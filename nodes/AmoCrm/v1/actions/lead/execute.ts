import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { simplifyCustomFields } from '../../helpers/customFields';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';
import type { BatchConfig } from '../types';
import { buildLeadListQuery } from './listQuery';
import {
	buildBatchUpdatePayload,
	buildComplexPayload,
	buildCreatePayload,
	buildLinkObjects,
	buildUpdatePayload,
} from './payload';
import { firstEmbedded } from './shared';

const LEADS = '/api/v4/leads';
const LEADS_COMPLEX = `${LEADS}/complex`;

/** The complex endpoint answers with a bare array rather than the usual HAL envelope. */
function complexRows(response: unknown): IDataObject[] {
	return Array.isArray(response) ? (response as IDataObject[]) : [];
}

/**
 * The input items one complex result accounts for.
 *
 * Duplicate control can answer several submitted leads with a single row — that is
 * what it is for — and amoCRM then returns `request_id` as an array holding every
 * index that was merged into it. Sending each of those items the same row is what
 * keeps `pairedItem` honest about which input ended up where.
 */
function complexItems(row: IDataObject): number[] {
	const echoed = Array.isArray(row.request_id) ? (row.request_id as unknown[]) : [row.request_id];

	return echoed.map(Number).filter((index) => Number.isFinite(index));
}

/**
 * The three writes the router may group.
 *
 * Every path builds its body with the same functions, so a field added to the editor
 * cannot end up honoured one request at a time and dropped fifty at a time.
 */
export const batch: Record<string, BatchConfig> = {
	create: {
		endpoint: LEADS,
		method: 'POST',
		collection: 'leads',
		payload: buildCreatePayload,
	},
	createComplex: {
		endpoint: LEADS_COMPLEX,
		method: 'POST',
		rows: complexRows,
		echoedItems: complexItems,
		// amoCRM refuses more than 50 leads here, rather than merely advising against it.
		maxBatchSize: 50,
		payload: buildComplexPayload,
	},
	update: {
		endpoint: LEADS,
		method: 'PATCH',
		collection: 'leads',
		payload: buildBatchUpdatePayload,
	},
};

function toItems(rows: IDataObject[], simplify: boolean): INodeExecutionData[] {
	return rows.map((row) => ({ json: simplify ? simplifyCustomFields(row) : row }));
}

function leadIdOf(context: IExecuteFunctions, itemIndex: number): string {
	return String(context.getNodeParameter('leadId', itemIndex, undefined, { extractValue: true }));
}

async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const body = await buildCreatePayload.call(this, itemIndex);

	// Even a single lead travels in an array: `POST /api/v4/leads` has no object form.
	const response = await amoCrmApiRequest.call(this, 'POST', LEADS, [body]);

	return [{ json: firstEmbedded(response, 'leads') }];
}

/**
 * One lead created together with its contact and company, through duplicate control.
 *
 * The answer is not a lead but a report on what the write resolved to — the lead's ID,
 * the contact's, the company's, and `merged`, which says whether an existing contact
 * absorbed the submitted one. It is passed on as it arrives: turning it into a lead
 * object would drop exactly the fact the caller asked this endpoint for.
 */
async function createComplex(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const body = await buildComplexPayload.call(this, itemIndex);

	// The complex endpoint has no object form either: one lead still travels in an array.
	const response = await amoCrmApiRequest.call(this, 'POST', LEADS_COMPLEX, [body]);
	const rows = complexRows(response);

	// Anything that is not the documented array is handed on rather than swallowed,
	// the same way a plain create passes on whatever amoCRM chose to answer with.
	return rows.length > 0
		? rows.map((row) => ({ json: row }))
		: [{ json: (response ?? {}) as IDataObject }];
}

async function update(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const leadId = leadIdOf(this, itemIndex);
	const body = await buildUpdatePayload.call(this, itemIndex);

	const response = await amoCrmApiRequest.call(this, 'PATCH', `${LEADS}/${leadId}`, body);
	const lead = firstEmbedded(response, 'leads');

	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	const links = buildLinkObjects(this.getNode(), fields);

	// amoCRM drops `_embedded.contacts` and `_embedded.companies` from a PATCH without
	// a word of complaint, so relinking has to go through the entity-links endpoint.
	if (links.length > 0) {
		await amoCrmApiRequest.call(this, 'POST', `${LEADS}/${leadId}/link`, links);
	}

	return [{ json: lead }];
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const leadId = leadIdOf(this, itemIndex);
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const simplify = this.getNodeParameter('simplify', itemIndex, false) as boolean;

	const qs: IDataObject = {};
	const withValues = (options.with ?? []) as string[];
	if (withValues.length > 0) qs.with = withValues.join(',');

	const lead = (await amoCrmApiRequest.call(this, 'GET', `${LEADS}/${leadId}`, undefined, qs)) as
		| IDataObject
		| undefined;

	// A lead that does not exist answers 204 with an empty body, never 404 — silence is
	// the only signal there is, and passing it on as an empty item would hide the cause.
	if (lead === undefined) {
		throw new NodeOperationError(this.getNode(), `Lead ${leadId} was not found`, {
			description:
				'amoCRM returns nothing at all for a lead that does not exist, sits in the trash, or lies outside the rights of the user this credential belongs to.',
			itemIndex,
		});
	}

	return toItems([lead], simplify);
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const simplify = this.getNodeParameter('simplify', itemIndex, false) as boolean;
	const qs = buildLeadListQuery.call(this, itemIndex);

	if (returnAll) {
		return toItems(await amoCrmApiRequestAllItems.call(this, LEADS, 'leads', qs), simplify);
	}

	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;

	// One page is enough for a small limit; the helper clamps the page size to 250.
	return toItems(
		await amoCrmApiRequestAllItems.call(this, LEADS, 'leads', qs, { limit, pageSize: limit }),
		simplify,
	);
}

type Handler = (this: IExecuteFunctions, itemIndex: number) => Promise<INodeExecutionData[]>;

/**
 * amoCRM API v4 has no delete for leads — no `DELETE /api/v4/leads`, no batch form.
 * The trash is readable through the `only_deleted` include and nothing more, so the
 * operation list stops here rather than offering a delete that quietly moves a lead
 * to a "lost" stage instead.
 */
const OPERATIONS: Record<string, Handler> = { create, createComplex, get, getAll, update };

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const handler = OPERATIONS[operation];

	if (handler === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`The lead resource has no "${operation}" operation`,
			{ itemIndex },
		);
	}

	return await handler.call(this, itemIndex);
}
