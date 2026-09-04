import type { IDataObject, IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { omitEmpty } from '../../helpers/query';
import { amoCrmApiRequest } from '../../transport';

const PIPELINES_ENDPOINT = '/api/v4/leads/pipelines';

/**
 * The two stage ids amoCRM keeps for itself.
 *
 * They are not per-pipeline ids that happen to repeat: 142 (won) and 143 (lost) are
 * literally those integers in every pipeline of every account, created with the
 * pipeline and flagged `is_editable: false`. Deleting one is refused by the API with
 * a message that does not say why, so this module refuses it first.
 */
const WON_STATUS_ID = 142;
const LOST_STATUS_ID = 143;

function toItems(rows: IDataObject[]): INodeExecutionData[] {
	return rows.map((row) => ({ json: row }));
}

function embeddedRows(response: IDataObject | undefined, collection: string): IDataObject[] {
	const embedded = (response?._embedded ?? {}) as IDataObject;
	return (embedded[collection] ?? []) as IDataObject[];
}

/**
 * Stages are addressed as `(pipeline, status)`, never by status id alone.
 *
 * Both endpoints below need the pipeline in the path, and the dropdown values 142
 * and 143 would otherwise be ambiguous across the account.
 */
function statusesEndpoint(pipelineId: string): string {
	return `${PIPELINES_ENDPOINT}/${pipelineId}/statuses`;
}

function buildStatusEntries(collection: IDataObject): IDataObject[] {
	const rows = (collection.entry ?? []) as IDataObject[];

	return rows
		.filter((row) => String(row.name ?? '') !== '' || Number(row.statusId ?? 0) > 0)
		.map((row) => {
			const status = omitEmpty({
				name: row.name,
				sort: row.sort,
				color: row.color,
			});

			const id = Number(row.statusId ?? 0);
			if (id > 0) status.id = id;

			return status;
		});
}

/**
 * Turns the stage-description editor into amoCRM's `descriptions` array.
 *
 * The API distinguishes the three cases by what is present: an id plus text edits,
 * text alone adds, and an id with no text deletes. Two rows on the same level are a
 * user mistake amoCRM rejects with a bare 422, so it is caught here instead.
 */
function buildDescriptions(collection: IDataObject, node: INode): IDataObject[] {
	const rows = (collection.entry ?? []) as IDataObject[];
	const levels = new Set<string>();
	const result: IDataObject[] = [];

	for (const row of rows) {
		const level = String(row.level ?? '');
		if (level === '') continue;

		if (levels.has(level)) {
			throw new NodeOperationError(
				node,
				`Two stage descriptions were given for the "${level}" level`,
				{
					description:
						'amoCRM stores at most one description per level, and at most three per stage.',
				},
			);
		}
		levels.add(level);

		const entry: IDataObject = { level };

		const id = Number(row.descriptionId ?? 0);
		if (id > 0) entry.id = id;

		const text = String(row.description ?? '');
		if (text !== '') entry.description = text;

		result.push(entry);
	}

	return result;
}

function limitRows(this: IExecuteFunctions, rows: IDataObject[], itemIndex: number): IDataObject[] {
	// Neither pipelines nor statuses take page/limit — an account holds at most 50
	// pipelines and 100 stages each, so the whole list arrives in one response and
	// the limit is applied here rather than by the API.
	if (this.getNodeParameter('returnAll', itemIndex, false) === true) return rows;

	const limit = Number(this.getNodeParameter('limit', itemIndex, 50));
	return rows.slice(0, limit);
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = this.getNode();

	if (operation === 'getAll') {
		const response = (await amoCrmApiRequest.call(this, 'GET', PIPELINES_ENDPOINT)) as
			| IDataObject
			| undefined;

		let rows = embeddedRows(response, 'pipelines');

		if (this.getNodeParameter('excludeArchived', itemIndex, false) === true) {
			rows = rows.filter((pipeline) => pipeline.is_archive !== true);
		}

		return toItems(limitRows.call(this, rows, itemIndex));
	}

	if (operation === 'create') {
		const body: IDataObject = {
			name: this.getNodeParameter('name', itemIndex) as string,
			sort: Number(this.getNodeParameter('sort', itemIndex)),
			is_main: this.getNodeParameter('is_main', itemIndex) as boolean,
			is_unsorted_on: this.getNodeParameter('is_unsorted_on', itemIndex) as boolean,
		};

		const statuses = buildStatusEntries(
			this.getNodeParameter('statusesUi', itemIndex, {}) as IDataObject,
		);
		if (statuses.length > 0) body._embedded = { statuses };

		// The write endpoint is a bulk one even for a single pipeline.
		const response = (await amoCrmApiRequest.call(this, 'POST', PIPELINES_ENDPOINT, [body])) as
			| IDataObject
			| undefined;

		return toItems(embeddedRows(response, 'pipelines'));
	}

	const pipelineId = String(this.getNodeParameter('pipelineId', itemIndex));

	if (operation === 'get') {
		const pipeline = (await amoCrmApiRequest.call(
			this,
			'GET',
			`${PIPELINES_ENDPOINT}/${pipelineId}`,
		)) as IDataObject | undefined;

		return pipeline === undefined ? [] : [{ json: pipeline }];
	}

	if (operation === 'update') {
		const updateFields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
		const body = omitEmpty(updateFields);

		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(node, 'Nothing to update on this pipeline', {
				description: 'Add at least one entry under Update Fields.',
			});
		}

		const pipeline = (await amoCrmApiRequest.call(
			this,
			'PATCH',
			`${PIPELINES_ENDPOINT}/${pipelineId}`,
			body,
		)) as IDataObject | undefined;

		return pipeline === undefined ? [] : [{ json: pipeline }];
	}

	if (operation === 'delete') {
		await amoCrmApiRequest.call(this, 'DELETE', `${PIPELINES_ENDPOINT}/${pipelineId}`);
		return [{ json: { success: true, id: Number(pipelineId) } }];
	}

	if (operation === 'getAllStatuses') {
		const qs: IDataObject = {};
		if (this.getNodeParameter('includeDescriptions', itemIndex, false) === true) {
			qs.with = 'descriptions';
		}

		const response = (await amoCrmApiRequest.call(
			this,
			'GET',
			statusesEndpoint(pipelineId),
			undefined,
			qs,
		)) as IDataObject | undefined;

		return toItems(limitRows.call(this, embeddedRows(response, 'statuses'), itemIndex));
	}

	if (operation === 'createStatus') {
		const body = omitEmpty({
			name: this.getNodeParameter('name', itemIndex) as string,
			sort: Number(this.getNodeParameter('sort', itemIndex)),
			color: this.getNodeParameter('color', itemIndex, '') as string,
		});

		const descriptions = buildDescriptions(
			this.getNodeParameter('descriptionsUi', itemIndex, {}) as IDataObject,
			node,
		);
		if (descriptions.length > 0) body.descriptions = descriptions;

		const response = (await amoCrmApiRequest.call(this, 'POST', statusesEndpoint(pipelineId), [
			body,
		])) as IDataObject | undefined;

		return toItems(embeddedRows(response, 'statuses'));
	}

	const statusId = String(this.getNodeParameter('statusId', itemIndex));
	const statusEndpoint = `${statusesEndpoint(pipelineId)}/${statusId}`;

	if (operation === 'getStatus') {
		const qs: IDataObject = {};
		if (this.getNodeParameter('includeDescriptions', itemIndex, false) === true) {
			qs.with = 'descriptions';
		}

		const status = (await amoCrmApiRequest.call(this, 'GET', statusEndpoint, undefined, qs)) as
			| IDataObject
			| undefined;

		return status === undefined ? [] : [{ json: status }];
	}

	if (operation === 'updateStatus') {
		const updateFields = this.getNodeParameter('statusUpdateFields', itemIndex, {}) as IDataObject;
		const body = omitEmpty(updateFields);

		const descriptions = buildDescriptions(
			this.getNodeParameter('descriptionsUi', itemIndex, {}) as IDataObject,
			node,
		);
		if (descriptions.length > 0) body.descriptions = descriptions;

		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(node, 'Nothing to update on this stage', {
				description: 'Add at least one entry under Update Fields or Stage Descriptions.',
			});
		}

		const status = (await amoCrmApiRequest.call(this, 'PATCH', statusEndpoint, body)) as
			| IDataObject
			| undefined;

		return status === undefined ? [] : [{ json: status }];
	}

	if (operation === 'deleteStatus') {
		if (Number(statusId) === WON_STATUS_ID || Number(statusId) === LOST_STATUS_ID) {
			throw new NodeOperationError(
				node,
				`Stage ${statusId} belongs to amoCRM and cannot be deleted`,
				{
					description:
						'142 (won) and 143 (lost) exist in every pipeline and are not editable. Delete the pipeline itself if you need them gone.',
				},
			);
		}

		await amoCrmApiRequest.call(this, 'DELETE', statusEndpoint);

		// Leads standing in the removed stage are not deleted with it: amoCRM moves
		// them to the first stage of the pipeline.
		return [{ json: { success: true, id: Number(statusId), pipeline_id: Number(pipelineId) } }];
	}

	throw new NodeOperationError(node, `Unknown operation "${operation}" for the pipeline resource`);
}
