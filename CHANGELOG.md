# Changelog

Notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the package follows [semantic versioning](https://semver.org/).

## 0.4.2 — 2026-09-12

### Changed

- **A dark-theme icon.** Both nodes and both credentials carried one flat file, so on
  n8n's dark canvas the amoCRM mark sat there as a dark smudge. There is now a `light`
  and a `dark` variant at each of the four declarations. The path is the vendor's and is
  untouched; only the blue differs, `#0084C0` on light and `#3DC2FF` on dark, which is the
  same hue and saturation with the lightness raised from 38% to 62%. amoCRM publishes no
  dark logo of its own, so the lighter tone is ours rather than theirs.

Nothing else changed: no operation, field or identifier is different from 0.4.1.

## 0.4.1 — 2026-09-12

### Changed

- **`LICENSE.md` now says what the icon is.** The MIT text was there from the start, but
  nothing in it addressed the amoCRM mark the package reproduces in three icon files. The
  new Trademarks section states the obvious out loud: the mark identifies the service these
  nodes connect to, nothing more, and the MIT grant does not sublicense it. Both brand names
  are covered, since amoCRM and Kommo are one product behind one API.

No code change: `dist` is identical to 0.4.0.

## 0.4.0 — 2026-09-08

### Added

- **A Talk resource — the conversations the trigger already reports.** The trigger has always
  raised _message added_ and _conversation created_, and until now the node had no way to answer
  either. Talk lists conversations (filtered by contact, by the lead or customer they are about,
  or to just the ones still in work), reads one, reads its messages, replies into whichever
  messenger the client wrote from, and closes it — outright, or by handing it to the NPS bot to
  ask for a rating first. The channel does not have to belong to this integration: a WhatsApp
  conversation opened by somebody else's is answerable all the same.

  Listing, reading and closing are documented by both amoCRM and Kommo. **Get Messages** and
  **Send Message** are documented by Kommo only, and against a live amoCRM.ru account they answer
  **403**, not 404: the routes are there, gated behind a chat permission amoCRM does not offer
  integrations, so listing conversations succeeds while reading one of them refuses. Sending
  spends the Chats API add-on quota; reading the history does not. All of it answers 402 on an
  account whose subscription has lapsed.

- **Create Complex on leads — a lead, its contact and its company in one request.** This is the
  only route into amoCRM's duplicate control: a contact whose phone or e-mail the account already
  knows is merged into rather than created a second time, and the answer reports which lead,
  contact and company the write resolved to, and whether a merge happened. Taking in an enquiry
  stops being four nodes and four requests against the rate budget.

  The contact gets the same editors as the Contact resource — the same phone and e-mail inputs,
  the same custom-field editor — and the company gets that pair too, which its own resource does
  not offer. Either may instead be given an ID to attach an entity that already exists, which is
  then not checked for duplicates and cannot be combined with the fields describing a new one.
  One condition worth knowing before relying on it: duplicate control has to be switched on for
  the integration in amoCRM, and where it is not, the write still succeeds, unchecked.

  It takes a **Batch Size** like the other lead writes, up to amoCRM's limit of 50 per request.
  Where duplicate control merges several submitted leads into one, every input item that ended up
  in that lead is paired with the result, so a merge is visible per item rather than as a silently
  shorter output.

### Fixed

- **A select field's options are read from the right dictionary.** The list beside the field
  picker was looked up by the node's _resource_, which is only ever right when the entity being
  written is the resource itself. Under **Unsorted** — whose resource name matches no dictionary
  at all — the options of every select and multi-select came back empty, with nothing said about
  why, and a value left empty because there was nothing to pick then dropped that field from the
  request entirely. The editor now states which entity its fields belong to.
- **The node's own error messages reach the user again.** Handed an error n8n had already wrapped,
  n8n's `NodeApiError` keeps its own text and silently discards the one it is given — so a refused
  request surfaced as _"Forbidden - perhaps check your credentials?"_ even though the credentials
  were fine and the real cause was a missing permission. Every explanation this node writes was at
  the mercy of which layer happened to wrap the failure first. The failure is now passed on as
  plain data, carrying amoCRM's response with it, so the message written here is the one that
  survives.
- **A 403 now says what amoCRM said.** The node replaced the API's own explanation with its list
  of the three things a 403 can mean, which is the right guess when there is nothing better — but
  on an endpoint gated behind a permission, amoCRM names the permission, and that sentence was
  being thrown away. It is now printed first, with the three generic causes kept underneath.
- **The HTTP status is found in more of the shapes a failure arrives in.** It decides whether a
  request is retried and which explanation the reader gets, and it was being missed on several
  nestings — `response.statusCode`, a status on the error itself, and anything wrapped twice —
  which left those failures with n8n's generic wording and no retry where one was due.

## 0.3.1 — 2026-09-07

### Fixed

- **A call note no longer looks for a user named "504141".** The Note resource sent
  `call_responsible` as text, and amoCRM reads a string there as a user _name_, so a numeric
  ID matched nobody. It is now resolved the way the Call resource always resolved it.
- **Unusable filter values are reported rather than sent.** A pipeline filter on leads, and an
  ID list on customers, went through `Number()` without checking the result: anything
  unparseable reached amoCRM as the literal `NaN`, a search that matches nothing and explains
  nothing. Both now name the field and say what they read.
- **Contact and company writes send IDs as numbers.** `responsible_user_id`, `created_by` and
  `updated_by` were passed on exactly as stored, so an ID that arrived as text — from an
  expression, or from a workflow written as JSON — went out as text. The other five resources
  already converted; these two now match. A value that is not a number is still passed
  through, so amoCRM names the offending field instead of the node quietly dropping it.

### Changed

- **Archived pipelines are listed again, marked `(archived)`.** Hiding them left a lead that
  sits in one unaddressable, disagreed with the Pipeline resource — which returns archived
  pipelines by default — and disagreed with the stage picker, which never hid their stages.
- **The tag fields say what they take.** Names, comma-separated; a value of only digits is read
  as an existing tag's ID rather than a name; and tags are separate per entity type, so an ID
  copied from a contact does not point at the same tag on a lead. The README claimed tags
  replace an entity's whole set — that is amoCRM's raw behaviour, not this node's, which adds
  them and offers **Replace Tags** when overwriting is meant.

## 0.3.0 — 2026-09-06

### Changed

- **The request budget is counted per credential, not per account address.** amoCRM budgets
  requests per integration, and a credential is what holds one, so two integrations calling
  the same account are entitled to a budget each instead of sharing one. This also settles an
  inconsistency: with a single window per account, two credentials configured with different
  **Requests per Second** took turns imposing their own limit on the same window. Setups with
  one credential per account are unaffected.
- **The README leads with what the node does for you**, in a new _Why this node_ section
  placed on the first screen: the request counter and its retry rules, the amoCRM errors this
  node explains, account-aware dropdowns and field editors, batching, the trigger's payload
  decoding, and why neither credential can be pointed at an address of its own. It replaces
  _What makes this node different_.
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
- **Both credentials are pinned out of the HTTP Request node.** n8n adds an _Allowed HTTP Request
  Domains_ setting to credentials like these, defaulting to _All_, which lets anyone select the
  credential in an HTTP Request node and point it at any URL. The package now ships that setting
  itself, fixed to _None_ and hidden. It governs the HTTP Request, GraphQL and declarative-routing
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
