import type { INodeProperties, INodePropertyCollection } from 'n8n-workflow';
import { deepCopy } from 'n8n-workflow';

import { returnAllProperties, simplifyProperty } from '../../descriptions/common';
import { customFieldsDescription } from '../../descriptions/customFields';

/** Scopes a property to this resource and to the operations it belongs to. */
function showFor(operations: string[]): INodeProperties['displayOptions'] {
	return { show: { resource: ['catalogElement'], operation: operations } };
}

/**
 * The custom-field editor, bound to the chosen list.
 *
 * Every other entity in amoCRM has one fixed field dictionary, so the shared editor
 * fetches it once when the panel opens. A list element does not: its fields live at
 * `/catalogs/{catalogId}/custom_fields`, and the dictionary changes the moment the
 * user picks a different list. Declaring the dependency is what makes the editor
 * refetch instead of offering the previous list's fields — and it is also what lets
 * the front end resolve an expression in the Catalog field before asking for them.
 */
function catalogCustomFields(displayOptions: INodeProperties['displayOptions']): INodeProperties {
	const editor = deepCopy(customFieldsDescription(displayOptions, 'getCustomFields'));
	const sections = (editor.options ?? []) as INodePropertyCollection[];

	for (const value of sections[0]?.values ?? []) {
		const typeOptions = value.typeOptions;
		if (typeOptions?.loadOptionsMethod === undefined) continue;

		value.typeOptions = {
			...typeOptions,
			loadOptionsDependsOn: [...(typeOptions.loadOptionsDependsOn ?? []), 'catalogId'],
		};
	}

	return editor;
}

/**
 * Which element to work with, searched inside the chosen list.
 *
 * A list can hold thousands of rows, so this is a searchable picker rather than a
 * dropdown: amoCRM's own `query=` does the matching server-side. There is no "By URL"
 * mode — amoCRM documents no address for a single element, and a mode that validates
 * links it cannot resolve is worse than no mode at all.
 */
const elementLocator: INodeProperties = {
	displayName: 'Element',
	name: 'elementId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	displayOptions: showFor(['get', 'update']),
	description: 'The list element to work with',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'searchCatalogElements',
				searchable: true,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			// Empty has to pass: n8n validates a mode against whatever the field holds and
			// does not look at `required` first, so an untouched optional picker would
			// report an error before anything is typed. See descriptions/common.ts.
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '^[0-9]*$',
						errorMessage: 'An amoCRM id is a number',
					},
				},
			],
		},
	],
};

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getAll',
		displayOptions: { show: { resource: ['catalogElement'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a catalog element',
				description: 'Add an element to a list',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a catalog element',
				description: 'Retrieve one element of a list',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many catalog elements',
				description: 'Retrieve the elements of a list',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a catalog element',
				description: 'Change the name or the field values of an element',
			},
		],
	},
	{
		displayName: 'Catalog Name or ID',
		name: 'catalogId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getCatalogs' },
		default: '',
		required: true,
		displayOptions: { show: { resource: ['catalogElement'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName:
			'In the products list an element is a product: SKU, Description, Price and Group are its built-in fields. In the invoices list an element is an invoice, that list often refuses elements added from outside the invoices widget, and the answer carries a link to the printable invoice.',
		name: 'catalogKindNotice',
		type: 'notice',
		default: '',
		displayOptions: showFor(['create', 'update']),
	},
	elementLocator,
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['create']),
		description: 'Name of the element, shown wherever amoCRM lists it',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: showFor(['update']),
		description:
			'New name for the element. Leave it empty to keep the current one; amoCRM documents the name as required on a write, so fill it in if a field-only update is refused.',
	},
	catalogCustomFields(showFor(['create', 'update'])),
	...returnAllProperties(showFor(['getAll'])),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor(['getAll']),
		options: [
			{
				displayName: 'Element IDs',
				name: 'elementIds',
				type: 'string',
				default: '',
				placeholder: '525439,525440',
				description: 'Comma-separated IDs of the elements to return',
			},
			{
				displayName: 'Search Query',
				name: 'query',
				type: 'string',
				default: '',
				description: 'Free-text search across every filled field of the elements',
			},
		],
	},
	{
		displayName: 'Include Invoice Link',
		name: 'includeInvoiceLink',
		type: 'boolean',
		default: false,
		displayOptions: showFor(['get', 'getAll']),
		description:
			'Whether to ask amoCRM for the address of the printable invoice. Only elements of the invoices list have one; every other list answers with null.',
	},
	simplifyProperty(showFor(['create', 'get', 'getAll', 'update'])),
];
