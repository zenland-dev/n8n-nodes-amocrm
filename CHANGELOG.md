# Changelog

Notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the package follows [semantic versioning](https://semver.org/).

## 0.3.0 — 2026-09-06

### Changed

- **The request budget is counted per credential, not per account address.** amoCRM budgets
  requests per integration, and a credential is what holds one, so two integrations calling
  the same account are entitled to a budget each instead of sharing one. This also settles an
  inconsistency: with a single window per account, two credentials configured with different
  **Requests per Second** took turns imposing their own limit on the same window. Setups with
  one credential per account are unaffected.
- **The README leads with what the node does for you**, in a new *Why this node* section
  placed on the first screen: the request counter and its retry rules, the amoCRM errors this
  node explains, account-aware dropdowns and field editors, batching, the trigger's payload
  decoding, and why neither credential can be pointed at an address of its own. It replaces
  *What makes this node different*.
- **Wording corrected where it overstated amoCRM's rules.** A 403 earned by going too fast
  shuts out the integration that earned it; the ceiling across every integration calling one
  account is a separate, wider limit. Dropdown caching is now described as what it is — a
  saving on reopening a node, not on the first open.

### Fixed

- **An entity picker no longer reports an error while it is empty.** Switching an optional
  picker — a contact's company, a linked entity, a catalog element — to **By ID** or **By URL**
  marked the node as broken before anything had been typed: n8n validates a picker's mode
  against whatever the field holds, empty included, and does not consult the field's
  `required` flag first. Empty now passes, and a picker that really is required still fails
  n8n's own emptiness check.

### Added

- **A Feedback and bugs section in the README**, and issue templates for a bug report and a
  feature request. The package always carried `bugs.url`, but only npm's own tooling reads
  that — a reader who got to the end of the README was told where the licence is and nothing
  about where to report what they had just run into.
- **A note that the budget belongs to the n8n process.** A queue-mode instance with N workers
  holds N budgets, so **Requests per Second** on the credential should be divided by the
  number of workers.

## 0.2.0 — 2026-09-05

### Changed

- **The account address is now a subdomain plus a domain chosen from a closed list**
  (`amocrm.ru`, `amocrm.com`, `kommo.com`), replacing the free-form **Account Address** field on
  both credentials. Whoever can edit a credential decides where its secret is sent — n8n masks the
  token on read but restores it on save, so a free-form address was enough to walk a five-year
  token, or the OAuth client secret, out of the building. The domain is checked against the list in
  the credential and again in the node's own code, because a credential's dropdown is only a hint
  to the editor; the subdomain is reduced to the characters a host may contain.
- **Both credentials are pinned out of the HTTP Request node.** n8n adds an *Allowed HTTP Request
  Domains* setting to credentials like these, defaulting to *All*, which lets anyone select the
  credential in an HTTP Request node and point it at any URL. The package now ships that setting
  itself, fixed to *None* and hidden. It governs the HTTP Request, GraphQL and declarative-routing
  surfaces only — this node's own calls, its trigger and its credential tests are unaffected.

## 0.1.0 — 2026-09-05

First release.

### Added

- **amoCRM node** — 88 operations across 21 resources: leads, contacts, companies, customers,
  tasks, notes, files, catalogs, catalog elements, custom fields, pipelines and their statuses,
  links, tags, events, unsorted, salesbots, users, calls, webhooks, the account itself, and a
  Custom Request escape hatch for any endpoint the node does not model.
- **amoCRM Trigger** — subscribes to amoCRM webhooks when the workflow is activated and
  unsubscribes when it is deactivated, and decodes amoCRM's PHP-bracket form payloads into ordinary
  nested JSON.
- **Two credential types** — a long-lived access token and OAuth2. Both carry a per-second request
  limiter and cache account metadata per credential.
- Dropdowns read the account the credential points at, so pipelines, statuses, users, tags,
  catalogs and every configured custom field are picked from a list, and each custom field renders
  the input its type deserves.
- Usable as a tool by n8n's AI Agent, with a description on every operation and a builder hint for
  LLM workflow builders.
