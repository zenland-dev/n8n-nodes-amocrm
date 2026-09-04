import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { amoCrmApiRequest } from '../../transport';

const ENDPOINT = '/api/v4/account';

/**
 * Everything `GET /api/v4/account` adds only when asked.
 *
 * Three of these are the sole publication of a dictionary: task types, departments
 * and the file-service host have no endpoint of their own, so a node that needs a
 * task type or a group name has to come here for it.
 */
const WITH_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Amojo ID',
		value: 'amojo_id',
		description: 'ID of the account in the amoJo chat service',
	},
	{
		name: 'Amojo Rights',
		value: 'amojo_rights',
		description: 'Chat rights of the account: can_direct and can_create_groups',
	},
	{
		name: 'Datetime Settings',
		value: 'datetime_settings',
		description: 'Date and time patterns of the account, and its timezone',
	},
	{
		name: 'Drive URL',
		value: 'drive_url',
		description: 'Host of the account file service, which every Files operation needs',
	},
	{
		name: 'Entity Names',
		value: 'entity_names',
		description: 'Names this account gave to leads, contacts and the rest, with translations',
	},
	{
		name: 'Invoices Settings',
		value: 'invoices_settings',
		description: 'Language of invoices and the ID of the invoices list',
	},
	{
		name: 'Is API Filter Enabled',
		value: 'is_api_filter_enabled',
		description: 'Whether alpha API filtering is switched on for the account',
	},
	{
		name: 'Task Types',
		value: 'task_types',
		description: 'The task-type dictionary, which no other endpoint publishes',
	},
	{
		name: 'User Groups',
		value: 'users_groups',
		description: 'The department dictionary, the only place group names are published',
	},
	{
		name: 'Version',
		value: 'version',
		description: 'Current amoCRM version of the account',
	},
];

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'get',
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get an account',
				description: 'Retrieve the settings of the account the credential belongs to',
			},
		],
	},
	{
		displayName:
			'Every user of the account may call this, administrator or not, which makes it the one metadata read that always works. The answer carries current_user_id, so a workflow can learn who its own token is.',
		name: 'accountNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['account'], operation: ['get'] } },
	},
	{
		displayName: 'Include',
		name: 'with',
		type: 'multiOptions',
		default: [],
		options: WITH_OPTIONS,
		displayOptions: { show: { resource: ['account'], operation: ['get'] } },
		description:
			'Blocks amoCRM leaves out of the answer unless they are asked for. Most of them arrive under _embedded rather than at the top level.',
	},
];

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const requested = this.getNodeParameter('with', itemIndex, []) as string[];

	const account = (await amoCrmApiRequest.call(this, 'GET', ENDPOINT, undefined, {
		with: requested.join(','),
	})) as IDataObject | undefined;

	// This endpoint answers 200 for every authenticated caller, so an empty body is
	// not "no account" — it means the request never reached the account's own host.
	if (account === undefined) {
		throw new NodeOperationError(this.getNode(), 'amoCRM returned no account data', {
			description:
				'Check that the credential points at your own account address, for example mycompany.amocrm.ru, and not at www.amocrm.ru.',
			itemIndex,
		});
	}

	return [{ json: account }];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'get') return await get.call(this, itemIndex);

	throw new NodeOperationError(
		this.getNode(),
		`The account resource has no operation "${operation}"`,
		{ itemIndex },
	);
}
