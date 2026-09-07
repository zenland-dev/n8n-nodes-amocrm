import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';

/** Scopes a property to this resource and to the operations it belongs to. */
function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['talk'], operation: operations } };
}

/** The two entity types a conversation can be about; a contact always owns it. */
const ENTITY_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Customer', value: 'customer' },
	{ name: 'Lead', value: 'lead' },
];

/** The attachment types the send endpoint accepts, each needing a file on the drive. */
const ATTACHMENT_OPTIONS: INodePropertyOptions[] = [
	{ name: 'File', value: 'file' },
	{ name: 'Picture', value: 'picture' },
	{ name: 'Video', value: 'video' },
];

const talkIdProperty: INodeProperties = {
	displayName: 'Conversation ID',
	name: 'talkId',
	type: 'string',
	default: '',
	required: true,
	placeholder: '117',
	displayOptions: showFor(['close', 'get', 'getMessages', 'sendMessage']),
	description:
		'The talk_id of the conversation, as Get Many returns it. It is not the chat ID: a chat is the channel, a conversation is one exchange inside it.',
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
			displayName: 'Contact IDs',
			name: 'contactIds',
			type: 'string',
			default: '',
			placeholder: '3372695, 3372696',
			description: 'Only conversations belonging to these contacts, comma-separated',
		},
		{
			displayName: 'Conversation IDs',
			name: 'talkIds',
			type: 'string',
			default: '',
			placeholder: '117, 118',
			description: 'Only these conversations, by talk_id, comma-separated',
		},
		{
			displayName: 'Entity IDs',
			name: 'entityIds',
			type: 'string',
			default: '',
			placeholder: '667999637',
			description:
				'Only conversations about these leads or customers, comma-separated. Entity Type has to say which of the two.',
		},
		{
			displayName: 'Entity Type',
			name: 'entityType',
			type: 'options',
			default: 'lead',
			options: ENTITY_OPTIONS,
			description: 'What the IDs above are. Required whenever Entity IDs is filled in.',
		},
		{
			displayName: 'Only In Work',
			name: 'onlyInWork',
			type: 'boolean',
			default: false,
			description: 'Whether to return only conversations that are still open',
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
		displayOptions: { show: { resource: ['talk'] } },
		options: [
			{
				name: 'Close',
				value: 'close',
				action: 'Close a conversation',
				description:
					'End a conversation, or hand it to the NPS bot to ask the client for a rating first',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a conversation',
				description: 'Retrieve one conversation by its talk ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many conversations',
				description: 'List conversations, optionally only the open ones or those of one contact',
			},
			{
				name: 'Get Messages',
				value: 'getMessages',
				action: 'Get the messages of a conversation',
				description:
					'Read the message history of one conversation. Kommo accounts only: on amoCRM.ru this refuses with a 403.',
			},
			{
				name: 'Send Message',
				value: 'sendMessage',
				action: 'Send a message to a conversation',
				description:
					'Reply to the client in the messenger the conversation runs on — WhatsApp, Telegram or whichever channel it came from. Kommo accounts only: on amoCRM.ru this refuses with a 403.',
			},
		],
	},
	{
		displayName:
			'A conversation is one exchange with a client in a messenger, and it belongs to a contact. Listing, reading and closing work on both amoCRM and Kommo; an account whose subscription has lapsed answers 402. Get Messages and Send Message are documented by Kommo only: the routes exist on amoCRM.ru too, but answer 403 there — they need a chat permission that amoCRM does not offer integrations, so listing conversations succeeds while reading one refuses. Tested against a live amoCRM.ru account on 8 September 2026.',
		name: 'talkNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['close', 'get', 'getAll', 'getMessages', 'sendMessage']),
	},
	talkIdProperty,
	...returnAllProperties(showFor(['getAll', 'getMessages'])),
	filters,
	{
		displayName: 'Force Close',
		name: 'forceClose',
		type: 'boolean',
		default: false,
		displayOptions: showFor(['close']),
		description:
			'Whether to close the conversation outright. Off, and an account with the NPS bot enabled sends the client a rating request first, closing the conversation only once it answers or gives up.',
	},
	{
		displayName: 'Message',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		displayOptions: showFor(['sendMessage']),
		description: 'Text to send. It may be left empty when an attachment is given, and only then.',
	},
	{
		displayName: 'Attachment',
		name: 'attachment',
		type: 'collection',
		placeholder: 'Add Attachment Detail',
		default: {},
		displayOptions: showFor(['sendMessage']),
		description:
			'A file already on the amoCRM drive. Upload it with the File resource first — the send endpoint takes references, not file content, so all three details below are needed together.',
		options: [
			{
				displayName: 'File UUID',
				name: 'driveUuid',
				type: 'string',
				default: '',
				description: 'The uuid of the file, as the File resource reports it after an upload',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'file',
				options: ATTACHMENT_OPTIONS,
				description: 'How the messenger should present the file to the client',
			},
			{
				displayName: 'Version UUID',
				name: 'driveVersionUuid',
				type: 'string',
				default: '',
				description:
					'The uuid of the file version to send. A freshly uploaded file has one; File → Get reports the others.',
			},
		],
	},
];
