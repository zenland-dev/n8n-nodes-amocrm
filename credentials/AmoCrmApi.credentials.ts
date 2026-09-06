import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import {
	accountAddressProperties,
	accountHostExpression,
	pinnedHttpRequestDomains,
} from './accountAddress';

/** The account host, assembled from the subdomain and the closed domain list. */
export const ACCOUNT_BASE_URL = `=https://{{ ${accountHostExpression(
	'$credentials.subdomain',
	'$credentials.domain',
)} }}`;

export class AmoCrmApi implements ICredentialType {
	name = 'amoCrmApi';

	displayName = 'amoCRM Access Token API';

	documentationUrl = 'https://developers.kommo.com/docs/long-lived-token';

	icon: Icon = 'file:amocrm.svg';

	properties: INodeProperties[] = [
		...accountAddressProperties,
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Long-lived access token. Create a private integration in Settings → Integrations, open its "Keys and scopes" tab and generate a token there.',
		},
		{
			displayName: 'Requests per Second',
			name: 'requestsPerSecond',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 50 },
			default: 7,
			description:
				'How fast this integration may call the account. amoCRM budgets about seven requests per second per integration and shuts out repeat offenders, so raise this only if the account plan allows an integration more.',
		},
		pinnedHttpRequestDomains,
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: ACCOUNT_BASE_URL,
			url: '/api/v4/account',
		},
	};
}
