import type { INodeProperties } from 'n8n-workflow';

import type { EntityKind } from '../../descriptions/common';
import {
	batchSizeProperty,
	entityLocator,
	responsibleUserProperty,
	returnAllProperties,
} from '../../descriptions/common';

/**
 * A task carries its link to a card as the pair `entity_type` + `entity_id`, and
 * `entity_type` is the **plural** spelling — `leads`, not `lead`. Events use the
 * singular form for the same idea, so the two must never share an enum.
 */
const LINKABLE_ENTITIES: Array<{ kind: EntityKind; label: string; entityType: string }> = [
	{ kind: 'company', label: 'Company', entityType: 'companies' },
	{ kind: 'contact', label: 'Contact', entityType: 'contacts' },
	{ kind: 'customer', label: 'Customer', entityType: 'customers' },
	{ kind: 'lead', label: 'Lead', entityType: 'leads' },
];

/** Where the linked entity for create and update lives, per entity type. */
export const TARGET_ID_PARAMETERS: Record<string, string> = {
	companies: 'companyId',
	contacts: 'contactId',
	customers: 'customerId',
	leads: 'leadId',
};

/** The same pickers again, for the Get Many entity filter. */
export const FILTER_ID_PARAMETERS: Record<string, string> = {
	companies: 'filterCompanyId',
	contacts: 'filterContactId',
	customers: 'filterCustomerId',
	leads: 'filterLeadId',
};

export const TARGET_TYPE_PARAMETER = 'linkedEntityType';
export const FILTER_TYPE_PARAMETER = 'filterEntityType';

const show = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['task'], operation: operations },
});

/**
 * The entity-type dropdown plus one searchable picker per type.
 *
 * A bare "Entity ID" box would be cheaper to build and useless to use: nobody knows
 * a lead's id by heart. Splitting the choice in two lets the picker below search the
 * live account, and it keeps the plural `entity_type` spelling out of the user's
 * hands entirely.
 */
function entityTargetProperties(
	typeParameter: string,
	idParameters: Record<string, string>,
	operations: string[],
	options: { displayName: string; description: string; required: boolean },
): INodeProperties[] {
	const typeProperty: INodeProperties = {
		displayName: options.displayName,
		name: typeParameter,
		type: 'options',
		default: '',
		displayOptions: show(operations),
		description: options.description,
		options: [
			...LINKABLE_ENTITIES.map((entity) => ({ name: entity.label, value: entity.entityType })),
			{ name: 'None', value: '' },
		],
	};

	const pickers = LINKABLE_ENTITIES.map((entity) =>
		entityLocator(
			entity.kind,
			idParameters[entity.entityType],
			{
				show: { resource: ['task'], operation: operations, [typeParameter]: [entity.entityType] },
			},
			{
				required: options.required,
				description: `The ${entity.label.toLowerCase()} the task belongs to`,
			},
		),
	);

	return [typeProperty, ...pickers];
}

