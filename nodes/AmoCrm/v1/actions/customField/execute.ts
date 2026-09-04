import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { omitEmpty } from '../../helpers/query';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';
import { ENUM_FIELD_TYPES } from './description';

/** Path segment of each dictionary. Segments live under customers, catalogs under an id. */
const ENTITY_PATHS: Record<string, string> = {
	leads: 'leads',
	contacts: 'contacts',
	companies: 'companies',
	customers: 'customers',
	segments: 'customers/segments',
};

/**
 * amoCRM documents field groups for these four dictionaries only.
 *
 * There is no `/api/v4/catalogs/{id}/custom_fields/groups` and no segment
 * equivalent, so a group operation aimed at those would hit a 404 that says
 * nothing about why.
 */
const GROUP_ENTITIES = new Set(['leads', 'contacts', 'companies', 'customers']);

const ENUM_TYPES = new Set(ENUM_FIELD_TYPES);

function toItems(rows: IDataObject[]): INodeExecutionData[] {
	return rows.map((row) => ({ json: row }));
}

function embeddedRows(response: IDataObject | undefined, collection: string): IDataObject[] {
	const embedded = (response?._embedded ?? {}) as IDataObject;
	return (embedded[collection] ?? []) as IDataObject[];
}

function fieldsEndpoint(this: IExecuteFunctions, itemIndex: number): string {
	const entity = this.getNodeParameter('entity', itemIndex) as string;

	if (entity === 'catalog') {
		const catalogId = String(this.getNodeParameter('catalogId', itemIndex, ''));

		if (catalogId === '') {
			throw new NodeOperationError(this.getNode(), 'No list was chosen', {
				description: 'Custom fields of a list are addressed through that list, so pick one above.',
			});
		}

		return `/api/v4/catalogs/${catalogId}/custom_fields`;
	}

	return `/api/v4/${ENTITY_PATHS[entity] ?? entity}/custom_fields`;
}

function groupsEndpoint(this: IExecuteFunctions, itemIndex: number): string {
	const entity = this.getNodeParameter('entity', itemIndex) as string;

	if (!GROUP_ENTITIES.has(entity)) {
		throw new NodeOperationError(this.getNode(), 'This dictionary has no custom field groups', {
			description:
				'amoCRM keeps field groups for leads, contacts, companies and customers only — not for lists or customer segments.',
		});
	}

	return `/api/v4/${entity}/custom_fields/groups`;
}

function buildEnums(collection: IDataObject): IDataObject[] {
	const rows = (collection.entry ?? []) as IDataObject[];

	return rows
		.filter((row) => String(row.value ?? '') !== '' || Number(row.enumId ?? 0) > 0)
		.map((row) => {
			const option = omitEmpty({ value: row.value, sort: row.sort, code: row.code });

			const id = Number(row.enumId ?? 0);
			if (id > 0) option.id = id;

			return option;
		});
}

function buildNested(collection: IDataObject): IDataObject[] {
	const rows = (collection.entry ?? []) as IDataObject[];

	return rows
		.filter((row) => String(row.value ?? '') !== '')
		.map((row) => {
			const category = omitEmpty({ value: row.value, sort: row.sort });

			const parentId = Number(row.parentId ?? 0);
			if (parentId > 0) category.parent_id = parentId;

			return category;
		});
}

function buildChainedLists(collection: IDataObject): IDataObject[] {
	const rows = (collection.entry ?? []) as IDataObject[];

	return rows
		.filter((row) => String(row.catalogId ?? '') !== '')
		.map((row) => {
			const chained: IDataObject = { catalog_id: Number(row.catalogId) };

			if (String(row.title ?? '') !== '') chained.title = String(row.title);
			if (String(row.parentCatalogId ?? '') !== '') {
				chained.parent_catalog_id = Number(row.parentCatalogId);
			}

			return chained;
		});
}

function buildRequiredStatuses(collection: IDataObject): IDataObject[] {
	const rows = (collection.entry ?? []) as IDataObject[];

	return rows
		.filter((row) => String(row.statusId ?? '') !== '' && String(row.pipelineId ?? '') !== '')
		.map((row) => ({
			status_id: Number(row.statusId),
			pipeline_id: Number(row.pipelineId),
		}));
}

