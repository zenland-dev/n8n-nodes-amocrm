import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { customFieldsDescription } from '../../descriptions/customFields';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['unsorted'], operation: operations },
});

const showForCategory = (category: string): INodeProperties['displayOptions'] => ({
	show: { resource: ['unsorted'], operation: ['create'], category: [category] },
});

/** The four kinds of incoming lead amoCRM parks in Unsorted. */
const CATEGORY_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Call', value: 'sip' },
	{ name: 'Chat', value: 'chats' },
	{ name: 'Form', value: 'forms' },
	{ name: 'Mail', value: 'mail' },
];

const ORDER_FIELDS: INodePropertyOptions[] = [
	{ name: 'Created At', value: 'created_at' },
	{ name: 'Updated At', value: 'updated_at' },
];

const ORDER_DIRECTIONS: INodePropertyOptions[] = [
	{ name: 'Ascending', value: 'asc' },
	{ name: 'Descending', value: 'desc' },
];

/**
 * Unsorted holds incoming leads that nobody has looked at yet: the lead, contact and
 * company records already exist, but stay hidden from the interface until someone
 * accepts the item.
 *
 * Only `forms` and `sip` can be created over the API — chat and mail items are
 * produced by amoCRM's own integrations — and only a chat item can be linked to an
 * existing entity. That is the API's rule, not a gap in this node.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getAll',
	displayOptions: { show: { resource: ['unsorted'] } },
	options: [
		{
			name: 'Accept',
			value: 'accept',
			action: 'Accept an unsorted item',
			description: 'Turn the incoming lead into a normal lead',
		},
		{
			name: 'Create',
			value: 'create',
			action: 'Create an unsorted item',
			description: 'Add an incoming lead from a form or a call',
		},
		{
			name: 'Decline',
			value: 'decline',
			action: 'Decline an unsorted item',
			description: 'Discard the incoming lead and everything attached to it',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get an unsorted item',
			description: 'Retrieve one incoming lead by UID',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many unsorted items',
			description: 'Retrieve a filtered list of incoming leads',
		},
		{
			name: 'Get Summary',
			value: 'summary',
			action: 'Get the unsorted summary',
			description: 'Retrieve counts of accepted and declined incoming leads',
		},
		{
			name: 'Link',
			value: 'link',
			action: 'Link an unsorted item',
			description: 'Attach a chat incoming lead to an existing lead or customer',
		},
	],
};

const uidProperty: INodeProperties = {
	displayName: 'UID',
	name: 'uid',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['accept', 'decline', 'get', 'link']),
	placeholder: '5af9dedb6f2c6a29eaac6ee37fc75ffbb66e139e4603bdd0e14e39d4b319',
	description:
		'Identifier of the incoming lead. It is a long hexadecimal string, not a numeric ID — take it from Get Many or from an Unsorted webhook.',
};

const categoryProperty: INodeProperties = {
	displayName: 'Category',
	name: 'category',
	type: 'options',
	default: 'forms',
	displayOptions: showFor(['create']),
	options: [
		{
			name: 'Call',
			value: 'sip',
			description: 'An incoming or outgoing call reported by a telephony integration',
		},
		{ name: 'Form', value: 'forms', description: 'A submission from a web form' },
	],
	description:
		'Kind of incoming lead to create. Chat and mail items are created by amoCRM itself and have no API route.',
};

const sourceUidProperty: INodeProperties = {
	displayName: 'Source UID',
	name: 'sourceUid',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['create']),
	placeholder: 'website-contact-form',
	description:
		'Your own stable identifier for the source. amoCRM groups incoming leads by it, so use one value per form or per phone line rather than a fresh value per submission.',
};

const sourceNameProperty: INodeProperties = {
	displayName: 'Source Name',
	name: 'sourceName',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['create']),
	placeholder: 'Contact form on example.com',
	description: 'Human-readable source name, shown on the incoming lead in amoCRM',
};

const formMetadata: INodeProperties = {
	displayName: 'Form Details',
	name: 'formMetadata',
	type: 'collection',
	placeholder: 'Add Detail',
	default: {},
	displayOptions: showForCategory('forms'),
	description: 'What amoCRM shows about the submission on the incoming-lead card',
	options: [
		{
			displayName: 'Form ID',
			name: 'formId',
			type: 'string',
			default: '',
			description: 'Your identifier for the form that was submitted',
		},
		{
			displayName: 'Form Name',
			name: 'formName',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Form Page',
			name: 'formPage',
			type: 'string',
			default: '',
			placeholder: 'https://example.com/contact',
			description: 'Address of the page the form sits on',
		},
		{
			displayName: 'IP Address',
			name: 'ip',
			type: 'string',
			default: '',
			description: 'IP the submission came from',
		},
		{
			displayName: 'Referer',
			name: 'referer',
			type: 'string',
			default: '',
			description: 'Page the visitor arrived from',
		},
		{
			displayName: 'Sent At',
			name: 'formSentAt',
			type: 'dateTime',
			default: '',
			description: 'When the form was submitted. Defaults to the moment of the request.',
		},
	],
};

/**
 * amoCRM requires five of the call fields, so they are inputs of their own rather
 * than entries in a collection nobody would know to open.
 */
