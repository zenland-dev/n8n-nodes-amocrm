import type { IDataObject, IExecuteFunctions, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { omitEmpty, toBaseUrl } from '../../helpers/query';
import { amoCrmApiRequest } from '../../transport';
import { amoCrmCachedRequest } from '../../transport/cache';

/**
 * amoCRM keeps file storage on a host of its own — `drive-b.amocrm.ru`,
 * `drive-c.kommo.com` — sharded per account and reachable with the same OAuth
 * token as the rest of the API. The shard cannot be guessed from the subdomain,
 * so it is asked for and cached; a hardcoded host breaks half the accounts and
 * every Kommo one.
 */
const ACCOUNT_ENDPOINT = '/api/v4/account';

/** amoCRM's own default, used only when a session response omits the field. */
const DEFAULT_PART_SIZE = 524_288;

/** A list that never ends is a bug, not a large account. */
const MAX_PAGES = 200;

/**
 * Files are gated by permissions the node cannot ask for.
 *
 * They are checkboxes on the integration card, not OAuth scopes — amoCRM's OAuth
 * flow takes no `scope` parameter at all — so no token refresh and no reconnect
 * will ever clear this. A generic "403 forbidden" sends people hunting through
 * user rights instead.
 */
const FILE_SCOPE_HINT =
	'Files need permissions of their own, granted on the integration card in amoCRM: «Доступ к файлам» (Access to files) for everything here, plus «Удаление файлов» (File deletion) for Delete. They are checkboxes on the integration, not OAuth scopes, so reconnecting the credential cannot grant them. A 403 from the file API is far more often a missing checkbox than a rights or IP problem.';

export interface AbsoluteTarget {
	baseUrl: string;
	path: string;
}

/**
 * Splits an absolute link the drive handed back into the two halves the transport
 * wants.
 *
 * Passing the whole URL as the endpoint would work — the HTTP layer ignores the
 * base URL when the path is absolute — but the rate limiter is keyed on the base
 * URL, so the request would be charged to the account host while hitting the
 * drive. Two hosts sharing one budget is how an upload gets the account banned.
 */
export function splitAbsoluteUrl(href: unknown, node: INode, itemIndex: number): AbsoluteTarget {
	const raw = String(href ?? '').trim();
	const match = /^(https?:\/\/[^/?#]+)([/?#].*)?$/i.exec(raw);

	if (match === null) {
		throw new NodeOperationError(node, 'amoCRM returned a link this node cannot follow', {
			itemIndex,
			description:
				raw === ''
					? 'The response carried no URL where one was expected.'
					: `Expected an absolute http(s) URL, got "${raw}".`,
		});
	}

	return { baseUrl: match[1], path: match[2] ?? '/' };
}

/** Re-raises a file failure with the one explanation that is usually right. */
export function withFileScopeHint(node: INode, error: unknown, itemIndex: number): Error {
	if (String((error as { httpCode?: unknown })?.httpCode ?? '') !== '403') {
		return error instanceof Error ? error : new Error(String(error));
	}

	return new NodeApiError(node, error as JsonObject, {
		message: 'amoCRM refused the file request',
		description: FILE_SCOPE_HINT,
		httpCode: '403',
		itemIndex,
	});
}

/** The account's file-storage host, memoised for a minute by the shared cache. */
export async function resolveDriveUrl(this: IExecuteFunctions, itemIndex: number): Promise<string> {
	const account = (await amoCrmCachedRequest.call(this, ACCOUNT_ENDPOINT, {
		with: 'drive_url',
	})) as IDataObject | undefined;

	const driveUrl = toBaseUrl(account?.drive_url);

	if (driveUrl === '') {
		throw new NodeOperationError(this.getNode(), 'This amoCRM account exposes no file storage', {
			itemIndex,
			description:
				'GET /api/v4/account?with=drive_url answered without a drive_url. That happens when the integration has no access to files, or when the account predates the Files API.',
		});
	}

	return driveUrl;
}

export interface UploadInput {
	buffer: Buffer;
	fileName: string;
	contentType?: string;
	withPreview?: boolean;
	/** Set to store the bytes as a new version of a file that already exists. */
	fileUuid?: string;
}

/**
 * Uploads one buffer through amoCRM's chunked session and returns the file model.
 *
 * The flow is a session, then N sequential chunk posts, and no separate "finish"
 * call: each answer hands back a fresh `next_url` to post the following chunk to,
 * and the last one answers with the file itself instead. Posting every chunk to
 * the original URL — the obvious reading — fails after the first one.
 *
 * Chunks are sized from `max_part_size` in the session response and never from a
 * constant: the vendor's own pages disagree about the value (524288 in the schema,
 * 131072 in the prose), so only the server's answer can be trusted.
 */
export async function uploadFileToDrive(
	this: IExecuteFunctions,
	itemIndex: number,
	input: UploadInput,
): Promise<IDataObject> {
	const node = this.getNode();

	if (input.buffer.length === 0) {
		throw new NodeOperationError(node, 'The binary field holds no data', {
			itemIndex,
			description: 'amoCRM rejects a zero-byte upload session, so nothing was sent.',
		});
	}

	const driveUrl = await resolveDriveUrl.call(this, itemIndex);

	const session = (await amoCrmApiRequest.call(
		this,
		'POST',
		'/v1.0/sessions',
		omitEmpty({
			file_name: input.fileName,
			file_size: input.buffer.length,
			content_type: input.contentType,
			file_uuid: input.fileUuid,
			with_preview: input.withPreview,
		}),
		undefined,
		{ baseUrl: driveUrl },
	)) as IDataObject | undefined;

	if (session === undefined) {
		throw new NodeOperationError(node, 'amoCRM did not open an upload session', { itemIndex });
	}

	const maxFileSize = Number(session.max_file_size);
	if (Number.isFinite(maxFileSize) && maxFileSize > 0 && input.buffer.length > maxFileSize) {
		throw new NodeOperationError(node, 'The file is larger than this account allows', {
			itemIndex,
			description: `The file is ${input.buffer.length} bytes and the account caps one upload at ${maxFileSize}.`,
		});
	}

	const partSize = Math.max(1, Math.floor(Number(session.max_part_size) || DEFAULT_PART_SIZE));
	let target = splitAbsoluteUrl(session.upload_url, node, itemIndex);
	let uploaded: IDataObject | undefined;

	for (let offset = 0; offset < input.buffer.length; offset += partSize) {
		const part = input.buffer.subarray(offset, Math.min(offset + partSize, input.buffer.length));

		// The chunk endpoint takes the raw bytes as the whole body. The transport types
		// `body` as an object because every other amoCRM endpoint is JSON; a Buffer
		// travels through the HTTP layer untouched, which is what is wanted here.
		const response = (await amoCrmApiRequest.call(
			this,
			'POST',
			target.path,
			part as unknown as IDataObject,
			undefined,
			{
				baseUrl: target.baseUrl,
				headers: { 'Content-Type': 'application/octet-stream' },
			},
		)) as IDataObject | undefined;

		if (response?.next_url !== undefined && response.next_url !== '') {
			target = splitAbsoluteUrl(response.next_url, node, itemIndex);
			continue;
		}

		uploaded = response;
		break;
	}

	if (uploaded?.uuid === undefined) {
		throw new NodeOperationError(node, 'The upload ended without amoCRM returning a file', {
			itemIndex,
			description:
				'Every chunk was accepted but the final answer carried no file UUID. The session may have expired mid-upload; retry, and reduce the file size if it keeps happening.',
		});
	}

	return uploaded;
}

/** One file's metadata, straight off the drive host. */
export async function getDriveFile(
	this: IExecuteFunctions,
	itemIndex: number,
	fileUuid: string,
	driveUrl?: string,
): Promise<IDataObject> {
	const baseUrl = driveUrl ?? (await resolveDriveUrl.call(this, itemIndex));

	const file = (await amoCrmApiRequest.call(
		this,
		'GET',
		`/v1.0/files/${encodeURIComponent(fileUuid)}`,
		undefined,
		undefined,
		{ baseUrl },
	)) as IDataObject | undefined;

	if (file === undefined) {
		throw new NodeOperationError(this.getNode(), `The storage holds no file ${fileUuid}`, {
			itemIndex,
		});
	}

	return file;
}

/**
 * Walks `GET /v1.0/files`.
 *
 * The drive paginates by handing back an absolute `_links.next` and no `page`
 * counter to increment — a different idiom from `/api/v4`, so the shared paginator
 * does not fit and the link is followed verbatim.
 */
export async function listDriveFiles(
	this: IExecuteFunctions,
	itemIndex: number,
	qs: IDataObject,
	options: { limit?: number; driveUrl?: string } = {},
): Promise<IDataObject[]> {
	const node = this.getNode();
	const driveUrl = options.driveUrl ?? (await resolveDriveUrl.call(this, itemIndex));

	let target: AbsoluteTarget = { baseUrl: driveUrl, path: '/v1.0/files' };
	let query: IDataObject | undefined = qs;
	const rows: IDataObject[] = [];

	for (let page = 0; page < MAX_PAGES; page++) {
		const response = (await amoCrmApiRequest.call(this, 'GET', target.path, undefined, query, {
			baseUrl: target.baseUrl,
		})) as IDataObject | undefined;

		if (response === undefined) break;

		const embedded = (response._embedded ?? {}) as IDataObject;
		rows.push(...((embedded.files ?? []) as IDataObject[]));

		if (options.limit !== undefined && rows.length >= options.limit) {
			return rows.slice(0, options.limit);
		}

		const links = (response._links ?? {}) as IDataObject;
		const next = (links.next ?? {}) as IDataObject;
		if (next.href === undefined || next.href === '') break;

		// The next link already carries the filters, so the query object is dropped
		// rather than merged — merging would re-apply the first page's cursor.
		target = splitAbsoluteUrl(next.href, node, itemIndex);
		query = undefined;
	}

	return rows;
}

/** Pulls a file's bytes back down, following the drive's own download link. */
export async function downloadDriveFile(
	this: IExecuteFunctions,
	itemIndex: number,
	file: IDataObject,
): Promise<Buffer> {
	const links = (file._links ?? {}) as IDataObject;
	const download = (links.download ?? {}) as IDataObject;
	const target = splitAbsoluteUrl(download.href, this.getNode(), itemIndex);

	const body = (await amoCrmApiRequest.call(this, 'GET', target.path, undefined, undefined, {
		baseUrl: target.baseUrl,
		encoding: 'arraybuffer',
		// The transport asks for JSON by default, and a download must not be
		// negotiated into an error document.
		headers: { Accept: '*/*' },
	})) as Buffer | ArrayBuffer | Uint8Array | undefined;

	if (body === undefined) {
		throw new NodeOperationError(this.getNode(), 'amoCRM returned an empty file', { itemIndex });
	}

	return Buffer.isBuffer(body) ? body : Buffer.from(body as ArrayBuffer);
}
