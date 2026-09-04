import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError, randomInt, sleep } from 'n8n-workflow';

import { extractRetryAfterMs, extractStatusCode, toAmoCrmApiError } from '../helpers/errors';
import { flattenQuery, toBaseUrl } from '../helpers/query';
import { acquireSlot } from './rate-limiter';

/** Every context this node makes API calls from. */
export type AmoCrmContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions
	| IPollFunctions;

export interface AmoCrmRequestOptions {
	/** Return `{ body, headers, statusCode }` instead of just the parsed body. */
	fullResponse?: boolean;
	/** Extra headers, merged last. */
	headers?: IDataObject;
	/** Total attempts, including the first one. */
	maxAttempts?: number;
	/** Response decoding, for file downloads. */
	encoding?: IHttpRequestOptions['encoding'];
	/** Replaces the account base URL — used for the separate file-drive host. */
	baseUrl?: string;
}

/** Server errors worth a second try, but only for reads. */
const RETRYABLE_READ_STATUSES = new Set([500, 502, 503, 504]);

const MAX_PAGES = 1000;

interface AccountConnection {
	credentialType: 'amoCrmApi' | 'amoCrmOAuth2Api';
	baseUrl: string;
	requestsPerSecond: number;
}

async function resolveAccount(this: AmoCrmContext): Promise<AccountConnection> {
	// `getNodeParameter(name, 0)` is safe in every context: execute-style contexts
	// read the second argument as an item index, the others as a fallback value.
	const authentication = this.getNodeParameter('authentication', 0) as string;
	const credentialType = authentication === 'oAuth2' ? 'amoCrmOAuth2Api' : 'amoCrmApi';

	const credentials = await this.getCredentials(credentialType);
	const baseUrl = toBaseUrl(credentials.accountDomain);

	if (baseUrl === '') {
		throw new NodeOperationError(
			this.getNode(),
			'The amoCRM credential has no account address',
			{
				description:
					'Open the credential and fill in the account address, for example mycompany.amocrm.ru.',
			},
		);
	}

	const requestsPerSecond = Number(credentials.requestsPerSecond) || 7;

	return { credentialType, baseUrl, requestsPerSecond };
}

/** Waits 1s, 2s, 4s… with jitter, or honours `Retry-After` when the API sends one. */
function backoffDelay(attempt: number, error: unknown): number {
	const advertised = extractRetryAfterMs(error);
	if (advertised !== undefined) return Math.min(advertised, 60_000);

	const base = Math.min(2 ** (attempt - 1) * 1000, 16_000);
	return base + randomInt(250);
}

/**
 * One request against the amoCRM API, rate-limited and retried.
 *
 * The return type is deliberately loose: an endpoint may answer with one entity, a
 * collection, a full response or binary content, and every caller narrows it on the
 * spot. A union here would only move the casts around.
 *
 * 429 is retried for every method — amoCRM rejects such a request before touching
 * any data, so replaying a write is safe. Server errors are retried for reads only,
 * because a 504 on a batch write may have saved part of the batch. 403 is never
 * retried: when it is the rate-limit ban, retrying is what makes it permanent.
 */
export async function amoCrmApiRequest(
	this: AmoCrmContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | IDataObject[],
	qs?: IDataObject,
	options: AmoCrmRequestOptions = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous by design
): Promise<any> {
	const account = await resolveAccount.call(this);
	const baseURL = options.baseUrl ?? account.baseUrl;

	const requestOptions: IHttpRequestOptions = {
		method,
		baseURL,
		url: endpoint,
		json: true,
		returnFullResponse: true,
	};

	if (options.headers !== undefined) requestOptions.headers = options.headers;
	if (options.encoding !== undefined) requestOptions.encoding = options.encoding;
	if (body !== undefined) requestOptions.body = body as IDataObject;

	const query = flattenQuery(qs);
	if (Object.keys(query).length > 0) requestOptions.qs = query;

	const maxAttempts = options.maxAttempts ?? 4;

	for (let attempt = 1; ; attempt++) {
		await acquireSlot(baseURL, account.requestsPerSecond);

		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				account.credentialType,
				requestOptions,
			);

			// A search that matched nothing, and a fetch of an id that does not exist,
			// both answer 204 with an empty body. That is a result, not a failure.
			if (response.statusCode === 204) {
				return options.fullResponse === true ? response : undefined;
			}

			return options.fullResponse === true ? response : response.body;
		} catch (error) {
			const status = extractStatusCode(error);
			const retryable =
				status === 429 ||
				(method === 'GET' && status !== undefined && RETRYABLE_READ_STATUSES.has(status));

			if (retryable && attempt < maxAttempts) {
				await sleep(backoffDelay(attempt, error));
				continue;
			}

			throw toAmoCrmApiError(this.getNode(), error, status);
		}
	}
}

/**
 * Walks a paginated list endpoint and returns the rows from `_embedded[collection]`.
 *
 * Stops when amoCRM omits `_links.next`, which is the only reliable end marker —
 * a full page can still be the last one.
 */
export async function amoCrmApiRequestAllItems(
	this: AmoCrmContext,
	endpoint: string,
	collection: string,
	qs: IDataObject = {},
	options: { limit?: number; pageSize?: number } = {},
): Promise<IDataObject[]> {
	const pageSize = Math.max(1, Math.min(options.pageSize ?? 250, 250));
	const results: IDataObject[] = [];

	for (let page = 1; page <= MAX_PAGES; page++) {
		const response = (await amoCrmApiRequest.call(this, 'GET', endpoint, undefined, {
			...qs,
			page,
			limit: pageSize,
		})) as IDataObject | undefined;

		if (response === undefined) break;

		const embedded = (response._embedded ?? {}) as IDataObject;
		const rows = (embedded[collection] ?? []) as IDataObject[];
		results.push(...rows);

		if (options.limit !== undefined && results.length >= options.limit) {
			return results.slice(0, options.limit);
		}

		const links = (response._links ?? {}) as IDataObject;
		if (links.next === undefined || rows.length === 0) break;
	}

	return results;
}

/** Splits a batch into chunks amoCRM will accept without timing out. */
export function chunk<T>(items: T[], size: number): T[][] {
	const safeSize = Math.max(1, Math.min(size, 250));
	const chunks: T[][] = [];

	for (let index = 0; index < items.length; index += safeSize) {
		chunks.push(items.slice(index, index + safeSize));
	}

	return chunks;
}