const callUniqProperty: INodeProperties = {
	displayName: 'Call ID',
	name: 'uniq',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showForCategory('sip'),
	description:
		'Unique identifier of the call, usually the PBX call ID. amoCRM treats a repeated value as the same call.',
};

const callFromProperty: INodeProperties = {
	displayName: 'Service',
	name: 'from',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showForCategory('sip'),
	placeholder: 'onlinePBX',
	description:
		'Name of the telephony service that handled the call. This is not a phone number — the caller number goes in Phone.',
};

const callPhoneProperty: INodeProperties = {
	displayName: 'Phone',
	name: 'phone',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showForCategory('sip'),
	placeholder: '+79161234567',
	description: 'Number of the client on the other end of the call',
};

const callCalledAtProperty: INodeProperties = {
	displayName: 'Called At',
	name: 'calledAt',
	type: 'dateTime',
	default: '',
	required: true,
	displayOptions: showForCategory('sip'),
	description: 'When the call took place',
};

const callDurationProperty: INodeProperties = {
	displayName: 'Duration',
	name: 'duration',
	type: 'number',
	typeOptions: { minValue: 0 },
	default: 0,
	required: true,
	displayOptions: showForCategory('sip'),
	description: 'Length of the call in seconds',
};

const callMetadata: INodeProperties = {
	displayName: 'Call Details',
	name: 'sipMetadata',
	type: 'collection',
	placeholder: 'Add Detail',
	default: {},
	displayOptions: showForCategory('sip'),
	options: [
		{
			displayName: 'Add Call Event',
			name: 'isCallEventNeeded',
			type: 'boolean',
			default: false,
			description: 'Whether to add a call event to the card of the entity amoCRM creates',
		},
		{
			displayName: 'Call Responsible',
			name: 'callResponsible',
			type: 'string',
			default: '',
			description: 'Who the call was for. amoCRM accepts a user ID, a phone number or a name here.',
		},
		{
			displayName: 'Recording URL',
			name: 'link',
			type: 'string',
			default: '',
			placeholder: 'https://example.com/recordings/1.mp3',
			description: 'Address of the call recording',
		},
		{
			displayName: 'Service Code',
			name: 'serviceCode',
			type: 'string',
			default: '',
			description: 'Code of the telephony provider, as agreed with amoCRM',
		},
	],
};

const createAdditionalFields: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'additionalFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: showFor(['create']),
	options: [
		{
			displayName: 'Created At',
			name: 'createdAt',
			type: 'dateTime',
			default: '',
			description: 'Backdates the incoming lead. Leave empty to use the moment of the request.',
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
	],
};

const leadFields: INodeProperties = {
	displayName: 'Lead Fields',
	name: 'leadFields',
	type: 'collection',
	placeholder: 'Add Lead Field',
	default: {},
	displayOptions: showFor(['create']),
	description:
		'The lead amoCRM creates behind the incoming item. The Custom Fields section below belongs to this lead.',
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
			placeholder: 'website, hot',
			description:
				'Comma-separated tag names to attach. A tag that does not exist yet is created by amoCRM.',
		},
		{
			displayName: 'Price',
			name: 'price',
			type: 'number',
			default: 0,
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
	],
};

