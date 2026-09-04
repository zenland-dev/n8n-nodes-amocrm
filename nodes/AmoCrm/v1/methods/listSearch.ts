import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { amoCrmApiRequest } from '../transport';
import { currentParam } from './shared';

const PAGE_SIZE = 50;

/**
 * A searchable picker over a list endpoint.
 *
 * Unlike the dictionary dropdowns, these lists are unbounded — an account can hold
 * a million leads — so they are never cached and never fully loaded. amoCRM's own
 * `query=` free-text search does the filtering server-side, and the editor pages
 * through the rest on scroll.
 */
async function searchEntities(
	this: ILoadOptionsFunctions,
	endpoint: string,
	collection: string,
	filter: string | undefined,
	paginationToken: string | undefined,
	describe: (row: IDataObject) => string | undefined,
	extraQs: IDataObject = {},
): Promise<INodeListSearchResult> {
	const page = Number(paginationToken ?? 1) || 1;

	const qs: IDataObject = { ...extraQs, page, limit: PAGE_SIZE };
	if (filter !== undefined && filter !== '') qs.query = filter;

	const response = (await amoCrmApiRequest.call(this, 'GET', endpoint, undefined, qs)) as
		| IDataObject
		| undefined;

	// 204: nothing matched. That is an empty picker, not an error.
	if (response === undefined) return { results: [] };

	const embedded = (response._embedded ?? {}) as IDataObject;
	const rows = (embedded[collection] ?? []) as IDataObject[];

	const results: INodeListSearchItems[] = rows.map((row) => {
		const item: INodeListSearchItems = {
			name: String(row.name ?? row.title ?? `#${String(row.id)}`),
			value: row.id as number,
		};

		const description = describe(row);
		if (description !== undefined && description !== '') item.description = description;

		return item;
	});

	const links = (response._links ?? {}) as IDataObject;

	return links.next === undefined || rows.length === 0
		? { results }
		: { results, paginationToken: String(page + 1) };
}

export async function searchLeads(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return await searchEntities.call(
		this,
		'/api/v4/leads',
		'leads',
		filter,
		paginationToken,
		(lead) => `#${String(lead.id)} · ${String(lead.price ?? 0)}`,
	);
}

export async function searchContacts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return await searchEntities.call(
		this,
		'/api/v4/contacts',
		'contacts',
		filter,
		paginationToken,
		(contact) => `#${String(contact.id)}`,
	);
}

export async function searchCompanies(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return await searchEntities.call(
		this,
		'/api/v4/companies',
		'companies',
		filter,
		paginationToken,
		(company) => `#${String(company.id)}`,
	);
}

export async function searchCustomers(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return await searchEntities.call(
		this,
		'/api/v4/customers',
		'customers',
		filter,
		paginationToken,
		(customer) => `#${String(customer.id)}`,
	);
}

export async function searchTasks(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const page = Number(paginationToken ?? 1) || 1;

	// Tasks have no name and no free-text search: the picker lists them newest first
	// and shows the beginning of the task text.
	const response = (await amoCrmApiRequest.call(this, 'GET', '/api/v4/tasks', undefined, {
		page,
		limit: PAGE_SIZE,
		'order[created_at]': 'desc',
	})) as IDataObject | undefined;

	if (response === undefined) return { results: [] };

	const embedded = (response._embedded ?? {}) as IDataObject;
	const rows = (embedded.tasks ?? []) as IDataObject[];

	const wanted =
		filter === undefined || filter === ''
			? rows
			: rows.filter((task) =>
					String(task.text ?? '')
						.toLowerCase()
						.includes(filter.toLowerCase()),
				);

	const results: INodeListSearchItems[] = wanted.map((task) => ({
		name: String(task.text ?? `#${String(task.id)}`).slice(0, 80),
		value: task.id as number,
		description: `#${String(task.id)}`,
	}));

	const links = (response._links ?? {}) as IDataObject;

	return links.next === undefined || rows.length === 0
		? { results }
		: { results, paginationToken: String(page + 1) };
}

export async function searchCatalogElements(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const catalogId = currentParam(this, 'catalogId');
	if (catalogId === undefined) return { results: [] };

	return await searchEntities.call(
		this,
		`/api/v4/catalogs/${catalogId}/elements`,
		'elements',
		filter,
		paginationToken,
		(element) => `#${String(element.id)}`,
	);
}
