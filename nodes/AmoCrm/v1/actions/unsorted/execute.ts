import type { IDataObject, IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toUnixSeconds as parseTimestamp } from '../../helpers/dates';
import { buildCustomFieldsValues } from '../../helpers/customFields';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';

const ENDPOINT = '/api/v4/leads/unsorted';
const COLLECTION = 'unsorted';

/** amoCRM stores every moment as Unix seconds; n8n hands over an ISO string. */
function toUnixSeconds(value: unknown, label: string, node: INode): number | undefined {
	const parsed = parseTimestamp(value);
	if (typeof parsed !== 'string') return parsed;

	throw new NodeOperationError(node, `"${label}" is not a date amoCRM can read: ${parsed}`);
}

function isFilled(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

function splitList(raw: unknown): string[] {
	return String(raw ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

/**
 * The UID of an incoming lead is a 60-character hex string, not a number.
 *
 * It is worth checking here rather than letting the request go out: an empty or
 * numeric value produces a 404 whose message says nothing about which parameter was
 * wrong, and the mistake is usually an expression that resolved to an entity id.
 */
function readUid(this: IExecuteFunctions, itemIndex: number): string {
	const uid = String(this.getNodeParameter('uid', itemIndex, '') ?? '').trim();

	if (uid === '') {
		throw new NodeOperationError(this.getNode(), 'No incoming-lead UID was given', {
			itemIndex,
			description:
				'Take the UID from Get Many or from an Unsorted webhook. It is a long hexadecimal string, not the ID of the lead behind the item.',
		});
	}

	return uid;
}

function buildFormMetadata(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const node = this.getNode();
	const fields = this.getNodeParameter('formMetadata', itemIndex, {}) as IDataObject;
	const metadata: IDataObject = {};

	if (isFilled(fields.formId)) metadata.form_id = String(fields.formId);
	if (isFilled(fields.formName)) metadata.form_name = String(fields.formName);
	if (isFilled(fields.formPage)) metadata.form_page = String(fields.formPage);
	if (isFilled(fields.ip)) metadata.ip = String(fields.ip);
	if (isFilled(fields.referer)) metadata.referer = String(fields.referer);

	const sentAt = toUnixSeconds(fields.formSentAt, 'Sent At', node);
	metadata.form_sent_at = sentAt ?? Math.floor(Date.now() / 1000);

	return metadata;
}

function buildCallMetadata(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const node = this.getNode();
	const fields = this.getNodeParameter('sipMetadata', itemIndex, {}) as IDataObject;

	const calledAt = toUnixSeconds(
		this.getNodeParameter('calledAt', itemIndex, ''),
		'Called At',
		node,
	);

	const metadata: IDataObject = {
		uniq: String(this.getNodeParameter('uniq', itemIndex)),
		from: String(this.getNodeParameter('from', itemIndex)),
		// amoCRM's own example sends this as a number, but the field is documented as a
		// string and a leading + survives only as one.
		phone: String(this.getNodeParameter('phone', itemIndex)),
		duration: Number(this.getNodeParameter('duration', itemIndex, 0)),
		called_at: calledAt ?? Math.floor(Date.now() / 1000),
	};

	if (isFilled(fields.link)) metadata.link = String(fields.link);
	if (isFilled(fields.serviceCode)) metadata.service_code = String(fields.serviceCode);
	if (fields.isCallEventNeeded === true) metadata.is_call_event_needed = true;
	if (isFilled(fields.callResponsible)) metadata.call_responsible = fields.callResponsible;

	return metadata;
}

/** A phone or e-mail on the embedded contact, addressed by its account-wide code. */
function contactMultitext(code: string, value: unknown): IDataObject | undefined {
	if (!isFilled(value)) return undefined;

	return {
		field_code: code,
		values: [{ value: String(value), enum_code: 'WORK' }],
	};
}

function buildEmbedded(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const leadFields = this.getNodeParameter('leadFields', itemIndex, {}) as IDataObject;
	const contactFields = this.getNodeParameter('contactFields', itemIndex, {}) as IDataObject;
	const companyName = this.getNodeParameter('companyName', itemIndex, '') as string;

	const embedded: IDataObject = {};

	const lead: IDataObject = {};
	if (isFilled(leadFields.name)) lead.name = String(leadFields.name);
	if (isFilled(leadFields.price)) lead.price = Number(leadFields.price);

	const customFields = buildCustomFieldsValues(
		this.getNodeParameter('customFieldsUi', itemIndex, {}) as IDataObject,
		this.getNode(),
	);
	if (customFields.length > 0) lead.custom_fields_values = customFields;

	// Tags hang off the lead's own `_embedded`, one level deeper than every other field.
	const tagNames = [
		...(Array.isArray(leadFields.tags) ? leadFields.tags.map(String) : []),
		...splitList(leadFields.newTags),
	];
	const tags = [...new Set(tagNames)].map((name) =>
		/^\d+$/.test(name) ? { id: Number(name) } : { name },
	);
	if (tags.length > 0) lead._embedded = { tags };

	if (Object.keys(lead).length > 0) embedded.leads = [lead];

	const contact: IDataObject = {};
	if (isFilled(contactFields.name)) contact.name = String(contactFields.name);
	if (isFilled(contactFields.first_name)) contact.first_name = String(contactFields.first_name);
	if (isFilled(contactFields.last_name)) contact.last_name = String(contactFields.last_name);

	const contactValues = [
		contactMultitext('PHONE', contactFields.phone),
		contactMultitext('EMAIL', contactFields.email),
	].filter((entry): entry is IDataObject => entry !== undefined);

	if (contactValues.length > 0) contact.custom_fields_values = contactValues;
	if (Object.keys(contact).length > 0) embedded.contacts = [contact];

	if (isFilled(companyName)) embedded.companies = [{ name: String(companyName) }];

	return embedded;
}

async function executeCreate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = this.getNode();
	const category = this.getNodeParameter('category', itemIndex) as string;
	const additional = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;

	const payload: IDataObject = {
		source_uid: String(this.getNodeParameter('sourceUid', itemIndex)),
		source_name: String(this.getNodeParameter('sourceName', itemIndex)),
		metadata:
			category === 'sip'
				? buildCallMetadata.call(this, itemIndex)
				: buildFormMetadata.call(this, itemIndex),
	};

	if (isFilled(additional.pipelineId)) payload.pipeline_id = Number(additional.pipelineId);

	const createdAt = toUnixSeconds(additional.createdAt, 'Created At', node);
	if (createdAt !== undefined) payload.created_at = createdAt;

	const embedded = buildEmbedded.call(this, itemIndex);
	if (Object.keys(embedded).length > 0) payload._embedded = embedded;

	// Both create endpoints take a top-level array; a bare object is a 400.
	const response = (await amoCrmApiRequest.call(this, 'POST', `${ENDPOINT}/${category}`, [
		payload,
	])) as IDataObject | undefined;

	const embeddedResponse = (response?._embedded ?? {}) as IDataObject;
	const rows = (embeddedResponse[COLLECTION] ?? []) as IDataObject[];

	return rows.length === 0 ? [{ json: response ?? {} }] : rows.map((row) => ({ json: row }));
}

async function executeGet(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const uid = readUid.call(this, itemIndex);

	const response = (await amoCrmApiRequest.call(this, 'GET', `${ENDPOINT}/${uid}`)) as
		| IDataObject
		| undefined;

	if (response === undefined) {
		throw new NodeOperationError(this.getNode(), `amoCRM has no incoming lead with UID ${uid}`, {
			itemIndex,
			description:
				'An item that was accepted or declined is gone from Unsorted, and its UID stops resolving.',
		});
	}

	return [{ json: response }];
}

async function executeGetAll(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const filter: IDataObject = {};

	const uids = splitList(filters.uids);
	if (uids.length > 0) filter.uid = uids;

	const categories = (filters.categories ?? []) as string[];
	if (categories.length > 0) filter.category = categories;

	if (isFilled(filters.pipelineId)) filter.pipeline_id = Number(filters.pipelineId);

	const qs: IDataObject = {};
	if (Object.keys(filter).length > 0) qs.filter = filter;

	if (isFilled(options.orderBy)) {
		qs.order = { [String(options.orderBy)]: String(options.orderDirection ?? 'desc') };
	}

	const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);

	const rows = await amoCrmApiRequestAllItems.call(this, ENDPOINT, COLLECTION, qs, {
		limit,
		pageSize: limit === undefined ? 250 : Math.min(limit, 250),
	});

	return rows.map((row) => ({ json: row }));
}

async function executeAccept(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const uid = readUid.call(this, itemIndex);
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const body: IDataObject = {};
	if (isFilled(options.user_id)) body.user_id = Number(options.user_id);
	if (isFilled(options.status_id)) body.status_id = Number(options.status_id);

	const response = (await amoCrmApiRequest.call(
		this,
		'POST',
		`${ENDPOINT}/${uid}/accept`,
		body,
	)) as IDataObject | undefined;

	return [{ json: response ?? { uid, accepted: true } }];
}

async function executeDecline(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const uid = readUid.call(this, itemIndex);
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const body: IDataObject = {};
	if (isFilled(options.user_id)) body.user_id = Number(options.user_id);

	// Decline is a DELETE that carries a JSON body — unusual, but that is the route.
	const response = (await amoCrmApiRequest.call(
		this,
		'DELETE',
		`${ENDPOINT}/${uid}/decline`,
		body,
	)) as IDataObject | undefined;

	return [{ json: response ?? { uid, declined: true } }];
}

async function executeLink(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const uid = readUid.call(this, itemIndex);
	const entityType = this.getNodeParameter('entityType', itemIndex) as string;
	const entityId = String(this.getNodeParameter('entityId', itemIndex));
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const link: IDataObject = {
		entity_id: Number(entityId),
		entity_type: entityType,
	};

	if (isFilled(options.contactId)) link.metadata = { contact_id: Number(options.contactId) };

	const body: IDataObject = { link };
	if (isFilled(options.user_id)) body.user_id = Number(options.user_id);

	// Only a chats-category item can be linked, and only an administrator may do it:
	// anything else comes back as a 400 or 403 the API does not explain further.
	const response = (await amoCrmApiRequest.call(this, 'POST', `${ENDPOINT}/${uid}/link`, body)) as
		| IDataObject
		| undefined;

	return [{ json: response ?? { uid, linked: true } }];
}

async function executeSummary(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = this.getNode();
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	const filter: IDataObject = {};

	const uids = splitList(filters.uids);
	if (uids.length > 0) filter.uid = uids;

	if (isFilled(filters.pipelineId)) filter.pipeline_id = Number(filters.pipelineId);

	const createdRange: IDataObject = {};
	const from = toUnixSeconds(filters.createdFrom, 'Created After', node);
	const to = toUnixSeconds(filters.createdTo, 'Created Before', node);
	if (from !== undefined) createdRange.from = from;
	if (to !== undefined) createdRange.to = to;
	if (Object.keys(createdRange).length > 0) filter.created_at = createdRange;

	const qs: IDataObject = {};
	if (Object.keys(filter).length > 0) qs.filter = filter;

	const response = (await amoCrmApiRequest.call(
		this,
		'GET',
		`${ENDPOINT}/summary`,
		undefined,
		qs,
	)) as IDataObject | undefined;

	return [{ json: response ?? {} }];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'accept':
			return await executeAccept.call(this, itemIndex);
		case 'create':
			return await executeCreate.call(this, itemIndex);
		case 'decline':
			return await executeDecline.call(this, itemIndex);
		case 'get':
			return await executeGet.call(this, itemIndex);
		case 'getAll':
			return await executeGetAll.call(this, itemIndex);
		case 'link':
			return await executeLink.call(this, itemIndex);
		case 'summary':
			return await executeSummary.call(this, itemIndex);
		default:
			throw new NodeOperationError(
				this.getNode(),
				`The unsorted resource has no "${operation}" operation`,
				{ itemIndex },
			);
	}
}
