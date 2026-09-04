/**
 * amoCRM allows about seven requests per second and reacts to sustained abuse by
 * returning 403 for every subsequent call — for the whole account on amocrm.ru,
 * for the whole egress IP on Kommo. That makes throttling a correctness concern,
 * not an optimisation: one greedy workflow can lock every other integration out.
 *
 * The window is shared per account host across the whole n8n process, so parallel
 * executions of different workflows still add up to a single budget.
 */

import { sleep } from 'n8n-workflow';

/** Reserved moments, ascending, for each account host. */
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
