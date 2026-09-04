import type { IDataObject } from 'n8n-workflow';

/**
 * Segments a crafted key must never reach: assigning through them would touch
 * `Object.prototype` for the whole process. The body is unauthenticated — amoCRM
 * signs nothing — so every segment is checked before it is used as a key.
 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

const INDEX_KEY = /^(?:0|[1-9]\d*)$/;

/**
 * Which amoCRM event code produced a given `<entity>.<action>` pair.
 *
 * The mapping is not mechanical, so it is written out rather than derived: the task
 * key is singular (`task.add` → `add_task`), outgoing messages have their own
 * top-level key (`outgoing_message.add` → `add_outgoing_message`), and notes arrive
 * under the entity they belong to (`leads.note` → `note_lead`).
 */
const EVENT_CODES: Record<string, Record<string, string>> = {
	companies: {
		add: 'add_company',
		delete: 'delete_company',
		note: 'note_company',
		responsible: 'responsible_company',
		restore: 'restore_company',
		update: 'update_company',
	},
	contacts: {
		add: 'add_contact',
		delete: 'delete_contact',
		note: 'note_contact',
		responsible: 'responsible_contact',
		restore: 'restore_contact',
		update: 'update_contact',
	},
	customers: {
		add: 'add_customer',
		delete: 'delete_customer',
		note: 'note_customer',
		responsible: 'responsible_customer',
		update: 'update_customer',
	},
	leads: {
		add: 'add_lead',
		delete: 'delete_lead',
		note: 'note_lead',
		responsible: 'responsible_lead',
		restore: 'restore_lead',
		status: 'status_lead',
		update: 'update_lead',
	},
	message: { add: 'add_message' },
	outgoing_message: { add: 'add_outgoing_message' },
	talk: { add: 'add_talk', delete: 'delete_talk', update: 'update_talk' },
	task: {
		add: 'add_task',
		delete: 'delete_task',
		responsible: 'responsible_task',
		update: 'update_task',
	},
	unsorted: { add: 'add_unsorted', delete: 'delete_unsorted', update: 'update_unsorted' },
};

/** One changed entity, lifted out of a delivery that may carry many. */
export interface AmoCrmWebhookEvent {
	/** amoCRM event code, e.g. `status_lead` */
	event: string;
	/** Top-level payload key, e.g. `leads` */
	entity: string;
	/** Second-level payload key, e.g. `status` */
	action: string;
	/** The entity as amoCRM sent it — every value is a string */
	data: IDataObject;
}

/**
 * Percent-decoding that cannot throw.
 *
 * `decodeURIComponent` raises a URIError on a malformed sequence, and this body
 * arrives straight off the open internet. A throwing decoder would cost the whole
 * delivery, and amoCRM disables a subscription that answers badly often enough, so
 * bytes are gathered by hand and handed to Buffer, which substitutes what it cannot
 * decode instead of giving up.
 */
function decodeFormComponent(input: string): string {
	const text = input.replace(/\+/g, ' ');
	if (!text.includes('%')) return text;

	const bytes: number[] = [];
	let literal = '';

	const flushLiteral = (): void => {
		if (literal === '') return;
		for (const byte of Buffer.from(literal, 'utf8')) bytes.push(byte);
		literal = '';
	};

	for (let index = 0; index < text.length; index++) {
		const pair = text.slice(index + 1, index + 3);

		if (text[index] === '%' && HEX_PAIR.test(pair)) {
			flushLiteral();
			bytes.push(parseInt(pair, 16));
			index += 2;
			continue;
		}

		literal += text[index];
	}

	flushLiteral();

	return Buffer.from(bytes).toString('utf8');
}

/** `leads[status][0][id]` → `['leads', 'status', '0', 'id']`. */
function bracketPath(key: string): string[] {
	const start = key.indexOf('[');
	if (start === -1 || !key.endsWith(']')) return [key];

	const segments = [key.slice(0, start)];
	const brackets = key.slice(start);
	const pattern = /\[([^[\]]*)\]/g;

	for (let match = pattern.exec(brackets); match !== null; match = pattern.exec(brackets)) {
		segments.push(match[1]);
	}

	return segments;
}

/** Writes `value` at `segments`, creating the objects on the way. */
function setDeep(root: IDataObject, segments: string[], value: unknown): void {
	let node: IDataObject = root;

	for (let depth = 0; depth < segments.length; depth++) {
		const segment = segments[depth];
		if (UNSAFE_SEGMENTS.has(segment)) return;

		// PHP's `key[]=` means "append". amoCRM sends explicit indices, but a proxy in
		// front of n8n, or a hand-written test, can still produce the short form.
		const key = segment === '' ? String(Object.keys(node).length) : segment;

		if (depth === segments.length - 1) {
			node[key] = value as IDataObject[string];
			return;
		}

		const existing = node[key];
		if (existing === null || typeof existing !== 'object') node[key] = {};

		node = node[key] as IDataObject;
	}
}

