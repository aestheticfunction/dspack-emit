# Writing an emit profile

You have a validated dspack contract (if not, start at the
[adoption guide](https://github.com/aestheticfunction/dspack/blob/main/ADOPTING.md))
and you want dspack-emit to project it — and the governed surfaces produced
under it — onto a rendering protocol. This guide covers what a profile is,
where yours should live, and which parts are mechanical versus judgment.

**A profile is pure data.** The transform engine is source-agnostic: it
reads only the profile plus the dspack document, never framework code.
Retargeting a different design system means writing a new profile, not
touching the engine.

## Where your profile lives

**In your own codebase, against the published package.** Two equivalent
forms; pick per project:

**As data (`*.profile.json`)** — the form authoring tools read and write. A
JSON profile is validated at load time against
[`profile.v1.schema.json`](../src/transform/profile.v1.schema.json) (a
one-to-one mirror of the `Profile` interface plus a `profileVersion: "1"`
envelope) and drives the engine byte-identically to the TypeScript form:

```ts
import { loadProfile, transform } from "@aestheticfunction/dspack-emit";

const profile = loadProfile(JSON.parse(readFileSync("acme.profile.json", "utf8")));
// throws ProfileLoadError with pathed issues if the document is malformed
```

From the CLI: `dspack-emit --in acme.dspack.json --profile acme.profile.json --out out`.
To start from zero, `scaffoldProfile(doc, { catalogIdBase })` derives a
mechanical 1:1 draft (verbatim prop projections, subFlatten from declared
`acceptsChildren`, no valueMaps, no casualties) plus `notes` listing every
judgment call left to you.

The schema fails closed: unknown keys are refused everywhere, with one
deliberate, dspack-conventional exception — `x-*` keys are accepted (and
preserved by `loadProfile`) at the document, plan, and casualty levels, so
authoring tools can carry provenance without a schema change. The engine
never reads them.

**As TypeScript** — the original form, and exactly how dspack-studio maps
the Astryx contract:

```ts
import type { Profile } from "@aestheticfunction/dspack-emit";
import { transform, emitSurface, validateCatalog } from "@aestheticfunction/dspack-emit";

export const yourProfile: Profile = { /* ... */ };
```

Reference implementations, in reading order:

- [`dspack-studio/packages/contracts/src/astryx-profile.ts`](https://github.com/aestheticfunction/dspack-studio/blob/main/packages/contracts/src/astryx-profile.ts)
  — an external profile for a **props-based** contract (most props map
  verbatim; little flattening). Start here; yours will probably look like
  this.
- [`src/transform/profiles.ts`](../src/transform/profiles.ts)
  (`shadcnProfile`) — the canonical in-repo profile for a **compound,
  composition-based** contract, exercising every directive including the
  heavy flattening ones. The casualty rationale behind it is documented in
  [MAPPING.md](./MAPPING.md).

An **in-repo** profile (in `src/transform/profiles.ts`, with golden files
and the profile-parity suite) is only for contracts canonical to the
ecosystem — that is maintainer-coordinated; open a discussion first.

## Anatomy of a profile

| Field | What it is | Mode |
|---|---|---|
| `catalogTitle`, `catalogDescription`, `catalogIdBase`, `instructions` | Catalog identity; the versioned `$id` is built from `catalogIdBase` | mechanical |
| `primaryColorToken` | Which contract token (`category` + `name`) supplies `theme.primaryColor` | judgment (small) |
| `components: ComponentPlan[]` | One plan per mapped dspack component | mostly mechanical, see below |
| `synthesized: ComponentPlan[]` | Target primitives your contract does **not** contain (Text, Column, …). dspack describes a component library, not a layout system; renderable surfaces need structure, so you synthesize it — and it is recorded as a fidelity finding, never smuggled in | **judgment** |
| `casualtyComponents` | Contract components with no faithful target representation: `{dspackId, attempted, class, reason}` — documented and warned, not emitted | **judgment** |
| `intentionallyOmitted` | Ids deliberately not mapped (not casualties either). Must stay documented, never silent | **judgment** |
| `surfaceSynthesis` | Which synthesized primitives the surface emitter uses for text leaves (`textComponent`/`textProp`) and for wrapping multiple children in single-child slots (`wrapComponent`/`wrapChildrenProp`) | mechanical once `synthesized` is decided |

Inside each `ComponentPlan`:

- `a2ui` / `dspackId` — target name and source id (`dspackId` omitted for
  pure synthesized primitives). `commons` composes shared `$defs`;
  `required` lists required target properties; `structural` declares
  target-native slots (each with a `synthNote` owning up to the synthesis).
- `propMap` — per-prop projection: target name, `kind`, optional
  `targetEnum` and `valueMap`. **A many-to-one `valueMap` is lossy — that
  is a judgment call; make it consciously and let the warning stand.**
- `surfacePlan` (`SurfacePlanDirectives`) — how a governed surface node
  projects onto the emitted component: `textProp`/`textChildProp` for text,
  `childProp`/`childrenProp` for children, `actionProp` to synthesize a
  declarative Action, `subText`/`subButtonText` to flatten compound
  sub-content into props, `structuralPassthrough`, and the named strategies
  `subTable` (tabular subtree → caption/columns/rows; cells flatten to
  subtree text, a documented loss) and `subFlatten`
  (`transparent` groupings splice children; `asText` sub-components become
  text primitives). Compound composition the target cannot represent is
  flattened *here*, visibly — never silently.
- `subCoverage` — for compound components, **every** contract sub-component
  id must be classified: which prop consumes it, "transparent grouping", or
  `dropped: <why>`. A parent mapping never implies its subs are supported;
  for in-repo profiles the parity suite fails on unclassified subs, and the
  discipline is worth keeping externally too.

For the **json-render** target the profile is much thinner
(`JsonRenderProfile`): optional `nameOverrides` for PascalCase collisions
and `intentionallyOmitted` — same never-silent rule. Most of the mapping is
mechanical there because json-render catalogs are generated from the
contract model directly.

## The three judgment calls

Everything else is bookkeeping. These three decide the fidelity story, and
they are yours, not the tool's:

1. **What gets synthesized** — which target primitives you add that the
   contract doesn't have, so surfaces are renderable at all.
2. **What is a casualty** — which components you decline to fake, with a
   written reason (`attempted` records what you tried).
3. **How compounds flatten** — what survives when composition meets a
   props-based protocol, per sub-component, in `subCoverage` and the
   `surfacePlan` directives.

The design stance mirrors the contract side: losses are **declared**, in
data, with reasons — a profile that silently drops things is a bug even
when it renders.

## Validating your profile

```ts
import { transform, emitSurface } from "@aestheticfunction/dspack-emit";

const { catalog, validation } = transform(doc, "1.0", surfaceMessages, yourProfile);
// validation carries the gate results: schema-compile (A1),
// catalog-shape meta-schema (A2), instance validation (A3).

const { messages, warnings } = emitSurface(surface, doc, { profile: yourProfile });
// warnings are your declared losses showing up in practice — read them.
```

Emit your contract's own worked examples (`examples[]` from the contract)
through `emitSurface` and treat any error as a profile gap: the studio does
exactly this at build time, so every example in the contract is proven
emittable. Gate details and CLI equivalents are in the
[README](../README.md); the shadcn casualty rationale that motivates the
directive set is in [MAPPING.md](./MAPPING.md).

## Profile v2 — the primitive language

v1's ten surface-plan directives are **compatibility syntax**: they keep
loading and emitting byte-identically, indefinitely, and everything above this
section still describes them. New profiles should be authored in **v2**
(`"profileVersion": "2"`), which spells the transformation model directly —
three constructs instead of ten directives.

Every plan answers three questions:

- **Identity** — does a node become an instance, and as which component?
  (`a2ui`, plus per-sub dispositions under `surface.subs`)
- **Routing** — for each piece of its subtree, where does it land?
  (`surface.routes`)
- **Repetition** — when a sub-structure repeats, how does it become an array?
  (`surface.collects`)

```jsonc
{
  "a2ui": "AlertDialog",
  "dspackId": "alert-dialog",
  "commons": ["ComponentCommon"],
  "structural": { /* … declared A2UI-side slots, exactly as in v1 … */ },
  "required": ["triggerLabel", "title", "action"],
  "surface": {
    "routes": [
      { "from": ["sub(alert-dialog-title).text"], "to": "prop:title" },
      { "from": ["sub(alert-dialog-trigger).label",
                 "sub(alert-dialog-trigger).firstText"], "to": "prop:triggerLabel" },
      { "from": ["synthesized.action"], "to": "action:action" }
    ]
  }
}
```

**Selectors** (closed set — there is no expression language, no JSON paths,
no predicates): `self.text`, `self.props.<prop>`,
`sub(<id>|…).text` / `.label` / `.firstText` / `.subtreeText`,
`children`, `synthesized.action`.

**Destinations** (names are literal, never computed): `prop:<name>`,
`textChild:<name>`, `slot:<name>`, `slots:<name>`, `action:<name>`. Every
destination must be declared by the plan — a structural slot or a propMap
target — because gate A3 catches an *omitted* property but silently passes an
*invented* one; load-time checking is where invention dies.

A route's `from` is an **ordered fallback chain**: the first selector that
yields a value wins. All selectors in one route must resolve in the same
write phase, and two same-phase writers on one destination refuse; layered
writers in distinct phases are legal (a passthrough prop beats a harvested
one, deterministically).

**Repetition** collects repeated sub-structures into an array-valued prop:

```jsonc
"collects": [
  { "of": ["table-header"], "into": "prop:columns", "shape": "flat",
    "row": ["table-row"], "cells": ["table-head", "table-cell"] },
  { "of": ["table-body"],   "into": "prop:rows",    "shape": "records",
    "field": "cells", "row": ["table-row"], "cells": ["table-cell", "table-head"] }
]
```

**Sub dispositions** name what happens to each sub-component the routes and
collects do not consume:

```jsonc
"subs": {
  "card-header":      "transparent",          // dissolves; children rise in place
  "card-title":       { "asText": "h3" },      // re-identifies as the text primitive
  "table-footer":     { "drop": "summary rows have no slot in this shape" }
}
```

**Every sub-component must be accounted for.** A v2 profile whose mapped
compound leaves a sub unresolved — no route consumes it, no collect gathers
it, no disposition dissolves or drops it — refuses to transform, per sub,
with a pathed finding naming the decision to make. (v1 profiles report the
same derivation under coverage instead, and `--strict-coverage` makes it
fatal there.)

**Functions** (v2 only): declare the catalog's check vocabulary as data, and
every `FunctionCall` an instance makes is validated against it — an
undeclared function fails gate A3. Definitions are declarative arg schemas;
implementations live in renderers.

```jsonc
"functions": {
  "matchesRegexp": { "description": "True when the value matches.",
                     "returns": "boolean",
                     "args": { "type": "object",
                               "properties": { "pattern": { "type": "string" } },
                               "required": ["pattern"] } }
}
```

**One language per document.** A v2 document must not carry `surfacePlan` or
`subCoverage`; a v1 document must not carry `surface` or `functions`. The
loader dispatches on `profileVersion` and validates against exactly one of
[profile.v1.schema.json](../src/transform/profile.v1.schema.json) /
[profile.v2.schema.json](../src/transform/profile.v2.schema.json); unknown
versions refuse naming the supported set.

`scaffoldProfile` emits v2: mechanical identities and prop projections,
children/text routes only where the contract's worked examples show them, and
every sub-component surfaced as an explicit unresolved decision that
transform refuses until you make it. The refusal is the point — it is your
work checklist, not an error to silence.

## The transformation ledger and `--strict-surface`

Every emission returns `fidelity` alongside the byte-frozen `messages` and
`warnings`: one entry per transformation, carrying the source path and
selector, the destination (or `"(discarded)"`), the originating profile rule,
the kind (`projected / moved / lifted / flattened / synthesized / wrapped /
dropped / deduplicated`), and a class from the shared taxonomy
(`maps-cleanly / synthesis-defaults / lossy / cannot-represent`).

Four outcomes stay distinguishable, by construction:

| outcome | how it reads |
|---|---|
| emitted cleanly | messages present; no `lossy`/`cannot-represent` entries |
| emitted with loss | messages present; the losses are named in `fidelity` |
| refused | `EmitSurfaceError` / `ProfileContractError` — nothing emitted |
| strict-failed | `--strict-surface` exit 5; the emitted artifact is still written and is **byte-identical** to the non-strict run |

`--strict-surface` never alters emitted content — it only decides whether
configured fidelity classes are acceptable. Bare, it fails `lossy` and
`cannot-represent`; `--strict-surface=lossy,synthesis-defaults` tightens it;
an unknown class is a usage error. Without the flag the ledger still prints:
loss is never invisible, the flag only makes it fatal.

## Ordering doctrine

Route and diagnostic ordering are **explicit** because object-key order and
warning order are observable in deterministic artifacts. A route's write
phase is derived from what it reads (never authored, never declaration
position); diagnostics and fidelity sort by declared `(path, band, phase,
rule)` keys. Compatibility goldens must never be re-baselined merely because
an internal refactor changes incidental execution sequence — a moved digest
is either a regression to fix or an intentional change explained at the pin,
in the same commit.

## The consuming-traversal rule

Compound-consuming routes resolve in **document order as one traversal**:
sibling tree position, not route declaration order, determines which node
claims a destination. This is what consuming a compound *means* — an
alert-dialog writes `triggerLabel` before `title` because the trigger
precedes the content, and it would keep doing so if the routes were declared
in the opposite order. Declaration order among consuming routes affects only
the deterministic tie-break of diagnostics, never the values.

## `x-scaffold.unresolved`

Scaffolds may infer mechanical structure from evidence (worked examples,
declared sub-components) and must surface everything else as questions —
never inventing governance, casualties, joins, donation, or semantic intent.
A scaffolded v2 profile lists every undecided sub-component under
`x-scaffold.unresolved`; the same set is what makes `transform()` refuse,
per sub, until you decide. A scaffold that refuses with a precise unresolved
checklist is preferable to one that emits by guessing.
