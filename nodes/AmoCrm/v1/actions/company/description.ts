import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import {
	batchSizeProperty,
	entityLocator,
	responsibleUserProperty,
	returnAllProperties,
	simplifyProperty,
} from '../../descriptions/common';
import { customFieldsDescription } from '../../descriptions/customFields';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['company'], operation: operations },
});

/** Extra collections amoCRM embeds in a company when asked for them with `with=`. */
const WITH_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Catalog Elements', value: 'catalog_elements' },
	{ name: 'Contacts', value: 'contacts' },
	{ name: 'Customers', value: 'customers' },
	{ name: 'Leads', value: 'leads' },
];

/** Companies sort by these two only — `created_at` is a leads-only order key. */
const ORDER_FIELDS: INodePropertyOptions[] = [
	{ name: 'ID', value: 'id' },
	{ name: 'Updated At', value: 'updated_at' },
];

const ORDER_DIRECTIONS: INodePropertyOptions[] = [
	{ name: 'Ascending', value: 'asc' },
	{ name: 'Descending', value: 'desc' },
];

/**
 * There is no Delete: amoCRM API v4 has no delete route for companies, singly or in
 * bulk. The web interface removes them through a private ajax endpoint that the API
 * token cannot reach, so this resource stops at create, read and update.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'create',
	displayOptions: { show: { resource: ['company'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a company',
			description: 'Add a company to the account',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a company',
			description: 'Retrieve one company by ID',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many companies',
			description: 'Retrieve a filtered list of companies',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a company',
			description: 'Change fields on an existing company',
		},
	],
};

const nameProperty: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['create']),
	description: 'Name of the company. It is the only identity a company has in amoCRM.',
};

/**
 * A company is linked to its contacts through the entity-links API, never through the
 * company body: amoCRM accepts nothing but tags under `_embedded` on create and
 * update, and silently ignores anything else put there.
 */
const contactsProperty: INodeProperties = {
	displayName: 'Contacts to Link',
	name: 'contactsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Contact',
	default: {},
	displayOptions: showFor(['create', 'update']),
	description:
		'Contacts to attach to the company. amoCRM links them in a second request after the company is written, so Batch Size has to stay at 1 for this.',
	options: [
		{
			name: 'entry',
			displayName: 'Contact',
			values: [
				{
					displayName: 'Contact ID',
					name: 'contactId',
					type: 'string',
					default: '',
					placeholder: '12117258',
					description: 'ID of the contact to attach to this company',
				},
				{
					displayName: 'Main Contact',
					name: 'isMain',
					type: 'boolean',
					default: false,
					description:
						'Whether this contact becomes the main contact of the company. amoCRM reads the same flag back as main_contact.',
				},
			],
		},
	],
};

