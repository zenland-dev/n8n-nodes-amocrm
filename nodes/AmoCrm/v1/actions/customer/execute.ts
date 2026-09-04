import type {
	IDataObject,
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { toUnixSeconds as parseTimestamp } from '../../helpers/dates';
import { buildCustomFieldsValues, simplifyCustomFields } from '../../helpers/customFields';
import { extractStatusCode, toAmoCrmApiError } from '../../helpers/errors';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';
import type { BatchConfig } from '../types';

const ENDPOINT = '/api/v4/customers';
const COLLECTION = 'customers';

/**
 * Customers is a feature an account switches on, and every route below answers 422
 * while it is off — with amoCRM's usual "Request validation failed", which sends the
 * user hunting through their parameters for a problem that is not there.
 *
 * `GET /api/v4/account` reports the real state in `customers_mode`, but probing it
 * before every call would cost a request per item, so the state is read from the
 * failure instead.
 */
async function withCustomersFeature<T>(node: INode, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (extractStatusCode(error) === 422) {
			throw new NodeApiError(node, error as JsonObject, {
				message: 'The Customers feature is switched off in this amoCRM account',
				description:
					'amoCRM answers 422 on the customer routes until Customers (Покупатели) is enabled, and some plans do not offer it at all. Switch it on in amoCRM, then retry — GET /api/v4/account reports the current state in customers_mode (unavailable, disabled, segments or periodicity).',
				httpCode: '422',
			});
		}

		throw toAmoCrmApiError(node, error);
	}
}

/** amoCRM stores every moment as Unix seconds; n8n hands over an ISO string. */
function toUnixSeconds(value: unknown, label: string, node: INode): number | undefined {
	const parsed = parseTimestamp(value);
	if (typeof parsed !== 'string') return parsed;

	throw new NodeOperationError(node, `"${label}" is not a date amoCRM can read: ${parsed}`);
}

function isFilled(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

/**
 * Tag references, from the dropdown and from the free-text box alike.
 *
 * The dropdown carries names rather than ids, because a tag typed by hand has no id
 * yet and amoCRM creates it on the spot. A numeric value still means an id — that is
 * what an expression fed from an earlier node produces.
 */
function tagReferences(selected: unknown, typed: unknown): IDataObject[] {
	const fromList = (Array.isArray(selected) ? selected : []).map((value) => String(value));
	const fromText = String(typed ?? '')
		.split(',')
		.map((name) => name.trim());

	const unique = [...new Set([...fromList, ...fromText])].filter((name) => name !== '');

	return unique.map((name) => (/^\d+$/.test(name) ? { id: Number(name) } : { name }));
}

/** Fields shared by create and update, in the shape the API takes for both. */
function applyCustomerFields(payload: IDataObject, fields: IDataObject, node: INode): void {
	if (isFilled(fields.name)) payload.name = String(fields.name);
	if (isFilled(fields.next_price)) payload.next_price = Number(fields.next_price);
	if (isFilled(fields.periodicity)) payload.periodicity = Number(fields.periodicity);
	if (isFilled(fields.status_id)) payload.status_id = Number(fields.status_id);
	if (isFilled(fields.responsible_user_id)) {
		payload.responsible_user_id = Number(fields.responsible_user_id);
	}

	// 0 is amoCRM's system user, so these two are compared against '' and not falsiness.
	if (isFilled(fields.created_by)) payload.created_by = Number(fields.created_by);
	if (isFilled(fields.updated_by)) payload.updated_by = Number(fields.updated_by);

	const nextDate = toUnixSeconds(fields.nextDate, 'Next Purchase Date', node);
	if (nextDate !== undefined) payload.next_date = nextDate;

	const createdAt = toUnixSeconds(fields.createdAt, 'Created At', node);
	if (createdAt !== undefined) payload.created_at = createdAt;

	// `tags_to_add` / `tags_to_delete` are used rather than `_embedded.tags`, which
	// replaces the whole set: a workflow that adds one tag would silently drop the rest.
	const toAdd = tagReferences(fields.tags, fields.newTags);
	if (toAdd.length > 0) payload.tags_to_add = toAdd;

	const toDelete = tagReferences(fields.tagsToDelete, '');
	if (toDelete.length > 0) payload.tags_to_delete = toDelete;

	const segments = (Array.isArray(fields.segments) ? fields.segments : []).map((id) => ({
		id: Number(id),
	}));
	if (segments.length > 0) payload._embedded = { segments };
}

function applyCustomFields(this: IExecuteFunctions, payload: IDataObject, itemIndex: number): void {
	const collection = this.getNodeParameter('customFieldsUi', itemIndex, {}) as IDataObject;
	const values = buildCustomFieldsValues(collection, this.getNode());

	if (values.length > 0) payload.custom_fields_values = values;
}

async function buildCreatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const node = this.getNode();
	const payload: IDataObject = { name: String(this.getNodeParameter('name', itemIndex)) };
	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;

	applyCustomerFields(payload, fields, node);
	applyCustomFields.call(this, payload, itemIndex);

	return payload;
}

