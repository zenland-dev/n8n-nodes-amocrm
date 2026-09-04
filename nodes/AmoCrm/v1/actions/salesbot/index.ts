import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { entityLocator, returnAllProperties } from '../../descriptions/common';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';

/**
 * Salesbots live under `bots`, not under `salesbot`.
 *
 * `/api/v4/salesbot/...` does exist, but only for the `continue` call a widget makes
 * on its own paused bot, and `POST /api/v2/salesbot/run` is the pre-v4 shape whose
 * `entity_type` is an integer. Neither belongs in a general-purpose node.
 */
const BOTS_ENDPOINT = '/api/v4/bots';

/** Option value → the parameter holding the entity id, as in the Link resource. */
const ENTITY_PARAMETERS: Record<string, string> = {
	leads: 'leadId',
	contacts: 'contactId',
	customers: 'customerId',
};

function showFor(
	operations: string[],
	extra: Record<string, string[]> = {},
): INodeProperties['displayOptions'] {
	return { show: { resource: ['salesbot'], operation: operations, ...extra } };
}

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['salesbot'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve one salesbot by ID',
				action: 'Get a salesbot',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List the salesbots configured in the account',
				action: 'Get many salesbots',
			},
			{
				name: 'Run',
				value: 'run',
				description: 'Start a salesbot on one entity',
				action: 'Run a salesbot',
			},
			{
				name: 'Stop',
				value: 'stop',
				description: 'Stop a salesbot that is running on one entity',
				action: 'Stop a salesbot',
			},
		],
	},
	{
		displayName: 'Salesbot ID',
		name: 'botId',
		type: 'number',
		required: true,
		typeOptions: { minValue: 1 },
		default: 0,
		displayOptions: showFor(['get', 'run', 'stop']),
		description:
			'ID of the salesbot. amoCRM has no endpoint that resolves a bot by name, so run "Get Many" once to read the IDs, or take one from an earlier node.',
	},
	{
		displayName: 'Entity Type',
		name: 'entityType',
		type: 'options',
		default: 'leads',
		displayOptions: showFor(['run', 'stop']),
		description:
			'What the bot is run against. Leads and contacts work everywhere; customers are documented on amocrm.ru only, and Stop is documented for leads only — amoCRM rejects the combinations it does not support.',
		options: [
			{ name: 'Contacts', value: 'contacts' },
			{
				name: 'Customers',
				value: 'customers',
				description: 'Only on accounts that have the Customers module switched on',
			},
			{ name: 'Leads', value: 'leads' },
		],
	},
	entityLocator('lead', 'leadId', showFor(['run', 'stop'], { entityType: ['leads'] }), {
		description: 'The lead the bot is run against',
	}),
	entityLocator('contact', 'contactId', showFor(['run', 'stop'], { entityType: ['contacts'] }), {
		description: 'The contact the bot is run against',
	}),
	entityLocator('customer', 'customerId', showFor(['run', 'stop'], { entityType: ['customers'] }), {
		description: 'The customer the bot is run against',
	}),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(['getAll']),
		options: [
			{
				displayName: 'IDs',
				name: 'ids',
				type: 'string',
				default: '',
				placeholder: 'e.g. 250704, 250705',
				description: 'Comma-separated bot IDs to return instead of the whole list',
			},
			{
				displayName: 'Type',
				name: 'typeFunctionality',
				type: 'multiOptions',
				default: [],
				description: 'Which kinds of bot to return. Leave empty for all of them.',
				options: [
					{ name: 'Greeting', value: 'greeting' },
					{ name: 'Marketing', value: 'marketing' },
					{ name: 'NPS', value: 'nps' },
					{ name: 'Regular', value: 'regular' },
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: showFor(['get', 'getAll']),
		options: [
			{
				displayName: 'Include Favorite Flag',
				name: 'withFavorite',
				type: 'boolean',
				default: false,
				description: 'Whether to add the is_favorite flag to every bot in the result',
			},
		],
	},
	...returnAllProperties(showFor(['getAll'])),
];

function botIdOf(context: IExecuteFunctions, itemIndex: number): number {
	const botId = Number(context.getNodeParameter('botId', itemIndex, 0));

	if (!Number.isFinite(botId) || botId <= 0) {
		throw new NodeOperationError(context.getNode(), 'A salesbot ID is needed', {
			itemIndex,
			description: 'Use "Get Many" to list the bots of the account and read their IDs.',
		});
	}

	return Math.floor(botId);
}

/** The entity the bot is aimed at: its amoCRM type name and its id. */
function targetOf(
	context: IExecuteFunctions,
	itemIndex: number,
): { entity_type: string; entity_id: number } {
	const entityType = String(context.getNodeParameter('entityType', itemIndex, 'leads'));
	const parameter = ENTITY_PARAMETERS[entityType];

	if (parameter === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			`"${entityType}" is not an entity a salesbot runs on`,
			{ itemIndex, description: 'A bot runs on a lead, a contact or a customer.' },
		);
	}

	const entityId = Number(
		context.getNodeParameter(parameter, itemIndex, '', { extractValue: true }),
	);

	if (!Number.isFinite(entityId) || entityId <= 0) {
		throw new NodeOperationError(context.getNode(), 'The entity to run the bot on is missing', {
			itemIndex,
			description: `Pick a ${entityType.replace(/s$/, '')} above, or supply its ID.`,
		});
	}

	return { entity_type: entityType, entity_id: Math.floor(entityId) };
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;

	const qs: IDataObject = {};
	const filter: IDataObject = {};

	const types = (filters.typeFunctionality ?? []) as string[];
	if (types.length > 0) filter.type_functionality = types;

	const ids = String(filters.ids ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id !== '');
	if (ids.length > 0) filter.id = ids;

	if (Object.keys(filter).length > 0) qs.filter = filter;
	if (options.withFavorite === true) qs.with = 'favorite';

	// The collection key is `items`, not `bots` — this endpoint is the one place in
	// v4 where `_embedded` is not named after the entity.
	const rows = await amoCrmApiRequestAllItems.call(this, BOTS_ENDPOINT, 'items', qs, {
		limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number),
	});

	return rows.map((json) => ({ json }));
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const botId = botIdOf(this, itemIndex);
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	if (options.withFavorite === true) qs.with = 'favorite';

	const bot = (await amoCrmApiRequest.call(
		this,
		'GET',
		`${BOTS_ENDPOINT}/${botId}`,
		undefined,
		qs,
	)) as IDataObject | undefined;

	// A bot that does not exist answers 204 with an empty body rather than 404, so
	// silence is the only signal there is; passing it on as an empty item would hide it.
	if (bot === undefined) {
		throw new NodeOperationError(this.getNode(), `Salesbot ${botId} was not found`, {
			itemIndex,
			description:
				'amoCRM returns nothing at all for a bot that does not exist or lies outside the rights of the user this credential belongs to.',
		});
	}

	return [{ json: bot }];
}

/**
 * Starts or stops a bot on one entity.
 *
 * Both routes answer 202 with an empty body: amoCRM has accepted the instruction,
 * not finished acting on it. There is nothing to report back but the request, so
 * that is what the item carries.
 *
 * A bot also needs a chat to talk into. Aimed at a lead whose contact has no
 * messenger conversation, the call still returns 202 and then does nothing visible.
 */
async function command(
	this: IExecuteFunctions,
	itemIndex: number,
	action: 'run' | 'stop',
): Promise<INodeExecutionData[]> {
	const botId = botIdOf(this, itemIndex);
	const target = targetOf(this, itemIndex);

	await amoCrmApiRequest.call(this, 'POST', `${BOTS_ENDPOINT}/${botId}/${action}`, {
		...target,
	});

	return [{ json: { success: true, bot_id: botId, ...target } }];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') return await getAll.call(this, itemIndex);
	if (operation === 'get') return await get.call(this, itemIndex);
	if (operation === 'run') return await command.call(this, itemIndex, 'run');
	if (operation === 'stop') return await command.call(this, itemIndex, 'stop');

	throw new NodeOperationError(this.getNode(), `Unknown salesbot operation "${operation}"`, {
		itemIndex,
	});
}