/**
 * The extras amoCRM demands for particular types.
 *
 * Left to the API these come back as a bare 422 naming a key the user never typed,
 * so each one is checked here against the type they picked.
 */
function assertTypeRequirements(this: IExecuteFunctions, type: string, body: IDataObject): void {
	const node = this.getNode();

	if (ENUM_TYPES.has(type) && body.enums === undefined) {
		throw new NodeOperationError(node, `A "${type}" field needs at least one option`, {
			description: 'Add the choices it offers under Options.',
		});
	}

	if (type === 'chained_list' && body.chained_lists === undefined) {
		throw new NodeOperationError(node, 'A chained list field needs at least one list', {
			description: 'Add the lists it chains under Chained Lists.',
		});
	}

	if (type === 'monetary' && body.currency === undefined) {
		throw new NodeOperationError(node, 'A monetary field needs a currency', {
			description: 'Set Currency under Additional Fields to a three-letter code such as USD.',
		});
	}

	if (type === 'linked_entity' && body.search_in === undefined) {
		throw new NodeOperationError(node, 'A linked entity field needs a search target', {
			description:
				'Set Search In under Additional Fields to a catalog ID, contacts, companies or contacts_and_companies.',
		});
	}
}

function limitRows(this: IExecuteFunctions, rows: IDataObject[], itemIndex: number): IDataObject[] {
	if (this.getNodeParameter('returnAll', itemIndex, false) === true) return rows;

	return rows.slice(0, Number(this.getNodeParameter('limit', itemIndex, 50)));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = this.getNode();

	if (operation === 'getAll') {
		const endpoint = fieldsEndpoint.call(this, itemIndex);
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

		const qs: IDataObject = {};

		const types = (options.types ?? []) as string[];
		if (types.length > 0) qs.filter = { type: types };

		if (options.orderBy !== undefined && options.orderBy !== '') {
			qs.order = { [String(options.orderBy)]: String(options.orderDirection ?? 'asc') };
		}

		const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
		const limit = Number(this.getNodeParameter('limit', itemIndex, 50));

		// The vendor doc contradicts itself on the page size — 50 in the limitations,
		// 250 in the parameter table — so paging runs until _links.next is gone
		// rather than trusting a single response to hold everything.
		const rows = await amoCrmApiRequestAllItems.call(
			this,
			endpoint,
			'custom_fields',
			qs,
			returnAll ? {} : { limit },
		);

		return toItems(rows);
	}

	if (operation === 'get') {
		const endpoint = fieldsEndpoint.call(this, itemIndex);
		const fieldId = String(this.getNodeParameter('fieldId', itemIndex));

		const field = (await amoCrmApiRequest.call(this, 'GET', `${endpoint}/${fieldId}`)) as
			| IDataObject
			| undefined;

		return field === undefined ? [] : [{ json: field }];
	}

	if (operation === 'create') {
		const endpoint = fieldsEndpoint.call(this, itemIndex);
		const type = this.getNodeParameter('type', itemIndex) as string;

		const body: IDataObject = {
			name: this.getNodeParameter('name', itemIndex) as string,
			type,
			...omitEmpty(this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject),
		};

		const enums = buildEnums(this.getNodeParameter('enumsUi', itemIndex, {}) as IDataObject);
		if (enums.length > 0) body.enums = enums;

		const nested = buildNested(this.getNodeParameter('nestedUi', itemIndex, {}) as IDataObject);
		if (nested.length > 0) body.nested = nested;

		const chained = buildChainedLists(
			this.getNodeParameter('chainedListsUi', itemIndex, {}) as IDataObject,
		);
		if (chained.length > 0) body.chained_lists = chained;

		const requiredStatuses = buildRequiredStatuses(
			this.getNodeParameter('requiredStatusesUi', itemIndex, {}) as IDataObject,
		);
		if (requiredStatuses.length > 0) body.required_statuses = requiredStatuses;

		assertTypeRequirements.call(this, type, body);

		// The create endpoint is a bulk one even for a single field, and answers 201.
		const response = (await amoCrmApiRequest.call(this, 'POST', endpoint, [body])) as
			| IDataObject
			| undefined;

		return toItems(embeddedRows(response, 'custom_fields'));
	}

	if (operation === 'update') {
		const endpoint = fieldsEndpoint.call(this, itemIndex);
		const fieldId = String(this.getNodeParameter('fieldId', itemIndex));

		const body = omitEmpty(this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject);

		const enums = buildEnums(this.getNodeParameter('updateEnumsUi', itemIndex, {}) as IDataObject);
		if (enums.length > 0) body.enums = enums;

		const requiredStatuses = buildRequiredStatuses(
			this.getNodeParameter('requiredStatusesUi', itemIndex, {}) as IDataObject,
		);
		if (requiredStatuses.length > 0) body.required_statuses = requiredStatuses;

		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(node, 'Nothing to update on this field', {
				description: 'Add at least one entry under Update Fields, Options or Required in Stages.',
			});
		}

		const field = (await amoCrmApiRequest.call(this, 'PATCH', `${endpoint}/${fieldId}`, body)) as
			| IDataObject
			| undefined;

		return field === undefined ? [] : [{ json: field }];
	}

	if (operation === 'delete') {
		const endpoint = fieldsEndpoint.call(this, itemIndex);
		const fieldId = String(this.getNodeParameter('fieldId', itemIndex));

		// Deleting a field deletes every value stored in it, on every entity.
		await amoCrmApiRequest.call(this, 'DELETE', `${endpoint}/${fieldId}`);

		return [{ json: { success: true, id: Number(fieldId) } }];
	}

	if (operation === 'getAllGroups') {
		const endpoint = groupsEndpoint.call(this, itemIndex);

		const response = (await amoCrmApiRequest.call(this, 'GET', endpoint)) as
			| IDataObject
			| undefined;

		return toItems(limitRows.call(this, embeddedRows(response, 'custom_field_groups'), itemIndex));
	}

	if (operation === 'getGroup') {
		const endpoint = groupsEndpoint.call(this, itemIndex);
		const groupId = encodeURIComponent(String(this.getNodeParameter('groupId', itemIndex)));

		const group = (await amoCrmApiRequest.call(this, 'GET', `${endpoint}/${groupId}`)) as
			| IDataObject
			| undefined;

		return group === undefined ? [] : [{ json: group }];
	}

	if (operation === 'createGroup') {
		const endpoint = groupsEndpoint.call(this, itemIndex);

		const body: IDataObject = {
			name: this.getNodeParameter('name', itemIndex) as string,
			sort: Number(this.getNodeParameter('sort', itemIndex)),
		};

		const response = (await amoCrmApiRequest.call(this, 'POST', endpoint, [body])) as
			| IDataObject
			| undefined;

		return toItems(embeddedRows(response, 'custom_field_groups'));
	}

	if (operation === 'updateGroup') {
		const endpoint = groupsEndpoint.call(this, itemIndex);
		const groupId = encodeURIComponent(String(this.getNodeParameter('groupId', itemIndex)));

		const updateFields = this.getNodeParameter('groupUpdateFields', itemIndex, {}) as IDataObject;
		const body = omitEmpty({ name: updateFields.name, sort: updateFields.sort });

		const fields = String(updateFields.fields ?? '')
			.split(',')
			.map((id) => Number(id.trim()))
			.filter((id) => Number.isFinite(id) && id > 0);

		if (fields.length > 0) body.fields = fields;

		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(node, 'Nothing to update on this group', {
				description: 'Add at least one entry under Update Fields.',
			});
		}

		const group = (await amoCrmApiRequest.call(this, 'PATCH', `${endpoint}/${groupId}`, body)) as
			| IDataObject
			| undefined;

		return group === undefined ? [] : [{ json: group }];
	}

	if (operation === 'deleteGroup') {
		const endpoint = groupsEndpoint.call(this, itemIndex);
		const groupId = encodeURIComponent(String(this.getNodeParameter('groupId', itemIndex)));

		// The fields filed under the group survive it; only the grouping is removed.
		await amoCrmApiRequest.call(this, 'DELETE', `${endpoint}/${groupId}`);

		return [{ json: { success: true, id: String(this.getNodeParameter('groupId', itemIndex)) } }];
	}

	throw new NodeOperationError(
		node,
		`Unknown operation "${operation}" for the custom field resource`,
	);
}
