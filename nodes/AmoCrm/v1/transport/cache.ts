import type { IDataObject } from 'n8n-workflow';

import type { AmoCrmContext } from './index';
import { amoCrmApiRequest } from './index';

/**
 * Opening a node with a dozen account-aware dropdowns fires a dozen requests, and
 * the editor re-runs them whenever a dependent parameter changes. Against a budget
 * of seven requests per second that is enough to make the interface feel broken and,
 * worse, to eat the budget a running workflow needs.
 *
 * So dictionary reads are memoised for a short while, per credential. The window is
 * deliberately small: a user who has just added a pipeline in amoCRM should see it
 * after a breath, not after a restart.
 */
const TTL_MS = 60_000;

const entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

function prune(now: number): void {
	for (const [key, entry] of entries) {
		if (entry.expiresAt <= now) entries.delete(key);
	}
}

/**
 * A GET whose result is shared between dropdowns for {@link TTL_MS}.
 *
 * Keyed on the credential, not just the account: two credentials pointed at one
 * account can belong to users with different rights, and so can see different rows.
 */
export async function amoCrmCachedRequest(
	this: AmoCrmContext,
	endpoint: string,
	qs: IDataObject = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see amoCrmApiRequest
): Promise<any> {
	const node = this.getNode();
	const credentialId =
		node.credentials?.amoCrmApi?.id ?? node.credentials?.amoCrmOAuth2Api?.id ?? 'unbound';

	const key = `${credentialId}|${endpoint}|${JSON.stringify(qs)}`;
	const now = Date.now();
	prune(now);

	const cached = entries.get(key);
	if (cached !== undefined) return await cached.value;

	const value = amoCrmApiRequest.call(this, 'GET', endpoint, undefined, qs);
	entries.set(key, { expiresAt: now + TTL_MS, value });

	// A failed lookup must not be remembered — the usual cause is a credential the
	// user is still filling in, and they would otherwise wait out the TTL. The
	// rejection still reaches the caller through the await below.
	void value.catch(() => entries.delete(key));

	return await value;
}

/** Test seam: forget every memoised dictionary. */
export function resetRequestCache(): void {
	entries.clear();
}
