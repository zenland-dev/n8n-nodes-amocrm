import type { INodeProperties } from 'n8n-workflow';

import type { EntityKind } from '../../descriptions/common';
import { entityLocator, returnAllProperties } from '../../descriptions/common';

/**
 * The entity that owns the link. `catalog_elements` is missing on purpose: a list
 * element can be the target of a link but never the side you attach from.
 */
export const SOURCE_PARAMETERS: Record<string, string> = {
	leads: 'leadId',
	contacts: 'contactId',
	companies: 'companyId',
	customers: 'customerId',
};

/**
 * Option value → the `to_entity_type` amoCRM expects.
 *
 * Only `catalog_elements` differs, and it differs because n8n option values are
 * camelCase while the API spells this one with an underscore.
 */
export const TARGET_ENTITY_TYPES: Record<string, string> = {
	leads: 'leads',
	contacts: 'contacts',
	companies: 'companies',
	customers: 'customers',
	catalogElements: 'catalog_elements',
};

/** Option value → the parameter holding the target id. */
export const TARGET_PARAMETERS: Record<string, string> = {
	leads: 'toLeadId',
	contacts: 'toContactId',
	companies: 'toCompanyId',
	customers: 'toCustomerId',
	catalogElements: 'toElementId',
};

const TARGET_TYPE_OPTIONS = [
	{ name: 'Catalog Elements', value: 'catalogElements' },
	{ name: 'Companies', value: 'companies' },
	{ name: 'Contacts', value: 'contacts' },
	{ name: 'Customers', value: 'customers' },
	{ name: 'Leads', value: 'leads' },
];

function showFor(
	operations: string[],
	extra: Record<string, string[]> = {},
): INodeProperties['displayOptions'] {
	return { show: { resource: ['link'], operation: operations, ...extra } };
}

/** The same picker `entityLocator` builds, relabelled for the far side of a link. */
function targetLocator(
	kind: EntityKind,
	name: string,
	label: string,
	value: string,
): INodeProperties {
	return {
		...entityLocator(kind, name, showFor(['link', 'unlink'], { toEntityType: [value] })),
		displayName: label,
		description: 'The entity on the other side of the link',
	};
}

/**
 * A searchable picker for a list element.
 *
 * `entityLocator` covers the four CRM entities only, and the search behind this one
 * needs the list chosen above it — `searchCatalogElements` reads the `catalogId`
 * parameter to know which list to query.
 */
const elementLocator: INodeProperties = {
	displayName: 'Linked Catalog Element',
	name: 'toElementId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	displayOptions: showFor(['link', 'unlink'], { toEntityType: ['catalogElements'] }),
	description: 'The list element on the other side of the link',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'searchCatalogElements',
				searchable: true,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			// Empty has to pass: n8n validates a mode against whatever the field holds and
			// does not look at `required` first, so an untouched optional picker would
			// report an error before anything is typed. See descriptions/common.ts.
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '^[0-9]*$',
						errorMessage: 'An amoCRM id is a number',
					},
				},
			],
		},
	],
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['link'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List everything linked to one entity',
				action: 'Get many links',
			},
			{
				name: 'Link',
				value: 'link',
				description: 'Attach another entity to this one',
				action: 'Link an entity',
			},
			{
				name: 'Unlink',
				value: 'unlink',
				description: 'Detach a linked entity from this one',
				action: 'Unlink an entity',
			},
		],
	},
	{
		displayName: 'Entity Type',
		name: 'entityType',
		type: 'options',
		default: 'leads',
		displayOptions: showFor(['getAll', 'link', 'unlink']),
		description:
			'The side of the link you are working from. Leads take contacts, companies and catalog elements; contacts take companies, customers and catalog elements; companies take contacts, leads, customers and catalog elements.',
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
	entityLocator('lead', 'leadId', showFor(['getAll', 'link', 'unlink'], { entityType: ['leads'] })),
	entityLocator(
		'contact',
		'contactId',
		showFor(['getAll', 'link', 'unlink'], { entityType: ['contacts'] }),
	),
	entityLocator(
		'company',
		'companyId',
		showFor(['getAll', 'link', 'unlink'], { entityType: ['companies'] }),
	),
	entityLocator(
		'customer',
		'customerId',
		showFor(['getAll', 'link', 'unlink'], { entityType: ['customers'] }),
	),
	{
		displayName: 'Linked Entity Type',
		name: 'toEntityType',
		type: 'options',
		default: 'contacts',
		displayOptions: showFor(['link', 'unlink']),
		description:
			'What sits on the other side of the link. A catalog element also needs the list it belongs to, both when linking and when unlinking.',
		options: TARGET_TYPE_OPTIONS,
	},
	{
		displayName: 'Catalog Name or ID',
		name: 'catalogId',
		type: 'options',
		required: true,
		typeOptions: { loadOptionsMethod: 'getCatalogs' },
		default: '',
		displayOptions: showFor(['link', 'unlink'], { toEntityType: ['catalogElements'] }),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	targetLocator('lead', 'toLeadId', 'Linked Lead', 'leads'),
	targetLocator('contact', 'toContactId', 'Linked Contact', 'contacts'),
	targetLocator('company', 'toCompanyId', 'Linked Company', 'companies'),
	targetLocator('customer', 'toCustomerId', 'Linked Customer', 'customers'),
	elementLocator,
	{
		displayName: 'Quantity',
		name: 'quantity',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 1,
		displayOptions: showFor(['link'], { toEntityType: ['catalogElements'] }),
		description: 'How many units of the catalog element are attached to the entity',
	},
	{
		displayName: 'Main Contact',
		name: 'isMain',
		type: 'boolean',
		default: false,
		displayOptions: showFor(['link'], { toEntityType: ['contacts'] }),
		description:
			'Whether this contact becomes the main contact of the entity. amoCRM takes it as "is_main" and reads it back as "main_contact".',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['link', 'unlink']),
		options: [
			{
				displayName: 'Price ID',
				name: 'priceId',
				type: 'number',
				default: 0,
				description:
					'Which price column of the catalog to use for a linked element. Documented on amocrm.ru only; leave at 0 to let amoCRM pick.',
			},
			{
				displayName: 'Updated By Name or ID',
				name: 'updatedBy',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
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
				displayName: 'Catalog Name or ID',
				name: 'toCatalogId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getCatalogs' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Linked Entity ID',
				name: 'toEntityId',
				type: 'string',
				default: '',
				description:
					'Only return the link to this entity. amoCRM rejects it unless Linked Entity Type is set as well.',
			},
			{
				displayName: 'Linked Entity Type',
				name: 'toEntityType',
				type: 'options',
				default: '',
				description: 'Only return links pointing at entities of this type',
				options: TARGET_TYPE_OPTIONS,
			},
		],
	},
];
