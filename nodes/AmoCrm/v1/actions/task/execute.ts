import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toUnixSeconds } from '../../helpers/dates';
import { omitEmpty } from '../../helpers/query';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';
import type { BatchConfig } from '../types';
import {
	FILTER_ID_PARAMETERS,
	FILTER_TYPE_PARAMETER,
	TARGET_ID_PARAMETERS,
	TARGET_TYPE_PARAMETER,
} from './description';

const TASKS_ENDPOINT = '/api/v4/tasks';


function toNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Splits "7087, 7088" into the array amoCRM's `filter[id][]` syntax expects. */
function splitIds(value: unknown): number[] {
	return String(value ?? '')
		.split(',')
		.map((part) => Number(part.trim()))
		.filter((id) => Number.isFinite(id) && id !== 0);
}

/**
 * Reads the "Linked To" pair back out of the node.
 *
 * The picker for the chosen type is the only one on screen, so its value is the
 * entity id; every other picker keeps whatever the user left in it and is ignored.
 *
 * A write needs both halves. A filter does not: `filter[entity_type]=leads` on its
 * own is a legitimate query for "every task hanging on any lead", so an empty
 * picker there narrows the search rather than breaking it.
 */
async function readEntityTarget(
	this: IExecuteFunctions,
	itemIndex: number,
	typeParameter: string,
	idParameters: Record<string, string>,
	options: { requireId: boolean },
): Promise<{ entity_type: string; entity_id?: number } | undefined> {
	const entityType = String(this.getNodeParameter(typeParameter, itemIndex, '') ?? '');
	const idParameter = idParameters[entityType];
	if (idParameter === undefined) return undefined;

	const entityId = toNumber(
		this.getNodeParameter(idParameter, itemIndex, '', { extractValue: true }),
	);

	if (entityId === undefined && options.requireId) {
		throw new NodeOperationError(this.getNode(), 'The linked card has no ID', {
			itemIndex,
			description: `"Linked To" is set to ${entityType}, so a ${entityType.replace(/s$/, '')} has to be picked below it.`,
		});
	}

	return entityId === undefined
		? { entity_type: entityType }
		: { entity_type: entityType, entity_id: entityId };
}

/** Maps the Additional/Update Fields collection onto amoCRM's own field names. */
function taskFields(fields: IDataObject): IDataObject {
	const payload: IDataObject = omitEmpty({
		created_by: toNumber(fields.created_by),
		duration: toNumber(fields.duration),
		responsible_user_id: toNumber(fields.responsible_user_id),
		task_type_id: toNumber(fields.task_type_id),
		text: fields.text,
	});

	const createdAt = toUnixSeconds(fields.created_at);
	if (createdAt !== undefined) payload.created_at = createdAt;

	const completeTill = toUnixSeconds(fields.complete_till);
	if (completeTill !== undefined) payload.complete_till = completeTill;

	// A result is written as an object, but read back as `[]` when there is none.
	if (fields.result_text !== undefined && fields.result_text !== '') {
		payload.result = { text: String(fields.result_text) };
	}

	return payload;
}

async function buildCreatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const completeTill = toUnixSeconds(this.getNodeParameter('complete_till', itemIndex));

	if (completeTill === undefined) {
		throw new NodeOperationError(this.getNode(), 'The task has no deadline amoCRM can read', {
			itemIndex,
			description: 'Set Deadline to a date, or to a Unix timestamp in seconds.',
		});
	}

	const payload: IDataObject = {
		text: this.getNodeParameter('text', itemIndex) as string,
		complete_till: completeTill,
		...taskFields(this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject),
	};

	const target = await readEntityTarget.call(
		this,
		itemIndex,
		TARGET_TYPE_PARAMETER,
		TARGET_ID_PARAMETERS,
		{ requireId: true },
	);
	if (target !== undefined) Object.assign(payload, target);

	return payload;
}

function readTaskId(this: IExecuteFunctions, itemIndex: number): number {
	const taskId = toNumber(this.getNodeParameter('taskId', itemIndex, '', { extractValue: true }));

	if (taskId === undefined) {
		throw new NodeOperationError(this.getNode(), 'No task was picked', { itemIndex });
	}

	return taskId;
}

async function buildUpdatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const payload: IDataObject = {
		id: readTaskId.call(this, itemIndex),
		...taskFields(this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject),
	};

	const target = await readEntityTarget.call(
		this,
		itemIndex,
		TARGET_TYPE_PARAMETER,
		TARGET_ID_PARAMETERS,
		{ requireId: true },
	);
	if (target !== undefined) Object.assign(payload, target);

	return payload;
}

