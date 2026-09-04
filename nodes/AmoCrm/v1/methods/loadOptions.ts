import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { amoCrmCachedRequest } from '../transport/cache';
import { CUSTOM_FIELD_ENTITIES, cachedList, currentParam, toOptions } from './shared';

/** Which custom-field dictionary the node is currently editing. */
function customFieldsEndpoint(context: ILoadOptionsFunctions): string {
	const resource = String(context.getNodeParameter('resource', '') ?? '');

	if (resource === 'catalogElement') {
		const catalogId = currentParam(context, 'catalogId');
		return catalogId === undefined ? '' : `/api/v4/catalogs/${catalogId}/custom_fields`;
	}

	const entity = CUSTOM_FIELD_ENTITIES[resource];
	return entity === undefined ? '' : `/api/v4/${entity}/custom_fields`;
}

async function loadCustomFields(
	this: ILoadOptionsFunctions,
	endpoint: string,
): Promise<IDataObject[]> {
	if (endpoint === '') return [];
	return await cachedList.call(this, endpoint, 'custom_fields');
}

/**
 * Custom-field pickers carry the field type in the option value, as `id::type`.
 *
 * That is what lets the editor swap in the right value input — a checkbox for a flag,
 * a date picker for a date, the field's own options for a select — without a second
 * round trip, following the convention n8n's own Notion node uses.
 */
function toCustomFieldOptions(fields: IDataObject[]): INodePropertyOptions[] {
	const sorted = [...fields].sort((left, right) => {
		const bySort = Number(left.sort) - Number(right.sort);
		if (Number.isFinite(bySort) && bySort !== 0) return bySort;
		return String(left.name ?? '').localeCompare(String(right.name ?? ''));
	});

	return sorted.map((field) => {
		const code = field.code === null || field.code === undefined ? '' : ` [${String(field.code)}]`;

		return {
			name: `${String(field.name ?? field.id)}${code}`,
			value: `${String(field.id)}::${String(field.type)}`,
			description: `${String(field.type)} · ID ${String(field.id)}`,
		};
	});
}

export async function getPipelines(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const pipelines = await cachedList.call(this, '/api/v4/leads/pipelines', 'pipelines');

	return toOptions(
		pipelines.filter((pipeline) => pipeline.is_archive !== true),
		{ describe: (pipeline) => (pipeline.is_main === true ? 'Main pipeline' : undefined) },
	);
}

/**
 * Stages of the selected pipeline, or of every pipeline when none is chosen yet.
 *
 * amoCRM reuses ids 142 (won) and 143 (lost) in every pipeline, so a stage id alone
 * does not identify a stage — that is why the pipeline name is part of the label.
 */
export async function getStatuses(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const pipelines = await cachedList.call(this, '/api/v4/leads/pipelines', 'pipelines');
	const selected = currentParam(this, 'pipelineId');

	const wanted =
		selected === undefined
			? pipelines
			: pipelines.filter((pipeline) => String(pipeline.id) === String(selected));

	const options: INodePropertyOptions[] = [];

	for (const pipeline of wanted) {
		const embedded = (pipeline._embedded ?? {}) as IDataObject;
		const statuses = (embedded.statuses ?? []) as IDataObject[];

		for (const status of [...statuses].sort((a, b) => Number(a.sort) - Number(b.sort))) {
			const option: INodePropertyOptions = {
				name:
					wanted.length === 1
						? String(status.name)
						: `${String(pipeline.name)} · ${String(status.name)}`,
				value: status.id as number,
			};

			if (status.type === 1) option.description = 'Incoming leads stage';
			options.push(option);
		}
	}

	return options;
}

export async function getLossReasons(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await cachedList.call(this, '/api/v4/leads/loss_reasons', 'loss_reasons'));
}

export async function getUsers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const users = await cachedList.call(this, '/api/v4/users', 'users', { with: 'role,group' });

	const active = users.filter((user) => {
		const rights = (user.rights ?? {}) as IDataObject;
		return rights.is_active !== false;
	});

	return toOptions(active, { describe: (user) => String(user.email ?? '') });
}

/**
 * The same list plus amoCRM's system user.
 *
 * Id 0 is what `created_by` and `updated_by` carry for anything a robot, a widget or
 * the API itself did. It never appears in `GET /users`, so it has to be added by hand.
 */
export async function getUsersWithRobot(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const users = await getUsers.call(this);

	return [
		{ name: 'Robot (System)', value: 0, description: 'Actions performed by amoCRM itself' },
		...users,
	];
}

