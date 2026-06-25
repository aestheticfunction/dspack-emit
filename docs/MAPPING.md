# Mapping & fidelity: dspack → A2UI catalog

This document records, per field, how the shadcn/ui **dspack v0.2** contract
(`input/shadcn-ui.dspack.json`) projects onto an **A2UI catalog** (`out/catalog.*.json`),
using one of four fidelity classes:

- **maps cleanly** — represented in A2UI with no loss.
- **requires synthesis / defaults** — represented, but a value had to be invented,
  defaulted, or converted (information added, not in the source).
- **currently lossy** — partially represented; distinctions in the source collapse.
- **cannot be represented** — no A2UI catalog representation; dropped (with a warning).

The machine-generated, always-current version of the table below — including ajv
validation results — is emitted to `out/validation-report.v0_9_1.md` /
`.v1_0.md` on every run. This file is the curated narrative.

## Stated up front: the deliberate casualties

An A2UI catalog is a **JSON Schema describing renderable component shape**. A dspack
contract is broader: it also encodes *design intent and governance* — when to use a
component, when not to, accessibility contracts, compound-component composition rules,
preferred patterns, ruled-out anti-patterns, and framework bindings. **None of that
knowledge layer has any representation in an A2UI catalog, and that is expected.** These
are documented as deliberate casualties, not failures of the transform:

| dspack section | Fate | Why |
| --- | --- | --- |
| `patterns` | cannot be represented | A2UI has no "preferred component combination" concept. |
| `antiPatterns` | cannot be represented | A2UI cannot encode "do not do this". |
| component `whenToUse` / `whenNotToUse` | cannot be represented | Usage guidance is design intent, not schema. |
| component `accessibility` (role, keyboard, focus, label rules) | cannot be represented | A2UI catalogs carry no a11y contract. |
| component `composition` (sub-components, required children) | cannot be represented | A2UI components are flat; compound structure is lost. |
| component `constraints` | cannot be represented | RFC-2119 usage rules are not schema. |
| `frameworkBindings` (import paths, packages) | cannot be represented | A2UI is framework-agnostic by design. |
| `layout` (breakpoints, grid, containers, spacing scale) | cannot be represented | Descriptive layout system, not renderable components. |
| `themes` (e.g. dark mode overrides) | cannot be represented | A2UI delivers a single theme per surface, not named modes. |
| token `tier` / `aliasOf` | cannot be represented | Only resolved token *values* survive; the hierarchy is dropped. |

Each emits a `unsupported-section:*` or per-component warning during transform.

## Components

| dspack component | A2UI target | Class | Notes |
| --- | --- | --- | --- |
| `button` | `Button` | maps cleanly (shape) | structural slots synthesized; variant enum lossy (below). |
| `card` | `Card` | maps cleanly (shape) | compound sub-components (Header/Content/Footer) collapse to one `child`. |
| `input` | `TextField` | requires synthesis | `type`→`variant` projection (below); label synthesized. |
| `badge` | `Badge` | requires synthesis | no native A2UI Badge; emitted as a synthesized shape. Variant enum (default/secondary/outline/destructive) carried verbatim; the React visual honors all four. |
| `table` | `Table` | requires synthesis (composition lossy) | no native A2UI Table; emitted as a presentational shape (`caption`/`columns`/`rows`). The dspack sub-component composition (TableHeader/Body/Row/Head/Cell) **cannot be represented** and is recorded as a casualty. |
| `alert-dialog` | `AlertDialog` | requires synthesis (composition lossy) | no native A2UI AlertDialog; emitted as a non-dismissible confirmation shape that preserves the defining distinction from Dialog. The rich sub-component composition (trigger/content/title/description/footer/action/cancel) **cannot be represented**. |
| `dialog` | `Modal` (attempted) | cannot be represented | compound composition + dismissal/a11y semantics unrepresentable; **omitted** (casualty). |
| `dropdown-menu` | — | cannot be represented | no A2UI analog (items/sub-menus/separators); **omitted** (casualty). |

