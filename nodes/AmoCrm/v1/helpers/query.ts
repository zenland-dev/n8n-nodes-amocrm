import type { IDataObject } from 'n8n-workflow';

/**
 * amoCRM reads list filters from PHP-style bracket keys — `filter[created_at][from]`,
 * `filter[statuses][0][pipeline_id]`, `order[updated_at]` — so nested query objects
 * have to be flattened before they reach the HTTP layer.
 *
 * Empty values are dropped: n8n collections hand back `''` for every field the user
 * left alone, and an empty filter is not the same request as no filter at all.
 */
export function flattenQuery(input?: IDataObject): IDataObject {
	const output: IDataObject = {};

	const walk = (value: unknown, path: string): void => {
		if (value === undefined || value === null || value === '') return;

		if (Array.isArray(value)) {
			value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
			return;
		}

		if (typeof value === 'object') {
			for (const [key, entry] of Object.entries(value as IDataObject)) {
				walk(entry, `${path}[${key}]`);
			}
			return;
		}

		output[path] = value as string | number | boolean;
	};

	for (const [key, value] of Object.entries(input ?? {})) walk(value, key);

	return output;
}

/** Drops keys whose value is undefined, null or an empty string. */
export function omitEmpty(input: IDataObject): IDataObject {
	const output: IDataObject = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null || value === '') continue;
		output[key] = value;
	}
	return output;
}

/**
 * Turns a host that amoCRM itself handed us into a base URL — today only the
 * file-storage shard from `/api/v4/account`, which arrives as a bare host or a
 * full URL depending on the account.
 *
 * Deliberately permissive, and deliberately NOT used for the account address:
 * that one is assembled from the credential's subdomain and its closed domain
 * list by `accountBaseUrl`, so a credential cannot be aimed at another server.
 */
export function toBaseUrl(accountDomain: unknown): string {
	const host = String(accountDomain ?? '')
		.trim()
		.replace(/^https?:\/\//i, '')
		.split('/')[0]
		.trim();

	return host === '' ? '' : `https://${host}`;
}
