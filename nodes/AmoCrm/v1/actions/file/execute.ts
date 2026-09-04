import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { omitEmpty } from '../../helpers/query';
import { amoCrmApiRequest, chunk } from '../../transport';
import {
	ENTITY_TYPE_PARAMETER,
	LIST_ENTITY_TYPE_PARAMETER,
	LIST_ID_PARAMETERS,
	TARGET_ID_PARAMETERS,
} from './description';
import {
	downloadDriveFile,
	getDriveFile,
	listDriveFiles,
	resolveDriveUrl,
	uploadFileToDrive,
	withFileScopeHint,
} from './drive';

/**
 * A card holds links, not files, and amoCRM pages them with a `before_id` cursor —
 * a third pagination idiom, next to `/api/v4`'s page counter and the drive's next
 * link. The page size is deliberately modest: the endpoint documents `limit` but
 * not its maximum, and a card with hundreds of attachments is rare enough that
 * guessing high would only risk a rejected request.
 */
const ENTITY_FILES_PAGE_SIZE = 50;

/** How many UUIDs one storage lookup resolves while enriching a card's file list. */
const DETAIL_LOOKUP_SIZE = 50;

const MAX_PAGES = 200;

function readEntityType(
	this: IExecuteFunctions,
	itemIndex: number,
	parameter: string,
	idParameters: Record<string, string>,
): string {
	const entityType = String(this.getNodeParameter(parameter, itemIndex, 'leads') ?? '');

	if (idParameters[entityType] === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`"${entityType}" is not an entity type that holds files`,
			{
				itemIndex,
				description: 'Files can be linked to leads, contacts, companies and customers.',
			},
		);
	}

	return entityType;
}

function readEntityId(
	this: IExecuteFunctions,
	itemIndex: number,
	entityType: string,
	idParameters: Record<string, string>,
): string {
	const entityId = String(
		this.getNodeParameter(idParameters[entityType], itemIndex, '', { extractValue: true }) ?? '',
	).trim();

	if (entityId === '') {
		throw new NodeOperationError(this.getNode(), 'No entity was chosen', {
			itemIndex,
			description: 'Pick a card in the field above, or supply its ID with an expression.',
		});
	}

	return entityId;
}

/** The batch endpoints take a list, so one field may carry several UUIDs. */
function readFileUuids(this: IExecuteFunctions, itemIndex: number): string[] {
	const uuids = String(this.getNodeParameter('fileUuid', itemIndex, '') ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '');

	if (uuids.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No file UUID was given', {
			itemIndex,
			description: 'Upload answers with a "uuid" field; that is what belongs here.',
		});
	}

	return uuids;
}

/**
 * The name a file should be saved under.
 *
 * The drive stores the extension in `metadata` rather than in `name`, so the two
 * have to be put back together — otherwise every download lands as an extensionless
 * file that the operating system cannot open.
 */
function driveFileName(file: IDataObject): string {
	const name = String(file.name ?? '').trim();
	if (name === '') return 'file';

	const metadata = (file.metadata ?? {}) as IDataObject;
	const extension = String(metadata.extension ?? '').trim();

	if (extension === '' || name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) return name;

	return `${name}.${extension}`;
}

async function upload(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const inputField =
		String(this.getNodeParameter('inputDataFieldName', itemIndex, 'data') ?? '').trim() || 'data';
	const options = this.getNodeParameter('uploadOptions', itemIndex, {}) as IDataObject;

	const binary = this.helpers.assertBinaryData(itemIndex, inputField);
	const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, inputField);

	const file = await uploadFileToDrive.call(this, itemIndex, {
		buffer,
		fileName: String(options.fileName ?? '') || String(binary.fileName ?? '') || 'file',
		contentType: String(options.contentType ?? '') || String(binary.mimeType ?? '') || undefined,
		withPreview: options.withPreview === true ? true : undefined,
		fileUuid: String(options.fileUuid ?? '') || undefined,
	});

	return [{ json: file }];
}

/** `PUT` links a file to a card, `DELETE` unlinks it; the body is the same list. */
async function link(
	this: IExecuteFunctions,
	itemIndex: number,
	method: 'PUT' | 'DELETE',
): Promise<INodeExecutionData[]> {
	const entityType = readEntityType.call(
		this,
		itemIndex,
		ENTITY_TYPE_PARAMETER,
		TARGET_ID_PARAMETERS,
	);
	const entityId = readEntityId.call(this, itemIndex, entityType, TARGET_ID_PARAMETERS);
	const uuids = readFileUuids.call(this, itemIndex);

	// amoCRM answers 202 with no body on .ru and 200 with `{}` on Kommo, so the
	// confirmation has to be assembled here rather than passed through.
	const response = (await amoCrmApiRequest.call(
		this,
		method,
		`/api/v4/${entityType}/${entityId}/files`,
		uuids.map((uuid) => ({ file_uuid: uuid })),
	)) as IDataObject | undefined;

	return [
		{
			json: {
				success: true,
				entity_type: entityType,
				entity_id: Number(entityId),
				file_uuids: uuids,
				...(response ?? {}),
			},
		},
	];
}

