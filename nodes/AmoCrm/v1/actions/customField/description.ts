import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['customField'], operation: operations },
});

/** Types that carry their own option list, which amoCRM demands at creation time. */
export const ENUM_FIELD_TYPES = ['select', 'multiselect', 'radiobutton'];

/**
 * Every field type amoCRM documents, plus `multitext`.
 *
 * `multitext` is missing from the vendor's own list of available types even though
 * it is the type of the predefined contact PHONE and EMAIL fields — a doc omission,
 * not a deprecation. Not every type works on every entity, so the restricted ones
 * say where they belong.
 */
const FIELD_TYPES: INodePropertyOptions[] = [
	{ name: 'Birthday', value: 'birthday', description: 'Leads, contacts and companies' },
	{ name: 'Category', value: 'category', description: 'Lists only; holds nested categories' },
	{
		name: 'Chained List',
		value: 'chained_list',
		description: 'Leads and customers; a paid feature',
	},
	{ name: 'Checkbox', value: 'checkbox' },
	{ name: 'Date', value: 'date' },
	{ name: 'Date and Time', value: 'date_time' },
	{ name: 'File', value: 'file' },
	{ name: 'Items', value: 'items', description: 'Lists only; used by the invoices list' },
	{ name: 'Legal Entity', value: 'legal_entity', description: 'Leads, contacts and companies' },
	{ name: 'Linked Entity', value: 'linked_entity', description: 'Lists only; needs Search In' },
	{ name: 'Monetary', value: 'monetary', description: 'A paid feature; needs Currency' },
	{ name: 'Multiselect', value: 'multiselect' },
	{ name: 'Multitext', value: 'multitext', description: 'Contacts only; phone and e-mail style' },
	{ name: 'Number', value: 'numeric' },
	{ name: 'Payer', value: 'payer', description: 'Lists only; used by the invoices list' },
	{ name: 'Price', value: 'price', description: 'Lists only' },
	{ name: 'Radiobutton', value: 'radiobutton' },
	{ name: 'Select', value: 'select' },
	{ name: 'Short Address', value: 'streetaddress' },
	{ name: 'Smart Address', value: 'smart_address', description: 'Leads, contacts and companies' },
	{ name: 'Supplier', value: 'supplier', description: 'Lists only; used by the invoices list' },
	{ name: 'Text', value: 'text' },
	{ name: 'Textarea', value: 'textarea' },
	{ name: 'Tracking Data', value: 'tracking_data', description: 'Leads only' },
	{ name: 'URL', value: 'url' },
];

const REMIND_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Day', value: 'day' },
	{ name: 'Month', value: 'month' },
	{ name: 'Never', value: 'never' },
	{ name: 'Week', value: 'week' },
];

const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getAll',
	displayOptions: { show: { resource: ['customField'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a custom field',
			description: 'Add a field to one of the account dictionaries',
		},
		{
			name: 'Create Group',
			value: 'createGroup',
			action: 'Create a custom field group',
			description: 'Add a group that fields can be filed under',
		},
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete a custom field',
			description: 'Remove a field and every value stored in it',
		},
		{
			name: 'Delete Group',
			value: 'deleteGroup',
			action: 'Delete a custom field group',
			description: 'Remove a group; the fields inside it stay',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a custom field',
			description: 'Retrieve one field by ID',
		},
		{
			name: 'Get Group',
			value: 'getGroup',
			action: 'Get a custom field group',
			description: 'Retrieve one field group by ID',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many custom fields',
			description: 'Retrieve the fields of one dictionary',
		},
		{
			name: 'Get Many Groups',
			value: 'getAllGroups',
			action: 'Get many custom field groups',
			description: 'Retrieve the field groups of one dictionary',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a custom field',
			description: 'Change a field, its options or where it appears',
		},
		{
			name: 'Update Group',
			value: 'updateGroup',
			action: 'Update a custom field group',
			description: 'Rename a group, reorder it or set which fields it holds',
		},
	],
};

/**
 * Which dictionary the operation works on.
 *
 * amoCRM keeps a separate custom-field dictionary per entity, each behind its own
 * path, and a field id is only unique inside one of them.
 */
const entityProperty: INodeProperties = {
	displayName: 'Entity Type',
	name: 'entity',
	type: 'options',
	default: 'leads',
	required: true,
	displayOptions: { show: { resource: ['customField'] } },
	description:
		'Dictionary of custom fields to work with. Field groups exist for leads, contacts, companies and customers only.',
	options: [
		{ name: 'Catalog', value: 'catalog', description: 'A list; pick which one below' },
		{ name: 'Company', value: 'companies' },
		{ name: 'Contact', value: 'contacts' },
		{ name: 'Customer', value: 'customers' },
		{ name: 'Lead', value: 'leads' },
		{
			name: 'Segment',
			value: 'segments',
			description: 'Customer segments; needs the segmentation mode of Customers',
		},
	],
};

