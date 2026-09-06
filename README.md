# n8n-nodes-amocrm

amoCRM (Kommo) nodes for [n8n](https://n8n.io) — with dropdowns that read your own account.

Pipelines, stages, users, tags, catalogs and every custom field you have configured are loaded
live from the account the credential points at. You pick "Won" from a list instead of remembering
that it is status `142`, and a custom field renders the input its type deserves: a checkbox for a
flag, a date picker for a date, your own list of options for a select.

[![npm](https://img.shields.io/npm/v/@zenland-dev/n8n-nodes-amocrm.svg)](https://www.npmjs.com/package/@zenland-dev/n8n-nodes-amocrm)

## Contents

- [Installation](#installation)
- [Credentials](#credentials)
- [Nodes](#nodes)
- [Using this node with an AI agent](#using-this-node-with-an-ai-agent)
- [What makes this node different](#what-makes-this-node-different)
- [amoCRM behaviour worth knowing](#amocrm-behaviour-worth-knowing)
- [Compatibility](#compatibility)
- [Development](#development)
- [Feedback and bugs](#feedback-and-bugs)
- [Licence](#licence)

## Installation

In n8n, go to **Settings → Community nodes → Install** and enter:

```
@zenland-dev/n8n-nodes-amocrm
```

Or install it into a self-hosted instance by hand:

```bash
npm install @zenland-dev/n8n-nodes-amocrm
```

## Credentials

amoCRM offers two ways in. Both are supported; pick by how many accounts you need to reach.

### Access token — recommended for a single account

A long-lived token from a private integration. It does not rotate, so there is nothing to refresh
and nothing to break at three in the morning.

1. Sign in to amoCRM **as an administrator**.
2. **Settings → Integrations → Create integration**, and choose a private integration.
3. Fill in the form and save. Leaving the access checkboxes untouched grants every scope; tick
   **Files** as well if you plan to upload attachments.
4. Open the integration card's **Keys and scopes** tab and generate a long-lived token.
5. In n8n, create an **amoCRM Access Token API** credential:
   - **Subdomain** — the part in front of the domain: `mycompany` for `mycompany.amocrm.ru`.
   - **Domain** — pick `amocrm.ru`, `amocrm.com` or `kommo.com`.
   - **Access Token** — the token you just generated.
   - **Requests per Second** — leave at 7 unless your account has a paid limit add-on.

The token has an expiry date you chose when generating it, up to five years. Anyone holding it has
your whole account until then, so treat it like a password.

> **The address is a subdomain plus a fixed domain on purpose.** A credential holds a secret that
> n8n attaches to every request it makes with it, and whoever may edit that credential decides
> where those requests go — without ever seeing the secret, which n8n masks on read and restores on
> save. A free-form address would therefore be enough to walk the token out of the building. Here
> the domain comes from a closed list, the subdomain is reduced to the characters a host may
> contain, and the same rule is applied again in the node's own code. These credentials are also
> pinned so they cannot be selected in an HTTP Request node.

### OAuth2 — for integrations serving several accounts

1. Create the integration in amoCRM with **"Available for everyone"** ticked.
2. Copy n8n's **OAuth Redirect URL** from the credential screen into the integration's Redirect URI.
3. In n8n, create an **amoCRM OAuth2 API** credential, fill in **Subdomain**, **Domain**, Client ID
   and Client Secret, then click **Connect**.

The address must be filled in *before* connecting: amoCRM hosts its token endpoint on the
account's own domain, so n8n cannot build the request without it.

> amoCRM has no per-request scopes. What the integration may touch is chosen on the integration
> card inside amoCRM, not by n8n.

## Nodes

### amoCRM

| Resource | Operations |
| --- | --- |
| Lead | Create · Get · Get Many · Update |
| Contact | Create · Get · Get Many · Update |
| Company | Create · Get · Get Many · Update |
| Customer | Create · Get · Get Many · Update |
| Task | Create · Complete · Get · Get Many · Update |
| Note | Create · Get · Get Many · Update |
| Tag | Create · Get Many |
| Link | Link · Unlink · Get Many |
| Call | Create |
| Event | Get · Get Many |
| Unsorted | Create · Get · Get Many · Accept · Decline · Link · Get Summary |
| Catalog | Create · Get · Get Many · Update |
| Catalog Element | Create · Get · Get Many · Update |
| Pipeline | Create · Get · Get Many · Update · Delete — and the same five for stages |
| Custom Field | Create · Get · Get Many · Update · Delete — and the same five for field groups |
| User | Get · Get Many |
| Account | Get |
| Webhook | Subscribe · Unsubscribe · Get Many |
| File | Upload · Attach to Entity · Add as Note · Download · Get · Get Many · Get Linked Entities · Detach From Entity · Delete |
| Salesbot | Run · Stop · Get · Get Many |
| Custom Request | Request |

Eighty-eight operations across twenty-one resources.

> **There is no Delete for leads, contacts or companies** — API v4 has no such route.
> amoCRM's own interface deletes them through a session-authenticated endpoint no
> integration can use. A node offering "Delete" here would have to do something else
> and call it deletion, so this one does not offer it.

Create and Update on leads, contacts, companies and customers, Create, Update and Complete on
tasks, and Create on calls, accept a **Batch Size**: raise it and the node groups input items into single requests.

**Custom Request** is the release valve: any path, any method, through the same authenticated and
rate-limited transport. Anything amoCRM adds tomorrow is reachable today.

### amoCRM Trigger

Subscribes to amoCRM webhooks when the workflow is activated and unsubscribes when it is
deactivated. Events cover leads, contacts, companies, customers, tasks, notes, talks and messages.

amoCRM posts webhooks as `application/x-www-form-urlencoded` with PHP-style bracket keys
(`leads[status][0][id]=123`), not as JSON. The trigger decodes that into ordinary nested JSON, and
by default emits one item per changed entity rather than one per HTTP request — which is what a
workflow almost always wants to iterate over.

## Using this node with an AI agent

The node is exposed to n8n's AI Agent as a tool, and on n8n 2.x nothing has to be switched on
for that. The tool name a model sees is the operation's action — *Create a lead in amoCRM*,
*Get many tasks in amoCRM*, and so on. Four things decide whether it gets the call right.

**Pin Resource and Operation yourself, and let the model fill only the data fields.** n8n will
accept a `$fromAI()` placeholder on Resource and Operation, but the model then receives a
free-form string with no list of the twenty-one resources or eighty-eight operations to choose
from, and it will invent values like `catalog_element`. One node per operation you want to
expose is the shape that works — and it is the same shape an MCP Server Trigger needs, one
tool per node.

**Turn Simplify on when a model reads the output.** amoCRM returns custom fields as
`custom_fields_values: [{ field_id: 123456, values: [{ value: "…" }] }]`, which forces the model
to decode the account's field ids to make sense of a record. Simplify adds a flat
`custom_fields` object keyed by field name alongside the raw array. It is off by default
because it changes the shape of the output.

**Leave the entity pickers in their list mode** so a name resolves to an id on its own, and
switch a picker to *By ID* only when the id genuinely comes from earlier data. Pipeline, stage,
responsible user, tag and custom field ids differ from account to account — they are not
guessable, and a model asked for one will guess.

**Custom fields take a composite value.** The field picker's value is `fieldId::fieldType`, for
example `123456::select`, and the type half is what makes the matching value input appear. A
bare numeric id leaves that input hidden and the value is written as plain text — harmless for
a text field, wrong for a date, a select or a multiselect.

## What makes this node different

**Dropdowns read your account.** Pipelines, stages (scoped to the pipeline you picked), users,
task types, loss reasons, tags, catalogs, catalog elements, event types, customer statuses and
segments — all loaded from the live account, all cached briefly so that opening a node does not
spend your API budget.

**Custom fields get a real editor.** The field picker carries the field's type with it, so the
value input below changes to match: a checkbox for a flag, a date picker for a date, a
multi-select of your own options for a multi-select, a component-by-component form for an address.
Structured types amoCRM defines but no form can draw — legal entities, invoice items, files — take
JSON, and everything else is a proper input. There is also an explicit **Clear Field** switch,
because "empty" and "erase" are different instructions in amoCRM and confusing them costs data.

**Entities are searchable, not just numeric.** Where a lead, contact, company or customer is
needed, the picker searches the account by name as you type, and also accepts an ID or a URL
pasted straight out of the browser.

**The rate limit is respected by design.** amoCRM allows about seven requests per second and
answers sustained abuse with a 403 that applies to *every* integration on the account. This node
throttles inside its transport, shared across all workflows in the n8n process, retries 429 with
backoff, and never retries a 403 — because retrying is exactly what turns a throttle into a ban.

**Bulk writes are optional and honest.** Raise **Batch Size** on a create or update and the node
groups items into single requests, up to amoCRM's limit. Each element carries a `request_id`, so
results and validation failures still map back to the right input item.

## amoCRM behaviour worth knowing

- **An empty result is HTTP 204 with no body.** The node returns nothing rather than failing.
- **Stage IDs 142 and 143** mean won and lost in *every* pipeline, so a stage ID alone does not
  identify a stage. That is why stage labels are prefixed with the pipeline name.
- **`GET /users` and `/roles` are admin-only.** A 403 there usually means the authorising user is
  not an administrator, not that the token is wrong.
- **402 means the subscription lapsed**, not that credentials are bad. Writes stop immediately,
  reads keep working for thirty days.
- **Tag lists replace, not append.** Sending tags on an update replaces the whole set.
- **Multi-value custom fields replace too** — read, modify, write to add a second phone number.

## Compatibility

Tested against n8n 2.x. Requires Node.js 20.19 or newer, matching n8n's own requirement.

## Development

```bash
npm install
npm run build      # n8n-node build
npm run lint       # n8n-node lint
npm run dev        # runs a local n8n with this node loaded
```

The package ships with no runtime dependencies, as n8n's community-node rules require.

## Feedback and bugs

Bug reports and ideas are welcome — open an issue:
[github.com/zenland-dev/n8n-nodes-amocrm/issues](https://github.com/zenland-dev/n8n-nodes-amocrm/issues).

What makes a report quick to act on:

- your n8n version and the version of this package;
- which node, resource and operation;
- what amoCRM answered — the status code and the body of the error, with tokens removed;
- for a trigger, whether the subscription is listed in **amoCRM → Settings → Integrations**.

Missing an endpoint? The **Custom Request** operation reaches any part of the API in the
meantime — say which one you need and it can be modelled properly, with dropdowns and all.

## Licence

[MIT](LICENSE.md)
