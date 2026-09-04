import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildCustomFieldsValues,
	parseFieldSelection,
	simplifyCustomFields,
} from '../../helpers/customFields';
import { toUnixSeconds } from '../../helpers/dates';
import { omitEmpty } from '../../helpers/query';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';
import type { BatchConfig } from '../types';

const ENDPOINT = '/api/v4/companies';
const COLLECTION = 'companies';

/** Copies a value onto the request body, leaving untouched what the user left blank. */
function assign(target: IDataObject, key: string, value: unknown): void {
	if (value === undefined || value === null || value === '') return;
	target[key] = value;
}


/** Tag dropdowns hand back names; an expression may well hand back an id. */
function tagReferences(values: unknown[]): IDataObject[] {
	return values
		.map((value) => String(value ?? '').trim())
		.filter((value) => value !== '')
		.map((value) => (/^\d+$/.test(value) ? { id: Number(value) } : { name: value }));
}

/**
 * Tags go out as `tags_to_add` / `tags_to_delete` rather than `_embedded.tags`,
 * because the embedded form replaces the entity's whole tag set — every tag not
 * repeated in the request is detached.
 */
function applyTags(target: IDataObject, fields: IDataObject): void {
	const selected = (fields.tags ?? []) as unknown[];
	const typed = String(fields.newTags ?? '').split(',');
	const toAdd = tagReferences([...selected, ...typed]);
	if (toAdd.length > 0) target.tags_to_add = toAdd;

	const toDelete = tagReferences((fields.tagsToDelete ?? []) as unknown[]);
	if (toDelete.length > 0) target.tags_to_delete = toDelete;
}

/**
 * `metadata.is_main` is the write-side spelling of the main-contact flag; reads call
 * the same thing `main_contact`. It is only sent when the user asked for it, because
 * amoCRM documents the key on lead links and merely implies it for company links.
 */
function contactLinks(this: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const collection = this.getNodeParameter('contactsUi', itemIndex, {}) as IDataObject;
	const rows = (collection.entry ?? []) as IDataObject[];
	const links: IDataObject[] = [];

	for (const row of rows) {
		const contactId = String(row.contactId ?? '').trim();
		if (!/^\d+$/.test(contactId)) continue;

		const link: IDataObject = { to_entity_id: Number(contactId), to_entity_type: 'contacts' };
		if (row.isMain === true) link.metadata = { is_main: true };

		links.push(link);
	}

	return links;
}

/**
 * Attaching contacts is a second request against the written company, and the
 * batched path only ever sends one. Refusing up front beats writing the companies
 * and quietly dropping the links the user asked for.
 */
function assertContactLinksFitBatch(this: IExecuteFunctions, itemIndex: number): void {
	const batchSize = Number(this.getNodeParameter('batchSize', 0, 1)) || 1;
	if (batchSize <= 1) return;
	if (contactLinks.call(this, itemIndex).length === 0) return;

	throw new NodeOperationError(this.getNode(), 'Attaching contacts needs Batch Size set to 1', {
		description:
			'amoCRM links contacts to a company through a separate request, which a batched write does not make. Set Batch Size to 1, or attach the contacts afterwards with the Link resource.',
		itemIndex,
	});
}

async function linkContacts(
	this: IExecuteFunctions,
	companyId: string,
	itemIndex: number,
): Promise<void> {
	const links = contactLinks.call(this, itemIndex);
	if (links.length === 0 || companyId === '') return;

	await amoCrmApiRequest.call(this, 'POST', `${ENDPOINT}/${companyId}/link`, links);
}

async function buildCreatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	assertContactLinksFitBatch.call(this, itemIndex);

	const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const payload: IDataObject = {};

	assign(payload, 'name', this.getNodeParameter('name', itemIndex, '') as string);
	assign(payload, 'responsible_user_id', fields.responsible_user_id);
	assign(payload, 'created_by', fields.created_by);
	assign(payload, 'created_at', toUnixSeconds(fields.createdAt));
	applyTags(payload, fields);

	const customFields = buildCustomFieldsValues(
		this.getNodeParameter('customFieldsUi', itemIndex, {}) as IDataObject,
		this.getNode(),
	);
	if (customFields.length > 0) payload.custom_fields_values = customFields;

	return payload;
}

async function buildUpdatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	assertContactLinksFitBatch.call(this, itemIndex);

	const companyId = String(
		this.getNodeParameter('companyId', itemIndex, '', { extractValue: true }) ?? '',
	).trim();

	if (companyId === '') {
		throw new NodeOperationError(this.getNode(), 'No company to update', {
			description: 'Pick a company, or give its ID, before running an update.',
			itemIndex,
		});
	}

	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	const payload: IDataObject = { id: Number(companyId) };

	assign(payload, 'name', fields.name);
	assign(payload, 'responsible_user_id', fields.responsible_user_id);
	assign(payload, 'updated_by', fields.updated_by);
	applyTags(payload, fields);

	const customFields = buildCustomFieldsValues(
		this.getNodeParameter('customFieldsUi', itemIndex, {}) as IDataObject,
		this.getNode(),
	);
	if (customFields.length > 0) payload.custom_fields_values = customFields;

	return payload;
}

