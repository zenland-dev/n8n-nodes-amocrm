import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { amoCrmApiRequest, chunk } from '../transport';
import { resources } from './index';
import type { BatchConfig } from './types';

/* eslint-disable @n8n/community-nodes/require-node-api-error --
   Everything re-thrown below has already passed through the transport, which turns
   amoCRM failures into a NodeApiError carrying a message the user can act on.
   Wrapping it again here would bury that message under a generic one. */

function errorItem(error: unknown, itemIndex: number): INodeExecutionData {
	return {
		json: { error: error instanceof Error ? error.message : String(error) },
		pairedItem: { item: itemIndex },
	};
}

/**
 * Sends several input items in one amoCRM write.
 *
 * Every element carries `request_id` set to its item index, and amoCRM echoes it
 * back on both success and validation failure. That is what keeps `pairedItem`
 * honest across a batch — without it, a 50-item write that half-fails would map
 * results onto the wrong input items.
 */
async function executeBatched(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	config: BatchConfig,
	batchSize: number,
): Promise<INodeExecutionData[]> {
	const output: INodeExecutionData[] = [];
	const prepared: Array<{ index: number; body: IDataObject }> = [];

	for (let index = 0; index < items.length; index++) {
		try {
			prepared.push({ index, body: await config.payload.call(this, index) });
		} catch (error) {
			if (!this.continueOnFail()) throw error;
			output.push(errorItem(error, index));
		}
	}

	for (const group of chunk(prepared, batchSize)) {
		const body = group.map(({ index, body: entity }) => ({ ...entity, request_id: String(index) }));

		try {
			const response = (await amoCrmApiRequest.call(this, config.method, config.endpoint, body)) as
				| IDataObject
				| undefined;

			const embedded = (response?._embedded ?? {}) as IDataObject;
			const rows = (embedded[config.collection] ?? []) as IDataObject[];

			rows.forEach((row, position) => {
				const echoed = Number(row.request_id);
				const itemIndex = Number.isFinite(echoed) ? echoed : (group[position]?.index ?? 0);
				output.push({ json: row, pairedItem: { item: itemIndex } });
			});
		} catch (error) {
			// A batch fails as a whole, so every item in it gets the same verdict.
			if (!this.continueOnFail()) throw error;
			for (const { index } of group) output.push(errorItem(error, index));
		}
	}

	return output;
}

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const resource = this.getNodeParameter('resource', 0) as string;
	const operation = this.getNodeParameter('operation', 0) as string;

	const module = resources[resource];
	if (module === undefined) {
		throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`);
	}

	const batchConfig = module.batch?.[operation];

	if (batchConfig !== undefined) {
		const batchSize = Number(this.getNodeParameter('batchSize', 0, 1)) || 1;
		if (batchSize > 1) {
			return [await executeBatched.call(this, items, batchConfig, batchSize)];
		}
	}

	const output: INodeExecutionData[] = [];

	for (let index = 0; index < items.length; index++) {
		try {
			const results = await module.execute.call(this, operation, index);

			for (const result of results) {
				output.push({ ...result, pairedItem: result.pairedItem ?? { item: index } });
			}
		} catch (error) {
			if (!this.continueOnFail()) throw error;
			output.push(errorItem(error, index));
		}
	}

	return [output];
}
