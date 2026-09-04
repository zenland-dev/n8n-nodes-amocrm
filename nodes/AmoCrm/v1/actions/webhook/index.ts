import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { amoCrmApiRequest } from '../../transport';

/**
 * A subscription is keyed on its destination URL, not on its id: there is no
 * `/api/v4/webhooks/{id}` route at all, and unsubscribing is a DELETE against the
 * collection with `{ destination }` in the body. So every operation here works
 * against this one address, and the URL is the identifier throughout.
 */
const WEBHOOKS_ENDPOINT = '/api/v4/webhooks';

/** Addresses amoCRM cannot open from its own servers. */
const UNREACHABLE_HOST = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::|\/|$)/i;

/**
 * The event codes amoCRM documents for `settings`.
 *
 * They are offered as a convenience, not as a contract: the Russian and English
 * references do not list the same set and the enum keeps growing, so nothing the
 * user picks is validated against this list. A code amoCRM does not know is
 * rejected by amoCRM, with its own message, which is more accurate than anything
 * this node could say about it.
 */
const EVENT_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Chat Template Sent for Review',
		value: 'add_chat_template_review',
		description: 'Event code add_chat_template_review',
	},
	{ name: 'Company Created', value: 'add_company', description: 'Event code add_company' },
	{ name: 'Company Deleted', value: 'delete_company', description: 'Event code delete_company' },
	{
		name: 'Company Responsible User Changed',
		value: 'responsible_company',
		description: 'Event code responsible_company',
	},
	{ name: 'Company Restored', value: 'restore_company', description: 'Event code restore_company' },
	{ name: 'Company Updated', value: 'update_company', description: 'Event code update_company' },
	{ name: 'Contact Created', value: 'add_contact', description: 'Event code add_contact' },
	{ name: 'Contact Deleted', value: 'delete_contact', description: 'Event code delete_contact' },
	{
		name: 'Contact Responsible User Changed',
		value: 'responsible_contact',
		description: 'Event code responsible_contact',
	},
	{ name: 'Contact Restored', value: 'restore_contact', description: 'Event code restore_contact' },
	{ name: 'Contact Updated', value: 'update_contact', description: 'Event code update_contact' },
	{ name: 'Conversation Created', value: 'add_talk', description: 'Event code add_talk' },
	{
		name: 'Conversation Deleted',
		value: 'delete_talk',
		description: 'Event code delete_talk, listed in the Russian reference only',
	},
	{ name: 'Conversation Updated', value: 'update_talk', description: 'Event code update_talk' },
	{
		name: 'Customer Created',
		value: 'add_customer',
		description: 'Event code add_customer, needs the Customers module',
	},
	{
		name: 'Customer Deleted',
		value: 'delete_customer',
		description: 'Event code delete_customer, needs the Customers module',
	},
	{
		name: 'Customer Responsible User Changed',
		value: 'responsible_customer',
		description: 'Event code responsible_customer, needs the Customers module',
	},
	{
		name: 'Customer Updated',
		value: 'update_customer',
		description: 'Event code update_customer, needs the Customers module',
	},
	{
		name: 'Incoming Message Received',
		value: 'add_message',
		description: 'Event code add_message',
	},
	{ name: 'Lead Created', value: 'add_lead', description: 'Event code add_lead' },
	{ name: 'Lead Deleted', value: 'delete_lead', description: 'Event code delete_lead' },
	{
		name: 'Lead Responsible User Changed',
		value: 'responsible_lead',
		description: 'Event code responsible_lead',
	},
	{ name: 'Lead Restored', value: 'restore_lead', description: 'Event code restore_lead' },
	{
		name: 'Lead Status Changed',
		value: 'status_lead',
		description: 'Event code status_lead, the only event carrying old_status_id',
	},
	{ name: 'Lead Updated', value: 'update_lead', description: 'Event code update_lead' },
	{ name: 'Note Added to Company', value: 'note_company', description: 'Event code note_company' },
	{ name: 'Note Added to Contact', value: 'note_contact', description: 'Event code note_contact' },
	{
		name: 'Note Added to Customer',
		value: 'note_customer',
		description: 'Event code note_customer, needs the Customers module',
	},
	{ name: 'Note Added to Lead', value: 'note_lead', description: 'Event code note_lead' },
	{
		name: 'Outgoing Message Sent',
		value: 'add_outgoing_message',
		description: 'Event code add_outgoing_message',
	},
	{ name: 'Task Created', value: 'add_task', description: 'Event code add_task' },
	{ name: 'Task Deleted', value: 'delete_task', description: 'Event code delete_task' },
	{
		name: 'Task Responsible User Changed',
		value: 'responsible_task',
		description: 'Event code responsible_task',
	},
	{
		name: 'Task Updated',
		value: 'update_task',
		description: 'Event code update_task, listed in the Russian reference only',
	},
];

