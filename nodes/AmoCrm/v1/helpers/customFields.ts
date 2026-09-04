import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * amoCRM stores every custom field as `{ field_id, values: [...] }`, but the shape
 * of one `values` element depends on the field's type — a flag is a boolean, a date
 * is a Unix timestamp, a select is an enum reference, a legal entity is a whole
 * object. Twenty-four types, no two of them alike.
 *
 * The editor already knows which type the user picked, because the field dropdown
 * encodes it into the option value as `id::type`. This module turns that choice
 * into the JSON amoCRM expects, and turns the response back into something readable.
 */

/** Types whose value is a plain string. */
const TEXT_TYPES = new Set([
	'text',
	'textarea',
	'url',
	'streetaddress',
	'price',
	'monetary',
	'tracking_data',
]);

/** Types whose value is a moment in time, written as Unix seconds. */
const DATE_TYPES = new Set(['date', 'date_time', 'birthday']);

/** Types whose value is a single option of the field's own list. */
const SINGLE_ENUM_TYPES = new Set(['select', 'radiobutton', 'category']);

/** Types whose value is a structure amoCRM defines but the editor cannot draw. */
const JSON_TYPES = new Set(['legal_entity', 'items', 'linked_entity', 'file', 'payer', 'supplier']);

/** The parts of a `smart_address` field, in amoCRM's own enum order. */
const ADDRESS_PARTS: Array<[string, string]> = [
	['addressLine1', 'address_line_1'],
	['addressLine2', 'address_line_2'],
	['city', 'city'],
	['state', 'state'],
	['zip', 'zip'],
	['country', 'country'],
];

export interface CustomFieldSelection {
	id: string;
	type: string;
}

/** Splits the `id::type` value produced by the custom-field dropdown. */
export function parseFieldSelection(raw: unknown): CustomFieldSelection {
	const [id, type = ''] = String(raw ?? '').split('::');
	return { id: id.trim(), type: type.trim() };
}

function toUnixSeconds(value: unknown): number | string {
	if (typeof value === 'number') return Math.floor(value);

	const text = String(value ?? '').trim();
	if (text === '') return '';

	// A bare number in a string is already a timestamp.
	if (/^\d+$/.test(text)) return Number(text);

	const parsed = Date.parse(text);
	// Anything else is handed to amoCRM as written: it accepts RFC-3339 too, and a
	// silent 0 would be far worse than the API's own validation message.
	return Number.isNaN(parsed) ? text : Math.floor(parsed / 1000);
}

function parseJsonValue(raw: unknown, fieldId: string, node: INode): unknown {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'object') return raw;

	try {
		return JSON.parse(String(raw));
	} catch {
		throw new NodeOperationError(node, `Custom field ${fieldId} was given a value that is not valid JSON`);
	}
}

function valuesForEntry(
	entry: IDataObject,
	type: string,
	fieldId: string,
	node: INode,
): IDataObject[] {
	if (entry.clearValue === true) return [];

	if (type === 'checkbox') return [{ value: entry.booleanValue === true }];

	if (type === 'numeric') {
		const raw = entry.numberValue;
		return raw === undefined || raw === '' ? [] : [{ value: Number(raw) }];
	}

	if (DATE_TYPES.has(type)) {
		const value = toUnixSeconds(entry.dateValue);
		return value === '' ? [] : [{ value }];
	}

	if (SINGLE_ENUM_TYPES.has(type)) {
		const raw = entry.enumValue;
		if (raw === undefined || raw === '') return [];
		// A dropdown pick is an enum id; anything else is treated as the option label,
		// which amoCRM also accepts and which is what an expression usually produces.
		return /^\d+$/.test(String(raw)) ? [{ enum_id: Number(raw) }] : [{ value: String(raw) }];
	}

	if (type === 'multiselect') {
		const raw = (entry.enumValues ?? []) as Array<string | number>;
		return raw.map((value) =>
			/^\d+$/.test(String(value)) ? { enum_id: Number(value) } : { value: String(value) },
		);
	}

	if (type === 'multitext') {
		const collection = (entry.multitextValues ?? {}) as IDataObject;
		const rows = (collection.entry ?? []) as IDataObject[];

		return rows
			.filter((row) => row.value !== undefined && row.value !== '')
			.map((row) => {
				const element: IDataObject = { value: String(row.value) };
				if (row.enumCode !== undefined && row.enumCode !== '') {
					element.enum_code = String(row.enumCode);
				}
				return element;
			});
	}

	if (type === 'smart_address') {
		const address = (entry.addressValue ?? {}) as IDataObject;

		return ADDRESS_PARTS.filter(([key]) => {
			const value = address[key];
			return value !== undefined && value !== '';
		}).map(([key, code]) => ({ value: String(address[key]), enum_code: code }));
	}

	if (type === 'chained_list') {
		const collection = (entry.chainedValues ?? {}) as IDataObject;
		const rows = (collection.entry ?? []) as IDataObject[];

		// amoCRM caps a chained list at five pairs and rejects the whole request above
		// that, so the excess is dropped here rather than turned into a failed write.
		return rows
			.filter((row) => row.catalogId !== undefined && row.catalogElementId !== undefined)
			.slice(0, 5)
			.map((row) => ({
				catalog_id: Number(row.catalogId),
				catalog_element_id: Number(row.catalogElementId),
			}));
	}

	if (JSON_TYPES.has(type)) {
		const value = parseJsonValue(entry.jsonValue, fieldId, node);
		return value === undefined ? [] : [{ value: value as IDataObject }];
	}

	// TEXT_TYPES and anything the account has that this build has never heard of.
	const raw = entry.stringValue;
	if (raw === undefined || raw === '') return TEXT_TYPES.has(type) ? [] : [];

	return [{ value: String(raw) }];
}

/**
 * Turns the "Custom Fields" collection into the `custom_fields_values` array.
 *
 * An entry with no value at all is skipped rather than sent as an empty array,
 * because an empty array is amoCRM's instruction to *erase* the field — a
 * difference that costs data if it happens by accident. Erasing is deliberate:
 * the entry's "Clear Field" switch.
 */
export function buildCustomFieldsValues(
	collection: IDataObject | undefined,
	node: INode,
): IDataObject[] {
	const entries = ((collection ?? {}).field ?? []) as IDataObject[];
	const result: IDataObject[] = [];

	for (const entry of entries) {
		const selection = parseFieldSelection(entry.fieldId);
		if (selection.id === '') continue;

		const type = String(entry.fieldType ?? '') || selection.type;
		const values = valuesForEntry(entry, type, selection.id, node);

		if (values.length === 0 && entry.clearValue !== true) continue;

		result.push({ field_id: Number(selection.id), values });
	}

	return result;
}

/**
 * Flattens `custom_fields_values` into `{ "Field name": value }` beside the entity.
 *
 * The raw form is faithful but painful downstream: every read needs an index lookup
 * by `field_id` before it can reach a value. This keeps the original array intact
 * and adds a readable view next to it.
 */
export function simplifyCustomFields(entity: IDataObject): IDataObject {
	const fields = entity.custom_fields_values;
	if (!Array.isArray(fields)) return entity;

	const flat: IDataObject = {};

	for (const field of fields as IDataObject[]) {
		const name = String(field.field_name ?? field.field_code ?? field.field_id ?? '');
		if (name === '') continue;

		const values = (field.values ?? []) as IDataObject[];
		const unwrapped = values.map((item) => (item.value !== undefined ? item.value : item));

		flat[name] = unwrapped.length === 1 ? unwrapped[0] : unwrapped;
	}

	return { ...entity, custom_fields: flat };
}
