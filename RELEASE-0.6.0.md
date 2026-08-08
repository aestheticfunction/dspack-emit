# dspack-emit 0.6.0 — the representation program

0.6.0 ships the full surface-representation model built and measured on top of
the 0.5.0 foundation. It is **additive and backward-compatible**: every v1
profile emits byte-for-byte as it did under 0.5.0 (19 byte-neutrality pins +
the v2 keystone byte-identity gate prove it), so 0.5.0 consumers upgrade with
no behavior change and opt into the new capabilities per profile.

## New: the v2 profile language (`profileVersion: "2"`)

A closed, load-validated primitive vocabulary — Identity / Routing /
Repetition — that lets a profile express compound-composition shapes A2UI
supports but 0.5.0's directives could not:

- **T1 — transparent identity + control donation.** A boundary component
  emits no instance; its children rise, and a dissolving field's label
  donates onto its single eligible control. Ratified root-transparency.
- **T2 — item-mode collection.** A repeated sub-family becomes an array of
  records (`radio-group-item`, `select-item`).
- **T3 — declared key joins.** A repeated family pairs with a sibling family
  by declared keys — never position, adjacency, or similarity — with a
  slot-valued joined field (tabs trigger↔content).
- **T4 — multi-slot compounds.** `sub(x).children → slot:name` routes a named
  region's children as instances (dialog/sheet/popover).
- **Layered dissolution contexts.** A dissolving boundary shadows but does not
  erase enclosing compound contexts; dispositions resolve through the
  ancestor chain.

Every edge fails closed at load or emit with a pathed reason; every
transformation is recorded in the fidelity ledger; `--strict-surface` gates
on fidelity class.

## Also since 0.5.0

- Sub-component coverage derived from the internal model and enforced.
- Surface fidelity reporting (`EmitSurfaceResult.fidelity`, `maps-cleanly /
  synthesis-defaults / lossy / cannot-represent`).
- `scaffoldProfile` rewritten on the v2 vocabulary.
- Functions in the profile/catalog path.

## Compatibility & rollback

- v1 profiles: byte-frozen. No consumer action required.
- Rollback: pin `@aestheticfunction/dspack-emit@0.5.0` — still on npm,
  unchanged.
- Measured against the production shadcn v3 contract (34 components): 86 of
  104 sub-components resolved, 11 of 14 worked examples emit, every loss
  recorded. See `eval/`.
