import type { INodeProperties } from 'n8n-workflow';

/**
 * The only hosts amoCRM serves accounts on. The list being closed is the whole
 * point: an account address assembled from a free-form string can be pointed at
 * any server, and the credential would obligingly send its bearer token — and,
 * on the OAuth2 credential, the integration's client secret — straight there.
 *
 * Verified against all three: a request to `/api/v4/account` on a non-existent
 * subdomain answers with amoCRM's own `X-Error: Account not found`.
 */
export const ACCOUNT_DOMAINS = ['amocrm.com', 'amocrm.ru', 'kommo.com'] as const;

/** Everything a host label may contain. Anything else is dropped, not rejected. */
const SUBDOMAIN_ALLOWED = /[^a-z0-9-]/g;

/**
 * Builds the account host from the two credential fields, as an n8n expression.
 *
 * The domain is checked against the list here as well as in the dropdown,
 * because a credential's `options` are only a hint to the editor: stored values
 * reach the node through the expression engine and can be set by anything that
 * can write the credential. An unknown domain yields an empty host, which fails
 * the request loudly instead of sending the token somewhere unintended.
 *
 * `subdomainRef` and `domainRef` differ by context — property defaults read
 * sibling fields through `$self`, credential tests through `$credentials`.
 */
export function accountHostExpression(subdomainRef: string, domainRef: string): string {
	const domains = JSON.stringify([...ACCOUNT_DOMAINS]);
	const subdomain = `String(${subdomainRef} || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "")`;
	return `${domains}.includes(String(${domainRef} || "")) ? ${subdomain} + "." + String(${domainRef}) : ""`;
}

/** The same rule in plain TypeScript, for the transport. */
export function accountBaseUrl(credentials: { subdomain?: unknown; domain?: unknown }): string {
	const domain = String(credentials.domain ?? '');
	if (!(ACCOUNT_DOMAINS as readonly string[]).includes(domain)) return '';

	const subdomain = String(credentials.subdomain ?? '')
		.trim()
		.toLowerCase()
		.replace(SUBDOMAIN_ALLOWED, '');

	return subdomain === '' ? '' : `https://${subdomain}.${domain}`;
}

/** Address fields, shared by both credential types so they cannot drift apart. */
export const accountAddressProperties: INodeProperties[] = [
	{
		displayName: 'Subdomain',
		name: 'subdomain',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'mycompany',
		description:
			'The part of the account address in front of the domain — for mycompany.amocrm.ru that is mycompany. Only letters, digits and hyphens are kept.',
	},
	{
		displayName: 'Domain',
		name: 'domain',
		type: 'options',
		default: 'amocrm.ru',
		required: true,
		options: [
			{
				name: 'Amocrm.com',
				value: 'amocrm.com',
				description: 'Accounts created before the Kommo rebrand',
			},
			{ name: 'Amocrm.ru', value: 'amocrm.ru', description: 'Russian accounts' },
			{
				name: 'Kommo.com',
				value: 'kommo.com',
				description: 'Accounts outside Russia, after the Kommo rebrand',
			},
		],
		description:
			'Which amoCRM installation hosts the account. The list is closed on purpose: this node only ever calls amoCRM, so a credential cannot be aimed at another server.',
	},
];

/**
 * Pins n8n's own domain-restriction field to "none" and hides it.
 *
 * n8n injects this field into every credential carrying an `authenticate` block
 * or descending from `oAuth2Api`, defaulting to "all" — and with "all" anyone who
 * can edit the credential may select it in an HTTP Request node, type any URL,
 * and have n8n attach the token to it. Declaring the property ourselves skips
 * that injection entirely, so the editor offers no switch to flip.
 *
 * It governs the HTTP Request, GraphQL and declarative-routing surfaces only.
 * This node's own calls go through `httpRequestWithAuthentication`, which never
 * reads it, and the credential test runs on a surface where "none" is a no-op —
 * so nothing here restricts normal use.
 */
export const pinnedHttpRequestDomains: INodeProperties = {
	displayName: 'Allowed HTTP Request Domains',
	name: 'allowedHttpRequestDomains',
	type: 'hidden',
	default: 'none',
};