Two components are **synthesized** (present in the catalog, absent from dspack) because
A2UI surfaces need them to be renderable and dspack — being a *component library*
contract, not a layout system — does not contain them:

| Synthesized | Why |
| --- | --- |
| `Text` | A2UI content primitive for titles/labels. |
| `Column` | A2UI structural primitive; dspack's `layout` block is descriptive, not a component. |

`Table`, `Badge`, and `AlertDialog` above are likewise synthesized component *shapes* (A2UI's
Basic Catalog has no equivalent), emitted from their dspack entries with hand-authored React
visuals in `demo/src/ingest/components/`. Their dspack composition is a documented casualty.

## Properties

| dspack | A2UI | Class | Notes |
| --- | --- | --- | --- |
| `button.variant` `{default,destructive,outline,secondary,ghost,link}` | `Button.variant` `{default,primary,borderless}` | currently lossy | 6→3 projection. `default→primary`, `ghost/link→borderless`, `destructive/outline/secondary→default`. Source enum preserved in `x-dspack-source`. |
| `button.size` `{default,sm,lg,icon}` | — | cannot be represented | A2UI `Button` has no size axis. |
| `button.disabled`, `button.asChild` | — | cannot be represented | no A2UI representation (disabled state / React Slot composition). |
| `input.type` `{text,email,password,number,search,…}` | `TextField.variant` `{shortText,longText,number,obscured}` | requires synthesis | `password→obscured`, `number→number`, `text/email/search→shortText` (lossy for email/search). |
| `input.placeholder`, `input.disabled` | — | cannot be represented | A2UI `TextField` has `label`, not placeholder; no disabled. |
| `card.className` | — | cannot be represented | arbitrary class injection is outside the A2UI catalog contract. |
| (A2UI-native) `Button.child`, `Button.action`, `Card.child`, `TextField.label/value`, `Column.children` | — | requires synthesis | structural slots A2UI requires that dspack does not express. |

## Design tokens

| dspack | A2UI | Class | Notes |
| --- | --- | --- | --- |
| `color.primary` `hsl(222.2,47.4%,11.2%)` | `theme.primaryColor` `#0f172a` (v0.9.1) | requires synthesis | HSL→hex conversion to satisfy `^#[0-9a-fA-F]{6}$`. |
| `color.primary` | `surfaceProperties.x-dspack-primaryColor` (v1.0) | requires synthesis | v1.0 basic `surfaceProperties` has no `primaryColor` field; carried as extension. |
| full token palette (`color.*`, `border-radius.*`, …) | `theme`/`surfaceProperties` `x-dspack-tokens` | requires synthesis | resolved values carried as a documented extension (`additionalProperties: true`). |
| token `description`, `type` | — | cannot be represented | only the resolved value survives. |

The rendered demo drives the A2UI `--a2ui-*` CSS variables from this palette, so the
tokens are not just present in the catalog — they paint the rendered surface (the
primary button is `#0f172a`; the card border is the `border` token `#e2e8f0`).

## Component metadata

| dspack | A2UI | Class |
| --- | --- | --- |
| component `description` | catalog component `description` | maps cleanly |
| component `status`, `tags` | `x-dspack` annotation on the component schema | maps cleanly (as metadata) |
| component `id` | `x-dspack.sourceId` | maps cleanly (as metadata) |

## Version delta (v0.9.1 ↔ v1.0)

Confirmed against the checked-in fixtures (`fixtures/a2ui/basic-catalog.*.json`):

- **v0.9.1**: `$defs.theme` (with `primaryColor`, `#rrggbb`).
- **v1.0**: `$defs.surfaceProperties` (no `primaryColor` field) **+** top-level
  `instructions`; the separate `CatalogComponentCommon` `$def` is gone (folded away).
- Both: identical `components`, inlined `$defs`, and `anyComponent`.

Because this transformer **inlines all shared defs** (no external `$ref`s), the
structural differences beyond `theme`↔`surfaceProperties` wash out; the operative
catalog-facing delta the emitter switches on is the theme/surfaceProperties block,
plus `instructions` and the version segment in `$id`/`catalogId`.
