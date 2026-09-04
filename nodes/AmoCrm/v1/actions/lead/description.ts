import type { INodeProperties } from 'n8n-workflow';

import {
	batchSizeProperty,
	entityLocator,
	responsibleUserProperty,
	returnAllProperties,
	simplifyProperty,
} from '../../descriptions/common';
import { customFieldsDescription } from '../../descriptions/customFields';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['lead'], operation: operations },
});

// The sentence on every dropdown below is spelled out rather than taken from
// DYNAMIC_OPTIONS_DESCRIPTION on purpose: n8n's linter matches it as a literal and
// cannot follow an identifier, so the shared constant fails the rule it exists for.
// `multiOptions` wants the plural form ("specify IDs"), `options` the singular.

/**
 * The `with` values amoCRM documents for leads.
 *
 * They are sent as one comma-separated string rather than a repeated parameter, which
 * the execute step takes care of. `companies` is missing on purpose: amoCRM embeds it
 * on every lead read whether or not it is asked for.
 */
const WITH_OPTIONS = [
	{
		name: 'Catalog Elements',
		value: 'catalog_elements',
		description: 'List elements attached to the lead, with their quantity and price',
	},
	{
		name: 'Contacts',
		value: 'contacts',
		description: 'IDs of the linked contacts, and which of them is the main one',
	},
	{
		name: 'Is Price Modified By Robot',
		value: 'is_price_modified_by_robot',
		description: 'Whether a Salesbot was the last to change the price',
	},
	{
		name: 'Loss Reason',
		value: 'loss_reason',
		description: 'The whole loss reason rather than just its ID',
	},
	{
		name: 'Source',
		value: 'source',
		description: 'The integration source the lead came from',
	},
	{
		name: 'Source ID',
		value: 'source_id',
		description: 'ID of that source, as a plain field',
	},
];

/** The trash bin only makes sense when listing; a single lead is fetched by ID. */
const ONLY_DELETED_OPTION = {
	name: 'Only Deleted',
	value: 'only_deleted',
	description:
		'Return the leads sitting in the trash instead of the live ones. amoCRM fills in only their ID and update timestamps.',
};

const LIST_WITH_OPTIONS = [...WITH_OPTIONS, ONLY_DELETED_OPTION].sort((left, right) =>
	left.name.localeCompare(right.name),
);

/**
 * Everything a lead can be written with, minus the name on create.
 *
 * Create and update share this list so the two cannot drift apart, but three fields
 * only mean something on an existing lead: renaming it, and the two tag switches that
 * subtract from or overwrite the set it already has.
 */
function writeFields(mode: 'create' | 'update'): INodeProperties[] {
	const updateOnly = (properties: INodeProperties[]): INodeProperties[] =>
		mode === 'update' ? properties : [];

	return [
		{
			displayName: 'Additional Tags',
			name: 'extraTags',
			type: 'string',
			default: '',
			placeholder: 'hot, from-webinar',
			description:
				'Tags that are not in the list yet, comma-separated. amoCRM creates a tag the first time its name is used.',
		},
		{
			displayName: 'Closed At',
			name: 'closedAt',
			type: 'dateTime',
			default: '',
			description: 'When the lead was won or lost',
		},
		{
			displayName: 'Company ID',
			name: 'companyId',
			type: 'string',
			default: '',
			description:
				'ID of an existing company to attach. A lead holds at most one company, so only the first ID given is used.',
		},
		{
			displayName: 'Contact IDs',
			name: 'contactIds',
			type: 'string',
			default: '',
			placeholder: '12117258, 12117259',
			description: 'IDs of existing contacts to attach to the lead, comma-separated',
		},
		{
			displayName: 'Created At',
			name: 'createdAt',
			type: 'dateTime',
			default: '',
			description: 'Backdates the lead. Leave empty to let amoCRM stamp it now.',
		},
		{
			displayName: 'Created By Name or ID',
			name: 'createdBy',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Loss Reason Name or ID',
			name: 'lossReasonId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getLossReasons' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Main Contact ID',
			name: 'mainContactId',
			type: 'string',
			default: '',
			description:
				"Which contact is the lead's main one. It is attached even when it is not in the list above.",
		},
		...updateOnly([
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'New name for the lead',
			},
		]),
		{
			displayName: 'Pipeline Name or ID',
			name: 'pipelineId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getPipelines' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Price',
			name: 'price',
			type: 'number',
			default: 0,
			description: 'Budget of the lead, in the account currency',
		},
		...updateOnly([
			{
				displayName: 'Removed Tag Names or IDs',
				name: 'removedTags',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getLeadTags' },
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Replace Tags',
				name: 'replaceTags',
				type: 'boolean',
				default: false,
				description:
					"Whether to make the tags above the lead's complete set. Any tag the lead has that is not listed gets detached, and an empty list removes every tag. Off, the tags are simply added.",
			},
		]),
		responsibleUserProperty(undefined, 'responsibleUserId'),
		{
			displayName: 'Stage Name or ID',
			name: 'statusId',
			type: 'options',
			typeOptions: {
				loadOptionsMethod: 'getStatuses',
				loadOptionsDependsOn: ['&pipelineId'],
			},
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Tag Names or IDs',
			name: 'tags',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getLeadTags' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Updated At',
			name: 'updatedAt',
			type: 'dateTime',
			default: '',
			description: 'Overrides the timestamp amoCRM would set itself',
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
	];
}