const catalogIdProperty: INodeProperties = {
	displayName: 'Catalog Name or ID',
	name: 'catalogId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCatalogs' },
	default: '',
	required: true,
	displayOptions: { show: { resource: ['customField'], entity: ['catalog'] } },
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};

/**
 * A plain ID rather than a dropdown: the shared field pickers are keyed on the
 * node's resource, and this resource *is* the field dictionary, so none of them
 * can tell which entity was chosen above. Get Many lists the IDs.
 */
const fieldIdProperty: INodeProperties = {
	displayName: 'Field ID',
	name: 'fieldId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['get', 'update', 'delete']),
	placeholder: '4439091',
	description: 'ID of the custom field. Run Get Many on the same dictionary to look one up.',
};

const groupIdProperty: INodeProperties = {
	displayName: 'Group ID',
	name: 'groupId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['getGroup', 'updateGroup', 'deleteGroup']),
	placeholder: 'leads_29741591099841',
	description:
		'ID of the field group. These are strings in amoCRM, not numbers — "default", "statistic" or something like "leads_29741591099841".',
};

const nameProperty: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['create', 'createGroup']),
	description: 'Label shown on the entity card',
};

const typeProperty: INodeProperties = {
	displayName: 'Type',
	name: 'type',
	type: 'options',
	default: 'text',
	required: true,
	displayOptions: showFor(['create']),
	options: FIELD_TYPES,
	description:
		'What kind of value the field holds. amoCRM does not let a field change type afterwards, so a wrong choice means deleting the field and creating it again.',
};

const groupSortProperty: INodeProperties = {
	displayName: 'Sort',
	name: 'sort',
	type: 'number',
	default: 100,
	displayOptions: showFor(['createGroup']),
	description: 'Position among the groups, lowest first. amoCRM requires it on creation.',
};

const enumsProperty: INodeProperties = {
	displayName: 'Options',
	name: 'enumsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Option',
	default: {},
	displayOptions: {
		show: { resource: ['customField'], operation: ['create'], type: ENUM_FIELD_TYPES },
	},
	description:
		'The list of choices this field offers. amoCRM refuses to create the field without it.',
	options: [
		{
			name: 'entry',
			displayName: 'Option',
			values: [
				{
					displayName: 'Code',
					name: 'code',
					type: 'string',
					default: '',
					description: 'Optional symbolic code, so values can be written without the option ID',
				},
				{
					displayName: 'Sort',
					name: 'sort',
					type: 'number',
					default: 0,
					description: 'Position in the list, lowest first',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					description: 'Text shown to the user',
				},
			],
		},
	],
};

const updateEnumsProperty: INodeProperties = {
	displayName: 'Options',
	name: 'updateEnumsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['update']),
	description:
		'The choices of a select, multiselect or radiobutton field. amoCRM replaces the whole list with what you send, so repeat every option you want to keep and give each the ID it already has.',
	options: [
		{
			name: 'entry',
			displayName: 'Option',
			values: [
				{
					displayName: 'Code',
					name: 'code',
					type: 'string',
					default: '',
					description: 'Optional symbolic code, so values can be written without the option ID',
				},
				{
					displayName: 'Option ID',
					name: 'enumId',
					type: 'number',
					default: 0,
					description: 'ID of an existing option. Leave at 0 to add a new one.',
				},
				{
					displayName: 'Sort',
					name: 'sort',
					type: 'number',
					default: 0,
					description: 'Position in the list, lowest first',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					description: 'Text shown to the user',
				},
			],
		},
	],
};

const nestedProperty: INodeProperties = {
	displayName: 'Categories',
	name: 'nestedUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Category',
	default: {},
	displayOptions: {
		show: { resource: ['customField'], operation: ['create'], type: ['category'] },
	},
	description: 'The nested categories of a list field',
	options: [
		{
			name: 'entry',
			displayName: 'Category',
			values: [
				{
					displayName: 'Parent ID',
					name: 'parentId',
					type: 'number',
					default: 0,
					description: 'ID of the category this one sits under. Leave at 0 for a top-level one.',
				},
				{
					displayName: 'Sort',
					name: 'sort',
					type: 'number',
					default: 0,
					description: 'Position among its siblings, lowest first',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					description: 'Text shown to the user',
				},
			],
		},
	],
};

const chainedListsProperty: INodeProperties = {
	displayName: 'Chained Lists',
	name: 'chainedListsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Chained List',
	default: {},
	displayOptions: {
		show: { resource: ['customField'], operation: ['create'], type: ['chained_list'] },
	},
	description:
		'The lists this field chains together. amoCRM refuses to create the field without it.',
	options: [
		{
			name: 'entry',
			displayName: 'Chained List',
			values: [
				{
					displayName: 'List Name or ID',
					name: 'catalogId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCatalogs' },
					default: '',
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Parent List Name or ID',
					name: 'parentCatalogId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCatalogs' },
					default: '',
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Title',
					name: 'title',
					type: 'string',
					default: '',
					description: 'Label shown above this step of the chain',
				},
			],
		},
	],
};

