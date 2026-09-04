import type { INodeProperties } from 'n8n-workflow';

import * as account from './account';
import * as call from './call';
import * as catalog from './catalog';
import * as catalogElement from './catalogElement';
import * as company from './company';
import * as contact from './contact';
import * as customField from './customField';
import * as customRequest from './customRequest';
import * as customer from './customer';
import * as event from './event';
import * as file from './file';
import * as lead from './lead';
import * as link from './link';
import * as note from './note';
import * as pipeline from './pipeline';
import * as salesbot from './salesbot';
import * as tag from './tag';
import * as task from './task';
import * as unsorted from './unsorted';
import * as user from './user';
import * as webhook from './webhook';
import type { ResourceModule } from './types';

export const resources: Record<string, ResourceModule> = {
	account,
	call,
	catalog,
	catalogElement,
	company,
	contact,
	customField,
	customRequest,
	customer,
	event,
	file,
	lead,
	link,
	note,
	pipeline,
	salesbot,
	tag,
	task,
	unsorted,
	user,
	webhook,
};

/** Kept alphabetical: the linter enforces it, and so does finding things. */
export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	default: 'lead',
	options: [
		{ name: 'Account', value: 'account' },
		{ name: 'Call', value: 'call' },
		{ name: 'Catalog', value: 'catalog' },
		{
			name: 'Catalog Element',
			value: 'catalogElement',
			description: 'A row inside a catalog: a product, a service, or whatever that list holds',
		},
		{ name: 'Company', value: 'company' },
		{ name: 'Contact', value: 'contact' },
		{ name: 'Custom Field', value: 'customField' },
		{
			name: 'Custom Request',
			value: 'customRequest',
			description: 'Any amoCRM endpoint this node does not model, sent through the same authenticated and rate-limited transport',
		},
		{ name: 'Customer', value: 'customer' },
		{
			name: 'Event',
			value: 'event',
			description: "The account's change log: who changed what and when, read-only",
		},
		{ name: 'File', value: 'file' },
		{ name: 'Lead', value: 'lead' },
		{
			name: 'Link',
			value: 'link',
			description: 'Connections between entities: attach a contact to a lead, a lead to a customer, a catalog element to either',
		},
		{ name: 'Note', value: 'note' },
		{ name: 'Pipeline', value: 'pipeline' },
		{
			name: 'Salesbot',
			value: 'salesbot',
			description: 'Chat automation configured in the account: start or stop a bot on one entity',
		},
		{ name: 'Tag', value: 'tag' },
		{ name: 'Task', value: 'task' },
		{
			name: 'Unsorted',
			value: 'unsorted',
			description: 'Incoming requests from forms, chats and calls that nobody has accepted into a pipeline yet',
		},
		{ name: 'User', value: 'user' },
		{ name: 'Webhook', value: 'webhook' },
	],
};

export const resourceProperties: INodeProperties[] = Object.values(resources).flatMap(
	(module) => module.description,
);
