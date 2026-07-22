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

**In your own codebase, against the published package.** This is the normal
path, and it is exactly how dspack-studio maps the Astryx contract:

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
