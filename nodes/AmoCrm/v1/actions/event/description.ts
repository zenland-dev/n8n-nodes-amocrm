import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';

/** Scopes a property to this resource and to the operations it belongs to. */
function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['event'], operation: operations } };
}

/** Entity names, embedded on request so the feed reads without a second lookup. */
const WITH_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Catalog Element Name', value: 'catalog_element_name' },
	{ name: 'Catalog Name', value: 'catalog_name' },
	{ name: 'Company Name', value: 'company_name' },
	{ name: 'Contact Name', value: 'contact_name' },
	{
		name: 'Customer Name',
		value: 'customer_name',
		description: 'Documented on amoCRM.ru only, where the Customers module exists',
	},
	{ name: 'Lead Name', value: 'lead_name' },
];

/**
 * The entity types the event feed knows, in the singular spelling it insists on.
 *
 * Everywhere else in this API an entity type is plural — `leads`, `contacts` — and
 * the event feed is the one place it is not. A list element is `catalog_<catalog ID>`,
 * which no fixed list can hold, so it has to be written as an expression.
 */
const ENTITY_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Company', value: 'company' },
	{ name: 'Contact', value: 'contact' },
	{ name: 'Customer', value: 'customer' },
	{ name: 'Lead', value: 'lead' },
	{ name: 'Task', value: 'task' },
];

const includeProperty: INodeProperties = {
	displayName: 'Include',
	name: 'with',
	type: 'multiOptions',
	default: [],
	options: WITH_OPTIONS,
	description: 'Names of the entities the events belong to, embedded in every result',
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
			displayName: 'Created At From',
			name: 'createdAtFrom',
			type: 'dateTime',
			default: '',
			description: 'Only events recorded at or after this moment',
		},
		{
			displayName: 'Created At To',
			name: 'createdAtTo',
			type: 'dateTime',
			default: '',
			description: 'Only events recorded at or before this moment',
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
			displayName: 'Entity ID',
			name: 'entityId',
			type: 'string',
			default: '',
			placeholder: '6232965,6232966',
			description:
				'Only events about these entities, as a comma-separated list of IDs. amoCRM accepts at most ten, and only when exactly one entity type is chosen.',
		},
		{
			displayName: 'Entity Type',
			name: 'entity',
			type: 'multiOptions',
			default: [],
			options: ENTITY_OPTIONS,
			description:
				'Only events about entities of these types. The feed names types in the singular, unlike the rest of the API; for a list element write catalog_&lt;catalog ID&gt; with an expression.',
		},
		{
			displayName: 'Event ID',
			name: 'ids',
			type: 'string',
			default: '',
			placeholder: '01pz58t6p04ymgsgfbmfyfy1mf',
			description: 'Only these events, as a comma-separated list of IDs',
		},
		{
			displayName: 'Event Type Names or IDs',
			name: 'type',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getEventTypes' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

/**
 * Filters on what an event changed a value to.
 *
 * amoCRM supports four of these and no more, each tied to the event types it makes
 * sense for, and the keys it wants here are not the keys it answers with —
 * `leads_statuses` on the way in, `lead_status` on the way out. The previous value
 * is offered too because the parameter table lists `value_before` beside
 * `value_after`, though every documented example is about the new value.
 */
const valueFilters: INodeProperties = {
	displayName: 'Value Filters',
	name: 'valueFilters',
	type: 'collection',
	placeholder: 'Add Value Filter',
	default: {},
	displayOptions: showFor(['getAll']),
	options: [
		{
			displayName: 'Applies To',
			name: 'appliesTo',
			type: 'options',
			default: 'valueAfter',
			options: [
				{ name: 'New Value', value: 'valueAfter' },
				{ name: 'Previous Value', value: 'valueBefore' },
			],
			description:
				'Whether the filters below match the value after the change or the one before it. amoCRM documents examples for the new value only.',
		},
		{
			displayName: 'Custom Field Option ID',
			name: 'customFieldValue',
			type: 'string',
			default: '',
			description:
				'Only events where the field took this option. amoCRM allows it for select-type fields only, and Event Type must then name exactly one custom_field_&lt;field ID&gt;_value_changed code.',
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
			displayName: 'Responsible User Name or ID',
			name: 'responsibleUserId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsers' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Status Name or ID',
			name: 'statusId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getStatuses', loadOptionsDependsOn: ['&pipelineId'] },
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
				'Only events whose value is this one — a budget, a name, an LTV or an NPS rating. Event Type must name exactly one of the change types it fits.',
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
		displayOptions: { show: { resource: ['event'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get an event',
				description: 'Retrieve one entry of the account feed by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many events',
				description: 'Retrieve entries of the account feed',
			},
		],
	},
	{
		displayName:
			'The feed is read-only: entries appear because something else happened, so there is nothing here to create or delete. An account whose subscription has lapsed answers 402 on these calls even while other reads still work. Event IDs are ULID strings such as 01pz58t6p04ymgsgfbmfyfy1mf, never numbers.',
		name: 'eventFeedNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['get', 'getAll']),
	},
	{
		displayName: 'Event ID',
		name: 'eventId',
		type: 'string',
		default: '',
		required: true,
		placeholder: '01pz58t6p04ymgsgfbmfyfy1mf',
		displayOptions: showFor(['get']),
		description: 'ULID of the feed entry to read',
	},
	...returnAllProperties(showFor(['getAll'])),
	filters,
	valueFilters,
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['get', 'getAll']),
		options: [includeProperty],
	},
];
