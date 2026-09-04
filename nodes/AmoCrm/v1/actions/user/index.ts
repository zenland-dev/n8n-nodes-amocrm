import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../descriptions/common';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';

const ENDPOINT = '/api/v4/users';
const COLLECTION = 'users';

/** Scopes a property to this resource and to the operations it belongs to. */
function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['user'], operation: operations } };
}

/** What `with` adds to a user, on both the single and the collection route. */
const WITH_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Amojo ID',
		value: 'amojo_id',
		description: 'ID of the user in the chat service, which may be null',
	},
	{
		name: 'Group',
		value: 'group',
		description: 'Embeds the department the user belongs to, with its name',
	},
	{
		name: 'Phone Number',
		value: 'phone_number',
		description: 'Phone number recorded on the user profile',
	},
	{
		name: 'Role',
		value: 'role',
		description: 'Embeds the role the user holds, with its name',
	},
	{
		name: 'User Rank',
		value: 'user_rank',
		description: 'Rank of the user: newbie, candidate or master',
	},
	{
		name: 'UUID',
		value: 'uuid',
		description:
			'UUID of the user. amoCRM states plainly that third-party integrations are not meant to use it.',
	},
];

const includeProperty: INodeProperties = {
	displayName: 'Include',
	name: 'with',
	type: 'multiOptions',
	default: [],
	options: WITH_OPTIONS,
	description: 'Extra data to embed in every user',
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['user'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a user',
				description: 'Retrieve one user of the account by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many users',
				description: 'Retrieve the users of the account, deactivated ones included',
			},
		],
	},
	{
		displayName:
			'amoCRM lets only account administrators read users. A token that works everywhere else in this node still gets 403 "insufficient rights" here, and that — not a broken credential — is almost always the reason. Ask an administrator of the account to authorise the integration, or feed the user ID in from elsewhere.',
		name: 'adminOnlyNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['get', 'getAll']),
	},
	{
		displayName: 'User Name or ID',
		name: 'userId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getUsers' },
		default: '',
		required: true,
		displayOptions: showFor(['get']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	...returnAllProperties(showFor(['getAll'])),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['get', 'getAll']),
		options: [includeProperty],
	},
];

function withParam(options: IDataObject): string | undefined {
	const values = (options.with ?? []) as string[];
	return values.length === 0 ? undefined : values.join(',');
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const userId = String(this.getNodeParameter('userId', itemIndex, '') ?? '').trim();
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	if (userId === '') {
		throw new NodeOperationError(this.getNode(), 'No user was chosen', {
			description: 'Pick a user, or supply an ID with an expression.',
			itemIndex,
		});
	}

	// Id 0 is not a user record: amoCRM writes it into created_by and updated_by to
	// mean "the robot, a widget or the API". Fetching it would answer with nothing,
	// which reads as a rights problem and sends people looking in the wrong place.
	if (userId === '0') {
		throw new NodeOperationError(this.getNode(), 'There is no user with ID 0', {
			description:
				'amoCRM uses 0 in created_by and updated_by to mean the robot or the API itself, not a person. No user record exists for it.',
			itemIndex,
		});
	}

	const user = (await amoCrmApiRequest.call(this, 'GET', `${ENDPOINT}/${userId}`, undefined, {
		with: withParam(options),
	})) as IDataObject | undefined;

	if (user === undefined) {
		throw new NodeOperationError(this.getNode(), `No user with ID ${userId}`, {
			description:
				'amoCRM answers an unknown id with an empty response rather than a 404, so this may also be a rights problem.',
			itemIndex,
		});
	}

	return [{ json: user }];
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);

	// The list carries deactivated staff for ever, and nothing filters them out
	// server-side, so every row is emitted as it comes: rights.is_active tells them
	// apart, and dropping them here would hide the person a lead is assigned to.
	const users = await amoCrmApiRequestAllItems.call(
		this,
		ENDPOINT,
		COLLECTION,
		{ with: withParam(options) },
		{ limit, pageSize: limit === undefined ? 250 : Math.min(limit, 250) },
	);

	return users.map((user) => ({ json: user }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'get') return await get.call(this, itemIndex);
	if (operation === 'getAll') return await getAll.call(this, itemIndex);

	throw new NodeOperationError(
		this.getNode(),
		`The user resource has no operation "${operation}"`,
		{
			itemIndex,
		},
	);
}
