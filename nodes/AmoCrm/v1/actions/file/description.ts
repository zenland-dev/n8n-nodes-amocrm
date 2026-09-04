import type { INodeProperties } from 'n8n-workflow';

import type { EntityKind } from '../../descriptions/common';
import { entityLocator, returnAllProperties } from '../../descriptions/common';

// The sentence on the two dropdowns below is spelled out rather than taken from
// DYNAMIC_OPTIONS_DESCRIPTION on purpose: n8n's linter matches it as a literal and
// cannot follow an identifier, so the shared constant fails the rule it exists for.
// `multiOptions` wants the plural form ("specify IDs"), `options` the singular.

/**
 * The four card types a file can be hung on.
 *
 * As with notes, the type is not a filter but half of the URL —
 * `/api/v4/{entity_type}/{id}/files` — so it has to be chosen before the card is.
 * Customers appear in the amocrm.ru documentation only; Kommo's mirror lists just
 * the first three, and Kommo accounts have no Customers module to begin with.
 */
const FILE_ENTITIES: Array<{ kind: EntityKind; label: string; entityType: string }> = [
	{ kind: 'company', label: 'Company', entityType: 'companies' },
	{ kind: 'contact', label: 'Contact', entityType: 'contacts' },
	{ kind: 'customer', label: 'Customer', entityType: 'customers' },
	{ kind: 'lead', label: 'Lead', entityType: 'leads' },
];

export const ENTITY_TYPE_PARAMETER = 'entityType';
export const LIST_ENTITY_TYPE_PARAMETER = 'listEntityType';

/** Picker holding the card a file is linked to, per entity type. */
export const TARGET_ID_PARAMETERS: Record<string, string> = {
	companies: 'companyId',
	contacts: 'contactId',
	customers: 'customerId',
	leads: 'leadId',
};

/** The same pickers again, narrowing a Get Many to one card. */
export const LIST_ID_PARAMETERS: Record<string, string> = {
	companies: 'listCompanyId',
	contacts: 'listContactId',
	customers: 'listCustomerId',
	leads: 'listLeadId',
};

/** Operations that address a card rather than the storage as a whole. */
const ENTITY_OPERATIONS = ['addNote', 'attach', 'detach'];

/** Operations that take a file UUID. */
const UUID_OPERATIONS = ['addNote', 'attach', 'delete', 'detach', 'download', 'get', 'getLinks'];

const ENTITY_TYPE_OPTIONS = [
	{ name: 'Company', value: 'companies' },
	{ name: 'Contact', value: 'contacts' },
	{
		name: 'Customer',
		value: 'customers',
		description: 'Needs the Customers module, which Kommo accounts do not have',
	},
	{ name: 'Lead', value: 'leads' },
];

const show = (
	operations: string[],
	extra: Record<string, string[]> = {},
): INodeProperties['displayOptions'] => ({
	show: { resource: ['file'], operation: operations, ...extra },
});

