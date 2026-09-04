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
	show: { resource: ['customer'], operation: operations },
});

/** Collections amoCRM embeds in a customer only when asked for them with `with=`. */
const WITH_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Catalog Elements', value: 'catalog_elements' },
	{ name: 'Companies', value: 'companies' },
	{ name: 'Contacts', value: 'contacts' },
];

/**
 * There is no Delete: amoCRM API v4 publishes no delete route for customers, singly
 * or in bulk — the same gap the leads-adjacent entities have.
 *
 * Customers is also an optional feature. While it is switched off the account
 * answers 422 on the customer routes, which `execute` turns into a message that says
 * so rather than passing "Request validation failed" through.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'create',
	displayOptions: { show: { resource: ['customer'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a customer',
			description: 'Add a customer to the account',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a customer',
			description: 'Retrieve one customer by ID',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many customers',
			description: 'Retrieve a filtered list of customers',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a customer',
			description: 'Change fields on an existing customer',
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
	description: 'Display name of the customer',
};

const nextDateDescription =
	'When the next purchase is expected. Required while the account runs Customers in periodic-purchases mode.';

const periodicityDescription =
	'How often the customer buys, in days. Meaningful only while the account runs Customers in periodic-purchases mode.';

/** Two write semantics that are easy to get wrong, and expensive when you do. */
const CREATE_HINT =
	'Segments are stored as the list you send. Tags are added to the customer rather than replacing what it already has.';

const UPDATE_HINT =
	'Segments are replaced by the list you send, so repeat the ones you want to keep. Tags are added and removed one by one, so a tag you do not mention stays where it is.';

const additionalFields: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'additionalFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['create']),
	description: CREATE_HINT,
	options: [
		{
			displayName: 'Created At',
			name: 'createdAt',
			type: 'dateTime',
			default: '',
			description: 'Backdates the customer. Leave empty to use the moment of the request.',
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
			placeholder: 'vip, repeat-buyer',
			description:
				'Comma-separated tag names to attach. A tag that does not exist yet is created by amoCRM.',
		},
		{
			displayName: 'Next Purchase Amount',
			name: 'next_price',
			type: 'number',
			default: 0,
			description: 'Amount the next purchase is expected to bring in, in whole currency units',
		},
		{
			displayName: 'Next Purchase Date',
			name: 'nextDate',
			type: 'dateTime',
			default: '',
			description: nextDateDescription,
		},
		{
			displayName: 'Periodicity',
			name: 'periodicity',
			type: 'number',
			default: 0,
			description: periodicityDescription,
		},
		responsibleUserProperty(undefined),
		{
			displayName: 'Segment Names or IDs',
			name: 'segments',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getCustomerSegments' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Status Name or ID',
			name: 'status_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getCustomerStatuses' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Tag Names or IDs',
			name: 'tags',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getTags' },
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
	description: UPDATE_HINT,
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
			placeholder: 'vip, repeat-buyer',
			description:
				'Comma-separated tag names to attach. A tag that does not exist yet is created by amoCRM.',
		},
		{
			displayName: 'Next Purchase Amount',
			name: 'next_price',
			type: 'number',
			default: 0,
			description: 'Amount the next purchase is expected to bring in, in whole currency units',
		},
		{
			displayName: 'Next Purchase Date',
			name: 'nextDate',
			type: 'dateTime',
			default: '',
			description: nextDateDescription,
		},
		{
			displayName: 'Periodicity',
			name: 'periodicity',
			type: 'number',
			default: 0,
			description: periodicityDescription,
		},
		responsibleUserProperty(undefined),
		{
			displayName: 'Segment Names or IDs',
			name: 'segments',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getCustomerSegments' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Status Name or ID',
			name: 'status_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getCustomerStatuses' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Tag Names or IDs',
			name: 'tags',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getTags' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Tags to Remove Names or IDs',
			name: 'tagsToDelete',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getTags' },
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

/**
 * Everything here rides on amoCRM's "Фильтрация (Alpha)" package, which an account
 * pays for separately. Without it the parameters are accepted and ignored, so the
 * warning belongs on the collection rather than in a failed request.
 */
const filters: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: showFor(['getAll']),
	description:
		'Filtering customers by anything other than a search query needs amoCRM\'s paid "Filtering (Alpha)" package. Check GET /api/v4/account?with=is_api_filter_enabled if a filter appears to do nothing.',
	options: [
		{
			displayName: 'Closest Task From',
			name: 'closestTaskFrom',
			type: 'dateTime',
			default: '',
			description: 'Only customers whose nearest open task falls on or after this moment',
		},
		{
			displayName: 'Closest Task To',
			name: 'closestTaskTo',
			type: 'dateTime',
			default: '',
			description: 'Only customers whose nearest open task falls on or before this moment',
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
			placeholder: '1299433, 1299434',
			description: 'Comma-separated customer IDs to fetch',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
			description:
				'Matches the customer name as a whole. Use Search Query for anything resembling a substring search.',
		},
		{
			displayName: 'Next Purchase Amount From',
			name: 'nextPriceFrom',
			type: 'string',
			default: '',
			placeholder: '1000',
			description: 'Lower bound for the expected next purchase amount',
		},
		{
			displayName: 'Next Purchase Amount To',
			name: 'nextPriceTo',
			type: 'string',
			default: '',
			placeholder: '5000',
			description: 'Upper bound for the expected next purchase amount',
		},
		{
			displayName: 'Next Purchase Date From',
			name: 'nextDateFrom',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Next Purchase Date To',
			name: 'nextDateTo',
			type: 'dateTime',
			default: '',
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
				'Free-text search across every filled field. It needs no paid package, and it is the only way to find a customer by phone number.',
		},
		{
			displayName: 'Status Names or IDs',
			name: 'status_id',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getCustomerStatuses' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
		'Only text, numeric, date, checkbox and select-style fields can be filtered on. Phone, e-mail and address fields cannot — reach those through Search Query.',
	options: [
		{
			name: 'filter',
			displayName: 'Filter',
			values: [
				{
					displayName: 'Field Name or ID',
					name: 'fieldId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCustomFields' },
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
	options: [withProperty, simplifyProperty(undefined)],
};

export const description: INodeProperties[] = [
	operation,
	nameProperty,
	entityLocator('customer', 'customerId', showFor(['get', 'update'])),
	additionalFields,
	updateFields,
	customFieldsDescription(showFor(['create', 'update'])),
	batchSizeProperty(showFor(['create', 'update'])),
	...returnAllProperties(showFor(['getAll'])),
	filters,
	customFieldFilters,
	getOptions,
	getAllOptions,
];
