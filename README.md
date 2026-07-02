# dspack → A2UI

A proof-of-concept that compiles a **dspack** design-system contract into a valid
**[A2UI](https://github.com/a2ui-project/a2ui) catalog** and renders a sample surface
through the published React A2UI renderer.

> **The question this answers:** *Can dspack function as a portable interchange contract
> for agent UI systems by compiling into an A2UI catalog with acceptable fidelity and
> minimal custom logic?*
>
> **Short answer (from this experiment):** **Yes for the renderable component surface;
> no for the design-intent layer — by design.** Component shapes, variant enums, and
> design tokens project onto an A2UI catalog cleanly enough to validate and render. The
> mapper is a generic engine plus a small *data-only* profile (no per-component code).
> dspack's *governance* layer (usage patterns, anti-patterns, accessibility contracts,
> compound composition, framework bindings) has no A2UI representation — A2UI catalogs
> describe renderable shape, not design intent. Those are documented as deliberate
> casualties, not gaps to be closed.

This is an experiment. It proves **contract portability only**. It does not implement
reconciliation, drift detection, Figma/AF integration, MCP tooling, bidirectional sync,
or runtime governance.

## Demo

The full chain: an example `dspack.json` queried via `ds-mcp`, compiled by this transformer, and rendered through the published A2UI renderer.

https://github.com/user-attachments/assets/510a781b-4214-49b3-b997-9cbecdc36961

## What's here

| Path | What |
| --- | --- |
| `input/shadcn-ui.dspack.json` | Example input: a dspack v0.2 contract from a React+Tailwind system (shadcn/ui). |
| `src/` | The transformer: source-agnostic engine + data-only profile + versioned emitter + validator. |
| `surface/settings-card.surface.json` | Hand-authored A2UI v0.9.1 surface instantiating the compiled components. |
| `out/catalog.v0_9_1.json`, `out/catalog.v1_0.json` | Generated catalogs (no external `$ref`, versioned `catalogId`). |
| `out/validation-report.*` | Validation + fidelity reports (Markdown + JSON). |
| `docs/MAPPING.md` | Per-field fidelity narrative and the deliberate casualties. |
| `demo/` | Standalone Vite + React 19 app rendering the surface via `@a2ui/react`. |
| `fixtures/a2ui/` | Checked-in A2UI schema fixtures used as ground truth. |

## The transformer

The mapper reads a **dspack JSON contract, not framework code** — React/Tailwind is
merely where this example's dspack happened to come from. The engine (`src/transform/`)
is generic; the only source-specific part is a declarative **profile**
(`src/transform/profiles.ts`) describing the dspack→A2UI component/prop/token
correspondence. Retargeting another design system means writing another profile, not
new engine code.

```
load dspack → map (engine + profile) → emit (versioned) → validate (ajv) → report
```

Run it:

```bash
npm install
npm run build:catalogs      # emits v0.9.1 and v1.0 catalogs + reports into out/
npm test                    # vitest: color math, mapping, and the validation gates
```

Or directly:

```bash
npm run transform -- --in input/shadcn-ui.dspack.json --a2ui-version 1.0 --out out
```

### Versioned emitter (`--a2ui-version 0.9.1 | 1.0`)

The mapper targets and validates the **v1.0** catalog schema as the primary line, and
also emits **v0.9.1** for the renderer demo (maintained React renderers are stable on
v0.9.1). Confirmed against the checked-in fixtures, the only catalog-facing delta is:

- **v0.9.1** → `$defs.theme` (carries `primaryColor`, `#rrggbb`).
- **v1.0** → `$defs.surfaceProperties` + a top-level `instructions`.

(See `docs/MAPPING.md` for the full confirmation, including the dropped
`CatalogComponentCommon` def in v1.0, which washes out because we inline all defs.)

## Validation (the hard gate)

"Passes A2UI catalog schema validation" is operationalized as three ajv gates
(draft 2020-12, `strict:false`, `ajv-formats` — the same toolchain A2UI itself uses):

1. **schema-compile + no-external-ref** — ajv compiles the catalog *as a schema*;
   fails on any unresolved `$ref`, proving it is a valid, fully self-contained schema.
