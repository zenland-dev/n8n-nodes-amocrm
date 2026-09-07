import type { INodeProperties } from 'n8n-workflow';

/** The sentence n8n's linter requires on every dropdown backed by a load method. */
export const DYNAMIC_OPTIONS_DESCRIPTION =
	'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>';

/**
 * The editor for amoCRM custom fields.
 *
 * The field picker returns `id::type`, a hidden sibling pulls the type back out of
 * it, and every value input below is shown only for the types it fits. So picking
 * "Budget approved" gives a checkbox, "Delivery date" gives a date picker, and
 * "Region" gives that field's own list of options — read live from the account.
 *
 * The alternative, one free-text box for every field type, is what makes most CRM
 * integrations unpleasant: the user has to know that a date wants Unix seconds and
 * a select wants an enum id.
 */
export function customFieldsDescription(
	displayOptions: INodeProperties['displayOptions'],
	loadOptionsMethod = 'getCustomFields',
	// One operation may write more than one entity — a lead together with its contact
	// and company — and each of them has its own fields, so both the parameter name
	// and the label have to be sayable. `customFieldsUi` stays the default: it is the
	// name already stored in people's workflows.
	options: { name?: string; displayName?: string; placeholder?: string; fieldEntity?: string } = {},
): INodeProperties {
	return {
		displayName: options.displayName ?? 'Custom Fields',
		name: options.name ?? 'customFieldsUi',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: options.placeholder ?? 'Add Custom Field',
		default: {},
		displayOptions,
		description: 'Values for the custom fields configured in your amoCRM account',
		options: [
			{
				name: 'field',
				displayName: 'Field',
				/* eslint-disable n8n-nodes-base/node-param-fixed-collection-type-unsorted-items --
				   The order below is the order the user fills things in: pick a field, then fill
				   the one input that matches its type. Alphabetising would put "Clear Field"
				   above the field picker and scatter the value inputs between unrelated ones. */
				values: [
					{
						displayName: 'Field Name or ID',
						name: 'fieldId',
						type: 'options',
						typeOptions: { loadOptionsMethod },
						default: '',
						required: true,
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. The option value is composite — <code>fieldId::fieldType</code>, for example <code>123456::select</code> — because the type half decides which value input appears below. A bare numeric ID leaves that input hidden and the value is written as plain text, which is wrong for dates, selects and multiselects.',
					},
					{
						// Carries the amoCRM field type across to the inputs below. It is
						// derived from the picker rather than fetched, so switching fields
						// re-draws the editor without another API call.
						displayName: 'Field Type',
						name: 'fieldType',
						type: 'hidden',
						default: '={{ $parameter["&fieldId"].split("::")[1] }}',
					},
					// Which dictionary the picked field came from. Without it the option
					// list beside the picker is looked up by the node's *resource*, which
					// is right only when the entity being written is the resource itself —
					// a lead's own fields under Lead. It is wrong for the contact and the
					// company written inside a complex lead, and for unsorted, whose
					// resource name maps to no dictionary at all: the field would be
					// searched for in the wrong list, found nowhere, and its options would
					// come back empty with no error to say why.
					// Always present, and empty where the caller says nothing: an empty value
					// reads as "not stated" and the lookup falls back to the resource, which
					// is what every editor written before this did.
					/* eslint-disable-next-line n8n-nodes-base/node-param-default-missing --
					   The default is here, but it is the argument this factory was called
					   with rather than a literal, and the rule only recognises literals. */
					{
						displayName: 'Field Entity',
						name: 'fieldEntity',
						type: 'hidden',
						default: options.fieldEntity ?? '',
					},
					{
						displayName: 'Value',
						name: 'stringValue',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								fieldType: [
									'',
									'text',
									'textarea',
									'url',
									'streetaddress',
									'price',
									'monetary',
									'tracking_data',
								],
							},
						},
					},
					{
						displayName: 'Value',
						name: 'numberValue',
						type: 'number',
						default: 0,
						displayOptions: { show: { fieldType: ['numeric'] } },
					},
					{
						displayName: 'Value',
						name: 'booleanValue',
						type: 'boolean',
						default: false,
						displayOptions: { show: { fieldType: ['checkbox'] } },
					},
					{
						displayName: 'Value',
						name: 'dateValue',
						type: 'dateTime',
						default: '',
						displayOptions: { show: { fieldType: ['date', 'date_time', 'birthday'] } },
						description: 'Sent to amoCRM as a Unix timestamp',
					},
					{
						displayName: 'Option Name or ID',
						name: 'enumValue',
						type: 'options',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						typeOptions: {
							loadOptionsMethod: 'getCustomFieldEnums',
							loadOptionsDependsOn: ['&fieldId'],
						},
						default: '',
						displayOptions: { show: { fieldType: ['select', 'radiobutton', 'category'] } },
					},
					{
						displayName: 'Option Names or IDs',
						name: 'enumValues',
						type: 'multiOptions',
						description:
							'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						typeOptions: {
							loadOptionsMethod: 'getCustomFieldEnums',
							loadOptionsDependsOn: ['&fieldId'],
						},
						default: [],
						displayOptions: { show: { fieldType: ['multiselect'] } },
					},
					{
						displayName: 'Values',
						name: 'multitextValues',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						placeholder: 'Add Value',
						default: {},
						displayOptions: { show: { fieldType: ['multitext'] } },
						description:
							'Phone numbers, e-mail addresses or messenger handles. Sending this replaces every value the field currently holds.',
						options: [
							{
								name: 'entry',
								displayName: 'Entry',
								values: [
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
									},
									{
										displayName: 'Kind',
										name: 'enumCode',
										type: 'string',
										default: '',
										placeholder: 'WORK',
										description:
											'The amoCRM enum code for this value: WORK, WORKDD, MOB, FAX, HOME or OTHER for phones; WORK, PRIV or OTHER for e-mail',
									},
								],
							},
						],
					},
					{
						displayName: 'Address',
						name: 'addressValue',
						type: 'collection',
						placeholder: 'Add Address Part',
						default: {},
						displayOptions: { show: { fieldType: ['smart_address'] } },
						options: [
							{ displayName: 'Address Line 1', name: 'addressLine1', type: 'string', default: '' },
							{ displayName: 'Address Line 2', name: 'addressLine2', type: 'string', default: '' },
							{ displayName: 'City', name: 'city', type: 'string', default: '' },
							{
								displayName: 'Country',
								name: 'country',
								type: 'string',
								default: '',
								placeholder: 'RU',
								description: 'Two-letter ISO country code',
							},
							{ displayName: 'State', name: 'state', type: 'string', default: '' },
							{ displayName: 'ZIP', name: 'zip', type: 'string', default: '' },
						],
					},
					{
						displayName: 'Linked Elements',
						name: 'chainedValues',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						placeholder: 'Add Element',
						default: {},
						displayOptions: { show: { fieldType: ['chained_list'] } },
						description: 'Up to five list elements; anything beyond the fifth is ignored',
						options: [
							{
								name: 'entry',
								displayName: 'Element',
								values: [
									{
										displayName: 'List Name or ID',
										name: 'catalogId',
										type: 'options',
										description:
											'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
										typeOptions: { loadOptionsMethod: 'getCatalogs' },
										default: '',
									},
									{
										displayName: 'Element Name or ID',
										name: 'catalogElementId',
										type: 'options',
										description:
											'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
										typeOptions: {
											loadOptionsMethod: 'getCatalogElements',
											loadOptionsDependsOn: ['&catalogId'],
										},
										default: '',
									},
								],
							},
						],
					},
					{
						displayName: 'Value (JSON)',
						name: 'jsonValue',
						type: 'json',
						default: '',
						displayOptions: {
							show: {
								fieldType: ['legal_entity', 'items', 'linked_entity', 'file', 'payer', 'supplier'],
							},
						},
						description:
							'This amoCRM field type carries a structured object. Send it exactly as documented for the field type, without the surrounding "values" wrapper.',
					},
					/* eslint-enable n8n-nodes-base/node-param-fixed-collection-type-unsorted-items */
					{
						displayName: 'Clear Field',
						name: 'clearValue',
						type: 'boolean',
						default: false,
						description:
							'Whether to erase every value this field currently holds. Overrides the value above.',
					},
				],
			},
		],
	};
}
