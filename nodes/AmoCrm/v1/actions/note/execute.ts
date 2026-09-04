import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toUnixSeconds } from '../../helpers/dates';
import { omitEmpty } from '../../helpers/query';
import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';
import {
	ENTITY_TYPE_PARAMETER,
	FILTER_ID_PARAMETERS,
	NOTE_TYPES,
	TARGET_ID_PARAMETERS,
} from './description';


function toNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function splitList(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
}

function readEntityType(this: IExecuteFunctions, itemIndex: number): string {
	const entityType = String(this.getNodeParameter(ENTITY_TYPE_PARAMETER, itemIndex, 'leads') ?? '');

	if (TARGET_ID_PARAMETERS[entityType] === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`"${entityType}" is not an entity type that has notes`,
			{
				itemIndex,
				description: 'Pick Lead, Contact, Company or Customer.',
			},
		);
	}

	return entityType;
}

function readEntityId(
	this: IExecuteFunctions,
	itemIndex: number,
	entityType: string,
	parameters: Record<string, string>,
): number | undefined {
	return toNumber(
		this.getNodeParameter(parameters[entityType], itemIndex, '', { extractValue: true }),
	);
}

function parseJsonParams(this: IExecuteFunctions, raw: unknown, itemIndex: number): IDataObject {
	if (raw === undefined || raw === null || raw === '') return {};
	if (typeof raw === 'object') return raw as IDataObject;

	try {
		return JSON.parse(String(raw)) as IDataObject;
	} catch {
		throw new NodeOperationError(this.getNode(), 'Params (JSON) is not valid JSON', { itemIndex });
	}
}

/**
 * Builds the `note_type` + `params` pair for one note.
 *
 * amoCRM gives every note type its own `params` shape, and sending the wrong keys
 * fails the whole request rather than the one field. So each type is assembled from
 * its own inputs here, and only the escape hatch hands raw JSON straight through.
 */
function buildNoteBody(
	this: IExecuteFunctions,
	itemIndex: number,
): { note_type: string; params: IDataObject } {
	const choice = String(this.getNodeParameter('noteType', itemIndex, 'common') ?? 'common');
	const read = (name: string): string => String(this.getNodeParameter(name, itemIndex, '') ?? '');

	if (choice === 'custom') {
		const noteType = read('customNoteType').trim();

		if (noteType === '') {
			throw new NodeOperationError(this.getNode(), 'The custom note type is empty', {
				itemIndex,
				description: 'Write the amoCRM note_type string, for example invoice_paid.',
			});
		}

		return {
			note_type: noteType,
			params: parseJsonParams.call(
				this,
				this.getNodeParameter('customParams', itemIndex, ''),
				itemIndex,
			),
		};
	}

	const noteType = NOTE_TYPES[choice];

	if (noteType === undefined) {
		throw new NodeOperationError(this.getNode(), `Unknown note type "${choice}"`, { itemIndex });
	}

	if (choice === 'callIn' || choice === 'callOut') {
		return {
			note_type: noteType,
			params: omitEmpty({
				uniq: read('uniq'),
				duration: toNumber(this.getNodeParameter('duration', itemIndex, 0)),
				source: read('source'),
				link: read('link'),
				phone: read('phone'),
				call_responsible: read('call_responsible'),
			}),
		};
	}

	if (choice === 'smsIn' || choice === 'smsOut') {
		return { note_type: noteType, params: omitEmpty({ text: read('text'), phone: read('phone') }) };
	}

	if (choice === 'serviceMessage' || choice === 'extendedServiceMessage') {
		return {
			note_type: noteType,
			params: omitEmpty({ service: read('service'), text: read('text') }),
		};
	}

	if (choice === 'messageCashier') {
		return {
			note_type: noteType,
			params: omitEmpty({ status: read('noteStatus'), text: read('text') }),
		};
	}

	if (choice === 'geolocation') {
		// Longitude and latitude are strings in amoCRM's own schema, numbers are refused.
		return {
			note_type: noteType,
			params: omitEmpty({
				text: read('text'),
				address: read('address'),
				longitude: read('longitude'),
				latitude: read('latitude'),
			}),
		};
	}

	if (choice === 'attachment') {
		return {
			note_type: noteType,
			params: omitEmpty({
				file_uuid: read('file_uuid'),
				version_uuid: read('version_uuid'),
				file_name: read('file_name'),
			}),
		};
	}

	return { note_type: noteType, params: { text: read('text') } };
}

