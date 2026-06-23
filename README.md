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

## The render demo (headline deliverable)

```bash
cd demo
npm install
npm run dev      # open the printed localhost URL
```

The demo loads `surface/settings-card.surface.json` and the generated
`out/catalog.v0_9_1.json`, runs the surface through
`MessageProcessor([basicCatalog])` from `@a2ui/web_core/v0_9`, and renders it with
`<A2uiSurface>` from `@a2ui/react/v0_9`. A side panel shows what survived the transform
(component provenance, the lossy Button variant projection, the primary token).

**What this demonstrates — and its honest scope:**

- The compiled surface **renders** through the maintained React renderer: a `Card`
  containing a `Column` with `Text`, a `TextField`, and a primary `Button`.
- The dspack **design tokens drive the rendered theme** via A2UI's `--a2ui-*` CSS
  variables: the primary button paints in `#0f172a` (dspack `color.primary`) and the
  card border is `#e2e8f0` (dspack `color.border`).
- **Variants/enums survive** in the catalog; the panel shows the 6→3 lossy projection
  with the original shadcn enum preserved in `x-dspack-source`.

**Framing caveats (not overstated):**

- The stock A2UI React renderer renders its built-in **Basic Catalog** vocabulary; it
  does **not** ingest an arbitrary custom catalog (no React renderer does today). So
  this is a **Basic-Catalog-compatibility** proof. The link back to our generated
  catalog is the **instance gate**: the same surface objects validate against it.
- A2UI's model puts **component theming/presentation on the host**. The published
  `@a2ui/react@0.10.1` ships empty CSS-module maps for its interactive components
  (`Button_default = {}`), so the host (`demo/src/host-theme.css`) supplies the button/
  input styling — driven entirely by the same dspack-token CSS variables.
- **v1.0 is validated, not rendered** — maintained React renderers are stable on
  v0.9.1; a v1.0 catalog must pass schema validation but is not required to render until
  renderers ship v1.0 support.

## Pinned versions

`@a2ui/react@0.10.1`, `@a2ui/web_core@0.10.3` (both expose a `/v0_9` entry),
`@a2ui/markdown-it@0.0.4`, `react@19.2.7`. `demo/.npmrc` sets `legacy-peer-deps=true`
because `@a2ui/markdown-it` declares a stale peer; the mismatch is benign.
