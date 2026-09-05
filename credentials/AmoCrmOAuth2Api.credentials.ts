import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

import {
	accountAddressProperties,
	accountHostExpression,
	pinnedHttpRequestDomains,
} from './accountAddress';

/** Inside credential property defaults, sibling fields are read through `$self`. */
const HOST = accountHostExpression('$self["subdomain"]', '$self["domain"]');

/** Inside a credential test request, the same fields come from `$credentials`. */
const TEST_HOST = accountHostExpression('$credentials.subdomain', '$credentials.domain');

export class AmoCrmOAuth2Api implements ICredentialType {
	name = 'amoCrmOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'amoCRM OAuth2 API';

	documentationUrl = 'https://www.amocrm.ru/developers/content/oauth/step-by-step';

	icon: Icon = 'file:amocrm.svg';

	properties: INodeProperties[] = [
		{
			displayName:
				'Create an integration in amoCRM (Settings → Integrations → Create integration), tick "Available for everyone", and paste n8n\'s OAuth Redirect URL into the integration\'s Redirect URI field before connecting.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
		},
		...accountAddressProperties,
		{
			displayName: 'Requests per Second',
			name: 'requestsPerSecond',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 50 },
			default: 7,
			description:
				'How fast this account may be called. amoCRM allows seven requests per second per integration and bans repeat offenders, so raise this only if your account has a paid limit add-on.',
		},
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default:
				'={{ $self["domain"] === "kommo.com" ? "https://www.kommo.com/oauth" : "https://www.amocrm.ru/oauth" }}',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: `=https://{{ ${HOST} }}/oauth2/access_token`,
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '',
			description:
				'amoCRM has no per-request scopes. Access is chosen on the integration card in the amoCRM interface.',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: 'mode=popup',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
		pinnedHttpRequestDomains,
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: `=https://{{ ${TEST_HOST} }}`,
			url: '/api/v4/account',
		},
	};
}
