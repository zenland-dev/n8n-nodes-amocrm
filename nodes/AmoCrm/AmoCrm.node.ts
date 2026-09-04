import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { resourceProperties, resourceProperty } from './v1/actions';
import { router } from './v1/actions/router';
import { listSearch, loadOptions } from './v1/methods';

export class AmoCrm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'amoCRM',
		name: 'amoCrm',
		icon: { light: 'file:amocrm.svg', dark: 'file:amocrm.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with leads, contacts, companies and the rest of an amoCRM or Kommo account',
		defaults: { name: 'amoCRM' },
		usableAsTool: true,
		// Read by n8n's node catalog (@n8n/ai-utilities): searchHint is printed verbatim to a
		// model choosing a node, and it is the only place to say things no single operation
		// description can. Keep wire-format expressions out of it — the community-nodes
		// linter rejects them here.
		builderHint: {
			searchHint:
				'amoCRM and Kommo are one product behind one API, and this node serves both. A "lead" is a deal, not a person — people are contacts. Pipeline, stage, responsible user, tag and custom field IDs differ per account and cannot be guessed: leave the pickers on their list mode and let them resolve names, or read the IDs from the Account and Pipeline resources first. Turn Simplify on whenever the output is read by a model — it adds a flat, name-keyed custom_fields object next to the raw amoCRM array.',
			relatedNodes: [
				{
					nodeType: '@zenland-dev/n8n-nodes-amocrm.amoCrmTrigger',
					relationHint: 'Starts the workflow when amoCRM reports a change to a lead, contact, task, note or message',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
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
						description: 'Long-lived token from a private integration. Simplest, and does not expire on its own.',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
						description: 'Full OAuth2 flow, for integrations shared across several accounts',
					},
				],
			},
			resourceProperty,
			...resourceProperties,
		],
	};

	methods = { loadOptions, listSearch };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await router.call(this);
	}
}
