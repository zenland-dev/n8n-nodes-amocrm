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