2. **catalog-shape** — validates against a version-specific catalog-shape meta-schema
   (`src/validate/meta/`), the check that makes v0.9.1 vs v1.0 conformance distinct.
3. **instance** — every component instance in the sample surface validates against the
   catalog's own `#/$defs/anyComponent`.

The CLI exits non-zero if any gate fails. Both emitted versions currently pass all
three. The instance gate is proven non-vacuous in the test suite (it rejects a
malformed Button).

In the AF governance-pipeline naming these three checks are the **emitter gates
A1/A2/A3** (schema-compile, catalog-shape, instance); the protocol-neutral
**surface gates S1/S2/S3** (surface schema, contract vocabulary, governance lint)
run upstream in [dspack-gen](https://github.com/aestheticfunction/dspack-gen),
before anything reaches this emitter.

## Surface emission (dspack surface → A2UI)

The input contract is now **dspack v0.3**, whose `examples[]` embed *dspack
surface* documents — a protocol-neutral component tree in dspack vocabulary
(schema: `dspack.surface.v0_1.schema.json` in the dspack repo). This repo
compiles those surfaces to A2UI v0.9 messages:

```bash
npm run transform -- --in input/shadcn-ui.dspack.json --a2ui-version 0.9.1 --out out \
  --emit-surface surface/delete-account.dsurface.json
```

emits `out/delete-account.surface.json` (createSurface with dspack-token theme +
updateComponents) and instance-validates it against the freshly generated catalog
(gate A3). Exit codes: `1` catalog gates failed, `3` strict-coverage, `4` the
surface could not be emitted (unknown component / structure the profile cannot
project). The projection is data in the profile (`surfacePlan` directives in
`src/transform/profiles.ts`); the engine has no component-specific code.

**Honest scope:** compound composition flattens per the documented casualties in
MAPPING.md (e.g. an `alert-dialog` subtree collapses onto
`triggerLabel/title/description/cancelLabel/confirmLabel`); A2UI's required
declarative actions are *synthesized* (deterministic event-name slug) and every
synthesis/drop is emitted as a warning — nothing is silent.

The package is also consumable as a library (`transform`, `emitSurface`,
`validateCatalog`, `extractInstances` via the exports map — verified by
`npm run test:pack`); dspack-gen consumes it as a pinned git dependency.

## The render demo (headline deliverable)

```bash
cd demo
npm install
npm run dev      # open the printed localhost URL
```

The demo loads `surface/settings-card.surface.json` and the generated
`out/catalog.v0_9_1.json`, **ingests that catalog** into a renderable
`Catalog<ReactComponentImplementation>` (see [Phase 2](#phase-2-rendering-off-the-generated-catalog)),
runs the surface through `MessageProcessor([ingestedCatalog])` from `@a2ui/web_core/v0_9`,
and renders it with `<A2uiSurface>` from `@a2ui/react/v0_9`. A side panel shows what survived
the transform (component provenance, the lossy Button variant projection, the primary token).

**What this demonstrates — and its honest scope:**

- The compiled surface **renders** through the maintained React renderer: a `Card`
  containing a `Column` with `Text`, a `TextField`, and a primary `Button`.
- The dspack **design tokens drive the rendered theme** via A2UI's `--a2ui-*` CSS
  variables: the primary button paints in `#0f172a` (dspack `color.primary`) and the
  card border is `#e2e8f0` (dspack `color.border`).
- **Variants/enums survive** in the catalog; the panel shows the 6→3 lossy projection
  with the original shadcn enum preserved in `x-dspack-source`.

**Framing caveats (not overstated):**

- The surface renders **off the generated catalog**: the accepted component vocabulary and
  each component's schema are built from `out/catalog.v0_9_1.json` at load time (Phase 2).
  The catalog governs names, props, and accept/refuse; the per-component **visual** is either
  reused from the Basic Catalog (Button, Card, Text, TextField, Column) or hand-authored. See
  the Phase 2 section for exactly where ingestion ends and hand-authoring begins.
- A2UI's model puts **component theming/presentation on the host**. The published
  `@a2ui/react@0.10.1` ships empty CSS-module maps for its interactive components
  (`Button_default = {}`), so the host (`demo/src/host-theme.css`) supplies the button/
  input styling — driven entirely by the same dspack-token CSS variables.
- **v1.0 is validated, not rendered** — maintained React renderers are stable on
  v0.9.1; a v1.0 catalog must pass schema validation but is not required to render until
  renderers ship v1.0 support.

## Phase 2: rendering off the generated catalog

Phase 1 closed the loop at validation. Phase 2 makes the renderer **ingest** the generated
catalog: the accepted component vocabulary and each component's accepted schema are
constructed from `out/catalog.v*.json`, not from a hand-maintained list.

How it works (`demo/src/ingest/`, a generic, dspack-agnostic adapter):

- `buildComponentApi` turns one catalog component (JSON Schema) into a renderer
  `ComponentApi` (`{ name, schema: Zod }`). It classifies each property from the catalog
  itself, mapping the standard A2UI common-type `$ref` names (`DynamicString`, `Action`,
  `ChildList`, `ComponentId`, ...) to the canonical Zod schemas exported by
  `@a2ui/web_core/v0_9`, so the renderer's `scrapeSchemaBehavior` recognizes binding. This
  is **generic A2UI ingestion**: it works on any conformant catalog, inlined or not. An
  optional `x-a2ui` hint can disambiguate, but the adapter works with it entirely absent.
- `buildCatalog` iterates `catalog.components` (no hardcoded names) and pairs each with a
  React visual from the `registry`: either delegated to the Basic Catalog, hand-authored, or
  a visible "unimplemented" placeholder. It constructs `new Catalog(catalog.catalogId, ...)`.

**Where ingestion ends and hand-authoring begins (the honest split):** for every emitted
component the catalog governs the name, props, enums, defaults, and accept/refuse (true
ingestion). The per-component **visual** is reused (Button, Card, Text, TextField, Column) or
hand-authored. The renderer code (`demo/src/ingest/`) contains no component-name list; the
`registry` is the one hand-authored boundary.

**The acceptance gates** (`src/ingestion.test.ts`, run by `npm test`) prove this: recompiling
a changed contract changes the renderer's accepted vocabulary (Gate A, +`Table`) and accepted
props (Gate B, a new Button variant) with **no edit to the adapter or registry**; a catalog
name without a visual is a distinct, visible "unimplemented" state vs an absent name's
"Unknown component" (Gate C); `scrapeSchemaBehavior` recognizes the ingested dynamic/action/
child-list/checkable props (binding fidelity); Tier 1 works with `x-a2ui` stripped (tier
independence); and a static check enforces the no-hardcoded-names rule (negative control).

**No silent drops:** the transform now classifies **every** input dspack component as
mapped / adapted / omitted / unsupported and reports it (the `## Component coverage` section
of each validation report). An unclassified component emits a warning and, under
`--strict-coverage`, fails the CLI (exit 3).

**Access-management demo (P4/P5).** The updated dspack adds a `table` component and a
`data-table-with-row-actions` pattern, so the demo now includes a second surface,
`surface/access-management.surface.json`, for the prompt *"Build an access-management page
with a revoke action."* It renders off the generated catalog using ingested `Table` and
`Badge` components plus an `AlertDialog`. The **revoke** action is a destructive,
**non-dismissible** confirmation (the dspack `destructive-action-confirmation` pattern, and
the AlertDialog-vs-Dialog distinction): clicking the overlay does not dismiss it, and
confirming dispatches a `revoke_access` event through the A2UI action mechanism. As before,
the catalog governs names/props/accept-refuse; the `Table`/`Badge`/`AlertDialog` **visuals**
are hand-authored React in `demo/src/ingest/components/`.

**Honest scope / not yet done:** surfaces are hand-authored (the demo does **not** yet
generate surfaces from dspack patterns); `Table`/`Badge`/`AlertDialog` are synthesized A2UI
component *shapes* (the dspack sub-component composition is a documented casualty, not a
faithful compound contract); `dialog` and `dropdown-menu` remain unsupported casualties; and
v1.0 remains validated, not rendered.

## Pinned versions

`@a2ui/react@0.10.1`, `@a2ui/web_core@0.10.3` (both expose a `/v0_9` entry),
`@a2ui/markdown-it@0.0.4`, `react@19.2.7`. `demo/.npmrc` sets `legacy-peer-deps=true`
because `@a2ui/markdown-it` declares a stale peer; the mismatch is benign.
