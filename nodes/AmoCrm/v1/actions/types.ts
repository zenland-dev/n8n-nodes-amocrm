import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

/**
 * How one entity's worth of work is sent to amoCRM in a single request.
 *
 * Declaring this lets the router group items: amoCRM accepts up to 250 entities per
 * write, and against a budget of seven requests per second the difference between
 * one request per lead and one request per fifty leads is minutes, not milliseconds.
 * Each element carries a `request_id` so a validation failure can be traced back to
 * the item that caused it.
 */
export interface BatchConfig {
	endpoint: string;
	method: 'POST' | 'PATCH';
	/** Key under `_embedded` that holds the written entities in the response. */
	collection: string;
	/** Builds the body for one input item. */
	payload(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject>;
}

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