async function addNote(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const entityType = readEntityType.call(
		this,
		itemIndex,
		ENTITY_TYPE_PARAMETER,
		TARGET_ID_PARAMETERS,
	);
	const entityId = readEntityId.call(this, itemIndex, entityType, TARGET_ID_PARAMETERS);
	const fileUuid = readFileUuids.call(this, itemIndex)[0];
	const options = this.getNodeParameter('noteOptions', itemIndex, {}) as IDataObject;

	// A feed entry with no file name renders as a nameless attachment, so when the
	// user did not supply one it is read off the file itself.
	const fileName =
		String(options.fileName ?? '') ||
		driveFileName(await getDriveFile.call(this, itemIndex, fileUuid));

	const note: IDataObject = omitEmpty({
		entity_id: Number(entityId),
		note_type: 'attachment',
		responsible_user_id:
			options.responsibleUserId === undefined || options.responsibleUserId === ''
				? undefined
				: Number(options.responsibleUserId),
	});

	note.params = omitEmpty({
		file_uuid: fileUuid,
		file_name: fileName,
		text: options.text,
		version_uuid: options.versionUuid,
	});

	const response = (await amoCrmApiRequest.call(this, 'POST', `/api/v4/${entityType}/notes`, [
		note,
	])) as IDataObject | undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const notes = (embedded.notes ?? []) as IDataObject[];

	return notes.length > 0
		? notes.map((row) => ({ json: row }))
		: [{ json: { success: true, entity_type: entityType, ...note } }];
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const fileUuid = readFileUuids.call(this, itemIndex)[0];

	return [{ json: await getDriveFile.call(this, itemIndex, fileUuid) }];
}

async function getLinks(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const fileUuid = readFileUuids.call(this, itemIndex)[0];

	// This one answers with a bare `entities` array and no `_embedded`, so it is
	// emitted whole rather than unwrapped like every other collection.
	const response = (await amoCrmApiRequest.call(
		this,
		'GET',
		`/api/v4/files/${encodeURIComponent(fileUuid)}/links`,
	)) as IDataObject | undefined;

	return [{ json: response ?? { file_uuid: fileUuid, entities: [] } }];
}

/** Turns the interface's filter collection into the drive's bracket query. */
function driveFilters(filters: IDataObject): IDataObject {
	const filter: IDataObject = {};

	if (filters.name !== undefined && filters.name !== '') filter.name = filters.name;
	if (filters.term !== undefined && filters.term !== '') filter.term = filters.term;
	if (filters.uuid !== undefined && filters.uuid !== '') filter.uuid = filters.uuid;

	const extensions = String(filters.extensions ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '');
	if (extensions.length > 0) filter.extensions = extensions;

	const createdBy = (filters.createdBy ?? []) as Array<string | number>;
	if (createdBy.length > 0) filter.created_by = createdBy.map((value) => Number(value));

	// The API documents this as a valueless flag; `1` is how a valueless flag
	// survives a query string that drops empty values.
	if (filters.deleted === true) filter.deleted = 1;

	const from = toUnixSeconds(filters.dateFrom);
	const to = toUnixSeconds(filters.dateTo);
	if (from !== undefined || to !== undefined) {
		filter.date = omitEmpty({
			type: String(filters.dateType ?? 'created_at'),
			from,
			to,
		});
	}

	return Object.keys(filter).length > 0 ? { filter } : {};
}

function toUnixSeconds(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return Math.floor(value);

	const text = String(value).trim();
	if (/^\d+$/.test(text)) return Number(text);

	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

async function listEntityFiles(
	this: IExecuteFunctions,
	itemIndex: number,
	entityType: string,
	entityId: string,
	limit?: number,
): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	let beforeId: number | undefined;

	for (let page = 0; page < MAX_PAGES; page++) {
		const qs: IDataObject = { limit: ENTITY_FILES_PAGE_SIZE };
		if (beforeId !== undefined) qs.before_id = beforeId;

		const response = (await amoCrmApiRequest.call(
			this,
			'GET',
			`/api/v4/${entityType}/${entityId}/files`,
			undefined,
			qs,
		)) as IDataObject | undefined;

		if (response === undefined) break;

		const embedded = (response._embedded ?? {}) as IDataObject;
		const batch = (embedded.files ?? []) as IDataObject[];
		rows.push(...batch);

		if (limit !== undefined && rows.length >= limit) return rows.slice(0, limit);
		if (batch.length < ENTITY_FILES_PAGE_SIZE) break;

		// The `id` on a row is the id of the link record, not of the file, and it is
		// what `before_id` walks back through.
		const cursor = Number(batch[batch.length - 1]?.id);
		if (!Number.isFinite(cursor)) break;
		beforeId = cursor;
	}

	return rows;
}