/**
 * amoCRM answers a single-entity write with the same `_embedded` envelope it uses
 * for batches — its own docs show a bare object in one place and the envelope in
 * another, so both shapes are accepted here.
 */
function firstWritten(response: unknown): IDataObject {
	const envelope = (response ?? {}) as IDataObject;
	const embedded = (envelope._embedded ?? {}) as IDataObject;
	const rows = (embedded[COLLECTION] ?? []) as IDataObject[];

	return rows[0] ?? envelope;
}

function withParam(options: IDataObject): string | undefined {
	const values = (options.with ?? []) as string[];
	return values.length === 0 ? undefined : values.join(',');
}

function orderParam(options: IDataObject): IDataObject {
	const field = String(options.orderBy ?? '');
	if (field === '') return {};

	return { [field]: String(options.orderDirection ?? 'desc') };
}

function present(entity: IDataObject, options: IDataObject): IDataObject {
	return options.simplify === true ? simplifyCustomFields(entity) : entity;
}

function rangeFilter(from: unknown, to: unknown): IDataObject | undefined {
	const range = omitEmpty({ from: toUnixSeconds(from), to: toUnixSeconds(to) });
	return Object.keys(range).length === 0 ? undefined : range;
}

/** `filter[custom_fields_values][{field_id}]` — amoCRM keys these on the id, never the code. */
function customFieldFilters(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const collection = this.getNodeParameter('customFieldFiltersUi', itemIndex, {}) as IDataObject;
	const rows = (collection.filter ?? []) as IDataObject[];
	const result: IDataObject = {};

	for (const row of rows) {
		const { id } = parseFieldSelection(row.fieldId);
		if (id === '') continue;

		const range = omitEmpty({ from: row.from, to: row.to });
		if (Object.keys(range).length > 0) {
			result[id] = range;
			continue;
		}

		if (row.value !== undefined && row.value !== '') result[id] = [row.value];
	}

	return result;
}

function listFilter(this: IExecuteFunctions, filters: IDataObject, itemIndex: number): IDataObject {
	const filter: IDataObject = {};

	const ids = String(filters.ids ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id !== '');
	if (ids.length > 0) filter.id = ids;

	assign(filter, 'name', filters.name);

	for (const key of ['responsible_user_id', 'created_by', 'updated_by']) {
		const chosen = (filters[key] ?? []) as unknown[];
		if (chosen.length > 0) filter[key] = chosen;
	}

	assign(filter, 'created_at', rangeFilter(filters.createdAfter, filters.createdBefore));
	assign(filter, 'updated_at', rangeFilter(filters.updatedAfter, filters.updatedBefore));
	assign(filter, 'closest_task_at', rangeFilter(filters.closestTaskFrom, filters.closestTaskTo));

	const custom = customFieldFilters.call(this, itemIndex);
	if (Object.keys(custom).length > 0) filter.custom_fields_values = custom;

	return filter;
}

async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const payload = await buildCreatePayload.call(this, itemIndex);
	const response = await amoCrmApiRequest.call(this, 'POST', ENDPOINT, [payload]);
	const created = firstWritten(response);

	await linkContacts.call(this, String(created.id ?? ''), itemIndex);

	return [{ json: created }];
}

async function update(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const payload = await buildUpdatePayload.call(this, itemIndex);
	const companyId = String(payload.id);

	// The single-entity route takes a plain object; only the collection route takes
	// an array. Sending the wrong one is an unexplained 400.
	const response = await amoCrmApiRequest.call(this, 'PATCH', `${ENDPOINT}/${companyId}`, payload);

	await linkContacts.call(this, companyId, itemIndex);

	return [{ json: firstWritten(response) }];
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const companyId = String(
		this.getNodeParameter('companyId', itemIndex, '', { extractValue: true }) ?? '',
	).trim();
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const company = (await amoCrmApiRequest.call(this, 'GET', `${ENDPOINT}/${companyId}`, undefined, {
		with: withParam(options),
	})) as IDataObject | undefined;

	// An unknown or inaccessible id answers 204 with an empty body, not 404.
	if (company === undefined) {
		throw new NodeOperationError(this.getNode(), `No company with ID ${companyId}`, {
			description:
				'amoCRM answers an unknown or inaccessible id with an empty response, so this may also be a rights problem rather than a missing company.',
			itemIndex,
		});
	}

	return [{ json: present(company, options) }];
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {
		with: withParam(options),
		query: filters.query,
		filter: listFilter.call(this, filters, itemIndex),
		order: orderParam(options),
	};

	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);
	const rows = await amoCrmApiRequestAllItems.call(this, ENDPOINT, COLLECTION, qs, {
		limit,
		pageSize: limit === undefined ? 250 : Math.min(limit, 250),
	});

	return rows.map((row) => ({ json: present(row, options) }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'create':
			return await create.call(this, itemIndex);
		case 'get':
			return await get.call(this, itemIndex);
		case 'getAll':
			return await getAll.call(this, itemIndex);
		case 'update':
			return await update.call(this, itemIndex);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`Companies cannot do "${operation}" — amoCRM API v4 has no delete route for companies`,
				{ itemIndex },
			);
	}
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
