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
	show: { resource: ['contact'], operation: operations },
});

/** Extra collections amoCRM embeds in a contact when asked for them with `with=`. */
const WITH_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Catalog Elements', value: 'catalog_elements' },
	{ name: 'Customers', value: 'customers' },
	{ name: 'Leads', value: 'leads' },
];

/** Contacts sort by these two only — `created_at` is a leads-only order key. */
const ORDER_FIELDS: INodePropertyOptions[] = [
	{ name: 'ID', value: 'id' },
	{ name: 'Updated At', value: 'updated_at' },
];

const ORDER_DIRECTIONS: INodePropertyOptions[] = [
	{ name: 'Ascending', value: 'asc' },
	{ name: 'Descending', value: 'desc' },
];

/**
 * There is no Delete: amoCRM API v4 has no delete route for contacts, singly or in
 * bulk. The web interface removes them through a private ajax endpoint that the API
 * token cannot reach, so this resource stops at create, read and update.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'create',
	displayOptions: { show: { resource: ['contact'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a contact',
			description: 'Add a contact to the account',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a contact',
			description: 'Retrieve one contact by ID',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many contacts',
			description: 'Retrieve a filtered list of contacts',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a contact',
			description: 'Change fields on an existing contact',
		},
	],
};

const nameProperty: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
	displayOptions: showFor(['create']),
	description:
		'Display name of the contact. Leave it empty and fill First Name and Last Name instead — amoCRM builds the display name out of those two.',
};

/**
 * Phone numbers and e-mail addresses live in the predefined `PHONE` and `EMAIL`
 * multitext fields, every value tagged with a "kind" enum. The custom-field editor
 * below can reach them, but that turns the two fields every CRM user needs into the
 * most awkward ones in the node, so they get inputs of their own.
 *
 * The write is addressed by `field_code`: those codes are the same in every account,
 * so nothing has to be looked up before the request.
 */
const phonesProperty: INodeProperties = {
	displayName: 'Phones',
	name: 'phonesUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Phone',
	default: {},
	displayOptions: showFor(['create', 'update']),
	description:
		'Phone numbers of the contact. amoCRM replaces the whole field, so an update has to repeat the numbers you want to keep.',
	options: [
		{
			name: 'entry',
			displayName: 'Phone',
			values: [
				{
					displayName: 'Number',
					name: 'value',
					type: 'string',
					default: '',
					placeholder: '+79161234567',
				},
				{
					displayName: 'Kind',
					name: 'enumCode',
					type: 'options',
					default: 'WORK',
					description: 'How amoCRM labels this number',
					options: [
						{ name: 'Fax', value: 'FAX' },
						{ name: 'Home', value: 'HOME' },
						{ name: 'Mobile', value: 'MOB' },
						{ name: 'Other', value: 'OTHER' },
						{ name: 'Work', value: 'WORK' },
						{ name: 'Work Direct Dial', value: 'WORKDD' },
					],
				},
			],
		},
	],
};

const emailsProperty: INodeProperties = {
	displayName: 'Emails',
	name: 'emailsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Email',
	default: {},
	displayOptions: showFor(['create', 'update']),
	description:
		'E-mail addresses of the contact. amoCRM replaces the whole field, so an update has to repeat the addresses you want to keep.',
	options: [
		{
			name: 'entry',
			displayName: 'Email',
			values: [
				{
					displayName: 'Address',
					name: 'value',
					type: 'string',
					default: '',
					placeholder: 'name@example.com',
				},
				{
					displayName: 'Kind',
					name: 'enumCode',
					type: 'options',
					default: 'WORK',
					description: 'How amoCRM labels this address',
					options: [
						{ name: 'Other', value: 'OTHER' },
						{ name: 'Personal', value: 'PRIV' },
						{ name: 'Work', value: 'WORK' },
					],
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
			description: 'Backdates the contact. Leave empty to use the moment of the request.',
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
			displayName: 'First Name',
			name: 'first_name',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Last Name',
			name: 'last_name',
			type: 'string',
			default: '',
		},
		{
			displayName: 'New Tags',
			name: 'newTags',
			type: 'string',
			default: '',
			placeholder: 'vip, from-website',
			description:
				'Comma-separated tag names to attach. A tag that does not exist yet is created by amoCRM.',
		},
		responsibleUserProperty(undefined),
		{
			displayName: 'Tag Names or IDs',
			name: 'tags',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getContactTags' },
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
			displayName: 'First Name',
			name: 'first_name',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Last Name',
			name: 'last_name',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
			description:
				'Display name. Sending First Name or Last Name recomputes it, so pick one convention and stay with it.',
		},
		{
			displayName: 'New Tags',
			name: 'newTags',
			type: 'string',
			default: '',
			placeholder: 'vip, from-website',
			description:
				'Comma-separated tag names to attach. A tag that does not exist yet is created by amoCRM.',
		},
		responsibleUserProperty(undefined),
		{
			displayName: 'Tag Names or IDs',
			name: 'tags',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getContactTags' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Tags to Remove Names or IDs',
			name: 'tagsToDelete',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getContactTags' },
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
			description: 'Only contacts whose nearest open task falls on or after this moment',
		},
		{
			displayName: 'Closest Task To',
			name: 'closestTaskTo',
			type: 'dateTime',
			default: '',
			description: 'Only contacts whose nearest open task falls on or before this moment',
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
			placeholder: '406322, 406323',
			description: 'Comma-separated contact IDs to fetch',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
			description:
				'Matches the contact name as a whole. Use Search Query for anything resembling a substring search.',
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
			placeholder: '79161234567',
			description:
				'Free-text search across every filled field, phone numbers and e-mail addresses included. It is the only way to find a contact by phone, and amoCRM has announced it as deprecated.',
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
					typeOptions: { loadOptionsMethod: 'getContactCustomFields' },
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
	description:
		'Extra collections to embed in every result. The linked company comes back with or without this.',
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
			description: 'Field to sort by. amoCRM sorts contacts by ID and update time only.',
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
	entityLocator('contact', 'contactId', showFor(['get', 'update'])),
	phonesProperty,
	emailsProperty,
	entityLocator('company', 'companyId', showFor(['create', 'update']), {
		required: false,
		description:
			'Company to attach the contact to. amoCRM links it in a second request after the contact is written, so Batch Size has to stay at 1 for this. A contact holds at most one company.',
	}),
	additionalFields,
	updateFields,
	customFieldsDescription(showFor(['create', 'update']), 'getContactCustomFields'),
	batchSizeProperty(showFor(['create', 'update'])),
	...returnAllProperties(showFor(['getAll'])),
	filters,
	customFieldFilters,
	getOptions,
	getAllOptions,
];
