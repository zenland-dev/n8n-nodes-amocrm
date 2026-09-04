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

/**
 * Tags live in a separate dictionary per entity type — the same name is a different
 * tag, with a different id, under `leads` and under `contacts`. There is no global list.
 *
 * The chosen type becomes a URL segment, and an expression can put anything into a
 * parameter, so the accepted set is closed here rather than interpolated blindly.
 */
const ENTITY_PATHS = new Set(['leads', 'contacts', 'companies', 'customers']);

/**
 * amoCRM's own tag palette, hex without the leading `#`.
 *
 * The names are labels for the editor; only the codes travel to the API, and only
 * for lead tags — the other three types drop the colour.
 */
const TAG_COLORS: INodePropertyOptions[] = [
	{ name: 'Amber', value: 'FFCE5A' },
	{ name: 'Crimson', value: '9D2B32' },
	{ name: 'Dark Plum', value: '6A0F49' },
	{ name: 'Deep Blue', value: '10599D' },
	{ name: 'Forest Green', value: '0C7C59' },
	{ name: 'Gray', value: 'D0D0D0' },
	{ name: 'Lavender', value: 'A9A5D7' },
	{ name: 'Light Amber', value: 'FFE193' },
	{ name: 'Light Gray', value: 'EBEBEB' },
	{ name: 'Light Lavender', value: 'D8D5FF' },
	{ name: 'Light Lilac', value: 'F2DDF7' },
	{ name: 'Light Mint', value: 'C6F4DE' },
	{ name: 'Light Olive', value: 'DDEBB5' },
	{ name: 'Light Periwinkle', value: 'AABDFF' },
	{ name: 'Light Pink', value: 'FFC8C8' },
	{ name: 'Lilac', value: 'D1A4DC' },
	{ name: 'Mint', value: '90CDB0' },
	{ name: 'Olive', value: 'C7DB8C' },
	{ name: 'Periwinkle', value: '8699DA' },
	{ name: 'Plum', value: '832161' },
	{ name: 'Salmon', value: 'FF8F92' },
	{ name: 'Sky Blue', value: '86C0FC' },
	{ name: 'Teal Blue', value: '247BA0' },
];

function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['tag'], operation: operations } };
}

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['tag'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Add a tag to the dictionary of one entity type',
				action: 'Create a tag',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the tags defined for one entity type',
				action: 'Get many tags',
			},
		],
	},
	{
		displayName: 'Entity Type',
		name: 'entityType',
		type: 'options',
		default: 'leads',
		displayOptions: showFor(['create', 'getAll']),
		description:
			'Which dictionary to work with. Tags are kept per entity type: the same name under leads and under contacts is two different tags.',
		options: [
			{ name: 'Companies', value: 'companies' },
			{ name: 'Contacts', value: 'contacts' },
			{
				name: 'Customers',
				value: 'customers',
				description: 'Only on accounts that have the Customers module switched on',
			},
			{ name: 'Leads', value: 'leads' },
		],
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(['create']),
		description:
			'Name of the new tag. The v4 API can only add tags: there is no way to rename or delete one afterwards.',
	},
	{
		displayName: 'Color',
		name: 'color',
		type: 'options',
		default: '',
		displayOptions: {
			show: { resource: ['tag'], operation: ['create'], entityType: ['leads'] },
		},
		description:
			'Colour from the amoCRM tag palette. Lead tags only — contact, company and customer tags are always grey.',
		options: TAG_COLORS,
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
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Exact tag name. amoCRM matches one name here, not a list.',
			},
			{
				displayName: 'Search',
				name: 'query',
				type: 'string',
				default: '',
				description: 'Free-text search across tag names',
			},
		],
	},
];

/** The URL segment for the dictionary the user picked. */
function entityPath(context: IExecuteFunctions, itemIndex: number): string {
	const value = String(context.getNodeParameter('entityType', itemIndex, 'leads'));

	if (!ENTITY_PATHS.has(value)) {
		throw new NodeOperationError(context.getNode(), `"${value}" is not an entity type with tags`, {
			itemIndex,
			description: 'Tags exist for leads, contacts, companies and customers.',
		});
	}

	return value;
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const entity = entityPath(this, itemIndex);
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;

	const qs: IDataObject = {};

	// `query` sits at the top level on this endpoint, unlike the rest of the API,
	// where free-text search is `filter[query]`.
	if (filters.query !== undefined && filters.query !== '') qs.query = filters.query;
	if (filters.name !== undefined && filters.name !== '') qs.filter = { name: filters.name };

	const rows = await amoCrmApiRequestAllItems.call(this, `/api/v4/${entity}/tags`, 'tags', qs, {
		limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number),
	});

	return rows.map((json) => ({ json }));
}

async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const entity = entityPath(this, itemIndex);
	const name = String(this.getNodeParameter('name', itemIndex)).trim();

	if (name === '') {
		throw new NodeOperationError(this.getNode(), 'A tag needs a name', { itemIndex });
	}

	const tag: IDataObject = { name };

	// Colour is a lead-tag feature; the other dictionaries ignore or reject it.
	if (entity === 'leads') {
		const color = String(this.getNodeParameter('color', itemIndex, ''));
		if (color !== '') tag.color = color;
	}

	// The endpoint is batch-shaped even for a single tag: the body is always an array.
	const response = (await amoCrmApiRequest.call(this, 'POST', `/api/v4/${entity}/tags`, [tag])) as
		| IDataObject
		| undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const rows = (embedded.tags ?? []) as IDataObject[];

	if (rows.length === 0) {
		throw new NodeOperationError(this.getNode(), 'amoCRM did not return the created tag', {
			itemIndex,
			description: `Check whether a tag named "${name}" already exists in the ${entity} dictionary.`,
		});
	}

	return rows.map((json) => ({ json }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') return await getAll.call(this, itemIndex);
	if (operation === 'create') return await create.call(this, itemIndex);

	throw new NodeOperationError(this.getNode(), `Unknown tag operation "${operation}"`, {
		itemIndex,
	});
}
