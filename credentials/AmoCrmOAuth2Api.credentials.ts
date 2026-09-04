import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/** Normalises whatever the user pasted into a bare host name. */
const normalise = (ref: string) =>
	`(${ref} || "").trim().replace("https://", "").replace("http://", "").split("/")[0]`;

/** Inside credential property defaults, sibling fields are read through `$self`. */
const HOST = normalise('$self["accountDomain"]');

/** Inside a credential test request, the same field is read through `$credentials`. */
const TEST_HOST = normalise('$credentials.accountDomain');

export class AmoCrmOAuth2Api implements ICredentialType {
	name = 'amoCrmOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'amoCRM OAuth2 API';

	documentationUrl = 'https://www.amocrm.ru/developers/content/oauth/step-by-step';

	icon = 'file:amocrm.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName:
				'Create an integration in amoCRM (Settings → Integrations → Create integration), tick "Available for everyone", and paste n8n\'s OAuth Redirect URL into the integration\'s Redirect URI field before connecting.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Account Address',
			name: 'accountDomain',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'mycompany.amocrm.ru',
			description:
				'Address of the amoCRM account this integration will be authorised against, exactly as it appears in the browser address bar. amoCRM hosts the token endpoint on the account\'s own domain, so this must be filled in before connecting.',
		},
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
			default: `={{ ${HOST}.endsWith("kommo.com") ? "https://www.kommo.com/oauth" : "https://www.amocrm.ru/oauth" }}`,
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
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: `=https://{{ ${TEST_HOST} }}`,
			url: '/api/v4/account',
		},
	};
}