function noteFields(fields: IDataObject): IDataObject {
	const payload: IDataObject = omitEmpty({
		created_by: toNumber(fields.created_by),
		responsible_user_id: toNumber(fields.responsible_user_id),
	});

	const createdAt = toUnixSeconds(fields.created_at);
	if (createdAt !== undefined) payload.created_at = createdAt;

	// The API default is true, so the flag is only worth sending when it is off.
	if (fields.suppressAutomations === true) payload.is_need_to_trigger_digital_pipeline = false;

	return payload;
}

/** Reads back what amoCRM echoes after a write — `{id, entity_id, _links}`, no more. */
function writtenNotes(response: IDataObject | undefined): INodeExecutionData[] {
	const embedded = (response?._embedded ?? {}) as IDataObject;
	const rows = (embedded.notes ?? []) as IDataObject[];

	return rows.map((row) => ({ json: row }));
}

function buildListQuery(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const filter: IDataObject = {};

	const ids = splitList(filters.ids);
	if (ids.length > 0) filter.id = ids;

	const chosen = ((filters.noteTypes ?? []) as string[]).map((value) => NOTE_TYPES[value] ?? value);
	const noteTypes = [...chosen, ...splitList(filters.otherNoteTypes)];
	if (noteTypes.length > 0) filter.note_type = noteTypes;

	const updatedFrom = toUnixSeconds(filters.updated_at_from);
	const updatedTo = toUnixSeconds(filters.updated_at_to);
	if (updatedFrom !== undefined || updatedTo !== undefined) {
		filter.updated_at = omitEmpty({ from: updatedFrom, to: updatedTo });
	}

	// The only value `with` takes on notes, and the only way to see whether a note
	// is pinned — the field is simply absent from the response otherwise.
	const qs: IDataObject = { with: 'is_pinned' };
	if (Object.keys(filter).length > 0) qs.filter = filter;

	if (options.sortBy !== undefined && options.sortBy !== '') {
		qs.order = { [String(options.sortBy)]: String(options.sortOrder ?? 'desc') };
	}

	return qs;
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const entityType = readEntityType.call(this, itemIndex);

	if (operation === 'create') {
		const entityId = readEntityId.call(this, itemIndex, entityType, TARGET_ID_PARAMETERS);

		if (entityId === undefined) {
			throw new NodeOperationError(this.getNode(), 'No card was picked for the note', {
				itemIndex,
				description: 'A note always belongs to one lead, contact, company or customer.',
			});
		}

		const payload: IDataObject = {
			...buildNoteBody.call(this, itemIndex),
			...noteFields(this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject),
		};

		// The nested form takes entity_id from the path, so it cannot disagree with the body.
		const response = (await amoCrmApiRequest.call(
			this,
			'POST',
			`/api/v4/${entityType}/${entityId}/notes`,
			[payload],
		)) as IDataObject | undefined;

		return writtenNotes(response);
	}

	if (operation === 'update') {
		const noteId = toNumber(this.getNodeParameter('noteId', itemIndex, ''));

		if (noteId === undefined) {
			throw new NodeOperationError(this.getNode(), 'The note ID is missing', { itemIndex });
		}

		const payload: IDataObject = {
			id: noteId,
			...buildNoteBody.call(this, itemIndex),
			...noteFields(this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject),
		};

		// The batch form is used for a single note too: the `/{entity_id}/notes/{id}`
		// route would need an entity id the user has no reason to know here.
		const response = (await amoCrmApiRequest.call(this, 'PATCH', `/api/v4/${entityType}/notes`, [
			payload,
		])) as IDataObject | undefined;

		return writtenNotes(response);
	}

	if (operation === 'get') {
		const noteId = toNumber(this.getNodeParameter('noteId', itemIndex, ''));

		if (noteId === undefined) {
			throw new NodeOperationError(this.getNode(), 'The note ID is missing', { itemIndex });
		}

		const note = (await amoCrmApiRequest.call(
			this,
			'GET',
			`/api/v4/${entityType}/notes/${noteId}`,
			undefined,
			{ with: 'is_pinned' },
		)) as IDataObject | undefined;

		return note === undefined ? [] : [{ json: note }];
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);

		const entityId = readEntityId.call(this, itemIndex, entityType, FILTER_ID_PARAMETERS);
		const endpoint =
			entityId === undefined
				? `/api/v4/${entityType}/notes`
				: `/api/v4/${entityType}/${entityId}/notes`;

		const rows = await amoCrmApiRequestAllItems.call(
			this,
			endpoint,
			'notes',
			buildListQuery.call(this, itemIndex),
			{ limit },
		);

		return rows.map((row) => ({ json: row }));
	}

	throw new NodeOperationError(this.getNode(), `Unknown note operation "${operation}"`, {
		itemIndex,
	});
}
