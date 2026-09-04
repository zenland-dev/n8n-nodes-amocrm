import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * The account address is what the user sees in the browser address bar, e.g.
 * `mycompany.amocrm.ru`. People paste it with a scheme and a trailing path more
 * often than not, so every use of it is normalised the same way.
 */
export const ACCOUNT_BASE_URL =
	"=https://{{ $credentials.accountDomain.trim().replace('https://', '').replace('http://', '').split('/')[0] }}";

export class AmoCrmApi implements ICredentialType {
	name = 'amoCrmApi';

	displayName = 'amoCRM Access Token API';

	documentationUrl = 'https://developers.kommo.com/docs/long-lived-token';

	icon = 'file:amocrm.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Account Address',
			name: 'accountDomain',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'mycompany.amocrm.ru',
			description:
				'Address of your amoCRM account, exactly as it appears in the browser address bar. Works for amocrm.ru, amocrm.com and kommo.com accounts.',
		},
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
				'How fast this account may be called. amoCRM allows seven requests per second per integration and bans repeat offenders, so raise this only if your account has a paid limit add-on.',
		},
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