const filtersProperty: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: showFor(['getAll']),
	options: [
		{
			displayName: 'Closed After',
			name: 'closedAtFrom',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Closed Before',
			name: 'closedAtTo',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Created After',
			name: 'createdAtFrom',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Created Before',
			name: 'createdAtTo',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Created By Names or IDs',
			name: 'createdBy',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Custom Field Values',
			name: 'customFieldFiltersUi',
			type: 'fixedCollection',
			typeOptions: { multipleValues: true },
			placeholder: 'Add Custom Field Filter',
			default: {},
			description:
				'Only text, number, flag, list and multi-list fields can be filtered here. Phone and e-mail live in a field type amoCRM refuses to filter on — search those with Query instead.',
			options: [
				{
					name: 'field',
					displayName: 'Field',
					values: [
						{
							displayName: 'Field Name or ID',
							name: 'fieldId',
							type: 'options',
							typeOptions: { loadOptionsMethod: 'getLeadCustomFields' },
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
								'Match any of these, comma-separated. Use the option ID for a list field, and 1 or 0 for a flag.',
						},
						{
							displayName: 'From',
							name: 'from',
							type: 'string',
							default: '',
							description:
								'Lower bound for a number or date field, as a number or a date. Overrides Value.',
						},
						{
							displayName: 'To',
							name: 'to',
							type: 'string',
							default: '',
							description:
								'Upper bound for a number or date field, as a number or a date. Overrides Value.',
						},
					],
				},
			],
		},
		{
			displayName: 'IDs',
			name: 'ids',
			type: 'string',
			default: '',
			placeholder: '152462, 152464',
			description: 'Return only these leads, by ID, comma-separated',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
			description:
				'Match the lead name. amoCRM matches it whole, not as a substring — use Query to search inside names.',
		},
		{
			displayName: 'Next Task After',
			name: 'closestTaskAtFrom',
			type: 'dateTime',
			default: '',
			description: 'Leads whose nearest open task falls after this moment',
		},
		{
			displayName: 'Next Task Before',
			name: 'closestTaskAtTo',
			type: 'dateTime',
			default: '',
			description: 'Leads whose nearest open task falls before this moment',
		},
		{
			displayName: 'Pipeline Name or ID',
			name: 'pipelineId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getPipelines' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Price From',
			name: 'priceFrom',
			type: 'number',
			default: 0,
		},
		{
			displayName: 'Price To',
			name: 'priceTo',
			type: 'number',
			default: 0,
		},
		{
			displayName: 'Query',
			name: 'query',
			type: 'string',
			default: '',
			description:
				'Free-text search across every filled field of the lead, custom fields included. amoCRM has announced it will retire this in favour of the filters above.',
		},
		{
			displayName: 'Responsible User Names or IDs',
			name: 'responsibleUserIds',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getUsers' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Stage Names or IDs',
			name: 'statusIds',
			type: 'multiOptions',
			typeOptions: {
				loadOptionsMethod: 'getStatuses',
				loadOptionsDependsOn: ['&pipelineId'],
			},
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			hint: 'Needs a pipeline. amoCRM honours only one stage per pipeline in a single request.',
		},
		{
			displayName: 'Updated After',
			name: 'updatedAtFrom',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Updated Before',
			name: 'updatedAtTo',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Updated By Names or IDs',
			name: 'updatedBy',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'create',
		displayOptions: { show: { resource: ['lead'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a lead',
				description: 'Add a lead to a pipeline',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a lead',
				description: 'Retrieve one lead by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many leads',
				description: 'Search and list leads',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a lead',
				description: 'Change fields on an existing lead',
			},
		],
	},

	entityLocator('lead', 'leadId', showFor(['get', 'update'])),

	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: showFor(['create']),
		description: 'Leave empty and amoCRM names the lead after its ID',
	},

	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['create']),
		options: writeFields('create'),
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['update']),
		options: writeFields('update'),
	},

	customFieldsDescription(showFor(['create', 'update']), 'getLeadCustomFields'),
	batchSizeProperty(showFor(['create', 'update'])),

	...returnAllProperties(showFor(['getAll'])),
	filtersProperty,
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['getAll']),
		options: [
			{
				displayName: 'Include',
				name: 'with',
				type: 'multiOptions',
				default: [],
				description: 'Extra data amoCRM only sends when it is asked for',
				options: LIST_WITH_OPTIONS,
			},
			{
				displayName: 'Sort By',
				name: 'orderBy',
				type: 'options',
				default: 'id',
				options: [
					{ name: 'Created At', value: 'createdAt' },
					{ name: 'ID', value: 'id' },
					{ name: 'Updated At', value: 'updatedAt' },
				],
			},
			{
				displayName: 'Sort Direction',
				name: 'orderDirection',
				type: 'options',
				default: 'asc',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['get']),
		options: [
			{
				displayName: 'Include',
				name: 'with',
				type: 'multiOptions',
				default: [],
				description: 'Extra data amoCRM only sends when it is asked for',
				options: WITH_OPTIONS,
			},
		],
	},
	simplifyProperty(showFor(['get', 'getAll'])),
];
