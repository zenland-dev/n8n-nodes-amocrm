import type { INodeProperties } from 'n8n-workflow';

import { DYNAMIC_OPTIONS_DESCRIPTION } from './customFields';

export { DYNAMIC_OPTIONS_DESCRIPTION };

/** "Return All" plus the limit that appears when it is off. */
export function returnAllProperties(
	displayOptions: INodeProperties['displayOptions'],
): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			displayOptions,
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			displayOptions: {
				...displayOptions,
				show: { ...displayOptions?.show, returnAll: [false] },
			},
			description: 'Max number of results to return',
		},
	];
}

/** Flattens `custom_fields_values` into a readable object beside the entity. */
export function simplifyProperty(
	displayOptions: INodeProperties['displayOptions'],
): INodeProperties {
	return {
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: false,
		displayOptions,
		description:
			'Whether to add a readable "custom_fields" object next to the raw custom_fields_values array',
	};
}

export type EntityKind = 'lead' | 'contact' | 'company' | 'customer';

const ENTITY_LABELS: Record<EntityKind, { label: string; method: string; path: string }> = {
	lead: { label: 'Lead', method: 'searchLeads', path: 'leads' },
	contact: { label: 'Contact', method: 'searchContacts', path: 'contacts' },
	company: { label: 'Company', method: 'searchCompanies', path: 'companies' },
	customer: { label: 'Customer', method: 'searchCustomers', path: 'customers' },
};

/**
 * A picker for one entity, searchable against the live account.
 *
 * A CRM id is meaningless to a person, so the "From list" mode searches amoCRM by
 * name as the user types. "By ID" stays for expressions and for ids that came from
 * an earlier node, and "By URL" accepts a link pasted straight out of the browser —
 * which is how a person actually identifies a lead they are looking at.
 */
export function entityLocator(
	kind: EntityKind,
	name: string,
	displayOptions: INodeProperties['displayOptions'],
	options: { required?: boolean; description?: string } = {},
): INodeProperties {
	const entity = ENTITY_LABELS[kind];

	return {
		displayName: entity.label,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: options.required ?? true,
		displayOptions,
		description: options.description ?? `The ${entity.label.toLowerCase()} to work with`,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: entity.method,
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[0-9]+$',
							errorMessage: 'An amoCRM id is a number',
						},
					},
				],
			},
			{
				displayName: 'By URL',
				name: 'url',
				type: 'string',
				placeholder: `https://mycompany.amocrm.ru/${entity.path}/detail/12345`,
				// The entity segment is what makes the URL identify a lead rather than a
				// contact, so it is required. An earlier `|detail` alternative made
				// every `/…/detail/<id>` link match, which quietly accepted a contact
				// URL in a lead field and then operated on the contact's id.
				extractValue: {
					type: 'regex',
					regex: `/${entity.path}/(?:detail/)?([0-9]+)`,
				},
				validation: [
					{
						type: 'regex',
						properties: {
							regex: `.*/${entity.path}/(?:detail/)?[0-9]+.*`,
							errorMessage: `Not an amoCRM ${entity.label.toLowerCase()} URL`,
						},
					},
				],
			},
		],
	};
}

/**
 * How many input items to send in one amoCRM write.
 *
 * The default of 1 keeps the obvious behaviour — one item in, one request out, one
 * result back. Raising it trades that clarity for speed: amoCRM takes up to 250
 * entities per request but recommends 50, because a gateway timeout on a large
 * batch leaves you unable to tell what was saved.
 */
export function batchSizeProperty(
	displayOptions: INodeProperties['displayOptions'],
): INodeProperties {
	return {
		displayName: 'Batch Size',
		name: 'batchSize',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 250 },
		default: 1,
		displayOptions,
		description:
			'How many input items to send in a single request. Leave at 1 to send them one at a time; 50 is amoCRM\'s recommended maximum for bulk writes.',
	};
}

/** Responsible-user dropdown, loaded from the account. */
export function responsibleUserProperty(
	displayOptions: INodeProperties['displayOptions'],
	name = 'responsible_user_id',
): INodeProperties {
	return {
		displayName: 'Responsible User Name or ID',
		name,
		type: 'options',
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		typeOptions: { loadOptionsMethod: 'getUsers' },
		default: '',
		displayOptions,
	};
}
