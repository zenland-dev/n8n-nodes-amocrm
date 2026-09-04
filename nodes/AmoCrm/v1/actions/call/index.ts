import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toUnixSeconds as parseTimestamp } from '../../helpers/dates';
import { batchSizeProperty, responsibleUserProperty } from '../../descriptions/common';
import { amoCrmApiRequest } from '../../transport';
import type { BatchConfig } from '../types';

/** Fields amoCRM wants as integers; the rest of the optional set is text. */
const NUMERIC_FIELDS: Array<[string, string]> = [
	['callStatus', 'call_status'],
	['responsibleUserId', 'responsible_user_id'],
	['createdBy', 'created_by'],
	['updatedBy', 'updated_by'],
];

const TEXT_FIELDS: Array<[string, string]> = [
	['uniq', 'uniq'],
	['link', 'link'],
	['callResult', 'call_result'],
];

function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['call'], operation: operations } };
}

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'create',
		displayOptions: { show: { resource: ['call'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description:
					'Log a call. amoCRM finds the card it belongs to from the phone number; v4 has no way to list, change or delete a call afterwards.',
				action: 'Create a call',
			},
		],
	},
	{
		displayName: 'Direction',
		name: 'direction',
		type: 'options',
		required: true,
		default: 'inbound',
		displayOptions: showFor(['create']),
		description:
			'Which way the call went. It decides whether the feed entry is an incoming or an outgoing call.',
		options: [
			{ name: 'Inbound', value: 'inbound' },
			{ name: 'Outbound', value: 'outbound' },
		],
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+7 999 123-45-67',
		displayOptions: showFor(['create']),
		description:
			"The other party's number, and the only thing amoCRM uses to decide where the call lands. It is matched against contact and company phone fields by the last ten digits: the match goes to that contact's single open lead, or its single customer, and otherwise to the contact or company card itself. A number that matches nothing is reported as a failure — amoCRM never creates a contact from a call.",
	},
	{
		displayName: 'Duration',
		name: 'duration',
		type: 'number',
		required: true,
		typeOptions: { minValue: 0 },
		default: 0,
		displayOptions: showFor(['create']),
		description: 'Length of the call in seconds. Send 0 for a call that was never answered.',
	},
	{
		displayName: 'Source',
		name: 'source',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'my_pbx',
		displayOptions: showFor(['create']),
		description: 'Identifier of the telephony integration, shown next to the call in the feed',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['create']),
		options: [
			{
				displayName: 'Call Responsible',
				name: 'callResponsible',
				type: 'string',
				default: '',
				description:
					'Who took an inbound call or made an outbound one. amoCRM accepts a user ID, a phone number or a name.',
			},
			{
				displayName: 'Call Result',
				name: 'callResult',
				type: 'string',
				default: '',
				description: 'Free-text outcome of the call, shown in the feed',
			},
			{
				displayName: 'Call Status',
				name: 'callStatus',
				type: 'options',
				default: 4,
				description: 'How the call ended',
				options: [
					{ name: 'Busy', value: 7 },
					{ name: 'Call Back Later', value: 2 },
					{ name: 'Conversation Completed', value: 4 },
					{ name: 'Left a Message', value: 1 },
					{ name: 'Not Connected', value: 6 },
					{ name: 'Unavailable', value: 3 },
					{ name: 'Wrong Number', value: 5 },
				],
			},
			{
				displayName: 'Created At',
				name: 'createdAt',
				type: 'dateTime',
				default: '',
				description: 'When the call happened. Defaults to the moment amoCRM receives it.',
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
				displayName: 'Recording URL',
				name: 'link',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/records/1.mp3',
				description: 'Address of the recording. amoCRM plays it from there and does not copy it.',
			},
			responsibleUserProperty(undefined, 'responsibleUserId'),
			{
				displayName: 'Unique ID',
				name: 'uniq',
				type: 'string',
				default: '',
				description:
					'Your own identifier for this call. amoCRM stores it, which is what lets a repeated run be recognised instead of logging the call twice.',
			},
			{
				displayName: 'Updated At',
				name: 'updatedAt',
				type: 'dateTime',
				default: '',
				description: 'When the call record last changed',
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
		],
	},
	batchSizeProperty(showFor(['create'])),
];