/**
 * Turns `{ "0": …, "1": … }` into an array.
 *
 * amoCRM's own documentation prints the same event both ways — the Russian page
 * shows `leads.status` as an object keyed `"0"`, the English one as an array —
 * because the two were decoded by different bracket parsers. Downstream nodes
 * should not have to care which shape arrived.
 *
 * Only a dense sequence starting at zero is converted. That is deliberate:
 * `linked_leads_id` is an object keyed by lead id, and those keys are numeric too —
 * converting it would throw the ids away.
 */
function indexedObjectsToArrays(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(indexedObjectsToArrays);
	if (value === null || typeof value !== 'object') return value;

	const entries = Object.entries(value as IDataObject);
	const indices = entries.map(([key]) => Number(key)).sort((left, right) => left - right);
	const isDenseIndex =
		entries.length > 0 &&
		entries.every(([key]) => INDEX_KEY.test(key)) &&
		indices.every((index, position) => index === position);

	if (isDenseIndex) {
		return entries
			.sort(([left], [right]) => Number(left) - Number(right))
			.map(([, entry]) => indexedObjectsToArrays(entry));
	}

	const output: IDataObject = {};
	for (const [key, entry] of entries) {
		output[key] = indexedObjectsToArrays(entry) as IDataObject[string];
	}

	return output;
}

/**
 * Decodes an amoCRM webhook body into nested JSON.
 *
 * **amoCRM does not post JSON.** It posts `application/x-www-form-urlencoded` with
 * PHP-style bracket keys — `leads[status][0][id]=25399013&account[subdomain]=acme` —
 * and every JSON block in its documentation is the *decoded* view of that body, not
 * what comes down the wire. `JSON.parse` on it throws, and n8n's own form parsing
 * leaves the brackets sitting inside the key names, so the nesting has to be rebuilt
 * here. Rebuilding it by hand also lifts the depth and array-length limits the usual
 * `qs` defaults impose, both of which amoCRM exceeds: `leads[status][0]
 * [custom_fields][0][values][0][value]` is six levels deep, and one delivery can
 * carry hundreds of entities.
 *
 * Do not replace this with `JSON.parse`.
 */
export function parseAmoCrmWebhookBody(raw: string): IDataObject {
	const decoded: IDataObject = {};

	for (const pair of raw.split('&')) {
		if (pair === '') continue;

		const separator = pair.indexOf('=');
		const key = decodeFormComponent(separator === -1 ? pair : pair.slice(0, separator));
		if (key === '') continue;

		const value = separator === -1 ? '' : decodeFormComponent(pair.slice(separator + 1));
		setDeep(decoded, bracketPath(key), value);
	}

	return indexedObjectsToArrays(decoded) as IDataObject;
}

/**
 * The same rebuild, for a body n8n's HTTP layer already split into key/value pairs.
 *
 * Whether the brackets survive inside the key names depends on which form parser the
 * n8n instance runs, so both shapes are expanded the same way and an already-nested
 * body is walked to the bottom in case its parser gave up at a depth limit.
 */
export function expandAmoCrmWebhookBody(body: IDataObject): IDataObject {
	const expandEntry = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(expandEntry);
		if (value === null || typeof value !== 'object') return value;

		const nested: IDataObject = {};
		for (const [key, entry] of Object.entries(value as IDataObject)) {
			setDeep(nested, bracketPath(key), expandEntry(entry));
		}

		return nested;
	};

	return indexedObjectsToArrays(expandEntry(body)) as IDataObject;
}

/** Deletions can arrive as a bare id, and notes carry one wrapper more than anything else. */
function entityFromRow(action: string, row: unknown): IDataObject {
	if (row === null || typeof row !== 'object') return { id: String(row ?? '') };

	const entity = row as IDataObject;

	if (action === 'note' && entity.note !== null && typeof entity.note === 'object') {
		const { note, ...rest } = entity;
		return { ...rest, ...(note as IDataObject) };
	}

	return entity;
}

/**
 * Splits one delivery into the entities it changed.
 *
 * amoCRM batches: a bulk edit of fifty leads arrives as a single request holding
 * fifty entries under `leads.update`.
 */
export function collectAmoCrmWebhookEvents(payload: IDataObject): AmoCrmWebhookEvent[] {
	const events: AmoCrmWebhookEvent[] = [];

	for (const [entity, actions] of Object.entries(payload)) {
		if (entity === 'account' || actions === null || typeof actions !== 'object') continue;

		const known = EVENT_CODES[entity] !== undefined;

		for (const [action, rows] of Object.entries(actions as IDataObject)) {
			// One amoCRM example wraps `task.update` twice, and the array normaliser
			// faithfully reproduces that as an array of arrays.
			const list = (Array.isArray(rows) ? (rows as unknown[]) : [rows]).flatMap((row) =>
				Array.isArray(row) ? (row as unknown[]) : [row],
			);

			for (const row of list) {
				// A bare id in place of the entity is documented for deletions of the entities
				// listed above. Under an unknown key it is stray form data, not an event.
				if (!known && (row === null || typeof row !== 'object')) continue;

				events.push({
					event: EVENT_CODES[entity]?.[action] ?? `${action}_${entity}`,
					entity,
					action,
					data: entityFromRow(action, row),
				});
			}
		}
	}

	return events;
}
