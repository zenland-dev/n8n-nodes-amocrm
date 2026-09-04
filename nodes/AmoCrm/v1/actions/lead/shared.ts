import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * n8n hands a `dateTime` parameter over as an ISO-8601 string; amoCRM counts every
 * moment in whole Unix seconds. A value that parses as neither is returned as
 * `undefined` so the caller can name the field in the error — a silently dropped
 * `created_at` on a backdating import is the kind of bug nobody notices for weeks.
 */
export function unixSeconds(value: unknown): number | undefined {
	if (typeof value === 'number') return Math.floor(value);

	const text = String(value ?? '').trim();
	if (text === '') return undefined;
	if (/^\d+$/.test(text)) return Number(text);

	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

/** Converts one date-ish parameter, or explains which field the node could not read. */
export function requireUnixSeconds(node: INode, value: unknown, label: string): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;

	const seconds = unixSeconds(value);
	if (seconds === undefined) {
		throw new NodeOperationError(node, `${label}: "${String(value)}" is not a date`, {
			description: 'Give it an ISO-8601 date, or a Unix timestamp in seconds.',
		});
	}

	return seconds;
}

/** A `from`/`to` pair, or nothing when the user filled in neither end. */
export function boundsOf(from: unknown, to: unknown): IDataObject | undefined {
	const bounds: IDataObject = {};

	if (from !== undefined && from !== null && from !== '') bounds.from = from;
	if (to !== undefined && to !== null && to !== '') bounds.to = to;

	return Object.keys(bounds).length === 0 ? undefined : bounds;
}

/** Reads a comma-separated list of amoCRM ids, rejecting anything that is not one. */
export function parseIdList(node: INode, raw: unknown, label: string): number[] {
	const entries = String(raw ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');

	return entries.map((entry) => {
		if (!/^\d+$/.test(entry)) {
			throw new NodeOperationError(node, `${label}: "${entry}" is not an amoCRM ID`, {
				description: 'Give a whole number, or several separated by commas.',
			});
		}

		return Number(entry);
	});
}

/**
 * Ids picked in a `multiOptions` dropdown.
 *
 * `0` is kept deliberately: it is amoCRM's system user, the one that owns everything
 * a robot or the API itself did, so a truthiness filter here would quietly discard
 * "created by a robot".
 */
export function toIdArray(value: unknown): number[] {
	if (!Array.isArray(value)) return [];

	return (value as unknown[]).map(Number).filter((id) => Number.isFinite(id));
}

/**
 * Tag references for a write body.
 *
 * The dropdown is built from tag *names* — amoCRM creates a tag the first time a name
 * is used, which is what makes the free-text box beside it worth having. An expression
 * may still produce ids, so digits are sent as `{ id }` and everything else as
 * `{ name }`; amoCRM accepts either.
 */
export function tagReferences(picked: unknown, extra: unknown): IDataObject[] {
	const listed = Array.isArray(picked) ? (picked as unknown[]).map((tag) => String(tag)) : [];
	const typed = String(extra ?? '').split(',');

	const references: IDataObject[] = [];
	const seen = new Set<string>();

	for (const raw of [...listed, ...typed]) {
		const tag = raw.trim();
		if (tag === '' || seen.has(tag)) continue;
		seen.add(tag);

		references.push(/^\d+$/.test(tag) ? { id: Number(tag) } : { name: tag });
	}

	return references;
}

/** Reads the entity amoCRM answered with, whether or not it wrapped it in HAL. */
export function firstEmbedded(response: unknown, collection: string): IDataObject {
	const body = (response ?? {}) as IDataObject;
	const embedded = (body._embedded ?? {}) as IDataObject;
	const rows = (embedded[collection] ?? []) as IDataObject[];

	return rows[0] ?? body;
}
