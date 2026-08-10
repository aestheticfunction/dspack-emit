# The shadcn contract pin

`input/shadcn-ui.dspack.json` is **pinned to one upstream commit** instead of tracking `dspack@main`. This file is the record of that decision.

A pin is not staleness. Staleness is silent and is discovered when something breaks; a pin names the exact bytes this package was built against, verifies them by hash on every CI run, reports how far behind `main` it sits, and states what has to be true before it is removed.

## The pin

| | |
|---|---|
| **Pinned ref** | [`805732c154f0f214721c9934a450b0edb2656c99`](https://github.com/aestheticfunction/dspack/commit/805732c154f0f214721c9934a450b0edb2656c99) — *feat(shadcn): record-collection intent (v2.3.0)*, 2026‑07‑22 |
| **Pinned contract** | shadcn/ui **v2.3.0** — 8 components, 39 sub-components, 2 intents, 8 rules, 2 worked examples, 70 040 bytes |
| **sha256** | `ca19f8410a97f2004cf1d6f6dd2d7542abccfbb5430b756e0ccdc1ee954c7bb7` |
| **Current upstream** | shadcn/ui **v3.0.0** at [`48643ff`](https://github.com/aestheticfunction/dspack/commit/48643ff) (merged as [`b573637`](https://github.com/aestheticfunction/dspack/commit/b573637), dspack#35) — 32 components, 106 sub-components, 11 intents, 48 rules, 14 worked examples, 460 066 bytes |
| **Tracking issue** | aestheticfunction/dspack-emit#28 |

The pinned copy is byte-identical to that upstream commit. Nothing here is a fork: no contract content was copied, edited, or re-authored to make the check pass.

> **The pinned contract is not current shadcn/ui coverage.** It describes 8 of the 32 components the design system's contract now governs. Do not cite this package's catalogs, coverage tables or fidelity reports as a statement about shadcn/ui support. The canonical evidence corpus is the production contract on `dspack@main`.

## Why the pin exists

dspack#35 merged the production contract (a 4× vocabulary expansion) on 2026‑08‑05. Everything in this package that consumes that contract — the `shadcnProfile`, the shadcn renderers in dspack-studio, and the `profile-parity` invariants — was designed against v2.3.0.

Following `main` immediately would not have produced a bigger catalog; it would have produced a broken one, and would have merged the approved *foundation* milestone into the T1–T5 representation work that is explicitly paused.

## Measured gaps preventing honest migration

Taken by syncing the production contract locally and running the suite (2026‑08‑05):

| Gap | Measurement |
|---|---|
| Worked examples that refuse to emit | **12 of 14** (`ex.delete-project-confirmation`, `ex.workspace-members-directory`, `ex.expense-report-form`, `ex.notification-preferences`, `ex.order-detail-summary`, `ex.invite-teammates-dialog`, `ex.project-workspace-panels`, `ex.docs-article-trail`, `ex.usage-help-affordances`, `ex.customer-context-sheet`, `ex.import-run-status`, `ex.orders-table-loading`) |
| Components with no classification | **24 of 32** — `shadcnProfile` maps 6 and declares 2 casualties |
| Sub-components needing `subCoverage` | **106**, against 39 today |
| Renderers silently misrendering | **7 of 22** emitted instances across six shadcn renderers |
| Declared `checks` resolving to `{}` | **5 components** — the profile format has no `functions` path |

The parity suite fails **14 tests** on a bare sync. Critically, the two completeness invariants fail for a reason no amount of profile authoring fixes cleanly: `profile-parity.test.ts` asserts *every worked example emits*, which the production contract cannot satisfy until refusal-for-an-acknowledged-reason is a first-class outcome.

Closing the gap by declaring 24 new casualties was considered and rejected: those components are "not mapped yet", not "cannot represent", and overloading the casualty vocabulary would weaken the fail-closed gate that vocabulary exists to power.

## Removal condition

Replace the pin with the production contract **only after all of the following are implemented and measured**:

- [x] profile v2 schema + explicit `profileVersion` dispatch — `src/transform/profile-schema-v2.ts`, `profile-load.ts`
- [x] v1 directive desugaring into the internal Identity/Route/Collect model — `src/transform/desugar.ts`, byte-neutrality gated by `src/byte-neutral.test.ts`
- [x] load-time validation of selectors and destinations — `src/transform/parse-v2.ts`
- [x] `EmitSurfaceResult.fidelity` + `--strict-surface` — `src/targets/a2ui/surface.ts`, `src/cli.ts` (exit 5)
- [x] sub-component coverage derived and enforced from the internal model
- [x] the six shadcn renderer drifts repaired, with props-level parity tests — landed in dspack-studio (`packages/shadcn-renderers`)
- [x] `functions` support on the profile/catalog path — `src/transform/profiles.ts`, `profile-load.ts`
- [ ] `profile-parity.test.ts` invariant 1 restated as *every worked example either emits, or refuses for a declared-casualty reason the contract itself acknowledges* — **the one remaining blocker** (`src/profile-parity.test.ts` still asserts every example emits)

Everything above except the last line shipped in **0.6.0** (see
[RELEASE-0.6.0.md](../RELEASE-0.6.0.md)): T1 transparent identity + control
donation, T2/T3 collect with declared joins, T4 multi-slot compounds, and
layered dissolution. The measured-gap table earlier in this document predates
that release — as of 0.6.0 the production contract is 34 components and 11 of
14 worked examples emit.

At that point: `node scripts/check-sync.mjs --write` after removing the `pin` block, regenerate the derived catalogs and json-render goldens, and commit them together.

## How the pin is enforced

`scripts/check-sync.mjs` runs in CI on every push and PR. For a pinned entry it:

1. fetches the artifact at the pinned commit and **fails if its sha256 differs from the recorded hash** — a pinned ref must be immutable, so a change means a force-push, history rewrite or CDN mismatch, never a routine update;
2. fails if the local copy drifts from those exact bytes, as before;
3. fetches the tracked branch and **always prints how far behind the pin sits**, so the pin can never quietly read as current.