/** A moment in time as amoCRM stores it: Unix seconds. */
function toUnixSeconds(
	context: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): number | undefined {
	const parsed = parseTimestamp(value);
	if (typeof parsed !== 'string') return parsed;

	throw new NodeOperationError(context.getNode(), `"${parsed}" is not a date ${label} can use`, {
		itemIndex,
	});
}

/**
 * One call, in the shape `POST /api/v4/calls` expects.
 *
 * Shared by the per-item path and the batch path so the two cannot drift apart —
 * the endpoint takes an array either way, one element or fifty.
 */
async function buildCreatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
	const phone = String(this.getNodeParameter('phone', itemIndex, '')).trim();
	const source = String(this.getNodeParameter('source', itemIndex, '')).trim();

	if (phone === '') {
		throw new NodeOperationError(this.getNode(), 'A call needs a phone number', {
			itemIndex,
			description: 'It is the only thing amoCRM has to work out which card the call belongs to.',
		});
	}

	if (source === '') {
		throw new NodeOperationError(this.getNode(), 'A call needs a source', {
			itemIndex,
			description:
				'Any short name for the telephony integration, such as "my_pbx". amoCRM shows it beside the call.',
		});
	}

	const call: IDataObject = {
		direction: String(this.getNodeParameter('direction', itemIndex, 'inbound')),
		phone,
		duration: Number(this.getNodeParameter('duration', itemIndex, 0)) || 0,
		source,
	};

	// The emptiness check is against '' rather than falsiness on purpose: 0 is a
	// meaningful value here — `created_by: 0` credits the call to the integration
	// rather than to a person.
	for (const [key, field] of NUMERIC_FIELDS) {
		const value = additional[key];
		if (value === undefined || value === '') continue;
		call[field] = Number(value);
	}

	for (const [key, field] of TEXT_FIELDS) {
		const value = additional[key];
		if (value === undefined || value === '') continue;
		call[field] = String(value);
	}

	// A bare number here is a user id; sending it as a string would have amoCRM
	// look for a user named "504141" instead.
	const responsible = String(additional.callResponsible ?? '').trim();
	if (responsible !== '') {
		call.call_responsible = /^\d+$/.test(responsible) ? Number(responsible) : responsible;
	}

	const createdAt = toUnixSeconds(this, additional.createdAt, 'Created At', itemIndex);
	if (createdAt !== undefined) call.created_at = createdAt;

	const updatedAt = toUnixSeconds(this, additional.updatedAt, 'Updated At', itemIndex);
	if (updatedAt !== undefined) call.updated_at = updatedAt;

	return call;
}

async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const payload = await buildCreatePayload.call(this, itemIndex);

	const response = (await amoCrmApiRequest.call(this, 'POST', '/api/v4/calls', [payload])) as
		| IDataObject
		| undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const rows = (embedded.calls ?? []) as IDataObject[];

	// This endpoint answers 200 even when it saved nothing: a call whose number
	// matches no card is listed in `errors` instead, and reporting that as success
	// would hide a silently lost call.
	if (rows.length === 0) {
		const errors = (response?.errors ?? []) as IDataObject[];

		throw new NodeOperationError(this.getNode(), 'amoCRM did not add the call', {
			itemIndex,
			description:
				errors.length > 0
					? `amoCRM answered: ${JSON.stringify(errors)}`
					: `No contact or company has a phone number ending in the same ten digits as ${String(payload.phone)}. amoCRM does not create a contact from a call.`,
		});
	}

	return rows.map((json) => ({ json }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'create') return await create.call(this, itemIndex);

	throw new NodeOperationError(this.getNode(), `Unknown call operation "${operation}"`, {
		itemIndex,
	});
}

/**
 * Calls are batchable: the endpoint takes an array, and every element comes back
 * carrying the `request_id` the router put on it, so results still land on the item
 * they came from.
 *
 * The catch is per-item failure. A call whose phone matches nothing appears in
 * `errors[]` rather than in `_embedded.calls`, and a batched run drops that item
 * from the output instead of raising it. Batch Size stays at 1 by default for that
 * reason: one item in, one verdict out.
 */
export const batch: Record<string, BatchConfig> = {
	create: {
		endpoint: '/api/v4/calls',
		method: 'POST',
		collection: 'calls',
		payload: buildCreatePayload,
	},
};
