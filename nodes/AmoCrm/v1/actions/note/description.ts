import type { INodeProperties } from 'n8n-workflow';

import type { EntityKind } from '../../descriptions/common';
import {
	entityLocator,
	responsibleUserProperty,
	returnAllProperties,
} from '../../descriptions/common';

/**
 * Notes are not an account-level collection: every entity type owns its own
 * `/api/v4/{entity_type}/notes` endpoint, in the **plural** spelling. So the entity
 * type is not a filter here, it is half of the URL — which is why it sits at the
 * top of the form for every operation.
 */
const NOTE_ENTITIES: Array<{ kind: EntityKind; label: string; entityType: string }> = [
	{ kind: 'company', label: 'Company', entityType: 'companies' },
	{ kind: 'contact', label: 'Contact', entityType: 'contacts' },
	{ kind: 'customer', label: 'Customer', entityType: 'customers' },
	{ kind: 'lead', label: 'Lead', entityType: 'leads' },
];

/** Picker holding the entity a new note is written to, per entity type. */
export const TARGET_ID_PARAMETERS: Record<string, string> = {
	companies: 'companyId',
	contacts: 'contactId',
	customers: 'customerId',
	leads: 'leadId',
};

/** The same pickers again, narrowing a Get Many to one card. */
export const FILTER_ID_PARAMETERS: Record<string, string> = {
	companies: 'filterCompanyId',
	contacts: 'filterContactId',
	customers: 'filterCustomerId',
	leads: 'filterLeadId',
};

export const ENTITY_TYPE_PARAMETER = 'entityType';

/**
 * The note types this node can write, mapped from a camelCase option value to the
 * string amoCRM stores.
 *
 * Reading is open-ended — a feed is full of system notes no integration may create,
 * such as `site_visit` or `invoice_paid` — but writing is a closed set, and the
 * `params` object each one needs is different. Hence a parameter set per type
 * rather than one JSON box for all of them.
 */
export const NOTE_TYPES: Record<string, string> = {
	attachment: 'attachment',
	callIn: 'call_in',
	callOut: 'call_out',
	common: 'common',
	extendedServiceMessage: 'extended_service_message',
	geolocation: 'geolocation',
	messageCashier: 'message_cashier',
	serviceMessage: 'service_message',
	smsIn: 'sms_in',
	smsOut: 'sms_out',
};

const NOTE_TYPE_OPTIONS = [
	{ name: 'Attachment', value: 'attachment' },
	{
		name: 'Custom (JSON)',
		value: 'custom',
		description: 'For a note type this build does not know about',
	},
	{ name: 'Extended Service Message', value: 'extendedServiceMessage' },
	{ name: 'Geolocation', value: 'geolocation' },
	{ name: 'Incoming Call', value: 'callIn' },
	{ name: 'Incoming SMS', value: 'smsIn' },
	{ name: 'Message to Cashier', value: 'messageCashier' },
	{ name: 'Outgoing Call', value: 'callOut' },
	{ name: 'Outgoing SMS', value: 'smsOut' },
	{ name: 'Service Message', value: 'serviceMessage' },
	{ name: 'Text', value: 'common' },
];

const CALL_TYPES = ['callIn', 'callOut'];
const TEXT_TYPES = [
	'common',
	'extendedServiceMessage',
	'geolocation',
	'messageCashier',
	'serviceMessage',
	'smsIn',
	'smsOut',
];

const show = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['note'], operation: operations },
});

/** Shows a parameter only for the note types whose `params` actually carry it. */
const showForTypes = (
	operations: string[],
	noteTypes: string[],
): INodeProperties['displayOptions'] => ({
	show: { resource: ['note'], operation: operations, noteType: noteTypes },
});