interface AmoCrmSubscription extends IDataObject {
	id?: number;
	destination?: string;
	disabled?: boolean;
	settings?: string[];
}

function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['webhook'], operation: operations } };
}

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['webhook'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the webhook subscriptions of the account',
				action: 'Get many webhooks',
			},
			{
				name: 'Subscribe',
				value: 'subscribe',
				description: 'Ask amoCRM to post the chosen events to a URL',
				action: 'Subscribe to events',
			},
			{
				name: 'Unsubscribe',
				value: 'unsubscribe',
				description: 'Stop amoCRM posting to a URL',
				action: 'Unsubscribe from events',
			},
		],
	},
	{
		displayName: 'Destination URL',
		name: 'destination',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/webhook',
		displayOptions: showFor(['subscribe', 'unsubscribe']),
		description:
			'Where amoCRM should post. It is also the identifier of the subscription: amoCRM has no per-webhook address, so this URL is what names the hook when unsubscribing, and subscribing the same URL again replaces its event list instead of adding a second hook.',
	},
	{
		displayName: 'Events',
		name: 'events',
		type: 'multiOptions',
		default: [],
		displayOptions: showFor(['subscribe']),
		description:
			'Which changes amoCRM should post. One subscription can carry many events, and sending the list again replaces it — events left unticked stop being delivered.',
		options: EVENT_OPTIONS,
	},
	{
		displayName: 'Additional Event Codes',
		name: 'additionalEvents',
		type: 'string',
		default: '',
		placeholder: 'e.g. add_unsorted, delete_unsorted',
		displayOptions: showFor(['subscribe']),
		description:
			'Comma-separated event codes to subscribe to besides the ones picked above. amoCRM keeps adding codes and its Russian and English references do not list the same set, so a code missing from the list can be typed here and amoCRM will say itself whether it accepts it.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: showFor(['subscribe']),
		options: [
			{
				displayName: 'Sort',
				name: 'sort',
				type: 'number',
				default: 0,
				description:
					'Ordering when several subscriptions fire on the same event. Leave at 0 to let amoCRM place it.',
			},
		],
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(['getAll']),
		options: [
			{
				displayName: 'Destination URL',
				name: 'destination',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/webhook',
				description: 'Only the subscription pointing at this exact URL',
			},
		],
	},
	...returnAllProperties(showFor(['getAll'])),
];

/** Event codes from the picker and the free-text field, deduplicated and ordered. */
function chosenEvents(context: IExecuteFunctions, itemIndex: number): string[] {
	const selected = context.getNodeParameter('events', itemIndex, []) as string[];
	const additional = String(context.getNodeParameter('additionalEvents', itemIndex, '') ?? '')
		.split(',')
		.map((code) => code.trim())
		.filter((code) => code !== '');

	return [...new Set([...selected, ...additional])].sort();
}

