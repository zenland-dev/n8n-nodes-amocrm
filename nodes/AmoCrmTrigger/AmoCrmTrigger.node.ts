import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { amoCrmApiRequest } from '../AmoCrm/v1/transport';
import {
	collectAmoCrmWebhookEvents,
	expandAmoCrmWebhookBody,
	parseAmoCrmWebhookBody,
} from './webhookPayload';

const WEBHOOKS_ENDPOINT = '/api/v4/webhooks';

/** Addresses amoCRM cannot open from its own servers. */
const UNREACHABLE_HOST = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::|\/|$)/i;

interface AmoCrmSubscription extends IDataObject {
	id?: number;
	destination?: string;
	disabled?: boolean;
	settings?: string[];
}

/** The URL amoCRM is told to post to. It is also the key every management call uses. */
function webhookDestination(this: IHookFunctions): string {
	const url = this.getNodeWebhookUrl('default');

	if (url === undefined || url === '') {
		throw new NodeOperationError(this.getNode(), 'This node has no webhook URL yet', {
			description: 'Save the workflow, then activate it so n8n can hand amoCRM an address.',
		});
	}

	if (UNREACHABLE_HOST.test(url)) {
		throw new NodeOperationError(this.getNode(), `amoCRM cannot reach ${url}`, {
			description:
				'Webhooks are delivered from amoCRM servers, so this n8n instance needs an address reachable from the internet. Set WEBHOOK_URL to the public address, or put a tunnel in front of n8n.',
		});
	}

	return url;
}

/** Event codes from the picker and the free-text field, deduplicated and ordered. */
function subscribedEvents(this: IHookFunctions): string[] {
	const selected = this.getNodeParameter('events', []) as string[];
	const additional = String(this.getNodeParameter('additionalEvents', '') ?? '')
		.split(',')
		.map((code) => code.trim())
		.filter((code) => code !== '');

	return [...new Set([...selected, ...additional])].sort();
}

/**
 * The subscriptions pointing at one URL.
 *
 * `filter[destination]` is documented, but the result is matched again here: an
 * account may hold up to a hundred hooks, and acting on the wrong one would silence
 * somebody else's integration.
 */
async function findSubscriptions(
	this: IHookFunctions,
	destination: string,
): Promise<AmoCrmSubscription[]> {
	const response = (await amoCrmApiRequest.call(this, 'GET', WEBHOOKS_ENDPOINT, undefined, {
		filter: { destination },
	})) as IDataObject | undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const hooks = (embedded.webhooks ?? []) as AmoCrmSubscription[];

	return hooks.filter((hook) => hook.destination === destination);
}

/** Reads the raw request body when n8n kept it, which is the most faithful source. */
function rawRequestBody(this: IWebhookFunctions): string | undefined {
	const request = this.getRequestObject() as unknown as { rawBody?: Buffer | string };
	const raw = request?.rawBody;

	if (raw === undefined || raw === null) return undefined;

	const text = typeof raw === 'string' ? raw : raw.toString('utf8');

	return text.trim() === '' ? undefined : text;
}