const additionalFields: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'additionalFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['create']),
	options: [
		{
			displayName: 'Created At',
			name: 'createdAt',
			type: 'dateTime',
			default: '',
			description: 'Backdates the company. Leave empty to use the moment of the request.',
		},
		{
			displayName: 'Created By Name or ID',
			name: 'created_by',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'New Tags',
			name: 'newTags',
			type: 'string',
			default: '',
			placeholder: 'partner, supplier',
			description:
				'Comma-separated tag names to attach. A tag that does not exist yet is created by amoCRM.',
		},
		responsibleUserProperty(undefined),
		{
			displayName: 'Tag Names or IDs',
			name: 'tags',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getCompanyTags' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

const updateFields: INodeProperties = {
	displayName: 'Update Fields',
	name: 'updateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['update']),
	options: [
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
		},
		{
			displayName: 'New Tags',
			name: 'newTags',
			type: 'string',
			default: '',
			placeholder: 'partner, supplier',
			description:
				'Comma-separated tag names to attach. A tag that does not exist yet is created by amoCRM.',
		},
		responsibleUserProperty(undefined),
		{
			displayName: 'Tag Names or IDs',
			name: 'tags',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getCompanyTags' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Tags to Remove Names or IDs',
			name: 'tagsToDelete',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getCompanyTags' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Updated By Name or ID',
			name: 'updated_by',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

const filters: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: showFor(['getAll']),
	options: [
		{
			displayName: 'Closest Task From',
			name: 'closestTaskFrom',
			type: 'dateTime',
			default: '',
			description: 'Only companies whose nearest open task falls on or after this moment',
		},
		{
			displayName: 'Closest Task To',
			name: 'closestTaskTo',
			type: 'dateTime',
			default: '',
			description: 'Only companies whose nearest open task falls on or before this moment',
		},
		{
			displayName: 'Created After',
			name: 'createdAfter',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Created Before',
			name: 'createdBefore',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Created By Names or IDs',
			name: 'created_by',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'IDs',
			name: 'ids',
			type: 'string',
			default: '',
			placeholder: '406320, 406321',
			description: 'Comma-separated company IDs to fetch',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
			description:
				'Matches the company name as a whole. Use Search Query for anything resembling a substring search.',
		},
		{
			displayName: 'Responsible User Names or IDs',
			name: 'responsible_user_id',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getUsers' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Search Query',
			name: 'query',
			type: 'string',
			default: '',
			placeholder: 'Romashka',
			description:
				'Free-text search across every filled field of the company, custom fields included. amoCRM has announced it as deprecated, but nothing has replaced it yet.',
		},
		{
			displayName: 'Updated After',
			name: 'updatedAfter',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Updated Before',
			name: 'updatedBefore',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Updated By Names or IDs',
			name: 'updated_by',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

const customFieldFilters: INodeProperties = {
	displayName: 'Custom Field Filters',
	name: 'customFieldFiltersUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Custom Field Filter',
	default: {},
	displayOptions: showFor(['getAll']),
	description:
		'Narrows the list by the value of a custom field. amoCRM filters text, numeric, date, checkbox and select-style fields only — phone, e-mail and address fields have to go through Search Query.',
	options: [
		{
			name: 'filter',
			displayName: 'Filter',
			values: [
				{
					displayName: 'Field Name or ID',
					name: 'fieldId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCompanyCustomFields' },
					default: '',
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					description:
						'Exact value to match. For a select field this is the option ID; for a checkbox, 1 or 0.',
				},
				{
					displayName: 'From',
					name: 'from',
					type: 'string',
					default: '',
					description:
						'Lower bound for a date or numeric field, as a Unix timestamp or a number. Takes precedence over Value.',
				},
				{
					displayName: 'To',
					name: 'to',
					type: 'string',
					default: '',
					description:
						'Upper bound for a date or numeric field, as a Unix timestamp or a number. Takes precedence over Value.',
				},
			],
		},
	],
};

const withProperty: INodeProperties = {
	displayName: 'Include',
	name: 'with',
	type: 'multiOptions',
	default: [],
	options: WITH_OPTIONS,
	description: 'Extra collections to embed in every result',
};

const getOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['get']),
	options: [withProperty, simplifyProperty(undefined)],
};

const getAllOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['getAll']),
	options: [
		withProperty,
		simplifyProperty(undefined),
		{
			displayName: 'Sort By',
			name: 'orderBy',
			type: 'options',
			default: 'id',
			options: ORDER_FIELDS,
			description: 'Field to sort by. amoCRM sorts companies by ID and update time only.',
		},
		{
			displayName: 'Sort Order',
			name: 'orderDirection',
			type: 'options',
			default: 'desc',
			options: ORDER_DIRECTIONS,
			description: 'Direction of the sort, applied only when Sort By is set',
		},
	],
};

export const description: INodeProperties[] = [
	operation,
	nameProperty,
	entityLocator('company', 'companyId', showFor(['get', 'update'])),
	contactsProperty,
	additionalFields,
	updateFields,
	customFieldsDescription(showFor(['create', 'update']), 'getCompanyCustomFields'),
	batchSizeProperty(showFor(['create', 'update'])),
	...returnAllProperties(showFor(['getAll'])),
	filters,
	customFieldFilters,
	getOptions,
	getAllOptions,
];