/** Carries `id` inside the body, which is what the batch endpoint addresses rows by. */
async function buildUpdatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const node = this.getNode();
	const customerId = this.getNodeParameter('customerId', itemIndex, undefined, {
		extractValue: true,
	}) as string;

	const payload: IDataObject = { id: Number(customerId) };
	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;

	applyCustomerFields(payload, fields, node);
	applyCustomFields.call(this, payload, itemIndex);

	return payload;
}

/**
 * Reads the written rows out of a collection response.
 *
 * The fallback to `leads` is not defensive programming for its own sake: amoCRM's
 * own PATCH example wraps updated customers in `_embedded.leads`, and an integration
 * that trusts one key alone returns nothing on the day the API matches its docs.
 */
function writtenRows(response: IDataObject | undefined): IDataObject[] {
	const embedded = (response?._embedded ?? {}) as IDataObject;
	const rows = (embedded[COLLECTION] ?? embedded.leads ?? []) as IDataObject[];

	return rows;
}

function withParameter(options: IDataObject): string | undefined {
	const values = (options.with ?? []) as string[];
	return values.length > 0 ? values.join(',') : undefined;
}

function present(row: IDataObject, options: IDataObject): INodeExecutionData {
	return { json: options.simplify === true ? simplifyCustomFields(row) : row };
}

/** Turns the Filters collection into amoCRM's `filter[...]` tree. */
function buildListQuery(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const node = this.getNode();
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const filter: IDataObject = {};

	const ids = String(filters.ids ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id !== '');
	if (ids.length > 0) filter.id = ids.map(Number);

	if (isFilled(filters.name)) filter.name = String(filters.name);

	for (const key of ['status_id', 'responsible_user_id', 'created_by', 'updated_by']) {
		const values = (filters[key] ?? []) as Array<string | number>;
		if (values.length > 0) filter[key] = values.map(Number);
	}

	const ranges: Array<[string, string, string, boolean]> = [
		['created_at', 'createdAfter', 'createdBefore', true],
		['updated_at', 'updatedAfter', 'updatedBefore', true],
		['closest_task_at', 'closestTaskFrom', 'closestTaskTo', true],
		['next_date', 'nextDateFrom', 'nextDateTo', true],
		['next_price', 'nextPriceFrom', 'nextPriceTo', false],
	];

	for (const [target, fromKey, toKey, isDate] of ranges) {
		const range: IDataObject = {};

		const from = isDate ? toUnixSeconds(filters[fromKey], fromKey, node) : filters[fromKey];
		const to = isDate ? toUnixSeconds(filters[toKey], toKey, node) : filters[toKey];

		if (isFilled(from)) range.from = from;
		if (isFilled(to)) range.to = to;
		if (Object.keys(range).length > 0) filter[target] = range;
	}

	const customFilters = ((
		this.getNodeParameter('customFieldFiltersUi', itemIndex, {}) as IDataObject
	).filter ?? []) as IDataObject[];
	const byField: IDataObject = {};

	for (const entry of customFilters) {
		// The picker's value is `id::type`; only the id belongs in the query.
		const fieldId = String(entry.fieldId ?? '').split('::')[0];
		if (fieldId === '') continue;

		if (isFilled(entry.from) || isFilled(entry.to)) {
			const range: IDataObject = {};
			if (isFilled(entry.from)) range.from = entry.from;
			if (isFilled(entry.to)) range.to = entry.to;
			byField[fieldId] = range;
			continue;
		}

		if (isFilled(entry.value)) byField[fieldId] = [entry.value];
	}

	if (Object.keys(byField).length > 0) filter.custom_fields_values = byField;

	const qs: IDataObject = {};
	if (Object.keys(filter).length > 0) qs.filter = filter;
	if (isFilled(filters.query)) qs.query = String(filters.query);

	const withValue = withParameter(options);
	if (withValue !== undefined) qs.with = withValue;

	return qs;
}

