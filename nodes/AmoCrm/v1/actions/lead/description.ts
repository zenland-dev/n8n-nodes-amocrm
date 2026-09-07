import type { INodeProperties } from 'n8n-workflow';

import {
	batchSizeProperty,
	entityLocator,
	multitextProperty,
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
 * All three writes share this list so they cannot drift apart, and each drops what it
 * cannot honour. Three fields only mean something on an existing lead: renaming it,
 * and the two tag switches that subtract from or overwrite the set it already has.
 * Three more only mean something where the lead does not carry its own contact and
 * company, which is every write except the complex one.
 */
function writeFields(mode: 'create' | 'update' | 'complex'): INodeProperties[] {
	const updateOnly = (properties: INodeProperties[]): INodeProperties[] =>
		mode === 'update' ? properties : [];

	// Complex creation carries the contact and the company itself, so the fields that
	// attach existing ones would compete with it for the same `_embedded` keys.
	const attachOnly = (properties: INodeProperties[]): INodeProperties[] =>
		mode === 'complex' ? [] : properties;

	return [
		{
			displayName: 'Additional Tags',
			name: 'extraTags',
			type: 'string',
			default: '',
			placeholder: 'hot, from-webinar',
			description:
				'Comma-separated tag names to attach; amoCRM creates a tag the first time its name is used. A value of only digits is read as the ID of an existing tag rather than as a name. Tags are separate per entity type, so an ID copied from a contact does not point at the same tag on a lead.',
		},
		{
			displayName: 'Closed At',
			name: 'closedAt',
			type: 'dateTime',
			default: '',
			description: 'When the lead was won or lost',
		},
		...attachOnly([
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
		]),
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
		...attachOnly([
			{
				displayName: 'Main Contact ID',
				name: 'mainContactId',
				type: 'string',
				default: '',
				description:
					"Which contact is the lead's main one. It is attached even when it is not in the list above.",
			},
		]),
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

const showForComplex = showFor(['createComplex']);

/**
 * The contact and the company that travel inside a complex lead.
 *
 * The contact gets the same editors as the Contact resource — the same phone and e-mail
 * inputs, the same custom-field editor — because a person filling in a lead's contact
 * should not meet a second, poorer way of writing the same entity. The company gets the
 * same pair, which its own resource does not offer: there they live inside the
 * custom-field editor, and here the duplicate check reads them.
 */
const complexNotice: INodeProperties = {
	displayName:
		"Everything below is checked against the account's existing contacts and companies before anything is written: a contact whose phone or e-mail is already known is merged into instead of being created a second time. The check runs only where duplicate control is switched on for this integration in amoCRM; where it is not, the write still succeeds, unchecked. Giving an ID below attaches that entity as it is and is not checked at all. One contact and one company per lead, at most 40 custom fields each, and at most 50 leads per request.",
	name: 'complexNotice',
	type: 'notice',
	default: '',
	displayOptions: showForComplex,
};

const complexProperties: INodeProperties[] = [
	{
		displayName: 'Contact Fields',
		name: 'complexContactFields',
		type: 'collection',
		placeholder: 'Add Contact Field',
		default: {},
		displayOptions: showForComplex,
		description: 'The contact to create with the lead, or attach to it',
		options: [
			{
				displayName: 'Contact ID',
				name: 'id',
				type: 'string',
				default: '',
				description:
					"Attach this contact instead of creating one. It cannot be combined with the contact's other fields, phones, e-mails or custom fields — amoCRM reads either an ID or a whole contact — and an attached contact is not checked for duplicates.",
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
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description:
					'Display name. Leave it empty and fill First Name and Last Name instead — amoCRM builds the display name out of those two.',
			},
			responsibleUserProperty(undefined),
		],
	},
	multitextProperty('phone', 'contactPhonesUi', showForComplex, {
		displayName: 'Contact Phones',
		placeholder: 'Add Contact Phone',
		description:
			'Phone numbers of the contact. This is what the duplicate check matches on, so a number here is what decides whether the contact is merged into an existing one.',
	}),
	multitextProperty('email', 'contactEmailsUi', showForComplex, {
		displayName: 'Contact Emails',
		placeholder: 'Add Contact Email',
		description:
			'E-mail addresses of the contact, matched by the duplicate check the same way phone numbers are',
	}),
	customFieldsDescription(showForComplex, 'getContactCustomFields', {
		name: 'contactCustomFieldsUi',
		displayName: 'Contact Custom Fields',
		placeholder: 'Add Contact Custom Field',
		fieldEntity: 'contacts',
	}),
	{
		displayName: 'Company Fields',
		name: 'complexCompanyFields',
		type: 'collection',
		placeholder: 'Add Company Field',
		default: {},
		displayOptions: showForComplex,
		description: 'The company to create with the lead, or attach to it. Leave empty for none.',
		options: [
			{
				displayName: 'Company ID',
				name: 'id',
				type: 'string',
				default: '',
				description:
					"Attach this company instead of creating one. It cannot be combined with the company's other fields, phones, e-mails or custom fields — amoCRM reads either an ID or a whole company — and an attached company is not checked for duplicates.",
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Name of the company',
			},
			responsibleUserProperty(undefined),
		],
	},
	multitextProperty('phone', 'companyPhonesUi', showForComplex, {
		displayName: 'Company Phones',
		placeholder: 'Add Company Phone',
		description: 'Phone numbers of the company',
	}),
	multitextProperty('email', 'companyEmailsUi', showForComplex, {
		displayName: 'Company Emails',
		placeholder: 'Add Company Email',
		description: 'E-mail addresses of the company',
	}),
	customFieldsDescription(showForComplex, 'getCompanyCustomFields', {
		name: 'companyCustomFieldsUi',
		displayName: 'Company Custom Fields',
		placeholder: 'Add Company Custom Field',
		fieldEntity: 'companies',
	}),
];

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
				name: 'Create Complex',
				value: 'createComplex',
				action: 'Create a lead with a contact and a company',
				description:
					"Add a lead together with its contact and company in one request, through amoCRM's own duplicate control: a contact whose phone or e-mail is already known is merged into rather than created twice",
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

	complexNotice,
	entityLocator('lead', 'leadId', showFor(['get', 'update'])),

	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: showFor(['create', 'createComplex']),
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
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['createComplex']),
		options: writeFields('complex'),
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

	customFieldsDescription(showFor(['create', 'createComplex', 'update']), 'getLeadCustomFields', {
		fieldEntity: 'leads',
	}),

	...complexProperties,

	batchSizeProperty(showFor(['create', 'update'])),
	batchSizeProperty(showForComplex, 50),

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
