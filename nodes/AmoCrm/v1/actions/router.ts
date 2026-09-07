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

/** The written entities, from the HAL envelope or from the config's own reader. */
function readRows(config: BatchConfig, response: unknown): IDataObject[] {
	if (config.rows !== undefined) return config.rows(response);

	const embedded = ((response as IDataObject | undefined)?._embedded ?? {}) as IDataObject;
	return (embedded[config.collection] ?? []) as IDataObject[];
}

/** The input item a row echoes back, as the index the batch wrote into `request_id`. */
function echoedItem(row: IDataObject): number[] {
	const echoed = Number(row.request_id);
	return Number.isFinite(echoed) ? [echoed] : [];
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
			const response = await amoCrmApiRequest.call(this, config.method, config.endpoint, body);
			const rows = readRows(config, response);

			rows.forEach((row, position) => {
				const owners = config.echoedItems?.(row) ?? echoedItem(row);
				const fallback = group[position]?.index ?? 0;

				// A row that echoes nothing usable still belongs to an input item, and the
				// position it arrived in is the best guess amoCRM leaves us.
				for (const itemIndex of owners.length > 0 ? owners : [fallback]) {
					output.push({ json: row, pairedItem: { item: itemIndex } });
				}
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
		// Held to what the endpoint accepts rather than to what the spinner allowed:
		// one stored `batchSize` serves every operation of a resource, so a value set
		// for a create that takes 250 arrives unchanged at one that takes 50.
		const requested = Number(this.getNodeParameter('batchSize', 0, 1)) || 1;
		const batchSize = Math.min(requested, batchConfig.maxBatchSize ?? 250);

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
