import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['pipeline'], operation: operations },
});

/**
 * The 21 colours amoCRM accepts when a stage is written.
 *
 * Reading and writing are asymmetric here: the colours the API hands back for the
 * system stages — `#c1c1c1` for incoming leads, `#CCFF66` for won, `#D5D8DB` for
 * lost — are not in this palette, so an existing stage does not always round-trip
 * through this dropdown. An expression can still send whatever the account uses.
 */
const STATUS_COLORS: INodePropertyOptions[] = [
	{ name: 'Blue', value: '#98cbff' },
	{ name: 'Grey', value: '#e6e8ea' },
	{ name: 'Lavender', value: '#ccc8f9' },
	{ name: 'Light Blue', value: '#c1e0ff' },
	{ name: 'Light Green', value: '#deff81' },
	{ name: 'Light Grey', value: '#f2f3f4' },
	{ name: 'Light Orange', value: '#ffdc7f' },
	{ name: 'Light Pink', value: '#f3beff' },
	{ name: 'Light Red', value: '#ffc8c8' },
	{ name: 'Light Yellow', value: '#fffd7f' },
	{ name: 'Mint', value: '#87f2c0' },
	{ name: 'Orange', value: '#ffce5a' },
	{ name: 'Pale Blue', value: '#d6eaff' },
	{ name: 'Pale Green', value: '#ebffb1' },
	{ name: 'Pale Orange', value: '#ffeab2' },
	{ name: 'Pale Pink', value: '#f9deff' },
	{ name: 'Pale Red', value: '#ffdbdb' },
	{ name: 'Pale Yellow', value: '#fffeb2' },
	{ name: 'Purple', value: '#eb93ff' },
	{ name: 'Red', value: '#ff8f92' },
	{ name: 'Yellow', value: '#fff000' },
];

const COLOR_DESCRIPTION =
	'One of the 21 colours amoCRM accepts on a write. The system stages come back in colours outside this palette, so re-saving such a stage through this list changes how it looks.';

/** Repeated wherever a user can aim an operation at a stage amoCRM owns. */
const RESERVED_STAGE_NOTE =
	'Stage 142 (won) and stage 143 (lost) carry those exact IDs in every pipeline of every account. amoCRM creates them itself, marks them not editable and refuses to delete them.';

const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getAll',
	displayOptions: { show: { resource: ['pipeline'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a pipeline',
			description: 'Add a pipeline, optionally with its stages',
		},
		{
			name: 'Create Status',
			value: 'createStatus',
			action: 'Create a pipeline status',
			description: 'Add a stage to an existing pipeline',
		},
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete a pipeline',
			description: 'Remove a pipeline that holds no leads',
		},
		{
			name: 'Delete Status',
			value: 'deleteStatus',
			action: 'Delete a pipeline status',
			description: 'Remove a stage and move its leads to the first stage of the pipeline',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a pipeline',
			description: 'Retrieve one pipeline with its stages',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many pipelines',
			description: 'Retrieve every pipeline of the account',
		},
		{
			name: 'Get Many Statuses',
			value: 'getAllStatuses',
			action: 'Get many pipeline statuses',
			description: 'Retrieve the stages of one pipeline',
		},
		{
			name: 'Get Status',
			value: 'getStatus',
			action: 'Get a pipeline status',
			description: 'Retrieve one stage of a pipeline',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a pipeline',
			description: 'Change the name, order or flags of a pipeline',
		},
		{
			name: 'Update Status',
			value: 'updateStatus',
			action: 'Update a pipeline status',
			description: 'Change the name, order, colour or descriptions of a stage',
		},
	],
};

const pipelineIdProperty: INodeProperties = {
	displayName: 'Pipeline Name or ID',
	name: 'pipelineId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getPipelines' },
	default: '',
	required: true,
	displayOptions: showFor([
		'get',
		'update',
		'delete',
		'getAllStatuses',
		'getStatus',
		'createStatus',
		'updateStatus',
		'deleteStatus',
	]),
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};

const statusIdProperty: INodeProperties = {
	displayName: 'Status Name or ID',
	name: 'statusId',
	type: 'options',
	typeOptions: {
		loadOptionsMethod: 'getStatuses',
		loadOptionsDependsOn: ['pipelineId'],
	},
	default: '',
	required: true,
	displayOptions: showFor(['getStatus', 'updateStatus', 'deleteStatus']),
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};

const nameProperty: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['create', 'createStatus']),
	description: 'Name shown in the amoCRM interface',
};

const sortProperty: INodeProperties = {
	displayName: 'Sort',
	name: 'sort',
	type: 'number',
	default: 100,
	displayOptions: showFor(['create', 'createStatus']),
	description:
		'Position in the list, lowest first. amoCRM requires it on creation, and it keeps the won and lost stages last by giving them 10000 and 11000.',
};

