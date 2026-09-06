/**
 * amoCRM allows an integration about seven requests per second, and answers
 * sustained abuse with a 403 that shuts that integration out — not a slowdown,
 * a refusal. The account has a wider ceiling across every integration calling it,
 * which no single integration can observe, so staying inside your own budget is
 * the only part you control. That makes throttling a correctness concern rather
 * than an optimisation: a greedy workflow does not run slower, it stops working.
 *
 * The window is keyed on the credential together with the host it calls, because
 * the budget belongs to the integration a credential holds. It lives in the n8n
 * process, so parallel executions of different workflows share one budget — and a
 * queue-mode worker, being a process of its own, keeps a window of its own.
 */

import { sleep } from 'n8n-workflow';

/** Reserved moments, ascending, for each credential and host. */
const windows = new Map<string, number[]>();

/**
 * Waits until the caller is allowed to send one request against `key`, reserving
 * its slot before returning so that concurrent callers queue behind it.
 */
export async function acquireSlot(key: string, requestsPerSecond: number): Promise<void> {
	const limit = Math.max(1, Math.min(50, Math.floor(requestsPerSecond) || 7));

	let slots = windows.get(key);
	if (slots === undefined) {
		slots = [];
		windows.set(key, slots);
	}

	const now = Date.now();
	while (slots.length > 0 && slots[0] <= now - 1000) slots.shift();

	if (slots.length < limit) {
		slots.push(now);
		return;
	}

	// The window is full. The earliest free moment is one second after the slot
	// `limit` places back; reserving it now keeps the queue ordered and fair.
	const readyAt = slots[slots.length - limit] + 1000;
	slots.push(readyAt);
	await sleep(Math.max(0, readyAt - now));
}

/** Test seam: forget every reservation. */
export function resetRateLimiter(): void {
	windows.clear();
}
