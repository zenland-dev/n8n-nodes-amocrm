import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { parseFieldSelection } from '../../helpers/customFields';
import { boundsOf, parseIdList, requireUnixSeconds, toIdArray } from './shared';

/** Filter parameter prefix → amoCRM range filter, plus the wording of its two inputs. */
const DATE_RANGES: Array<[string, string, string]> = [
	['createdAt', 'created_at', 'Created'],
	['updatedAt', 'updated_at', 'Updated'],
	['closedAt', 'closed_at', 'Closed'],
	['closestTaskAt', 'closest_task_at', 'Next Task'],
];

/** Sort keys are camelCase in the editor, snake_case in the API. */
const ORDER_FIELDS: Record<string, string> = {
	createdAt: 'created_at',
	id: 'id',
	updatedAt: 'updated_at',
};

/**
 * One end of a custom-field range.
 *
 * The same two inputs serve numeric and date fields, so a bare number is taken as
 * written — running `1500.5` through a date parser would only turn a valid bound
 * into an error.
 */
function boundValue(node: INode, raw: unknown, label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;

	const text = String(raw).trim();
	if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);

	return requireUnixSeconds(node, text, label);
}

/**
 * `filter[custom_fields_values][{field_id}]` — either a list of values to match, or a
 * `from`/`to` range for the numeric and date field types.
 *
 * amoCRM keys this filter on the numeric field id only; `field_code` is not accepted
 * here, and phone and e-mail fields are not filterable at all — those need `query`.
 */
function buildCustomFieldFilters(node: INode, collection: IDataObject): IDataObject {
	const entries = (collection.field ?? []) as IDataObject[];
	const filters: IDataObject = {};

	for (const entry of entries) {
		const { id } = parseFieldSelection(entry.fieldId);
		if (id === '') continue;

		const from = boundValue(node, entry.from, 'Custom field "From"');
		const to = boundValue(node, entry.to, 'Custom field "To"');
		const bounds = boundsOf(from, to);

		if (bounds !== undefined) {
			filters[id] = bounds;
			continue;
		}

		const values = String(entry.value ?? '')
			.split(',')
			.map((value) => value.trim())
			.filter((value) => value !== '');

		if (values.length > 0) filters[id] = values;
	}

	return filters;
}

/**
 * The whole `GET /api/v4/leads` query: `query`, `filter[...]`, `order[...]`, `with`.
 *
 * Nested objects and arrays survive as-is — the transport flattens them into amoCRM's
 * bracket syntax. `with` is the one exception: it is a single comma-separated string,
 * not a repeated parameter, so it is joined here.
 */
export function buildLeadListQuery(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const node = this.getNode();
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	const filter: IDataObject = {};

	const query = String(filters.query ?? '').trim();
	if (query !== '') qs.query = query;

	const ids = parseIdList(node, filters.ids, 'IDs');
	if (ids.length > 0) filter.id = ids;

	const name = String(filters.name ?? '').trim();
	if (name !== '') filter.name = name;

	const price = boundsOf(filters.priceFrom, filters.priceTo);
	if (price !== undefined) filter.price = price;

	for (const [parameter, field, label] of DATE_RANGES) {
		const bounds = boundsOf(
			requireUnixSeconds(node, filters[`${parameter}From`], `${label} After`),
			requireUnixSeconds(node, filters[`${parameter}To`], `${label} Before`),
		);

		if (bounds !== undefined) filter[field] = bounds;
	}

	const responsibleUserIds = toIdArray(filters.responsibleUserIds);
	if (responsibleUserIds.length > 0) filter.responsible_user_id = responsibleUserIds;

	const createdBy = toIdArray(filters.createdBy);
	if (createdBy.length > 0) filter.created_by = createdBy;

	const updatedBy = toIdArray(filters.updatedBy);
	if (updatedBy.length > 0) filter.updated_by = updatedBy;

	const pipelineId = filters.pipelineId;
	const hasPipeline = pipelineId !== undefined && pipelineId !== null && pipelineId !== '';
	if (hasPipeline) filter.pipeline_id = Number(pipelineId);

	const statusIds = toIdArray(filters.statusIds);
	if (statusIds.length > 0) {
		// A stage is the pair (pipeline, stage): ids 142 and 143 exist in every pipeline
		// of every account, so a bare stage id would match leads the user never asked for.
		if (!hasPipeline) {
			throw new NodeOperationError(node, 'Filtering by stage also needs a pipeline', {
				description:
					'amoCRM identifies a stage by the pipeline it belongs to, and reuses the "won" and "lost" ids across all of them. Add Pipeline to the same Filters collection.',
				itemIndex,
			});
		}

		filter.statuses = statusIds.map((statusId) => ({
			pipeline_id: Number(pipelineId),
			status_id: statusId,
		}));
	}

	const customFields = buildCustomFieldFilters(
		node,
		(filters.customFieldFiltersUi ?? {}) as IDataObject,
	);
	if (Object.keys(customFields).length > 0) filter.custom_fields_values = customFields;

	if (Object.keys(filter).length > 0) qs.filter = filter;

	const withValues = (options.with ?? []) as string[];
	if (withValues.length > 0) qs.with = withValues.join(',');

	const orderBy = String(options.orderBy ?? '');
	if (orderBy !== '') {
		const direction = String(options.orderDirection ?? 'asc');
		qs.order = { [ORDER_FIELDS[orderBy] ?? orderBy]: direction };
	}

	return qs;
}
