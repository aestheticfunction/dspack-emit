# Changelog

## 0.7.0 — 2026-08-10

Two ratified behavior changes. The emitted catalog artifact is untouched
(`$defs.anyComponent` and every component schema stay byte-identical — the
19 byte-neutrality pins and the v2 keystone byte-identity gate prove it);
what changes is how invalid *instances* are reported and when they are
refused.

### Gate A3 errors are branch-scoped, with structured `errorDetails`

Gate 3 used to validate every instance against `#/$defs/anyComponent` — a
flat `oneOf` over ALL catalog components — with `allErrors`, so one missing
prop produced an error per *other* branch (their
`const`/`required`/`unevaluatedProperties` failures), all prefixed with the
instance's own `component#id`. A single invalid TextField reported ~50
errors naming other components' props.

Now each instance is validated against its own `#/components/<name>` branch
(manual discrimination — semantically equivalent, since every branch pins
`component: {const: <name>}`), `allErrors` *within* the branch:

- an unknown component name yields exactly one error:
  `` `<comp>#<id>: component '<comp>' is not in this catalog (N components admitted)` ``;
- error strings are enriched from ajv params: enum violations append
  `(allowed: …)`, const violations `(expected: …)`, and
  unevaluated/additional-property violations name the offending property;
- `GateResult` gains an optional `errorDetails` field — per-instance
  structured evidence (`instance`, `component`, `id`, and each ajv error's
  `instancePath`/`schemaPath`/`keyword`/`params`/`message`) for downstream
  UIs. The strings in `errors` remain the primary user-facing form.

Gate name (`"instance"`), pass/fail semantics, and rigor are unchanged.

### `emitSurface` refuses catalog-invalid instances

The emitter could produce instances that cannot validate against the very
catalog they name: an authored prop with no propMap dropped silently at
projection, leaving a *required* catalog prop unset (e.g. `props.title` on
`alert`, whose `title` comes from the `alert-title` sub-component), and —
when a propMap declares a `targetEnum` but no `valueMap` — an
off-vocabulary value passed through verbatim. Both only failed downstream
at gate A3.

`emitSurface` now runs a final guard over every emitted instance against
its ComponentPlan (required-prop presence + targetEnum membership) and, on
any violation, throws `EmitSurfaceError` with one aggregated message
listing each violation and its cause, e.g.:

```
Alert#root: required prop 'title' has no value after emission — authored
'props.title' on 'alert' has no A2UI projection (title comes from the
'alert-title' sub-component)
```

Full-schema rigor stays gate A3's job (defense in depth). Warnings and
fidelity recording are untouched: a surface that emits, emits
byte-identically to 0.6.0, and no shipped example changes behavior.

## 0.6.0 — the representation program

See [RELEASE-0.6.0.md](./RELEASE-0.6.0.md).