export class AmoCrmTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'amoCRM Trigger',
		name: 'amoCrmTrigger',
		icon: 'file:amocrm.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["events"].join(", ") }}',
		description: 'Starts a workflow when something changes in an amoCRM or Kommo account',
		defaults: { name: 'amoCRM Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'amoCrmApi',
				required: true,
				displayOptions: { show: { authentication: ['accessToken'] } },
			},
			{
				name: 'amoCrmOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				// amoCRM gives a webhook two seconds to answer and counts anything slower as a
				// failed delivery; a hundred failures in two hours disable the subscription for
				// good. Answering on receipt keeps the reply independent of how long the rest
				// of the workflow runs.
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				default: 'accessToken',
				options: [
					{
						name: 'Access Token',
						value: 'accessToken',
						description:
							'Long-lived token from a private integration. Simplest, and does not expire on its own.',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
						description: 'Full OAuth2 flow, for integrations shared across several accounts',
					},
				],
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				default: [],
				description:
					'Which changes in amoCRM should start this workflow. Creating the subscription needs an account administrator, and amoCRM allows at most a hundred webhooks per account.',
				options: [
					{
						name: 'Chat Template Sent for Review',
						value: 'add_chat_template_review',
						description: 'Event code add_chat_template_review',
					},
					{
						name: 'Company Created',
						value: 'add_company',
						description: 'Event code add_company',
					},
					{
						name: 'Company Deleted',
						value: 'delete_company',
						description: 'Event code delete_company',
					},
					{
						name: 'Company Responsible User Changed',
						value: 'responsible_company',
						description: 'Event code responsible_company',
					},
					{
						name: 'Company Restored',
						value: 'restore_company',
						description: 'Event code restore_company',
					},
					{
						name: 'Company Updated',
						value: 'update_company',
						description: 'Event code update_company',
					},
					{
						name: 'Contact Created',
						value: 'add_contact',
						description: 'Event code add_contact',
					},
					{
						name: 'Contact Deleted',
						value: 'delete_contact',
						description: 'Event code delete_contact',
					},
					{
						name: 'Contact Responsible User Changed',
						value: 'responsible_contact',
						description: 'Event code responsible_contact',
					},
					{
						name: 'Contact Restored',
						value: 'restore_contact',
						description: 'Event code restore_contact',
					},
					{
						name: 'Contact Updated',
						value: 'update_contact',
						description: 'Event code update_contact',
					},
					{
						name: 'Conversation Created',
						value: 'add_talk',
						description: 'Event code add_talk',
					},
					{
						name: 'Conversation Deleted',
						value: 'delete_talk',
						description: 'Event code delete_talk, listed in the Russian reference only',
					},
					{
						name: 'Conversation Updated',
						value: 'update_talk',
						description: 'Event code update_talk',
					},
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
					{
						name: 'Lead Created',
						value: 'add_lead',
						description: 'Event code add_lead',
					},
					{
						name: 'Lead Deleted',
						value: 'delete_lead',
						description: 'Event code delete_lead',
					},
					{
						name: 'Lead Responsible User Changed',
						value: 'responsible_lead',
						description: 'Event code responsible_lead',
					},
					{
						name: 'Lead Restored',
						value: 'restore_lead',
						description: 'Event code restore_lead',
					},
					{
						name: 'Lead Status Changed',
						value: 'status_lead',
						description: 'Event code status_lead, the only event carrying old_status_id',
					},
					{
						name: 'Lead Updated',
						value: 'update_lead',
						description: 'Event code update_lead',
					},
					{
						name: 'Note Added to Company',
						value: 'note_company',
						description: 'Event code note_company',
					},
					{
						name: 'Note Added to Contact',
						value: 'note_contact',
						description: 'Event code note_contact',
					},
					{
						name: 'Note Added to Customer',
						value: 'note_customer',
						description: 'Event code note_customer, needs the Customers module',
					},
					{
						name: 'Note Added to Lead',
						value: 'note_lead',
						description: 'Event code note_lead',
					},
					{
						name: 'Outgoing Message Sent',
						value: 'add_outgoing_message',
						description: 'Event code add_outgoing_message',
					},
					{
						name: 'Task Created',
						value: 'add_task',
						description: 'Event code add_task',
					},
					{
						name: 'Task Deleted',
						value: 'delete_task',
						description: 'Event code delete_task',
					},
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
				],
			},
			{
				displayName: 'Additional Event Codes',
				name: 'additionalEvents',
				type: 'string',
				default: '',
				placeholder: 'e.g. add_unsorted, delete_unsorted',
				description:
					'Comma-separated event codes to subscribe to besides the ones picked above. amoCRM keeps adding codes and its Russian and English references do not list the same set, so a code missing from the list can be typed here and amoCRM will say itself whether it accepts it.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Include Raw Body',
						name: 'includeRawBody',
						type: 'boolean',
						default: false,
						description:
							'Whether to add the undecoded form-encoded request body to every item as "rawBody"',
					},
					{
						displayName: 'Split Entities Into Separate Items',
						name: 'splitEntities',
						type: 'boolean',
						default: true,
						description:
							'Whether to emit one item per changed entity instead of one item per request. amoCRM batches changes, so a bulk edit of fifty leads arrives as a single delivery.',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const destination = webhookDestination.call(this);
				const [existing] = await findSubscriptions.call(this, destination);

				if (existing === undefined) {
					delete staticData.webhookId;
					return false;
				}

				// amoCRM switches a hook off after too many bad answers and then delivers
				// nothing at all, silently. A disabled hook is treated as no hook, so that
				// activating the workflow puts a working one back.
				if (existing.disabled === true) return false;

				const subscribed = [...(existing.settings ?? [])].sort();
				if (subscribed.join(',') !== subscribedEvents.call(this).join(',')) return false;

				staticData.webhookId = existing.id;
				staticData.destination = destination;

				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const destination = webhookDestination.call(this);
				const events = subscribedEvents.call(this);

				if (events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No amoCRM events are selected', {
						description:
							'Pick at least one entry under "Events", or type a code into "Additional Event Codes".',
					});
				}

				// The destination URL is the primary key of an amoCRM subscription, and the
				// documentation does not promise that posting the same URL twice updates the
				// event list in place. Removing what is there first is the only way to be sure
				// this workflow ends up subscribed to exactly the events it asked for.
				const stale = await findSubscriptions.call(this, destination);
				if (stale.length > 0) {
					await amoCrmApiRequest.call(this, 'DELETE', WEBHOOKS_ENDPOINT, { destination });
				}

				const created = (await amoCrmApiRequest.call(this, 'POST', WEBHOOKS_ENDPOINT, {
					destination,
					settings: events,
				})) as AmoCrmSubscription | undefined;

				staticData.webhookId = created?.id;
				staticData.destination = destination;

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const stored = staticData.destination;
				const destination =
					typeof stored === 'string' && stored !== ''
						? stored
						: (this.getNodeWebhookUrl('default') ?? '');

				delete staticData.webhookId;
				delete staticData.destination;

				if (destination === '') return true;

				// Deleting by URL 404s when nothing is subscribed, so what is there is read
				// first — deactivating a workflow should not fail over an already-gone hook.
				const existing = await findSubscriptions.call(this, destination);
				if (existing.length === 0) return true;

				await amoCrmApiRequest.call(this, 'DELETE', WEBHOOKS_ENDPOINT, { destination });

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const splitEntities = options.splitEntities !== false;
		const includeRawBody = options.includeRawBody === true;

		const rawBody = rawRequestBody.call(this);
		const payload =
			rawBody === undefined
				? expandAmoCrmWebhookBody(this.getBodyData())
				: parseAmoCrmWebhookBody(rawBody);

		const rawBodyField = includeRawBody ? { rawBody: rawBody ?? '' } : {};

		if (!splitEntities) {
			return { workflowData: [[{ json: { ...payload, ...rawBodyField } }]] };
		}

		const account = (payload.account ?? {}) as IDataObject;
		const items: INodeExecutionData[] = collectAmoCrmWebhookEvents(payload).map((event) => ({
			json: {
				event: event.event,
				entity: event.entity,
				action: event.action,
				account,
				data: event.data,
				...rawBodyField,
			},
		}));

		// A delivery this node made nothing of is still acknowledged: amoCRM counts every
		// non-2xx answer towards disabling the subscription, and a hundred of them inside
		// two hours switch it off for every event, not just the unrecognised one.
		if (items.length === 0) return { webhookResponse: 'OK' };

		return { workflowData: [items] };
	}
}
