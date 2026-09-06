# Changelog

Notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the package follows [semantic versioning](https://semver.org/).

## 0.2.1 — 2026-09-06

### Added

- **A Feedback and bugs section in the README**, and issue templates for a bug report and a
  feature request. The package always carried `bugs.url`, but that is only read by npm's own
  tooling — a reader who reached the end of the README was told where the licence is and
  nothing about where to report what they had just run into.

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
