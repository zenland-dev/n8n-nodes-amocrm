import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { omitEmpty } from '../../helpers/query';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';

const ENDPOINT = '/api/v4/events';
const COLLECTION = 'events';

/** amoCRM.ru caps an events page at 100 while Kommo allows 250; 100 works on both. */
const MAX_PAGE_SIZE = 100;

/** amoCRM rejects more than ten values in either of these filters. */
const MAX_FILTER_VALUES = 10;

const PER_FIELD_TYPE = /^custom_field_\d+_value_changed$/;

function toUnixSeconds(value: unknown): number | string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return Math.floor(value);

	const text = String(value).trim();
	if (/^\d+$/.test(text)) return Number(text);

	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? text : Math.floor(parsed / 1000);
}

function rangeFilter(from: unknown, to: unknown): IDataObject | undefined {
	const range = omitEmpty({ from: toUnixSeconds(from), to: toUnixSeconds(to) });
	return Object.keys(range).length === 0 ? undefined : range;
}

function commaSeparated(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

function withParam(options: IDataObject): string | undefined {
	const values = (options.with ?? []) as string[];
	return values.length === 0 ? undefined : values.join(',');
}

/**
 * The three combinations amoCRM refuses, checked before the request goes out.
 *
 * Each of them answers with a bare 400 that names no parameter, so the user is left
 * guessing which of half a dozen filters was the wrong one. The rules are documented,
 * and none of them can be worked around by sending fewer values — silently dropping
 * the eleventh id would return rows the user did not ask for and never notice.
 */
function assertFilterLimits(
	this: IExecuteFunctions,
	types: string[],
	entities: string[],
	entityIds: string[],
	createdBy: unknown[],
	itemIndex: number,
): void {
	if (types.some((type) => PER_FIELD_TYPE.test(type)) && types.length > 1) {
		throw new NodeOperationError(
			this.getNode(),
			'A custom_field_<field ID>_value_changed event type cannot be combined with any other type',
			{
				description:
					'amoCRM accepts the per-field form on its own only. Filter on one field per request, or drop it and use custom_field_value_changed for every field at once.',
				itemIndex,
			},
		);
	}

	if (entityIds.length > 0 && entities.length !== 1) {
		throw new NodeOperationError(
			this.getNode(),
			'Filtering by Entity ID needs exactly one entity type',
			{
				description:
					'amoCRM cannot tell which kind of entity an id belongs to, so Entity Type has to name exactly one — lead, contact, company, customer or task.',
				itemIndex,
			},
		);
	}

	if (entityIds.length > MAX_FILTER_VALUES) {
		throw new NodeOperationError(
			this.getNode(),
			`Entity ID takes at most ${MAX_FILTER_VALUES} IDs, and ${entityIds.length} were given`,
			{ itemIndex },
		);
	}

	if (createdBy.length > MAX_FILTER_VALUES) {
		throw new NodeOperationError(
			this.getNode(),
			`Created By takes at most ${MAX_FILTER_VALUES} users, and ${createdBy.length} were chosen`,
			{ itemIndex },
		);
	}
}

function listFilter(this: IExecuteFunctions, filters: IDataObject, itemIndex: number): IDataObject {
	const filter: IDataObject = {};

	const ids = commaSeparated(filters.ids);
	const types = (filters.type ?? []) as string[];
	const entities = (filters.entity ?? []) as string[];
	const entityIds = commaSeparated(filters.entityId);
	const createdBy = (filters.created_by ?? []) as unknown[];

	assertFilterLimits.call(this, types, entities, entityIds, createdBy, itemIndex);

	if (ids.length > 0) filter.id = ids;
	if (types.length > 0) filter.type = types;
	if (entities.length > 0) filter.entity = entities;
	if (entityIds.length > 0) filter.entity_id = entityIds;
	if (createdBy.length > 0) filter.created_by = createdBy;

	const createdAt = rangeFilter(filters.createdAtFrom, filters.createdAtTo);
	if (createdAt !== undefined) filter.created_at = createdAt;

	return filter;
}

/**
 * Turns the Value Filters collection into `filter[value_after]` or `[value_before]`.
 *
 * The keys here are amoCRM's filter keys, which differ from the keys the same event
 * answers with: `leads_statuses` in, `lead_status` out; `responsible_user_id` in,
 * `responsible_user` out. Copying a key out of a response into this filter is the
 * mistake the docs never warn about.
 */
function valueFilter(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const collection = this.getNodeParameter('valueFilters', itemIndex, {}) as IDataObject;
	const value: IDataObject = {};

	const status = omitEmpty({
		pipeline_id: collection.pipelineId,
		status_id: collection.statusId,
	});
	if (Object.keys(status).length > 0) value.leads_statuses = [status];

	if (collection.responsibleUserId !== undefined && collection.responsibleUserId !== '') {
		value.responsible_user_id = collection.responsibleUserId;
	}
	if (collection.customFieldValue !== undefined && collection.customFieldValue !== '') {
		value.custom_field_values = collection.customFieldValue;
	}
	if (collection.value !== undefined && collection.value !== '') {
		value.value = collection.value;
	}

	if (Object.keys(value).length === 0) return {};

	const key = collection.appliesTo === 'valueBefore' ? 'value_before' : 'value_after';
	return { [key]: value };
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const eventId = String(this.getNodeParameter('eventId', itemIndex, '') ?? '').trim();
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	if (eventId === '') {
		throw new NodeOperationError(this.getNode(), 'No event ID was given', {
			description: 'An event ID is a ULID string such as 01pz58t6p04ymgsgfbmfyfy1mf.',
			itemIndex,
		});
	}

	const event = (await amoCrmApiRequest.call(this, 'GET', `${ENDPOINT}/${eventId}`, undefined, {
		with: withParam(options),
	})) as IDataObject | undefined;

	// An unknown id answers 204 with an empty body rather than a 404.
	if (event === undefined) {
		throw new NodeOperationError(this.getNode(), `No event with ID ${eventId}`, {
			description:
				'amoCRM answers an unknown or inaccessible id with an empty response, so this may also mean the account cannot see that entity.',
			itemIndex,
		});
	}

	return [{ json: event }];
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {
		with: withParam(options),
		filter: { ...listFilter.call(this, filters, itemIndex), ...valueFilter.call(this, itemIndex) },
	};

	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);
	const rows = await amoCrmApiRequestAllItems.call(this, ENDPOINT, COLLECTION, qs, {
		limit,
		pageSize: limit === undefined ? MAX_PAGE_SIZE : Math.min(limit, MAX_PAGE_SIZE),
	});

	return rows.map((row) => ({ json: row }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'get') return await get.call(this, itemIndex);
	if (operation === 'getAll') return await getAll.call(this, itemIndex);

	throw new NodeOperationError(
		this.getNode(),
		`The event resource has no operation "${operation}"`,
		{ itemIndex },
	);
}
