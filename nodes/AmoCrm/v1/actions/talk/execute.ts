import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';

const TALKS = '/api/v4/talks';

/** Both list endpoints cap a page at 250. */
const MAX_PAGE_SIZE = 250;

function commaSeparated(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

/**
 * The conversation the operation works on.
 *
 * Kept as a string rather than a number: it goes straight into the path, and a value
 * that is not an id should reach amoCRM as itself so the API names it, instead of
 * arriving as the literal "NaN" — a request that fails without saying why.
 */
function talkIdOf(this: IExecuteFunctions, itemIndex: number): string {
	const talkId = String(this.getNodeParameter('talkId', itemIndex, '') ?? '').trim();

	if (talkId === '') {
		throw new NodeOperationError(this.getNode(), 'No conversation ID was given', {
			description:
				'Use Get Many to list the conversations of the account and read their talk_id — the chat ID is a different value and does not work here.',
			itemIndex,
		});
	}

	return talkId;
}

function listFilter(this: IExecuteFunctions, filters: IDataObject, itemIndex: number): IDataObject {
	const filter: IDataObject = {};

	const talkIds = commaSeparated(filters.talkIds);
	const contactIds = commaSeparated(filters.contactIds);
	const entityIds = commaSeparated(filters.entityIds);

	if (talkIds.length > 0) filter.talk_id = talkIds;
	if (contactIds.length > 0) filter.contact_id = contactIds;

	if (entityIds.length > 0) {
		const entityType = String(filters.entityType ?? '').trim();

		// amoCRM cannot tell a lead id from a customer id, and answers a filter that
		// omits the type by ignoring it — returning every conversation as though no
		// filter had been asked for at all.
		if (entityType === '') {
			throw new NodeOperationError(
				this.getNode(),
				'Filtering by Entity IDs needs Entity Type as well',
				{
					description:
						'Add Entity Type to the filters and set it to Lead or Customer, whichever the IDs belong to.',
					itemIndex,
				},
			);
		}

		filter.entity_id = entityIds;
		filter.entity_type = entityType;
	}

	// The flag is presence-based: amoCRM reads any value as "yes", so sending
	// `false` would filter exactly as `true` does. It is omitted instead.
	if (filters.onlyInWork === true) filter.only_in_work = 1;

	return filter;
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const talkId = talkIdOf.call(this, itemIndex);

	const talk = (await amoCrmApiRequest.call(this, 'GET', `${TALKS}/${talkId}`)) as
		| IDataObject
		| undefined;

	// An unknown conversation may answer either 404, which the transport reports on its
	// own, or 204 with an empty body, which reaches here as nothing at all.
	if (talk === undefined) {
		throw new NodeOperationError(this.getNode(), `Conversation ${talkId} was not found`, {
			description:
				'amoCRM answers with nothing at all for a conversation that does not exist, or whose contact lies outside the rights of the user this credential belongs to.',
			itemIndex,
		});
	}

	return [{ json: talk }];
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	const qs: IDataObject = { filter: listFilter.call(this, filters, itemIndex) };
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);

	const rows = await amoCrmApiRequestAllItems.call(this, TALKS, 'talks', qs, {
		limit,
		pageSize: limit === undefined ? MAX_PAGE_SIZE : Math.min(limit, MAX_PAGE_SIZE),
	});

	return rows.map((json) => ({ json }));
}

async function getMessages(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const talkId = talkIdOf.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);

	const rows = await amoCrmApiRequestAllItems.call(
		this,
		`${TALKS}/${talkId}/messages`,
		'messages',
		{},
		{ limit, pageSize: limit === undefined ? MAX_PAGE_SIZE : Math.min(limit, MAX_PAGE_SIZE) },
	);

	return rows.map((json) => ({ json }));
}

/**
 * The attachment, or nothing.
 *
 * amoCRM wants all three of type, file and version together; two of the three is a
 * 400 that names none of them. Checking here turns that into a sentence saying which
 * one is missing.
 */
function attachmentOf(this: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	const attachment = this.getNodeParameter('attachment', itemIndex, {}) as IDataObject;

	const driveUuid = String(attachment.driveUuid ?? '').trim();
	const driveVersionUuid = String(attachment.driveVersionUuid ?? '').trim();

	if (driveUuid === '' && driveVersionUuid === '') return undefined;

	if (driveUuid === '' || driveVersionUuid === '') {
		throw new NodeOperationError(
			this.getNode(),
			'An attachment needs both File UUID and Version UUID',
			{
				description:
					'A file on the amoCRM drive is addressed by the pair. Upload the file with the File resource and use the uuid and version uuid it reports, or clear both fields to send text alone.',
				itemIndex,
			},
		);
	}

	return {
		type: String(attachment.type ?? 'file'),
		drive_uuid: driveUuid,
		drive_version_uuid: driveVersionUuid,
	};
}

/**
 * Replies to the client in whichever messenger the conversation runs on.
 *
 * Documented by Kommo only. The route exists on amoCRM.ru too but refuses there with a
 * 403 rather than a 404 — the permission it wants, "Sending to external chats", is not
 * one amoCRM offers integrations — so a refusal here is not a wrong conversation ID.
 *
 * The answer is `{ id }`, the id of the queued message: 202 means amoCRM accepted it
 * for delivery, not that the client has it.
 */
async function sendMessage(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const talkId = talkIdOf.call(this, itemIndex);
	const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');
	const attachment = attachmentOf.call(this, itemIndex);

	if (text.trim() === '' && attachment === undefined) {
		throw new NodeOperationError(this.getNode(), 'There is nothing to send', {
			description: 'Fill in Message, add an attachment, or both.',
			itemIndex,
		});
	}

	const body: IDataObject = {};
	if (text.trim() !== '') body.text = text;
	if (attachment !== undefined) body.attachment = attachment;

	const response = (await amoCrmApiRequest.call(
		this,
		'POST',
		`${TALKS}/${talkId}/send_message`,
		body,
	)) as IDataObject | undefined;

	return [{ json: { success: true, talk_id: talkId, ...(response ?? {}) } }];
}

/**
 * Ends the conversation, or asks the client to rate it first.
 *
 * The route answers 202 with no body: amoCRM has accepted the instruction, and with
 * the NPS bot enabled the conversation stays open until the client answers. There is
 * nothing to report but what was asked for, so that is what the item carries.
 *
 * A conversation that is already closed answers 422 rather than succeeding quietly,
 * which the transport turns into a message saying so.
 */
async function close(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const talkId = talkIdOf.call(this, itemIndex);
	const forceClose = this.getNodeParameter('forceClose', itemIndex, false) as boolean;

	await amoCrmApiRequest.call(this, 'POST', `${TALKS}/${talkId}/close`, {
		force_close: forceClose,
	});

	return [{ json: { success: true, talk_id: talkId, force_close: forceClose } }];
}

type Handler = (this: IExecuteFunctions, itemIndex: number) => Promise<INodeExecutionData[]>;

/**
 * There is no create and no update: a conversation appears because a client wrote in,
 * and everything about it beyond closing is changed by the messages inside it.
 */
const OPERATIONS: Record<string, Handler> = { close, get, getAll, getMessages, sendMessage };

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const handler = OPERATIONS[operation];

	if (handler === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`The talk resource has no "${operation}" operation`,
			{ itemIndex },
		);
	}

	return await handler.call(this, itemIndex);
}