const isMainProperty: INodeProperties = {
	displayName: 'Is Main',
	name: 'is_main',
	type: 'boolean',
	default: false,
	displayOptions: showFor(['create']),
	description:
		'Whether this becomes the default pipeline. Turning it on demotes whichever pipeline is main today.',
};

const isUnsortedOnProperty: INodeProperties = {
	displayName: 'Is Unsorted On',
	name: 'is_unsorted_on',
	type: 'boolean',
	default: false,
	displayOptions: showFor(['create']),
	description: 'Whether incoming leads are collected in this pipeline',
};

const colorProperty: INodeProperties = {
	displayName: 'Color',
	name: 'color',
	type: 'options',
	default: '',
	options: STATUS_COLORS,
	displayOptions: showFor(['createStatus']),
	description: COLOR_DESCRIPTION,
};

const statusesProperty: INodeProperties = {
	displayName: 'Statuses',
	name: 'statusesUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Status',
	default: {},
	displayOptions: showFor(['create']),
	description: `Stages to create together with the pipeline. Leave it empty to let amoCRM build its default set. ${RESERVED_STAGE_NOTE}`,
	options: [
		{
			name: 'entry',
			displayName: 'Status',
			values: [
				{
					displayName: 'Color',
					name: 'color',
					type: 'options',
					default: '',
					options: STATUS_COLORS,
					description: COLOR_DESCRIPTION,
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
					description: 'Position in the pipeline, lowest first',
				},
				{
					displayName: 'Status ID',
					name: 'statusId',
					type: 'number',
					default: 0,
					description:
						'Leave at 0 to create a new stage. Set it to 142 or 143 to rename the reserved won or lost stage instead — those two are the only IDs a new pipeline accepts.',
				},
			],
		},
	],
};

const descriptionsProperty: INodeProperties = {
	displayName: 'Stage Descriptions',
	name: 'descriptionsUi',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Description',
	default: {},
	displayOptions: showFor(['createStatus', 'updateStatus']),
	description:
		'Guidance shown to salespeople working this stage, at most one text per experience level and three in total. Give an existing description its ID and leave the text empty to delete it.',
	options: [
		{
			name: 'entry',
			displayName: 'Description',
			values: [
				{
					displayName: 'Description',
					name: 'description',
					type: 'string',
					typeOptions: { rows: 3 },
					default: '',
					description: 'Up to 1000 characters, emoji allowed',
				},
				{
					displayName: 'Description ID',
					name: 'descriptionId',
					type: 'number',
					default: 0,
					description:
						'ID of an existing description to edit or delete. Leave at 0 to add a new one.',
				},
				{
					displayName: 'Level',
					name: 'level',
					type: 'options',
					default: 'newbie',
					options: [
						{ name: 'Candidate', value: 'candidate' },
						{ name: 'Master', value: 'master' },
						{ name: 'Newbie', value: 'newbie' },
					],
					description: 'Experience level this text is written for',
				},
			],
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
			displayName: 'Is Main',
			name: 'is_main',
			type: 'boolean',
			default: false,
			description:
				'Whether this becomes the default pipeline. Turning it on demotes whichever pipeline is main today.',
		},
		{
			displayName: 'Is Unsorted On',
			name: 'is_unsorted_on',
			type: 'boolean',
			default: false,
			description: 'Whether incoming leads are collected in this pipeline',
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
			description: 'Position in the list of pipelines, lowest first',
		},
	],
};

const statusUpdateFields: INodeProperties = {
	displayName: 'Update Fields',
	name: 'statusUpdateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['updateStatus']),
	description: RESERVED_STAGE_NOTE,
	options: [
		{
			displayName: 'Color',
			name: 'color',
			type: 'options',
			default: '',
			options: STATUS_COLORS,
			description: COLOR_DESCRIPTION,
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
			description: 'Position in the pipeline, lowest first',
		},
	],
};

const excludeArchivedProperty: INodeProperties = {
	displayName: 'Exclude Archived',
	name: 'excludeArchived',
	type: 'boolean',
	default: false,
	displayOptions: showFor(['getAll']),
	description: 'Whether to leave archived pipelines out of the result',
};

const includeDescriptionsProperty: INodeProperties = {
	displayName: 'Include Descriptions',
	name: 'includeDescriptions',
	type: 'boolean',
	default: false,
	displayOptions: showFor(['getStatus', 'getAllStatuses']),
	description: 'Whether to embed the stage descriptions written for each experience level',
};

export const description: INodeProperties[] = [
	operation,
	pipelineIdProperty,
	statusIdProperty,
	nameProperty,
	sortProperty,
	isMainProperty,
	isUnsortedOnProperty,
	colorProperty,
	statusesProperty,
	descriptionsProperty,
	updateFields,
	statusUpdateFields,
	...returnAllProperties(showFor(['getAll', 'getAllStatuses'])),
	excludeArchivedProperty,
	includeDescriptionsProperty,
];
