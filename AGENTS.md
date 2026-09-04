# Working on this repository

Instructions for a coding agent editing this source. Users of the published node do not
need this file — it is not part of the npm package (`files: ["dist"]`).

`@zenland-dev/n8n-nodes-amocrm` is an n8n community node for amoCRM / Kommo, written from
scratch against the amoCRM API v4. Toolchain is `@n8n/node-cli` (n8n 2.x): no gulp, no
`.eslintrc.prepublish.js`.

## Before you finish, always

```
npm run build     # n8n-node build
npm run lint      # n8n-node lint
npm pack --dry-run
```

All three must pass. `pack` should list only `dist`, `README.md`, `LICENSE.md`,
`package.json` and the empty `index.js` — around 224 files, roughly 147 kB. Anything else
in that list is a bug.

`prepublishOnly` is **not** a check. It runs `n8n-node prerelease`, which exits 1 unless
`RELEASE_MODE` is set, purely to stop a hand-made `npm publish`. It builds nothing and
lints nothing, so the run above is the real gate.

## Layout

```
credentials/            two credential classes: amoCrmApi (long-lived token), amoCrmOAuth2Api
nodes/AmoCrm/           the action node; AmoCrm.node.json is its codex
  v1/actions/<resource>/  description.ts (UI + operations), execute.ts (calls), index.ts
  v1/actions/router.ts    dispatches resource+operation, and batches writes
  v1/descriptions/        properties shared across resources (entity locators, custom fields)
  v1/helpers/             custom-field encode/decode, dates, error shaping, query building
  v1/methods/             loadOptions and listSearch — the dropdowns that read the account
  v1/transport/           request, pagination, per-credential cache, rate limiter
nodes/AmoCrmTrigger/    the webhook trigger and its PHP-bracket payload decoder
```

Every request goes through `amoCrmApiRequest` in `v1/transport`. It already turns amoCRM
failures into a `NodeApiError` with a message the user can act on — do not wrap it again,
and do not call the API directly from an `execute.ts`.

Adding an operation means touching four places: the operation option in the resource's
`description.ts`, its parameters, the branch in `execute.ts`, and the README table.

## Rules that are not negotiable

**Never rename a published identifier.** Operation `value`s, resource `value`s, credential
names (`amoCrmApi`, `amoCrmOAuth2Api`), node names (`amoCrm`, `amoCrmTrigger`) and the
package name live inside other people's saved workflows. Renaming one silently breaks
their workflow and their stored credentials. Adding is always safe; renaming and removing
are a major version plus a `CHANGELOG.md` entry telling users what to do.

**No runtime dependencies.** `dependencies` must stay empty — the community-node linter
rejects a non-empty one. Everything needed is in `n8n-workflow` or the standard library.

**No global `setTimeout`, `setInterval`, `process` or `Math.random`.** Use `sleep` and
`randomInt` from `n8n-workflow`; the linter enforces this.

**Property text follows n8n's conventions.** Descriptions start with a capital letter — so
a sentence may not open with `amoCRM`, reword instead. Booleans are described as
"Whether …". Options are alphabetical unless a comment explains why not.

## Keep the node legible to an AI agent

The node is exposed to n8n's AI Agent (`usableAsTool: true`; the trigger must never set
it). n8n's node catalog reads a narrow slice of the description, so these fields carry
real weight and are easy to break by omission:

- **every operation option needs `action` and `description`.** The `action` string becomes
  the tool name a model sees ("Create a lead in amoCRM"); the `description` is printed
  verbatim in the catalog. All 88 currently have both — keep it that way.
- **`builderHint.searchHint`** on the node is the one place to state what no single
  operation can. Wire-format expressions (`={{ … }}`) and connection-type literals are
  rejected there by the linter.
- **`codex.alias`** in `*.node.json` is what makes the node findable: it is the only codex
  field that survives into the AI projection, and searches like "deal" or "sales pipeline"
  match through it.
- **hidden properties are stripped before a model sees them.** Anything an agent must know
  to fill a field has to live in a visible `description` — that is why `fieldId` spells out
  its `fieldId::fieldType` composite value.

## Releasing

Branch is `main` — `n8n-node release` runs release-it with `--git.requireBranch main`.

`npm run release` bumps the version, regenerates `CHANGELOG.md` from commit subjects, tags
and pushes; `.github/workflows/publish.yml` then publishes to npm with provenance. Commit
subjects become public release notes, so write them accordingly. Never run `npm publish`
by hand: it loses provenance, which n8n requires from community nodes.
