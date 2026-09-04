import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { amoCrmApiRequest } from '../../transport';

/**
 * The escape hatch: any call to the account's API, through the same authenticated
 * and rate-limited transport the modelled resources use.
 *
 * It exists so that an endpoint this node does not cover — a new one, a beta one,
 * one gated behind a module — never forces the user out into a bare HTTP Request
 * node, where they would have to rebuild the credential, the token refresh, the
 * seven-per-second budget and the error messages by hand.
 */
const METHODS: IHttpRequestMethods[] = ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'];

/** Methods whose request carries a body. DELETE does here: amoCRM uses one. */
const METHODS_WITH_BODY = ['DELETE', 'PATCH', 'POST', 'PUT'];

/** The same ceiling the paginating transport helper uses, for the same reason. */
const MAX_PAGES = 1000;

function showFor(extra: Record<string, string[]> = {}): INodeProperties['displayOptions'] {
	return { show: { resource: ['customRequest'], operation: ['request'], ...extra } };
}

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'request',
		displayOptions: { show: { resource: ['customRequest'] } },
		options: [
			{
				name: 'Request',
				value: 'request',
				description:
					'Send any call to the account API. Use it for endpoints this node does not model; authentication, the rate limit and the error messages are the same as everywhere else.',
				action: 'Make a custom request',
			},
		],
	},
	{
		displayName: 'Method',
		name: 'method',
		type: 'options',
		default: 'GET',
		displayOptions: showFor(),
		description: 'HTTP method of the request',
		options: [
			{ name: 'DELETE', value: 'DELETE' },
			{ name: 'GET', value: 'GET' },
			{ name: 'PATCH', value: 'PATCH' },
			{ name: 'POST', value: 'POST' },
			{ name: 'PUT', value: 'PUT' },
		],
	},
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		required: true,
		default: '',
		placeholder: '/api/v4/leads',
		displayOptions: showFor(),
		description:
			'Path relative to the account address in the credential, such as /api/v4/leads or /api/v4/leads/123/notes. Leave the https://mycompany.amocrm.ru part out — this node only ever calls the account it is authenticated against.',
	},
	{
		displayName: 'Query Parameters',
		name: 'queryParametersUi',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Query Parameter',
		default: {},
		displayOptions: showFor(),
		description:
			'Sent as they are written. amoCRM uses PHP bracket keys, so type them out in full, as in filter[created_at][from], filter[responsible_user_id][0] or order[updated_at]. A repeated key needs its own index rather than a second row with the same name.',
		options: [
			{
				name: 'parameter',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						placeholder: 'filter[created_at][from]',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'json',
		default: '{}',
		displayOptions: showFor({ method: METHODS_WITH_BODY }),
		description:
			'JSON body, sent exactly as written. amoCRM expects an array at collection routes (POST /api/v4/leads) and a bare object at single-entity ones (PATCH /api/v4/leads/123). Leave it empty for a request that carries no body.',
	},
	...returnAllProperties(showFor({ method: ['GET'] })),
	{
		displayName: 'Response Format',
		name: 'responseFormat',
		type: 'options',
		default: 'auto',
		displayOptions: showFor(),
		description: 'How to turn the response into n8n items',
		options: [
			{
				name: 'Automatic',
				value: 'auto',
				description:
					'One item per row for a list response, one item carrying the body for anything else',
			},
			{
				name: 'Whole Response',
				value: 'whole',
				description: 'One item per response, holding the body exactly as amoCRM sent it',
			},
		],
	},
];

function readMethod(context: IExecuteFunctions, itemIndex: number): IHttpRequestMethods {
	const method = String(context.getNodeParameter('method', itemIndex, 'GET')).toUpperCase();

	if (!METHODS.includes(method as IHttpRequestMethods)) {
		throw new NodeOperationError(context.getNode(), `"${method}" is not a method this node sends`, {
			itemIndex,
			description: `Pick one of ${METHODS.join(', ')}.`,
		});
	}

	return method as IHttpRequestMethods;
}

/**
 * The path, checked before it is sent.
 *
 * A full URL is refused rather than quietly stripped: the credential decides which
 * account is called, and a request that looks like it points somewhere else would
 * otherwise carry this account's token to that host.
 */
function readPath(context: IExecuteFunctions, itemIndex: number): string {
	const path = String(context.getNodeParameter('path', itemIndex, '') ?? '').trim();

	if (path === '') {
		throw new NodeOperationError(context.getNode(), 'A custom request needs a path', {
			itemIndex,
			description:
				'For example /api/v4/leads. The account address comes from the credential, so only the path belongs here.',
		});
	}

	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
		throw new NodeOperationError(context.getNode(), 'The path must not be a full URL', {
			itemIndex,
			description:
				'Drop the scheme and host and keep the path, as in /api/v4/leads. This node sends every request to the account in the credential and cannot call another host.',
		});
	}

	return path.startsWith('/') ? path : `/${path}`;
}

/** Query parameters from the editor, empty rows dropped. */
function readQuery(context: IExecuteFunctions, itemIndex: number): IDataObject {
	const ui = context.getNodeParameter('queryParametersUi', itemIndex, {}) as IDataObject;
	const rows = (ui.parameter ?? []) as IDataObject[];

	const qs: IDataObject = {};

	for (const row of rows) {
		const name = String(row.name ?? '').trim();
		if (name === '') continue;
		qs[name] = row.value;
	}

	return qs;
}