/** Replaces `{ file_uuid, id }` link rows with the files they point at. */
async function withFileDetails(
	this: IExecuteFunctions,
	itemIndex: number,
	rows: IDataObject[],
): Promise<IDataObject[]> {
	const uuids = rows.map((row) => String(row.file_uuid ?? '')).filter((uuid) => uuid !== '');
	if (uuids.length === 0) return rows;

	const driveUrl = await resolveDriveUrl.call(this, itemIndex);
	const files = new Map<string, IDataObject>();

	for (const group of chunk(uuids, DETAIL_LOOKUP_SIZE)) {
		const found = await listDriveFiles.call(
			this,
			itemIndex,
			{ filter: { uuid: group.join(',') } },
			{ limit: group.length, driveUrl },
		);

		for (const file of found) files.set(String(file.uuid ?? ''), file);
	}

	return rows.map((row) => {
		const file = files.get(String(row.file_uuid ?? ''));
		// A file that the storage no longer returns — trashed, or hidden from this
		// user — keeps its bare link row rather than dropping out of the result.
		return file === undefined ? row : { ...file, link_id: row.id };
	});
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);
	const source = String(this.getNodeParameter('source', itemIndex, 'entity') ?? 'entity');

	if (source === 'drive') {
		const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
		const files = await listDriveFiles.call(this, itemIndex, driveFilters(filters), { limit });

		return files.map((file) => ({ json: file }));
	}

	const entityType = readEntityType.call(
		this,
		itemIndex,
		LIST_ENTITY_TYPE_PARAMETER,
		LIST_ID_PARAMETERS,
	);
	const entityId = readEntityId.call(this, itemIndex, entityType, LIST_ID_PARAMETERS);
	const options = this.getNodeParameter('entityListOptions', itemIndex, {}) as IDataObject;

	const rows = await listEntityFiles.call(this, itemIndex, entityType, entityId, limit);
	const detailed =
		options.includeDetails === true ? await withFileDetails.call(this, itemIndex, rows) : rows;

	return detailed.map((row) => ({ json: row }));
}

async function download(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const fileUuid = readFileUuids.call(this, itemIndex)[0];
	const binaryPropertyName =
		String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data') ?? '').trim() || 'data';
	const options = this.getNodeParameter('downloadOptions', itemIndex, {}) as IDataObject;

	const driveUrl = await resolveDriveUrl.call(this, itemIndex);
	const file = await getDriveFile.call(this, itemIndex, fileUuid, driveUrl);
	const buffer = await downloadDriveFile.call(this, itemIndex, file);

	const metadata = (file.metadata ?? {}) as IDataObject;
	const binary = await this.helpers.prepareBinaryData(
		buffer,
		String(options.fileName ?? '') || driveFileName(file),
		String(metadata.mime_type ?? '') || undefined,
	);

	return [{ json: file, binary: { [binaryPropertyName]: binary } }];
}

async function remove(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const uuids = readFileUuids.call(this, itemIndex);
	const driveUrl = await resolveDriveUrl.call(this, itemIndex);

	// Deleting answers 204 with no body, and needs the separate «Удаление файлов»
	// permission on top of file access.
	await amoCrmApiRequest.call(
		this,
		'DELETE',
		'/v1.0/files',
		uuids.map((uuid) => ({ uuid })),
		undefined,
		{ baseUrl: driveUrl },
	);

	return [{ json: { success: true, deleted: uuids } }];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	try {
		if (operation === 'addNote') return await addNote.call(this, itemIndex);
		if (operation === 'attach') return await link.call(this, itemIndex, 'PUT');
		if (operation === 'delete') return await remove.call(this, itemIndex);
		if (operation === 'detach') return await link.call(this, itemIndex, 'DELETE');
		if (operation === 'download') return await download.call(this, itemIndex);
		if (operation === 'get') return await get.call(this, itemIndex);
		if (operation === 'getAll') return await getAll.call(this, itemIndex);
		if (operation === 'getLinks') return await getLinks.call(this, itemIndex);
		if (operation === 'upload') return await upload.call(this, itemIndex);
	} catch (error) {
		// Every call in this module can fail for one reason the API never spells out.
		throw withFileScopeHint(this.getNode(), error, itemIndex);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The file resource has no operation "${operation}"`,
		{
			itemIndex,
		},
	);
}
