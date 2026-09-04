import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { buildCustomFieldsValues, simplifyCustomFields } from '../../helpers/customFields';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';

/** The only value `with` takes on elements; it fills in `invoice_link`. */
const INVOICE_LINK = 'invoice_link';

/**
 * Elements live under the list that owns them, so every call needs a list first.
 * The picker holds it, but an expression may still resolve to nothing — and a
 * request to `/catalogs//elements` would come back as a puzzling 404.
 */
function elementsEndpoint(this: IExecuteFunctions, itemIndex: number): string {
	const catalogId = String(this.getNodeParameter('catalogId', itemIndex) ?? '').trim();

	if (catalogId === '') {
		throw new NodeOperationError(this.getNode(), 'No list was chosen', {
			itemIndex,
			description: 'Pick a list in the Catalog field, or supply its ID with an expression.',
		});
	}

	return `/api/v4/catalogs/${catalogId}/elements`;
}

function elementId(this: IExecuteFunctions, itemIndex: number): string {
	return String(
		this.getNodeParameter('elementId', itemIndex, undefined, { extractValue: true }) ?? '',
	).trim();
}

function customFieldsValues(this: IExecuteFunctions, itemIndex: number): IDataObject[] {
	return buildCustomFieldsValues(
		this.getNodeParameter('customFieldsUi', itemIndex, {}) as IDataObject,
		this.getNode(),
	);
}

function toItems(
	this: IExecuteFunctions,
	rows: IDataObject[],
	itemIndex: number,
): INodeExecutionData[] {
	const simplify = this.getNodeParameter('simplify', itemIndex, false) as boolean;

	return rows.map((row) => ({ json: simplify ? simplifyCustomFields(row) : row }));
}

/** amoCRM reads several ids as `filter[id][0]`, `filter[id][1]`… — an array in, brackets out. */
function parseIds(raw: unknown): number[] {
	return String(raw ?? '')
		.split(',')
		.map((part) => Number(part.trim()))
		.filter((id) => Number.isFinite(id) && id > 0);
}

async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const body: IDataObject = { name: this.getNodeParameter('name', itemIndex) as string };

	const customFields = customFieldsValues.call(this, itemIndex);
	if (customFields.length > 0) body.custom_fields_values = customFields;

	// Creating takes an array even for a single element, and answers with a collection.
	const response = (await amoCrmApiRequest.call(
		this,
		'POST',
		elementsEndpoint.call(this, itemIndex),
		[body],
	)) as IDataObject | undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const created = ((embedded.elements ?? []) as IDataObject[])[0] ?? response ?? {};

	return toItems.call(this, [created], itemIndex);
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const id = elementId.call(this, itemIndex);
	const qs: IDataObject = {};

	if (this.getNodeParameter('includeInvoiceLink', itemIndex, false) === true) {
		qs.with = INVOICE_LINK;
	}

	const element = (await amoCrmApiRequest.call(
		this,
		'GET',
		`${elementsEndpoint.call(this, itemIndex)}/${id}`,
		undefined,
		qs,
	)) as IDataObject | undefined;

	if (element === undefined) {
		throw new NodeOperationError(this.getNode(), `The list has no element with ID ${id}`, {
			itemIndex,
		});
	}

	return toItems.call(this, [element], itemIndex);
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};

	const query = String(filters.query ?? '').trim();
	if (query !== '') qs.query = query;

	const ids = parseIds(filters.elementIds);
	if (ids.length > 0) qs.filter = { id: ids };

	if (this.getNodeParameter('includeInvoiceLink', itemIndex, false) === true) {
		qs.with = INVOICE_LINK;
	}

	const elements = await amoCrmApiRequestAllItems.call(
		this,
		elementsEndpoint.call(this, itemIndex),
		'elements',
		qs,
		{ limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number) },
	);

	return toItems.call(this, elements, itemIndex);
}

async function update(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const id = elementId.call(this, itemIndex);
	const body: IDataObject = {};

	const name = String(this.getNodeParameter('name', itemIndex, '') ?? '').trim();
	if (name !== '') body.name = name;

	const customFields = customFieldsValues.call(this, itemIndex);
	if (customFields.length > 0) body.custom_fields_values = customFields;

	// An empty PATCH would be answered with the untouched element, which reads like a
	// silent success. Saying so here is the only chance the user gets to notice.
	if (Object.keys(body).length === 0) {
		throw new NodeOperationError(this.getNode(), 'The element update has nothing to write', {
			itemIndex,
			description: 'Fill in a new name, or add at least one custom field value.',
		});
	}

	// A single update takes a bare object; only the batch form of this endpoint is an array.
	const updated = (await amoCrmApiRequest.call(
		this,
		'PATCH',
		`${elementsEndpoint.call(this, itemIndex)}/${id}`,
		body,
	)) as IDataObject | undefined;

	return toItems.call(this, [updated ?? { id: Number(id), ...body }], itemIndex);
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'create') return await create.call(this, itemIndex);
	if (operation === 'get') return await get.call(this, itemIndex);
	if (operation === 'getAll') return await getAll.call(this, itemIndex);
	if (operation === 'update') return await update.call(this, itemIndex);

	throw new NodeOperationError(
		this.getNode(),
		`The catalog element resource has no operation "${operation}"`,
		{ itemIndex },
	);
}
