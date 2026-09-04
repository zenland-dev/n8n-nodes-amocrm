import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { amoCrmCachedRequest } from '../transport/cache';

/** Entity paths that own a custom-field dictionary. */
export const CUSTOM_FIELD_ENTITIES: Record<string, string> = {
	lead: 'leads',
	contact: 'contacts',
	company: 'companies',
	customer: 'customers',
	segment: 'customers/segments',
};

/**
 * Reads a parameter that may sit either beside the caller inside a collection or
 * at the top level of the node.
 *
 * The `&` prefix means "sibling within the same collection entry", and only
 * `getCurrentNodeParameter` understands it. `getNodeParameter` is tried next
 * because it is the only one of the two that resolves an expression — a user who
 * writes `{{ $json.pipeline_id }}` into the parent field still gets a working
 * child dropdown, as long as the parent is listed in `loadOptionsDependsOn`.
 */
export function currentParam(
	context: ILoadOptionsFunctions,
	name: string,
): string | number | undefined {
	const readers: Array<() => unknown> = [
		() => context.getCurrentNodeParameter(`&${name}`),
		() => context.getNodeParameter(name, undefined),
		() => context.getCurrentNodeParameter(name),
	];

	for (const read of readers) {
		try {
			const value = read();
			if (value !== undefined && value !== null && value !== '') {
				return value as string | number;
			}
		} catch {
			// Not addressable from here; try the next form.
		}
	}

	return undefined;
}

/** Pages through a dictionary endpoint, reusing the short-lived dropdown cache. */
export async function cachedList(
	this: ILoadOptionsFunctions,
	endpoint: string,
	collection: string,
	qs: IDataObject = {},
	maxPages = 20,
): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];

	for (let page = 1; page <= maxPages; page++) {
		const response = (await amoCrmCachedRequest.call(this, endpoint, {
			...qs,
			page,
			limit: 250,
		})) as IDataObject | undefined;

		// 204: the account simply has none of these yet.
		if (response === undefined) break;

		const embedded = (response._embedded ?? {}) as IDataObject;
		const items = (embedded[collection] ?? []) as IDataObject[];
		rows.push(...items);

		const links = (response._links ?? {}) as IDataObject;
		if (links.next === undefined || items.length === 0) break;
	}

	return rows;
}

/**
 * Turns API rows into dropdown entries, ordered the way amoCRM orders them in its
 * own interface — by `sort` where the entity has one, by name otherwise.
 */
export function toOptions(
	rows: IDataObject[],
	options: {
		nameKey?: string;
		valueKey?: string;
		describe?: (row: IDataObject) => string | undefined;
		label?: (row: IDataObject) => string;
	} = {},
): INodePropertyOptions[] {
	const { nameKey = 'name', valueKey = 'id', describe, label } = options;

	const sorted = [...rows].sort((left, right) => {
		const leftSort = Number(left.sort);
		const rightSort = Number(right.sort);

		if (Number.isFinite(leftSort) && Number.isFinite(rightSort) && leftSort !== rightSort) {
			return leftSort - rightSort;
		}

		return String(left[nameKey] ?? '').localeCompare(String(right[nameKey] ?? ''));
	});

	return sorted.map((row) => {
		const entry: INodePropertyOptions = {
			name: label === undefined ? String(row[nameKey] ?? row[valueKey] ?? '') : label(row),
			value: row[valueKey] as string | number,
		};

		const description = describe?.(row);
		if (description !== undefined && description !== '') entry.description = description;

		return entry;
	});
}