/**
 * Completing a task is a PATCH, not a `/complete` route.
 *
 * The result text is sent only when there is one: most accounts reject a close
 * without it, but the few that allow it would otherwise get an empty string
 * written into their feed.
 */
async function buildCompletePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const payload: IDataObject = {
		id: readTaskId.call(this, itemIndex),
		is_completed: true,
	};

	const resultText = String(this.getNodeParameter('result_text', itemIndex, '') ?? '').trim();
	if (resultText !== '') payload.result = { text: resultText };

	return payload;
}

/**
 * Sends one task and returns what amoCRM echoes back.
 *
 * The response to a write is deliberately thin — `{id, request_id, _links}` — and it
 * is returned as it comes, because the batched path in the router can do no better
 * and the two must not disagree about what a created task looks like.
 */
async function writeTasks(
	this: IExecuteFunctions,
	method: 'POST' | 'PATCH',
	payload: IDataObject,
): Promise<INodeExecutionData[]> {
	const response = (await amoCrmApiRequest.call(this, method, TASKS_ENDPOINT, [payload])) as
		| IDataObject
		| undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const rows = (embedded.tasks ?? []) as IDataObject[];

	return rows.map((row) => ({ json: row }));
}

async function buildListQuery(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const filter: IDataObject = {};

	if (filters.ids !== undefined && filters.ids !== '') filter.id = splitIds(filters.ids);

	const responsible = (filters.responsible_user_id ?? []) as Array<string | number>;
	if (responsible.length > 0) filter.responsible_user_id = responsible;

	const taskTypes = (filters.task_type ?? []) as Array<string | number>;
	// The filter is `task_type`, singular, even though the field on a task is `task_type_id`.
	if (taskTypes.length > 0) filter.task_type = taskTypes;

	// amoCRM wants 1 and 0 here; a JSON boolean is rejected.
	if (filters.is_completed !== undefined)
		filter.is_completed = filters.is_completed === true ? 1 : 0;

	const updatedFrom = toUnixSeconds(filters.updated_at_from);
	const updatedTo = toUnixSeconds(filters.updated_at_to);
	if (updatedFrom !== undefined || updatedTo !== undefined) {
		filter.updated_at = omitEmpty({ from: updatedFrom, to: updatedTo });
	}

	const target = await readEntityTarget.call(
		this,
		itemIndex,
		FILTER_TYPE_PARAMETER,
		FILTER_ID_PARAMETERS,
		{ requireId: false },
	);
	if (target !== undefined) {
		filter.entity_type = target.entity_type;
		if (target.entity_id !== undefined) filter.entity_id = target.entity_id;
	}

	const qs: IDataObject = {};
	if (Object.keys(filter).length > 0) qs.filter = filter;

	if (options.sortBy !== undefined && options.sortBy !== '') {
		qs.order = { [String(options.sortBy)]: String(options.sortOrder ?? 'desc') };
	}

	return qs;
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'create') {
		return await writeTasks.call(this, 'POST', await buildCreatePayload.call(this, itemIndex));
	}

	if (operation === 'update') {
		return await writeTasks.call(this, 'PATCH', await buildUpdatePayload.call(this, itemIndex));
	}

	if (operation === 'complete') {
		return await writeTasks.call(this, 'PATCH', await buildCompletePayload.call(this, itemIndex));
	}

	if (operation === 'get') {
		const taskId = readTaskId.call(this, itemIndex);
		const task = (await amoCrmApiRequest.call(this, 'GET', `${TASKS_ENDPOINT}/${taskId}`)) as
			| IDataObject
			| undefined;

		return task === undefined ? [] : [{ json: task }];
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
		const qs = await buildListQuery.call(this, itemIndex);

		const rows = await amoCrmApiRequestAllItems.call(this, TASKS_ENDPOINT, 'tasks', qs, { limit });

		return rows.map((row) => ({ json: row }));
	}

	throw new NodeOperationError(this.getNode(), `Unknown task operation "${operation}"`, {
		itemIndex,
	});
}

/**
 * Every task write goes to the same account-level endpoint, so all three of them
 * can be grouped once the user raises Batch Size — the payload builders are shared
 * with `execute` so the two paths cannot drift apart.
 */
export const batch: Record<string, BatchConfig> = {
	complete: {
		endpoint: TASKS_ENDPOINT,
		method: 'PATCH',
		collection: 'tasks',
		payload: buildCompletePayload,
	},
	create: {
		endpoint: TASKS_ENDPOINT,
		method: 'POST',
		collection: 'tasks',
		payload: buildCreatePayload,
	},
	update: {
		endpoint: TASKS_ENDPOINT,
		method: 'PATCH',
		collection: 'tasks',
		payload: buildUpdatePayload,
	},
};
