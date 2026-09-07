import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

/** The parts of a batched write that do not depend on the response shape. */
interface BatchBase {
	endpoint: string;
	method: 'POST' | 'PATCH';
	/** Builds the body for one input item. */
	payload(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject>;
	/**
	 * Which input items a result row accounts for.
	 *
	 * Defaults to the single index echoed back in `request_id`. Complex lead creation
	 * needs it because its duplicate control can answer several submitted leads with
	 * one row, and then `request_id` is an array of every index that ended up merged.
	 */
	echoedItems?(row: IDataObject): number[];
	/**
	 * The most entities this endpoint accepts in one request, where it is lower than
	 * amoCRM's usual 250.
	 *
	 * The spinner's own ceiling is not enough on its own: **Batch Size** is one stored
	 * parameter shared by every operation of the resource, so a 200 set for an ordinary
	 * create survives being switched to an endpoint that takes 50 — and an expression
	 * never passes through the spinner at all.
	 */
	maxBatchSize?: number;
}

/**
 * Where the written entities are in the response.
 *
 * Almost every amoCRM write answers with the usual HAL envelope, so naming the
 * collection under `_embedded` is enough. `POST /api/v4/leads/complex` answers with a
 * bare array instead, which is what `rows` is for — one or the other, never both.
 */
type BatchResponse =
	| { collection: string; rows?: never }
	| { collection?: never; rows(response: unknown): IDataObject[] };

/**
 * How one entity's worth of work is sent to amoCRM in a single request.
 *
 * Declaring this lets the router group items: amoCRM accepts up to 250 entities per
 * write, and against a budget of seven requests per second the difference between
 * one request per lead and one request per fifty leads is minutes, not milliseconds.
 * Each element carries a `request_id` so a validation failure can be traced back to
 * the item that caused it.
 */
export type BatchConfig = BatchBase & BatchResponse;

/** Everything the node needs to know about one resource. */
export interface ResourceModule {
	/** Operation selector and every parameter belonging to this resource. */
	description: INodeProperties[];
	/** Handles one input item. */
	execute(
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	): Promise<INodeExecutionData[]>;
	/** Operations that can be grouped into one request. */
	batch?: Record<string, BatchConfig>;
}