const contactFields: INodeProperties = {
	displayName: 'Contact Fields',
	name: 'contactFields',
	type: 'collection',
	placeholder: 'Add Contact Field',
	default: {},
	displayOptions: showFor(['create']),
	description:
		'The contact attached to the incoming lead. It stays hidden from the Contacts list until the item is accepted.',
	options: [
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@example.com',
			default: '',
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
			description: 'Display name. amoCRM builds one out of First Name and Last Name if left empty.',
		},
		{
			displayName: 'Phone',
			name: 'phone',
			type: 'string',
			default: '',
			placeholder: '+79161234567',
		},
	],
};

const companyNameProperty: INodeProperties = {
	displayName: 'Company Name',
	name: 'companyName',
	type: 'string',
	default: '',
	displayOptions: showFor(['create']),
	description: 'Company to attach to the incoming lead. An incoming lead holds at most one.',
};

const acceptOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['accept']),
	options: [
		{
			displayName: 'Stage Name or ID',
			name: 'status_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getStatuses' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'User Name or ID',
			name: 'user_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsers' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

const declineOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['decline']),
	options: [
		{
			displayName: 'User Name or ID',
			name: 'user_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsers' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

const linkEntityType: INodeProperties = {
	displayName: 'Entity Type',
	name: 'entityType',
	type: 'options',
	default: 'leads',
	displayOptions: showFor(['link']),
	options: [
		{ name: 'Customer', value: 'customers' },
		{ name: 'Lead', value: 'leads' },
	],
	description:
		'What to attach the chat to. amoCRM documents leads everywhere and customers in the Russian reference only, so treat customers as the less certain of the two.',
};

const linkEntityId: INodeProperties = {
	displayName: 'Entity ID',
	name: 'entityId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['link']),
	placeholder: '152464',
	description: 'ID of the lead or customer the chat is attached to',
};

const linkOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: showFor(['link']),
	options: [
		{
			displayName: 'Contact ID',
			name: 'contactId',
			type: 'string',
			default: '',
			description: 'Contact to attach along with the chat',
		},
		{
			displayName: 'User Name or ID',
			name: 'user_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsers' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	],
};

const listFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: showFor(['getAll']),
	options: [
		{
			displayName: 'Categories',
			name: 'categories',
			type: 'multiOptions',
			default: [],
			options: CATEGORY_OPTIONS,
			description: 'Kinds of incoming lead to return',
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
			displayName: 'UIDs',
			name: 'uids',
			type: 'string',
			default: '',
			description: 'Comma-separated incoming-lead UIDs to fetch',
		},
	],
};

const listOptions: INodeProperties = {
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
			default: 'created_at',
			options: ORDER_FIELDS,
			description:
				"Field to sort by. Only creation time is documented in both of amoCRM's references; update time appears in the Russian one alone.",
		},
		{
			displayName: 'Sort Order',
			name: 'orderDirection',
			type: 'options',
			default: 'desc',
			options: ORDER_DIRECTIONS,
			description: 'Direction of the sort, applied only when Sort By is set',
		},
	],
};

const summaryFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: showFor(['summary']),
	options: [
		{
			displayName: 'Created After',
			name: 'createdFrom',
			type: 'dateTime',
			default: '',
		},
		{
			displayName: 'Created Before',
			name: 'createdTo',
			type: 'dateTime',
			default: '',
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
			displayName: 'UIDs',
			name: 'uids',
			type: 'string',
			default: '',
			description: 'Comma-separated incoming-lead UIDs to count',
		},
	],
};

export const description: INodeProperties[] = [
	operation,
	uidProperty,
	categoryProperty,
	sourceNameProperty,
	sourceUidProperty,
	callUniqProperty,
	callFromProperty,
	callPhoneProperty,
	callCalledAtProperty,
	callDurationProperty,
	callMetadata,
	formMetadata,
	leadFields,
	contactFields,
	companyNameProperty,
	customFieldsDescription(showFor(['create']), 'getLeadCustomFields'),
	createAdditionalFields,
	acceptOptions,
	declineOptions,
	linkEntityType,
	linkEntityId,
	linkOptions,
	...returnAllProperties(showFor(['getAll'])),
	listFilters,
	listOptions,
	summaryFilters,
];
