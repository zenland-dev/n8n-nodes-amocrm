import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { buildCustomFieldsValues } from '../../helpers/customFields';
import { parseIdList, requireUnixSeconds, tagReferences } from './shared';

/** Editor parameter → amoCRM field, for everything that is a plain scalar. */
const SCALAR_FIELDS: Array<[string, string]> = [
	['name', 'name'],
	['price', 'price'],
	['pipelineId', 'pipeline_id'],
	['statusId', 'status_id'],
	['responsibleUserId', 'responsible_user_id'],
	['lossReasonId', 'loss_reason_id'],
	['createdBy', 'created_by'],
	['updatedBy', 'updated_by'],
];

/** Editor parameter → amoCRM field → label, for the moments amoCRM lets you write. */
const DATE_FIELDS: Array<[string, string, string]> = [
	['createdAt', 'created_at', 'Created At'],
	['updatedAt', 'updated_at', 'Updated At'],
	['closedAt', 'closed_at', 'Closed At'],
];

/** Fields that describe links rather than lead data. */
const LINK_FIELDS = ['contactIds', 'mainContactId', 'companyId'];

type WriteMode = 'create' | 'update';

/** Which collection holds the optional fields for this operation. */
function fieldsParameter(mode: WriteMode): string {
	return mode === 'create' ? 'additionalFields' : 'updateFields';
}

/** An amoCRM id is always an integer; an expression may well produce it as a string. */
function toId(value: unknown): number | string {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : String(value);
}

interface ContactSelection {
	contactIds: number[];
	mainContactId?: number;
	companyId?: number;
}

function readLinkSelection(node: INode, fields: IDataObject): ContactSelection {
	const contactIds = parseIdList(node, fields.contactIds, 'Contact IDs');
	const mainContactId = parseIdList(node, fields.mainContactId, 'Main Contact ID')[0];
	const companyId = parseIdList(node, fields.companyId, 'Company ID')[0];

	// The main contact does not have to be repeated in the list to be attached.
	const all =
		mainContactId === undefined || contactIds.includes(mainContactId)
			? contactIds
			: [mainContactId, ...contactIds];

	return { contactIds: all, mainContactId, companyId };
}

/** Whether the user asked for links that a PATCH body cannot carry. */
export function hasLinkFields(fields: IDataObject): boolean {
	return LINK_FIELDS.some((name) => {
		const value = fields[name];
		return value !== undefined && value !== null && String(value).trim() !== '';
	});
}

/**
 * Link objects for `POST /api/v4/leads/{id}/link`.
 *
 * The flag that marks the main contact is written as `metadata.is_main` and read back
 * as `metadata.main_contact` — amoCRM uses two names for one fact, and a third
 * (`is_main`) inside `_embedded.contacts` on a lead read.
 */
export function buildLinkObjects(node: INode, fields: IDataObject): IDataObject[] {
	const { contactIds, mainContactId, companyId } = readLinkSelection(node, fields);
	const links: IDataObject[] = [];

	for (const id of contactIds) {
		const link: IDataObject = { to_entity_id: id, to_entity_type: 'contacts' };
		if (id === mainContactId) link.metadata = { is_main: true };
		links.push(link);
	}

	if (companyId !== undefined) {
		links.push({ to_entity_id: companyId, to_entity_type: 'companies' });
	}

	return links;
}

/**
 * The body for one lead, shared by the single-request path and the batched one.
 *
 * Tags are additive by default (`tags_to_add` / `tags_to_delete`). The alternative,
 * `_embedded.tags`, is a full replacement: amoCRM detaches every tag the lead has
 * that is not in the list, so an integration that used it for "add a tag" would strip
 * whatever a salesperson had put there by hand. Replacement stays available behind an
 * explicit switch, because it is the only way to state the final set.
 */
async function buildPayload(
	this: IExecuteFunctions,
	itemIndex: number,
	mode: WriteMode,
): Promise<IDataObject> {
	const node = this.getNode();
	const fields = this.getNodeParameter(fieldsParameter(mode), itemIndex, {}) as IDataObject;

	const body: IDataObject = {};
	const embedded: IDataObject = {};

	if (mode === 'create') {
		const name = String(this.getNodeParameter('name', itemIndex, '') ?? '').trim();
		if (name !== '') body.name = name;
	} else {
		// A batched PATCH addresses each lead by the `id` inside its own element.
		body.id = Number(this.getNodeParameter('leadId', itemIndex, undefined, { extractValue: true }));
	}

	for (const [parameter, field] of SCALAR_FIELDS) {
		const value = fields[parameter];
		if (value === undefined || value === null || value === '') continue;

		if (field === 'name') body.name = String(value);
		else if (field === 'price') body.price = Number(value);
		else body[field] = toId(value);
	}

	for (const [parameter, field, label] of DATE_FIELDS) {
		const seconds = requireUnixSeconds(node, fields[parameter], label);
		if (seconds !== undefined) body[field] = seconds;
	}

	const customFields = buildCustomFieldsValues(
		this.getNodeParameter('customFieldsUi', itemIndex, {}) as IDataObject,
		node,
	);
	if (customFields.length > 0) body.custom_fields_values = customFields;

	const tags = tagReferences(fields.tags, fields.extraTags);

	if (fields.replaceTags === true) {
		// Deliberate overwrite: an empty list here detaches every tag the lead has.
		embedded.tags = tags;
	} else {
		if (tags.length > 0) body.tags_to_add = tags;

		const removed = tagReferences(fields.removedTags, '');
		if (removed.length > 0) body.tags_to_delete = removed;
	}

	if (mode === 'create') {
		const { contactIds, mainContactId, companyId } = readLinkSelection(node, fields);

		if (contactIds.length > 0) {
			embedded.contacts = contactIds.map((id) =>
				id === mainContactId ? { id, is_main: true } : { id },
			);
		}

		// A lead holds at most one company, despite the field being an array.
		if (companyId !== undefined) embedded.companies = [{ id: companyId }];
	}

	if (Object.keys(embedded).length > 0) body._embedded = embedded;

	return body;
}

export async function buildCreatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	return await buildPayload.call(this, itemIndex, 'create');
}

export async function buildUpdatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	return await buildPayload.call(this, itemIndex, 'update');
}

/**
 * The same update body, refused when it would lose work.
 *
 * amoCRM ignores `_embedded.contacts` and `_embedded.companies` on a PATCH, so the
 * node attaches them with a second request — which a batched write, being one request
 * for many leads, has nowhere to put. Saying so beats silently dropping the links.
 */
export async function buildBatchUpdatePayload(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject> {
	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;

	if (hasLinkFields(fields)) {
		throw new NodeOperationError(
			this.getNode(),
			'Attaching contacts or a company needs a Batch Size of 1',
			{
				description:
					'amoCRM cannot relink a lead in the same request that updates it, so the node sends a second one. That is only possible while leads are updated one at a time.',
				itemIndex,
			},
		);
	}

	return await buildUpdatePayload.call(this, itemIndex);
}
