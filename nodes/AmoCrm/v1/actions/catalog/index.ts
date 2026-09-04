import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';

const CATALOGS_ENDPOINT = '/api/v4/catalogs';

/** Scopes a property to this resource and to the operations it belongs to. */
function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['catalog'], operation: operations } };
}

/**
 * The three kinds of list amoCRM knows.
 *
 * Products and invoices are not separate entities in v4: each is an ordinary list
 * that the account may hold exactly one of, so they are read and written through
 * the very same endpoints as any list the user made by hand.
 */
const CATALOG_TYPES: INodePropertyOptions[] = [
	{
		name: 'Invoices',
		value: 'invoices',
		description:
			'The invoices list, whose elements are invoices. An account holds at most one, and it exists on amoCRM.ru only.',
	},
	{
		name: 'Products',
		value: 'products',
		description:
			'The products list, whose elements are products. An account holds at most one, and it normally appears when the products feature is switched on in the account settings.',
	},
	{ name: 'Regular', value: 'regular', description: 'An ordinary list' },
];

/**
 * The switches an integration may set on a list.
 *
 * `type` is missing on purpose — amoCRM only reads it while creating, so a list
 * cannot change kind — and so are `can_be_deleted` and `sdk_widget_code`, which the
 * account computes for itself. `can_show_in_cards` is undocumented in the request
 * tables but is what the vendor's own SDK sends, and the interface exposes it.
 */
const catalogSettings: INodeProperties[] = [
	{
		displayName: 'Can Add Elements',
		name: 'canAddElements',
		type: 'boolean',
		default: false,
		description:
			'Whether elements may be added to the list from the amoCRM interface. amoCRM documents this switch as applying to the invoices list only.',
	},
	{
		displayName: 'Can Link Multiple',
		name: 'canLinkMultiple',
		type: 'boolean',
		default: false,
		description: 'Whether one element may be linked to several leads or customers at once',
	},
	{
		displayName: 'Can Show in Cards',
		name: 'canShowInCards',
		type: 'boolean',
		default: false,
		description:
			'Whether a tab holding the list is added to the lead and customer cards. amoCRM documents this switch as applying to the invoices list only.',
	},
	{
		displayName: 'Sort Order',
		name: 'sort',
		type: 'number',
		default: 0,
		description: 'Position of the list among the other lists',
	},
];

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['catalog'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a catalog',
				description: 'Add a list to the account',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a catalog',
				description: 'Retrieve one list by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many catalogs',
				description: 'Retrieve the lists of the account, products and invoices included',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a catalog',
				description: 'Change the name or the settings of a list',
			},
		],
	},
	{
		displayName: 'Catalog Name or ID',
		name: 'catalogId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getCatalogs' },
		default: '',
		required: true,
		displayOptions: showFor(['get', 'update']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['create', 'update']),
		description:
			'Name of the list as it appears in amoCRM. It is required on an update too, even when only a switch changes.',
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		default: 'regular',
		options: CATALOG_TYPES,
		displayOptions: showFor(['create']),
		description: 'Kind of list to create. A list keeps its kind for life.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['create']),
		options: catalogSettings,
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['update']),
		options: catalogSettings,
	},
	...returnAllProperties(showFor(['getAll'])),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(['getAll']),
		options: [
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'regular',
				options: CATALOG_TYPES,
				description: 'Keep only the lists of this kind',
			},
		],
	},
];

function requireCatalogId(this: IExecuteFunctions, itemIndex: number): string {
	const catalogId = String(this.getNodeParameter('catalogId', itemIndex) ?? '').trim();

	if (catalogId === '') {
		throw new NodeOperationError(this.getNode(), 'No list was chosen', {
			itemIndex,
			description: 'Pick a list in the Catalog field, or supply its ID with an expression.',
		});
	}

	return catalogId;
}

/** Turns the interface's switches into the field names amoCRM expects. */
function settingsFromCollection(collection: IDataObject): IDataObject {
	const body: IDataObject = {};

	if (collection.canAddElements !== undefined) {
		body.can_add_elements = collection.canAddElements as boolean;
	}
	if (collection.canLinkMultiple !== undefined) {
		body.can_link_multiple = collection.canLinkMultiple as boolean;
	}
	if (collection.canShowInCards !== undefined) {
		body.can_show_in_cards = collection.canShowInCards as boolean;
	}
	if (collection.sort !== undefined && collection.sort !== '') {
		body.sort = Number(collection.sort);
	}

	return body;
}

function firstCatalog(response: IDataObject | undefined): IDataObject {
	const embedded = (response?._embedded ?? {}) as IDataObject;
	const rows = (embedded.catalogs ?? []) as IDataObject[];

	return rows[0] ?? response ?? {};
}

async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const body: IDataObject = {
		name: this.getNodeParameter('name', itemIndex) as string,
		type: this.getNodeParameter('type', itemIndex) as string,
		...settingsFromCollection(
			this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject,
		),
	};

	// Creating takes an array even for a single list, and answers with a collection.
	const response = (await amoCrmApiRequest.call(this, 'POST', CATALOGS_ENDPOINT, [body])) as
		| IDataObject
		| undefined;

	return [{ json: firstCatalog(response) }];
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const catalogId = requireCatalogId.call(this, itemIndex);

	const catalog = (await amoCrmApiRequest.call(
		this,
		'GET',
		`${CATALOGS_ENDPOINT}/${catalogId}`,
	)) as IDataObject | undefined;

	if (catalog === undefined) {
		throw new NodeOperationError(this.getNode(), `The account has no list with ID ${catalogId}`, {
			itemIndex,
		});
	}

	return [{ json: catalog }];
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const type = String(filters.type ?? '');

	// An account holds at most ten lists, so the whole set arrives in one request and
	// is filtered here. amoCRM does accept `?type=`, but only the vendor SDK uses it —
	// it appears in none of the documented parameter tables, and a filter that a future
	// version silently ignores would hand back the wrong rows without saying so.
	const catalogs = await amoCrmApiRequestAllItems.call(this, CATALOGS_ENDPOINT, 'catalogs');
	const wanted = type === '' ? catalogs : catalogs.filter((catalog) => catalog.type === type);

	const limited = returnAll
		? wanted
		: wanted.slice(0, this.getNodeParameter('limit', itemIndex) as number);

	return limited.map((catalog) => ({ json: catalog }));
}

async function update(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const catalogId = requireCatalogId.call(this, itemIndex);

	const body: IDataObject = {
		name: this.getNodeParameter('name', itemIndex) as string,
		...settingsFromCollection(this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject),
	};

	// A single update takes a bare object; only the batch form of this endpoint is an array.
	const updated = (await amoCrmApiRequest.call(
		this,
		'PATCH',
		`${CATALOGS_ENDPOINT}/${catalogId}`,
		body,
	)) as IDataObject | undefined;

	// An empty answer still means the write went through, so echo what was written
	// rather than emitting an item with nothing in it.
	return [{ json: updated ?? { id: Number(catalogId), ...body } }];
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
		`The catalog resource has no operation "${operation}"`,
		{ itemIndex },
	);
}