async function executeCreate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const payload = await buildCreatePayload.call(this, itemIndex);

	// The collection endpoint takes an array even for a single customer.
	const response = (await withCustomersFeature(
		this.getNode(),
		async () => await amoCrmApiRequest.call(this, 'POST', ENDPOINT, [payload]),
	)) as IDataObject | undefined;

	const rows = writtenRows(response);

	return rows.length === 0 ? [{ json: response ?? {} }] : rows.map((row) => ({ json: row }));
}

async function executeUpdate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const { id, ...body } = await buildUpdatePayload.call(this, itemIndex);

	const response = (await withCustomersFeature(
		this.getNode(),
		async () =>
			await amoCrmApiRequest.call(this, 'PATCH', `${ENDPOINT}/${String(id)}`, body as IDataObject),
	)) as IDataObject | undefined;

	return [{ json: response ?? { id } }];
}

async function executeGet(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const customerId = this.getNodeParameter('customerId', itemIndex, undefined, {
		extractValue: true,
	}) as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	const withValue = withParameter(options);
	if (withValue !== undefined) qs.with = withValue;

	const response = (await withCustomersFeature(
		this.getNode(),
		async () =>
			await amoCrmApiRequest.call(this, 'GET', `${ENDPOINT}/${customerId}`, undefined, qs),
	)) as IDataObject | undefined;

	if (response === undefined) {
		throw new NodeOperationError(this.getNode(), `amoCRM has no customer with ID ${customerId}`, {
			itemIndex,
			description:
				'A customer that does not exist answers 204 No Content instead of 404, so this is what an unknown ID looks like.',
		});
	}

	return [present(response, options)];
}

async function executeGetAll(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const qs = buildListQuery.call(this, itemIndex);

	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);

	const rows = await withCustomersFeature(
		this.getNode(),
		async () =>
			await amoCrmApiRequestAllItems.call(this, ENDPOINT, COLLECTION, qs, {
				limit,
				pageSize: limit === undefined ? 250 : Math.min(limit, 250),
			}),
	);

	return rows.map((row) => present(row, options));
}

export const batch: Record<string, BatchConfig> = {
	create: {
		endpoint: ENDPOINT,
		method: 'POST',
		collection: COLLECTION,
		payload: buildCreatePayload,
	},
	update: {
		endpoint: ENDPOINT,
		method: 'PATCH',
		collection: COLLECTION,
		payload: buildUpdatePayload,
	},
};

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'create':
			return await executeCreate.call(this, itemIndex);
		case 'get':
			return await executeGet.call(this, itemIndex);
		case 'getAll':
			return await executeGetAll.call(this, itemIndex);
		case 'update':
			return await executeUpdate.call(this, itemIndex);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`The customer resource has no "${operation}" operation`,
				{ itemIndex },
			);
	}
}