export async function getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const account = (await amoCrmCachedRequest.call(this, '/api/v4/account', {
		with: 'users_groups',
	})) as IDataObject | undefined;

	const embedded = (account?._embedded ?? {}) as IDataObject;

	// A department id of 0 is legitimate here, so nothing may be filtered on truthiness.
	return toOptions((embedded.users_groups ?? []) as IDataObject[]);
}

export async function getRoles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await cachedList.call(this, '/api/v4/roles', 'roles'));
}

export async function getTaskTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const account = (await amoCrmCachedRequest.call(this, '/api/v4/account', {
		with: 'task_types',
	})) as IDataObject | undefined;

	const embedded = (account?._embedded ?? {}) as IDataObject;

	return toOptions((embedded.task_types ?? []) as IDataObject[]);
}

/** Custom fields of the entity the node is currently working with. */
export async function getCustomFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toCustomFieldOptions(await loadCustomFields.call(this, customFieldsEndpoint(this)));
}

export async function getContactCustomFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return toCustomFieldOptions(await loadCustomFields.call(this, '/api/v4/contacts/custom_fields'));
}

export async function getCompanyCustomFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return toCustomFieldOptions(await loadCustomFields.call(this, '/api/v4/companies/custom_fields'));
}

export async function getLeadCustomFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return toCustomFieldOptions(await loadCustomFields.call(this, '/api/v4/leads/custom_fields'));
}

/**
 * The options of the custom field picked beside this one.
 *
 * The field list is already in the dropdown cache, so this costs no extra request.
 */
export async function getCustomFieldEnums(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const raw = currentParam(this, 'fieldId');
	if (raw === undefined) return [];

	const fieldId = String(raw).split('::')[0];
	const fields = await loadCustomFields.call(this, customFieldsEndpoint(this));
	const field = fields.find((candidate) => String(candidate.id) === fieldId);

	const enums = (field?.enums ?? []) as IDataObject[];

	return toOptions(enums, {
		nameKey: 'value',
		describe: (option) =>
			option.code === null || option.code === undefined ? undefined : String(option.code),
	});
}

export async function getCustomFieldGroups(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const endpoint = customFieldsEndpoint(this);
	if (endpoint === '') return [];

	// Group ids are strings here, sometimes keywords such as "default".
	return toOptions(await cachedList.call(this, `${endpoint}/groups`, 'custom_field_groups'), {
		describe: (group) => String(group.id),
	});
}

export async function getCatalogs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await cachedList.call(this, '/api/v4/catalogs', 'catalogs'), {
		describe: (catalog) => String(catalog.type ?? ''),
	});
}

export async function getCatalogElements(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const catalogId = currentParam(this, 'catalogId');
	if (catalogId === undefined) return [];

	// Lists can hold thousands of rows; the searchable picker is the better tool
	// above a few hundred, so this stops after four pages rather than stalling.
	return toOptions(
		await cachedList.call(this, `/api/v4/catalogs/${catalogId}/elements`, 'elements', {}, 4),
	);
}

async function tagOptions(
	this: ILoadOptionsFunctions,
	entity: string,
): Promise<INodePropertyOptions[]> {
	return toOptions(await cachedList.call(this, `/api/v4/${entity}/tags`, 'tags'), {
		valueKey: 'name',
		describe: (tag) => `ID ${String(tag.id)}`,
	});
}

export async function getLeadTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await tagOptions.call(this, 'leads');
}

export async function getContactTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await tagOptions.call(this, 'contacts');
}

export async function getCompanyTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await tagOptions.call(this, 'companies');
}

export async function getCustomerTags(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await tagOptions.call(this, 'customers');
}

/** Tags of whichever entity the node is currently working with. */
export async function getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const resource = String(this.getNodeParameter('resource', '') ?? '');
	const entity = CUSTOM_FIELD_ENTITIES[resource] ?? 'leads';

	return await tagOptions.call(this, entity);
}

export async function getEventTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const types = await cachedList.call(this, '/api/v4/events/types', 'events_types');

	return toOptions(types, {
		valueKey: 'key',
		label: (type) => String(type.lang ?? type.key),
		describe: (type) => String(type.key),
	});
}

export async function getCustomerStatuses(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return toOptions(await cachedList.call(this, '/api/v4/customers/statuses', 'statuses'));
}

export async function getCustomerSegments(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return toOptions(await cachedList.call(this, '/api/v4/customers/segments', 'segments'));
}

export async function getSources(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await cachedList.call(this, '/api/v4/sources', 'sources'), {
		describe: (source) => String(source.external_id ?? ''),
	});
}