const requiredStatusesProperty: INodeProperties = {
	displayName: 'Required in Stages',
	name: 'requiredStatusesUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Stage',
	default: {},
	displayOptions: showFor(['create', 'update']),
	description:
		'Stages a lead cannot be moved into until this field is filled. Sending this replaces the whole list.',
	options: [
		{
			name: 'entry',
			displayName: 'Stage',
			values: [
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
					displayName: 'Status Name or ID',
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
			],
		},
	],
};

/**
 * The optional half of a field model, shared by create and update.
 *
 * It is split in two so that "Name" — first-class and required when creating, one
 * option among the rest when updating — can be dropped into its alphabetical place
 * without sorting the list at runtime, which is what the linter reads it as.
 */
const fieldOptionsBeforeName: INodeProperties[] = [
	{
		displayName: 'Code',
		name: 'code',
		type: 'string',
		default: '',
		description:
			'Symbolic code for the field, so values can be written with field_code instead of the numeric ID',
	},
	{
		displayName: 'Currency',
		name: 'currency',
		type: 'string',
		default: '',
		placeholder: 'USD',
		description: 'Three-letter currency code. amoCRM requires it for a Monetary field.',
	},
	{
		displayName: 'Group ID',
		name: 'group_id',
		type: 'string',
		default: '',
		description: 'ID of the group to file the field under. Group IDs are strings, not numbers.',
	},
	{
		displayName: 'Is API Only',
		name: 'is_api_only',
		type: 'boolean',
		default: false,
		description: 'Whether the field can be written through the API only, and not in the interface',
	},
	{
		displayName: 'Is Required',
		name: 'is_required',
		type: 'boolean',
		default: false,
		description: 'Whether a list element must have this field filled. Lists only.',
	},
	{
		displayName: 'Is Visible',
		name: 'is_visible',
		type: 'boolean',
		default: false,
		description: 'Whether the field is shown in the list interface. Lists only.',
	},
];

const nameOption: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
	description: 'Label shown on the entity card',
};

const fieldOptionsAfterName: INodeProperties[] = [
	{
		displayName: 'Remind',
		name: 'remind',
		type: 'options',
		default: 'never',
		options: REMIND_OPTIONS,
		description: 'How long before a Birthday field amoCRM reminds. Ignored by every other type.',
	},
	{
		displayName: 'Search In',
		name: 'search_in',
		type: 'string',
		default: '',
		placeholder: 'contacts_and_companies',
		description:
			'What a Linked Entity field may point at: a catalog ID, or contacts, companies or contacts_and_companies',
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'number',
		default: 0,
		description: 'Position on the entity card, lowest first',
	},
	{
		displayName: 'Tracking Callback',
		name: 'tracking_callback',
		type: 'string',
		default: '',
		description: 'JavaScript callback run by the amoCRM web form for a Tracking Data field',
	},
];

const additionalFields: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'additionalFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['create']),
	options: [...fieldOptionsBeforeName, ...fieldOptionsAfterName],
};

const updateFields: INodeProperties = {
	displayName: 'Update Fields',
	name: 'updateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['update']),
	options: [...fieldOptionsBeforeName, nameOption, ...fieldOptionsAfterName],
};

const groupUpdateFields: INodeProperties = {
	displayName: 'Update Fields',
	name: 'groupUpdateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['updateGroup']),
	options: [
		{
			displayName: 'Field IDs',
			name: 'fields',
			type: 'string',
			default: '',
			placeholder: '14563, 12575',
			description:
				'Comma-separated IDs of the fields this group holds, in the order they should appear. Sending it replaces the current contents of the group.',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Sort',
			name: 'sort',
			type: 'number',
			default: 100,
			description: 'Position among the groups, lowest first',
		},
	],
};

const getAllOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['getAll']),
	options: [
		{
			displayName: 'Sort By',
			name: 'orderBy',
			type: 'options',
			default: 'sort',
			options: [
				{ name: 'ID', value: 'id' },
				{ name: 'Sort', value: 'sort' },
			],
			description: 'Field to order the result by',
		},
		{
			displayName: 'Sort Order',
			name: 'orderDirection',
			type: 'options',
			default: 'asc',
			options: [
				{ name: 'Ascending', value: 'asc' },
				{ name: 'Descending', value: 'desc' },
			],
			description: 'Direction of the sort, applied only when Sort By is set',
		},
		{
			displayName: 'Types',
			name: 'types',
			type: 'multiOptions',
			default: [],
			options: FIELD_TYPES,
			description: 'Return only fields of these types',
		},
	],
};

export const description: INodeProperties[] = [
	operation,
	entityProperty,
	catalogIdProperty,
	fieldIdProperty,
	groupIdProperty,
	nameProperty,
	typeProperty,
	groupSortProperty,
	enumsProperty,
	updateEnumsProperty,
	nestedProperty,
	chainedListsProperty,
	requiredStatusesProperty,
	additionalFields,
	updateFields,
	groupUpdateFields,
	...returnAllProperties(showFor(['getAll', 'getAllGroups'])),
	getAllOptions,
];