function entityPickers(
	idParameters: Record<string, string>,
	operations: string[],
	options: { required: boolean; describe: (label: string) => string },
): INodeProperties[] {
	return NOTE_ENTITIES.map((entity) =>
		entityLocator(
			entity.kind,
			idParameters[entity.entityType],
			{
				show: {
					resource: ['note'],
					operation: operations,
					[ENTITY_TYPE_PARAMETER]: [entity.entityType],
				},
			},
			{ required: options.required, description: options.describe(entity.label.toLowerCase()) },
		),
	);
}

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'create',
		displayOptions: { show: { resource: ['note'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a note',
				description: 'Write a note into the feed of a lead, contact, company or customer',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a note',
				description: 'Retrieve one note by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many notes',
				description: 'List notes of one entity type, optionally narrowed to a single card',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a note',
				description: 'Change the text or parameters of an existing note',
			},
		],
	},

	{
		displayName: 'Entity Type',
		name: ENTITY_TYPE_PARAMETER,
		type: 'options',
		default: 'leads',
		required: true,
		displayOptions: { show: { resource: ['note'] } },
		description:
			'Which kind of card the note belongs to. It selects the endpoint, so a note cannot be moved between types afterwards.',
		options: [
			{ name: 'Company', value: 'companies' },
			{ name: 'Contact', value: 'contacts' },
			{
				name: 'Customer',
				value: 'customers',
				description: 'Needs the Customers module, which Kommo accounts do not have',
			},
			{ name: 'Lead', value: 'leads' },
		],
	},

	...entityPickers(TARGET_ID_PARAMETERS, ['create'], {
		required: true,
		describe: (label) => `The ${label} to write the note on`,
	}),

	{
		displayName: 'Note ID',
		name: 'noteId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: show(['get', 'update']),
		description: 'ID of the note to work with',
	},

	{
		displayName: 'Note Type',
		name: 'noteType',
		type: 'options',
		default: 'common',
		displayOptions: show(['create', 'update']),
		description:
			'What kind of entry to write into the feed. Each type carries its own set of fields.',
		options: NOTE_TYPE_OPTIONS,
	},

	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: showForTypes(['create', 'update'], TEXT_TYPES),
		description: 'The body of the note as it appears in the feed',
	},

	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		default: '',
		displayOptions: showForTypes(['create', 'update'], [...CALL_TYPES, 'smsIn', 'smsOut']),
		description:
			'Phone number shown on the note. On a call note it is display only — amoCRM does not re-route the note by it.',
	},
	{
		displayName: 'Duration',
		name: 'duration',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		displayOptions: showForTypes(['create', 'update'], CALL_TYPES),
		description: 'Length of the call in seconds',
	},
	{
		displayName: 'Recording URL',
		name: 'link',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/recordings/1.mp3',
		displayOptions: showForTypes(['create', 'update'], CALL_TYPES),
		description:
			'Where the recording can be played from. The player in the feed reads it directly, so it has to be reachable without a login.',
	},
	{
		displayName: 'Source',
		name: 'source',
		type: 'string',
		default: '',
		placeholder: 'onlinePBX',
		displayOptions: showForTypes(['create', 'update'], CALL_TYPES),
		description: 'Name of the telephony integration, shown beside the call in the feed',
	},
	{
		displayName: 'Call Responsible',
		name: 'call_responsible',
		type: 'string',
		default: '',
		displayOptions: showForTypes(['create', 'update'], CALL_TYPES),
		description: 'Who handled the call: a user ID, a phone number or a name',
	},
	{
		displayName: 'Unique Call ID',
		name: 'uniq',
		type: 'string',
		default: '',
		displayOptions: showForTypes(['create', 'update'], CALL_TYPES),
		description:
			'Your own identifier for this call. amoCRM stores it untouched, which is what lets a later update find the same call again.',
	},

	{
		displayName: 'Service',
		name: 'service',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showForTypes(
			['create', 'update'],
			['extendedServiceMessage', 'serviceMessage'],
		),
		description: 'Name of the integration the message comes from',
	},

	{
		displayName: 'Status',
		name: 'noteStatus',
		type: 'options',
		default: 'created',
		displayOptions: showForTypes(['create', 'update'], ['messageCashier']),
		description: 'State of the message on the cashier side',
		options: [
			{ name: 'Canceled', value: 'canceled' },
			{ name: 'Created', value: 'created' },
			{ name: 'Shown', value: 'shown' },
		],
	},

	{
		displayName: 'Address',
		name: 'address',
		type: 'string',
		default: '',
		displayOptions: showForTypes(['create', 'update'], ['geolocation']),
		description: 'Human-readable address of the place',
	},
	{
		displayName: 'Latitude',
		name: 'latitude',
		type: 'string',
		default: '',
		placeholder: '55.751244',
		displayOptions: showForTypes(['create', 'update'], ['geolocation']),
		description: 'Sent as a string, which is the only form amoCRM accepts here',
	},
	{
		displayName: 'Longitude',
		name: 'longitude',
		type: 'string',
		default: '',
		placeholder: '37.618423',
		displayOptions: showForTypes(['create', 'update'], ['geolocation']),
		description: 'Sent as a string, which is the only form amoCRM accepts here',
	},

	{
		displayName: 'File UUID',
		name: 'file_uuid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showForTypes(['create', 'update'], ['attachment']),
		description:
			'UUID of a file that is already in amoCRM Drive. Upload it with the File resource first — this note only points at it.',
	},
	{
		displayName: 'Version UUID',
		name: 'version_uuid',
		type: 'string',
		default: '',
		displayOptions: showForTypes(['create', 'update'], ['attachment']),
		description: 'UUID of the file version to show, as returned by the upload',
	},
	{
		displayName: 'File Name',
		name: 'file_name',
		type: 'string',
		default: '',
		displayOptions: showForTypes(['create', 'update'], ['attachment']),
		description: 'Name to display in the feed',
	},

	{
		displayName: 'Custom Note Type',
		name: 'customNoteType',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'invoice_paid',
		displayOptions: showForTypes(['create', 'update'], ['custom']),
		description:
			'The raw amoCRM note_type string. Most types beyond the ones listed above are written by amoCRM itself and rejected from the API.',
	},
	{
		displayName: 'Params (JSON)',
		name: 'customParams',
		type: 'json',
		default: '{}',
		displayOptions: showForTypes(['create', 'update'], ['custom']),
		description: 'Sent as the note params object exactly as written here',
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
				description: 'Backdates the note, for imports that have to keep the original moment',
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
			responsibleUserProperty(undefined),
			{
				displayName: 'Suppress Automations',
				name: 'suppressAutomations',
				type: 'boolean',
				default: false,
				description:
					'Whether to write the note without firing Digital Pipeline and Salesbot automations. Worth turning on for bulk imports, which would otherwise trigger every rule in the account.',
			},
		],
	},

	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: [responsibleUserProperty(undefined)],
	},

	...returnAllProperties(show(['getAll'])),

	...entityPickers(FILTER_ID_PARAMETERS, ['getAll'], {
		required: false,
		describe: (label) =>
			`Return only the notes of one ${label}. Leave it empty to read the notes of every ${label} in the account.`,
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
				displayName: 'Note IDs',
				name: 'ids',
				type: 'string',
				default: '',
				placeholder: '42709325,42709326',
				description: 'Comma-separated list of note IDs to return',
			},
			{
				displayName: 'Note Types',
				name: 'noteTypes',
				type: 'multiOptions',
				default: [],
				description: 'Return only notes of these kinds',
				options: NOTE_TYPE_OPTIONS.filter((option) => option.value !== 'custom'),
			},
			{
				displayName: 'Other Note Types',
				name: 'otherNoteTypes',
				type: 'string',
				default: '',
				placeholder: 'site_visit,invoice_paid',
				description:
					'Comma-separated raw note types, for the system notes a feed holds that no integration can write',
			},
			{
				displayName: 'Updated After',
				name: 'updated_at_from',
				type: 'dateTime',
				default: '',
				description: 'Only notes changed at or after this moment',
			},
			{
				displayName: 'Updated Before',
				name: 'updated_at_to',
				type: 'dateTime',
				default: '',
				description: 'Only notes changed at or before this moment',
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
				default: 'updated_at',
				options: [
					{ name: 'ID', value: 'id' },
					{ name: 'Updated At', value: 'updated_at' },
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
];