/** The JSON body, or undefined when the request carries none. */
function readBody(
	context: IExecuteFunctions,
	itemIndex: number,
	method: IHttpRequestMethods,
): IDataObject | IDataObject[] | undefined {
	if (!METHODS_WITH_BODY.includes(method)) return undefined;

	const raw = context.getNodeParameter('body', itemIndex, '');

	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'object') return raw as IDataObject | IDataObject[];

	const text = String(raw).trim();
	if (text === '') return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), 'The body is not valid JSON', {
			itemIndex,
			description: `${error instanceof Error ? error.message : String(error)}. amoCRM takes JSON only; an expression that returns an object works too.`,
		});
	}

	if (parsed === null || typeof parsed !== 'object') {
		throw new NodeOperationError(
			context.getNode(),
			'The body must be a JSON object or a JSON array',
			{
				itemIndex,
				description:
					'amoCRM reads a bare object at single-entity routes and an array at collection routes. A number or a string on its own is never a valid body.',
			},
		);
	}

	return parsed as IDataObject | IDataObject[];
}

/**
 * Whether a response is a paginated collection.
 *
 * The check is deliberately narrow. A single entity also carries `_embedded` — a
 * lead brings its tags and contacts along — so splitting on `_embedded` alone would
 * emit the tags and throw the lead away. A list envelope is recognised by the
 * paging fields beside it.
 */
function isListResponse(body: IDataObject): boolean {
	if (typeof body._embedded !== 'object' || body._embedded === null) return false;

	const links = (body._links ?? {}) as IDataObject;

	return (
		body._page !== undefined ||
		body._page_count !== undefined ||
		body._total_items !== undefined ||
		links.next !== undefined
	);
}

/** Every row under `_embedded`, whatever the collection is called. */
function listRows(body: IDataObject): IDataObject[] {
	const embedded = (body._embedded ?? {}) as IDataObject;

	return Object.values(embedded).flatMap((value) => (Array.isArray(value) ? value : []));
}

/** `_links.next`, as a path this account can be asked for again. */
function nextPath(body: IDataObject): string | undefined {
	const links = (body._links ?? {}) as IDataObject;
	const next = links.next;

	const href =
		typeof next === 'string'
			? next
			: ((next as IDataObject | undefined)?.href as string | undefined);

	if (href === undefined || href === '') return undefined;

	// Only the path and query are taken from the link. The host is not: following a
	// URL out of a response body is how an authenticated call ends up sending this
	// account's token somewhere it was never meant to go.
	try {
		const parsed = new URL(href);
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return href.startsWith('/') ? href : undefined;
	}
}

function toItems(response: unknown, responseFormat: string): INodeExecutionData[] {
	// 204, and a 202 with an empty body, both arrive here as nothing at all. The call
	// did succeed, so the item says so rather than being dropped.
	if (response === undefined || response === null || response === '') {
		return [{ json: { success: true } }];
	}

	if (typeof response !== 'object') return [{ json: { data: response } }];
	if (Array.isArray(response)) return (response as IDataObject[]).map((json) => ({ json }));

	const body = response as IDataObject;

	if (responseFormat === 'auto' && isListResponse(body)) {
		return listRows(body).map((json) => ({ json }));
	}

	return [{ json: body }];
}

/**
 * Walks `_links.next` until amoCRM stops offering one.
 *
 * A missing `next` is the only reliable end of a list — a full page can still be the
 * last one — and it is also what makes this work for the endpoints that page by
 * cursor rather than by page number: the link carries whatever they need.
 */
async function requestAllPages(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	responseFormat: string,
): Promise<INodeExecutionData[]> {
	const items: INodeExecutionData[] = [];

	let endpoint = path;
	let query: IDataObject | undefined = qs;

	for (let page = 0; page < MAX_PAGES; page++) {
		const response = (await amoCrmApiRequest.call(this, 'GET', endpoint, undefined, query)) as
			| IDataObject
			| undefined;

		if (response === undefined) break;

		items.push(...toItems(response, responseFormat));

		const following = nextPath(response);
		if (following === undefined) break;

		// The link already carries the query, so it must not be merged with the one
		// from the first request — that would re-apply `page=1` on every hop.
		endpoint = following;
		query = undefined;
	}

	return items;
}

async function request(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const method = readMethod(this, itemIndex);
	const path = readPath(this, itemIndex);
	const qs = readQuery(this, itemIndex);
	const body = readBody(this, itemIndex, method);
	const responseFormat = String(this.getNodeParameter('responseFormat', itemIndex, 'auto'));

	const returnAll =
		method === 'GET' && (this.getNodeParameter('returnAll', itemIndex, false) as boolean);

	if (returnAll) {
		return await requestAllPages.call(this, path, qs, responseFormat);
	}

	// Without "Return All" the request is sent exactly once, exactly as written. The
	// limit is applied to what came back rather than added to the query, so a `limit`
	// typed into Query Parameters stays the one amoCRM sees.
	const response = await amoCrmApiRequest.call(this, method, path, body, qs);
	const items = toItems(response, responseFormat);

	if (method !== 'GET' || items.length <= 1) return items;

	const limit = Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;

	return items.slice(0, Math.max(1, limit));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'request') return await request.call(this, itemIndex);

	throw new NodeOperationError(this.getNode(), `Unknown custom request operation "${operation}"`, {
		itemIndex,
	});
}
