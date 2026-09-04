import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { amoCrmApiRequest, amoCrmApiRequestAllItems } from '../../transport';
import { SOURCE_PARAMETERS, TARGET_ENTITY_TYPES, TARGET_PARAMETERS } from './description';

export { description } from './description';

interface LinkSource {
	entity: string;
	entityId: string;
}

interface LinkTarget {
	/** The option the user picked, which is not always the API spelling. */
	choice: string;
	apiType: string;
	toEntityId: number;
	catalogId?: number;
}

/** Reads a resourceLocator and refuses anything that is not an amoCRM id. */
function readId(
	context: IExecuteFunctions,
	parameter: string,
	itemIndex: number,
	label: string,
): string {
	const raw = context.getNodeParameter(parameter, itemIndex, '', { extractValue: true });
	const id = String(raw ?? '').trim();

	if (!/^[0-9]+$/.test(id)) {
		throw new NodeOperationError(context.getNode(), `${label} is missing or not an amoCRM id`, {
			itemIndex,
			description: `Received "${id}". Pick the entity from the list, or pass its numeric id.`,
		});
	}

	return id;
}

function readSource(context: IExecuteFunctions, itemIndex: number): LinkSource {
	const entity = String(context.getNodeParameter('entityType', itemIndex, 'leads'));
	const parameter = SOURCE_PARAMETERS[entity];

	if (parameter === undefined) {
		throw new NodeOperationError(context.getNode(), `"${entity}" cannot be the owner of a link`, {
			itemIndex,
			description:
				'Links are read and written from leads, contacts, companies and customers. A catalog element can only be the other side.',
		});
	}

	return { entity, entityId: readId(context, parameter, itemIndex, 'The entity to link from') };
}

function readTarget(context: IExecuteFunctions, itemIndex: number): LinkTarget {
	const choice = String(context.getNodeParameter('toEntityType', itemIndex, 'contacts'));
	const apiType = TARGET_ENTITY_TYPES[choice];
	const parameter = TARGET_PARAMETERS[choice];

	if (apiType === undefined || parameter === undefined) {
		throw new NodeOperationError(context.getNode(), `"${choice}" is not a linkable entity type`, {
			itemIndex,
		});
	}

	const target: LinkTarget = {
		choice,
		apiType,
		toEntityId: Number(readId(context, parameter, itemIndex, 'The entity to link to')),
	};

	if (choice === 'catalogElements') {
		const catalogId = Number(context.getNodeParameter('catalogId', itemIndex, 0));

		// amoCRM needs the catalog id to unlink an element as well as to link one —
		// without it the unlink fails with a validation error that names no field.
		if (!Number.isFinite(catalogId) || catalogId <= 0) {
			throw new NodeOperationError(
				context.getNode(),
				'A catalog element link needs the catalog it belongs to',
				{ itemIndex, description: 'Choose a catalog above, both for Link and for Unlink.' },
			);
		}

		target.catalogId = catalogId;
	}

	return target;
}

function buildMetadata(
	context: IExecuteFunctions,
	itemIndex: number,
	target: LinkTarget,
	operation: string,
): IDataObject | undefined {
	const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const metadata: IDataObject = {};

	if (target.catalogId !== undefined) {
		metadata.catalog_id = target.catalogId;

		if (operation === 'link') {
			const quantity = Number(context.getNodeParameter('quantity', itemIndex, 0));
			if (Number.isFinite(quantity) && quantity > 0) metadata.quantity = quantity;

			const priceId = Number(options.priceId ?? 0);
			if (Number.isFinite(priceId) && priceId > 0) metadata.price_id = priceId;
		}
	}

	if (operation === 'link' && target.choice === 'contacts') {
		// Sent only when switched on: amoCRM makes the first contact of an entity the
		// main one by itself, and an explicit false is not documented to undo that.
		if (context.getNodeParameter('isMain', itemIndex, false) === true) metadata.is_main = true;
	}

	const updatedBy = options.updatedBy;
	if (updatedBy !== undefined && updatedBy !== '') metadata.updated_by = Number(updatedBy);

	return Object.keys(metadata).length === 0 ? undefined : metadata;
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const source = readSource(this, itemIndex);
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;

	const filter: IDataObject = {};
	const choice = String(filters.toEntityType ?? '');
	if (choice !== '') filter.to_entity_type = TARGET_ENTITY_TYPES[choice] ?? choice;

	const toEntityId = String(filters.toEntityId ?? '').trim();
	if (toEntityId !== '') {
		if (filter.to_entity_type === undefined) {
			throw new NodeOperationError(
				this.getNode(),
				'Filtering by a linked entity ID also needs its type',
				{
					itemIndex,
					description:
						'amoCRM accepts filter[to_entity_id] only together with filter[to_entity_type].',
				},
			);
		}

		filter.to_entity_id = Number(toEntityId);
	}

	if (filters.toCatalogId !== undefined && filters.toCatalogId !== '') {
		filter.to_catalog_id = Number(filters.toCatalogId);
	}

	const qs: IDataObject = Object.keys(filter).length === 0 ? {} : { filter };

	const rows = await amoCrmApiRequestAllItems.call(
		this,
		`/api/v4/${source.entity}/${source.entityId}/links`,
		'links',
		qs,
		{ limit: returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number) },
	);

	// This form of the endpoint leaves `entity_id` / `entity_type` out of every row,
	// which makes the links of several entities indistinguishable once merged into
	// one stream. They are put back in front, where the API's own values still win.
	return rows.map((row) => ({
		json: { entity_id: Number(source.entityId), entity_type: source.entity, ...row },
	}));
}

async function link(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const source = readSource(this, itemIndex);
	const target = readTarget(this, itemIndex);

	const entry: IDataObject = { to_entity_id: target.toEntityId, to_entity_type: target.apiType };
	const metadata = buildMetadata(this, itemIndex, target, 'link');
	if (metadata !== undefined) entry.metadata = metadata;

	const response = (await amoCrmApiRequest.call(
		this,
		'POST',
		`/api/v4/${source.entity}/${source.entityId}/link`,
		[entry],
	)) as IDataObject | undefined;

	const embedded = (response?._embedded ?? {}) as IDataObject;
	const rows = (embedded.links ?? []) as IDataObject[];

	if (rows.length === 0) {
		return [{ json: { entity_id: Number(source.entityId), entity_type: source.entity, ...entry } }];
	}

	return rows.map((json) => ({ json }));
}

async function unlink(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const source = readSource(this, itemIndex);
	const target = readTarget(this, itemIndex);

	const entry: IDataObject = { to_entity_id: target.toEntityId, to_entity_type: target.apiType };
	const metadata = buildMetadata(this, itemIndex, target, 'unlink');
	if (metadata !== undefined) entry.metadata = metadata;

	// Unlink answers 204 with an empty body, so there is nothing to pass on but the
	// fact that it worked — and what it was that got detached.
	await amoCrmApiRequest.call(this, 'POST', `/api/v4/${source.entity}/${source.entityId}/unlink`, [
		entry,
	]);

	return [
		{
			json: {
				success: true,
				entity_id: Number(source.entityId),
				entity_type: source.entity,
				...entry,
			},
		},
	];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getAll') return await getAll.call(this, itemIndex);
	if (operation === 'link') return await link.call(this, itemIndex);
	if (operation === 'unlink') return await unlink.call(this, itemIndex);

	throw new NodeOperationError(this.getNode(), `Unknown link operation "${operation}"`, {
		itemIndex,
	});
}