/**
 * The destination URL, checked before it is sent.
 *
 * amoCRM answers a malformed address with a bare 400, and an address it merely
 * cannot reach with a success followed by nothing ever arriving — the second one
 * is expensive to diagnose later. Reachability is only enforced when subscribing:
 * a hook already pointing somewhere unreachable still has to be removable.
 */
function readDestination(
	context: IExecuteFunctions,
	itemIndex: number,
	requireReachable: boolean,
): string {
	const destination = String(context.getNodeParameter('destination', itemIndex, '') ?? '').trim();

	if (destination === '') {
		throw new NodeOperationError(context.getNode(), 'A webhook needs a destination URL', {
			itemIndex,
			description: 'amoCRM identifies a subscription by the address it posts to.',
		});
	}

	let parsed: URL;
	try {
		parsed = new URL(destination);
	} catch {
		throw new NodeOperationError(context.getNode(), `"${destination}" is not a URL`, {
			itemIndex,
			description: 'Give the whole address, scheme included, as in https://example.com/webhook.',
		});
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new NodeOperationError(
			context.getNode(),
			`amoCRM cannot post to a "${parsed.protocol.replace(':', '')}" address`,
			{ itemIndex, description: 'A webhook destination is an http or https URL.' },
		);
	}

	if (requireReachable && UNREACHABLE_HOST.test(destination)) {
		throw new NodeOperationError(context.getNode(), `amoCRM cannot reach ${destination}`, {
			itemIndex,
			description:
				'Webhooks are delivered from amoCRM servers, so the address has to be reachable from the internet. A local address only works behind a tunnel.',
		});
	}

	return destination;
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;

	const qs: IDataObject = {};
	const destination = String(filters.destination ?? '').trim();
	if (destination !== '') qs.filter = { destination };

	// This collection is not paginated: an account is capped at a hundred hooks and
	// amoCRM answers with all of them at once. So the limit is applied to what came
	// back rather than turned into page parameters the endpoint does not document.
	const response = (await amoCrmApiRequest.call(this, 'GET', WEBHOOKS_ENDPOINT, undefined, qs)) as
		| IDataObject
		| undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const hooks = (embedded.webhooks ?? []) as AmoCrmSubscription[];

	const limit = Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;
	const rows = returnAll ? hooks : hooks.slice(0, limit);

	return rows.map((json) => ({ json }));
}

async function subscribe(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const destination = readDestination(this, itemIndex, true);
	const events = chosenEvents(this, itemIndex);
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	if (events.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No amoCRM events are selected', {
			itemIndex,
			description:
				'Pick at least one entry under "Events", or type a code into "Additional Event Codes".',
		});
	}

	const body: IDataObject = { destination, settings: events };

	const sort = Number(options.sort ?? 0);
	if (Number.isFinite(sort) && sort > 0) body.sort = sort;

	const created = (await amoCrmApiRequest.call(this, 'POST', WEBHOOKS_ENDPOINT, body)) as
		| AmoCrmSubscription
		| undefined;

	// Unlike every list route, this one answers with a bare subscription object and
	// no `_embedded` wrapper. On the rare empty answer the request still succeeded,
	// so what was asked for is reported instead of an empty item.
	return [{ json: created ?? body }];
}

async function unsubscribe(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const destination = readDestination(this, itemIndex, false);

	// A DELETE carrying a body is unusual, but it is the documented shape here —
	// there is no `/api/v4/webhooks/{id}` to delete instead. Success is 204, empty.
	await amoCrmApiRequest.call(this, 'DELETE', WEBHOOKS_ENDPOINT, { destination });

	return [{ json: { success: true, destination } }];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') return await getAll.call(this, itemIndex);
	if (operation === 'subscribe') return await subscribe.call(this, itemIndex);
	if (operation === 'unsubscribe') return await unsubscribe.call(this, itemIndex);

	throw new NodeOperationError(this.getNode(), `Unknown webhook operation "${operation}"`, {
		itemIndex,
	});
}