function entityPickers(
	idParameters: Record<string, string>,
	typeParameter: string,
	operations: string[],
	extra: Record<string, string[]>,
	describe: (label: string) => string,
): INodeProperties[] {
	return FILE_ENTITIES.map((entity) =>
		entityLocator(
			entity.kind,
			idParameters[entity.entityType],
			{
				show: {
					resource: ['file'],
					operation: operations,
					...extra,
					[typeParameter]: [entity.entityType],
				},
			},
			{ required: true, description: describe(entity.label.toLowerCase()) },
		),
	);
}

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'upload',
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Add as Note',
				value: 'addNote',
				action: 'Add a file as a note',
				description: 'Write an attachment entry into the feed of a card',
			},
			{
				name: 'Attach to Entity',
				value: 'attach',
				action: 'Attach a file to an entity',
				description: 'Link an uploaded file to the Files tab of a card',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a file',
				description: 'Move a file in the storage to the trash',
			},
			{
				name: 'Detach From Entity',
				value: 'detach',
				action: 'Detach a file from an entity',
				description: 'Unlink a file from a card, leaving it in the storage',
			},
			{
				name: 'Download',
				value: 'download',
				action: 'Download a file',
				description: 'Fetch the contents of a file into binary data',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a file',
				description: 'Retrieve the metadata of one file by UUID',
			},
			{
				name: 'Get Linked Entities',
				value: 'getLinks',
				action: 'Get entities linked to a file',
				description: 'Retrieve every card one file is attached to',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many files',
				description: 'List the files of one card, or search the whole storage',
			},
			{
				name: 'Upload',
				value: 'upload',
				action: 'Upload a file',
				description: 'Send binary data to the account file storage',
			},
		],
	},

	{
		displayName: 'Input Data Field Name',
		name: 'inputDataFieldName',
		type: 'string',
		default: 'data',
		required: true,
		placeholder: 'data',
		displayOptions: show(['upload']),
		description: 'The name of the input binary field holding the file to upload',
	},
	{
		displayName: 'Options',
		name: 'uploadOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['upload']),
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description:
					'Name to store the file under, extension included. Defaults to the file name carried by the binary field.',
			},
			{
				displayName: 'Generate Previews',
				name: 'withPreview',
				type: 'boolean',
				default: false,
				description:
					'Whether to ask amoCRM to render preview thumbnails, for the formats that support them',
			},
			{
				displayName: 'MIME Type',
				name: 'contentType',
				type: 'string',
				default: '',
				placeholder: 'application/pdf',
				description:
					'Content type to store the file under. Defaults to the MIME type carried by the binary field.',
			},
			{
				displayName: 'New Version of File UUID',
				name: 'fileUuid',
				type: 'string',
				default: '',
				description:
					'UUID of an existing file to store these bytes as a new version of, instead of creating a separate file',
			},
		],
	},

	{
		displayName: 'File UUID',
		name: 'fileUuid',
		type: 'string',
		default: '',
		required: true,
		placeholder: '367b9f38-5f01-4cea-947e-dfab36726785',
		displayOptions: show(UUID_OPERATIONS),
		description:
			'UUID of the file, as returned by Upload. Attach, Detach and Delete also accept several UUIDs separated by commas.',
	},

	{
		displayName: 'Entity Type',
		name: ENTITY_TYPE_PARAMETER,
		type: 'options',
		default: 'leads',
		required: true,
		displayOptions: show(ENTITY_OPERATIONS),
		description: 'Which kind of card the file belongs to. It selects the endpoint.',
		options: ENTITY_TYPE_OPTIONS,
	},
	...entityPickers(
		TARGET_ID_PARAMETERS,
		ENTITY_TYPE_PARAMETER,
		ENTITY_OPERATIONS,
		{},
		(label) => `The ${label} the file belongs to`,
	),

	{
		displayName: 'Options',
		name: 'noteOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['addNote']),
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description:
					'Name shown on the feed entry. Left empty, the name stored on the file is read from the storage and used.',
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
				displayName: 'Text',
				name: 'text',
				type: 'string',
				default: '',
				description: 'A comment shown beside the attachment in the feed',
			},
			{
				displayName: 'Version UUID',
				name: 'versionUuid',
				type: 'string',
				default: '',
				description:
					'Pin the entry to one version of the file. Left empty, the feed always shows the latest version.',
			},
		],
	},

	{
		displayName: 'Files Of',
		name: 'source',
		type: 'options',
		default: 'entity',
		displayOptions: show(['getAll']),
		description: 'Whether to list the files linked to one card, or search the whole storage',
		options: [
			{
				name: 'Account Storage',
				value: 'drive',
				description: 'Search every file the account holds, linked or not',
			},
			{
				name: 'Entity',
				value: 'entity',
				description: 'List the files linked to one lead, contact, company or customer',
			},
		],
	},
	{
		displayName: 'Entity Type',
		name: LIST_ENTITY_TYPE_PARAMETER,
		type: 'options',
		default: 'leads',
		required: true,
		displayOptions: show(['getAll'], { source: ['entity'] }),
		description: 'Which kind of card to list the files of',
		options: ENTITY_TYPE_OPTIONS,
	},
	...entityPickers(
		LIST_ID_PARAMETERS,
		LIST_ENTITY_TYPE_PARAMETER,
		['getAll'],
		{ source: ['entity'] },
		(label) => `The ${label} whose files to list`,
	),

	...returnAllProperties(show(['getAll'])),

	{
		displayName: 'Options',
		name: 'entityListOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['getAll'], { source: ['entity'] }),
		options: [
			{
				displayName: 'Include File Details',
				name: 'includeDetails',
				type: 'boolean',
				default: false,
				description:
					'Whether to read each file from the storage as well. A card only stores links, so without this the rows carry a UUID and nothing else — at the cost of one extra request per fifty files.',
			},
		],
	},

	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll'], { source: ['drive'] }),
		options: [
			{
				displayName: 'Created By Names or IDs',
				name: 'createdBy',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getUsers' },
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Date From',
				name: 'dateFrom',
				type: 'dateTime',
				default: '',
				description: 'Keep only files whose chosen date is at or after this moment',
			},
			{
				displayName: 'Date To',
				name: 'dateTo',
				type: 'dateTime',
				default: '',
				description: 'Keep only files whose chosen date is at or before this moment',
			},
			{
				displayName: 'Date Type',
				name: 'dateType',
				type: 'options',
				default: 'created_at',
				description: 'Which date the From and To bounds apply to',
				options: [
					{ name: 'Created At', value: 'created_at' },
					{ name: 'Updated At', value: 'updated_at' },
				],
			},
			{
				displayName: 'Extensions',
				name: 'extensions',
				type: 'string',
				default: '',
				placeholder: 'pdf,png',
				description: 'Keep only these file extensions, separated by commas',
			},
			{
				displayName: 'File UUIDs',
				name: 'uuid',
				type: 'string',
				default: '',
				description: 'Keep only these UUIDs, separated by commas',
			},
			{
				displayName: 'Include Deleted',
				name: 'deleted',
				type: 'boolean',
				default: false,
				description: 'Whether to include files that are in the trash',
			},
			{
				displayName: 'Name Contains',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Keep only files whose name contains this text',
			},
			{
				displayName: 'Search Term',
				name: 'term',
				type: 'string',
				default: '',
				description:
					'Full-text search across file names and the names of the cards they are linked to',
			},
		],
	},

	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		placeholder: 'data',
		displayOptions: show(['download']),
		description: 'The name of the output binary field to write the file to',
	},
	{
		displayName: 'Options',
		name: 'downloadOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['download']),
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description:
					'Name to give the downloaded file. Defaults to the name it carries in the storage.',
			},
		],
	},
];