const taskTypeProperty: INodeProperties = {
	displayName: 'Task Type Name or ID',
	name: 'task_type_id',
	type: 'options',
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	typeOptions: { loadOptionsMethod: 'getTaskTypes' },
	default: '',
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'create',
		displayOptions: { show: { resource: ['task'] } },
		options: [
			{ name: 'Complete', value: 'complete', action: 'Complete a task' },
			{ name: 'Create', value: 'create', action: 'Create a task' },
			{ name: 'Get', value: 'get', action: 'Get a task' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many tasks' },
			{ name: 'Update', value: 'update', action: 'Update a task' },
		],
	},

	{
		displayName: 'Task',
		name: 'taskId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: show(['complete', 'get', 'update']),
		description: 'The task to work with',
		modes: [
			{
				// Tasks have no name to search by, so the list shows the newest first and
				// narrows them by the text the user has already typed.
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchTasks', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[0-9]+$', errorMessage: 'An amoCRM ID is a number' },
					},
				],
			},
		],
	},

	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		default: '',
		required: true,
		displayOptions: show(['create']),
		description: 'What has to be done',
	},
	{
		displayName: 'Deadline',
		name: 'complete_till',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: show(['create']),
		description: 'When the task is due, sent to amoCRM as a Unix timestamp',
	},

	...entityTargetProperties(TARGET_TYPE_PARAMETER, TARGET_ID_PARAMETERS, ['create', 'update'], {
		displayName: 'Linked To',
		description:
			'The card this task hangs on. Leave it at None for a task that belongs to nobody in particular.',
		required: true,
	}),

	{
		displayName: 'Result',
		name: 'result_text',
		type: 'string',
		default: '',
		required: true,
		displayOptions: show(['complete']),
		description: 'What came of the task. Most accounts refuse to close a task without one.',
	},

	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			{
				displayName: 'Created At',
				name: 'created_at',
				type: 'dateTime',
				default: '',
				description: 'Backdates the task, for imports that have to keep the original moment',
			},
			{
				displayName: 'Created By Name or ID',
				name: 'created_by',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getUsersWithRobot' },
				default: '',
			},
			{
				displayName: 'Duration',
				name: 'duration',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'How long the task is expected to take, in seconds. It drives the block the task occupies in the calendar.',
			},
			responsibleUserProperty(undefined),
			taskTypeProperty,
		],
	},

	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: [
			{
				displayName: 'Deadline',
				name: 'complete_till',
				type: 'dateTime',
				default: '',
				description: 'When the task is due, sent to amoCRM as a Unix timestamp',
			},
			{
				displayName: 'Duration',
				name: 'duration',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'How long the task is expected to take, in seconds',
			},
			responsibleUserProperty(undefined),
			{
				displayName: 'Result',
				name: 'result_text',
				type: 'string',
				default: '',
				description:
					'What came of the task. Writing it does not close the task — the Complete operation does that.',
			},
			taskTypeProperty,
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				default: '',
				description: 'What has to be done',
			},
		],
	},

	...returnAllProperties(show(['getAll'])),

	...entityTargetProperties(FILTER_TYPE_PARAMETER, FILTER_ID_PARAMETERS, ['getAll'], {
		displayName: 'Linked To',
		description: 'Return only the tasks hanging on one card',
		required: false,
	}),

	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{
				displayName: 'Completed',
				name: 'is_completed',
				type: 'boolean',
				default: false,
				description:
					'Whether to return only closed tasks. Leave this filter out altogether to get open and closed ones alike.',
			},
			{
				displayName: 'Responsible User Names or IDs',
				name: 'responsible_user_id',
				type: 'multiOptions',
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getUsers' },
				default: [],
			},
			{
				displayName: 'Task IDs',
				name: 'ids',
				type: 'string',
				default: '',
				placeholder: '7087,7088',
				description: 'Comma-separated list of task IDs to return',
			},
			{
				displayName: 'Task Type Names or IDs',
				name: 'task_type',
				type: 'multiOptions',
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getTaskTypes' },
				default: [],
			},
			{
				displayName: 'Updated After',
				name: 'updated_at_from',
				type: 'dateTime',
				default: '',
				description: 'Only tasks changed at or after this moment',
			},
			{
				displayName: 'Updated Before',
				name: 'updated_at_to',
				type: 'dateTime',
				default: '',
				description: 'Only tasks changed at or before this moment',
			},
		],
	},

	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{
				displayName: 'Sort By',
				name: 'sortBy',
				type: 'options',
				default: 'created_at',
				options: [
					{ name: 'Created At', value: 'created_at' },
					{ name: 'Deadline', value: 'complete_till' },
					{ name: 'ID', value: 'id' },
				],
			},
			{
				displayName: 'Sort Order',
				name: 'sortOrder',
				type: 'options',
				default: 'desc',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
				],
			},
		],
	},

	batchSizeProperty(show(['complete', 'create', 'update'])),
];
