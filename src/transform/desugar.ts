/**
 * v1 surface-plan directives -> the internal transformation model.
 *
 * Every authored directive is surface syntax for one or more Identity / Route /
 * Collect facts. This module is the whole of that translation, and it is the
 * only place in the package that knows the v1 directive names: past here, the
 * engine sees primitives.
 *
 * The translation must be EXACT, not approximate — v1 profiles keep emitting
 * byte-identically (src/byte-neutral.test.ts is the gate), so every quirk of
 * the original directives is reproduced here deliberately, with the quirk named:
 *
 *  - `subText` visits the node itself, not only its descendants;
 *  - `subButtonText` accepts only label-bearing components, then falls back to
 *    an audited lift of the first direct text under the sub;
 *  - `textProp`/`textChildProp` overwrite, while everything else is first-wins;
 *  - `subTable` accepts a header-cell wherever a cell is expected, concatenates
 *    multiple header rows into one flat column list, and takes the first caption;
 *  - `structuralPassthrough` wins over any consumed value.
 *
 * Reading this file top to bottom is also the v1 -> internal mapping table.
 */
import type { ComponentPlan, SurfacePlanDirectives } from "./profiles.js";
import { parseSurfaceV2 } from "./parse-v2.js";
import { emptySurfaceModel, WriteOrder, type Collect, type Route, type SurfaceModel } from "./model.js";

/** Cache: a plan's model is derived once, not per emitted node. */
const cache = new WeakMap<ComponentPlan, SurfaceModel>();

/**
 * The internal model for a plan, whichever language it is written in: a v2
 * `surface` block parses directly; v1 directives desugar. Both languages meet
 * the engine only as this model — the engine cannot tell them apart, which is
 * the compatibility guarantee.
 */
export function surfaceModelOf(plan: ComponentPlan): SurfaceModel {
  const hit = cache.get(plan);
  if (hit) return hit;
  const model = plan.surface ? parseSurfaceV2(plan.surface, plan, "/surface") : desugar(plan.surfacePlan ?? {});
  cache.set(plan, model);
  return model;
}

export function desugar(sp: SurfacePlanDirectives): SurfaceModel {
  const model = emptySurfaceModel();
  const route = (r: Route) => model.routes.push(r);

  // structuralPassthrough: CSR props copied verbatim into same-named slots.
  // Listed first because it wins over consumed values, and the engine applies
  // routes in order with first-write-wins.
  for (const key of sp.structuralPassthrough ?? []) {
    route({
      order: WriteOrder.Verbatim,
      from: [{ kind: "self-prop", prop: key }],
      to: { kind: "prop", name: key },
      origin: "structuralPassthrough",
    });
  }

  // subText: descendant text -> a named prop. One route per target prop; the
  // selector names every sub that feeds it, which is also how two sub ids
  // sharing one destination stay a single first-wins decision.
  const bySubTextTarget = new Map<string, string[]>();
  for (const [sub, prop] of Object.entries(sp.subText ?? {})) {
    bySubTextTarget.set(prop, [...(bySubTextTarget.get(prop) ?? []), sub]);
  }
  for (const [prop, subs] of bySubTextTarget) {
    route({ order: WriteOrder.Consume, from: [{ kind: "sub-text", subs }], to: { kind: "prop", name: prop }, origin: "subText" });
  }

  // subButtonText: the label of a label-bearing component inside the sub, else
  // an audited lift of the first direct text under it. One route, two ordered
  // selectors — the fallback that motivated Selector[].
  for (const [sub, prop] of Object.entries(sp.subButtonText ?? {})) {
    route({
      order: WriteOrder.Consume,
      from: [
        { kind: "sub-label", subs: [sub] },
        { kind: "sub-text-lift", subs: [sub] },
      ],
      to: { kind: "prop", name: prop },
      origin: "subButtonText",
    });
  }

  // subTable: three nested collects plus a caption route. Nothing here is
  // table-shaped except the sub ids the profile names — the depth is nesting,
  // the record key is an item field name, and the drops are ordinary drops.
  if (sp.subTable) {
    const t = sp.subTable;
    route({
      order: WriteOrder.CollectLead,
      from: [{ kind: "subtree-text", subs: [t.caption] }],
      to: { kind: "prop", name: t.targetCaption },
      origin: "subTable.caption",
    });

    /** A row's cells: one flat scalar list. A header-cell counts as a cell. */
    const cells = (origin: string): Collect => ({
      order: WriteOrder.Collect,
      flatten: false,
      of: [t.row],
      as: { kind: "inline" },
      scalar: {
        order: WriteOrder.Collect,
        from: [{ kind: "subtree-text", subs: [t.cell, t.headerCell] }],
        to: { kind: "prop", name: "cells" },
        origin,
      },
      origin,
    });

    // Header: every header row's cells concatenate into ONE flat column list —
    // v1 passes the same array to each header row, so two header rows append.
    model.collects.push({
      order: WriteOrder.Collect,
      flatten: true,
      of: [t.header],
      as: { kind: "prop", name: t.targetColumns },
      item: { cells: cells("subTable.header") },
      origin: "subTable.header",
    });

    // Body: one record per row, its cells under the `cells` field. That field
    // name was a literal in the v1 emitter; here it is data.
    model.collects.push({
      order: WriteOrder.Collect,
      flatten: false,
      of: [t.body],
      as: { kind: "prop", name: t.targetRows },
      item: { cells: cells("subTable.body") },
      origin: "subTable.body",
    });

    Object.assign(model.drops, t.drops);
  }

  // textProp / textChildProp: the node's own text. Both OVERWRITE, unlike every
  // consuming directive — v1's one asymmetry, kept explicit.
  if (sp.textProp) {
    route({
      order: WriteOrder.SelfText,
      from: [{ kind: "self-text" }],
      to: { kind: "prop", name: sp.textProp },
      overwrite: true,
      origin: "textProp",
    });
  }
  if (sp.textChildProp) {
    route({
      order: WriteOrder.SelfTextChild,
      from: [{ kind: "self-text" }],
      to: { kind: "text-child", name: sp.textChildProp },
      overwrite: true,
      origin: "textChildProp",
    });
  }

  // actionProp: no source in the subtree; the event name is a deterministic
  // slug the engine derives. Ordered after the text routes because v1 reads a
  // prop those routes may have written when naming the event.
  if (sp.actionProp) {
    route({
      order: WriteOrder.Action,
      from: [{ kind: "synthesized-action" }],
      to: { kind: "action", name: sp.actionProp },
      origin: "actionProp",
    });
  }

  // subFlatten: the two halves are Identity decisions about named subs —
  // dissolve, or become the synthesized text primitive with a variant.
  for (const sub of sp.subFlatten?.transparent ?? []) {
    model.subIdentity[sub] = { kind: "transparent" };
  }
  for (const [sub, variant] of Object.entries(sp.subFlatten?.asText ?? {})) {
    model.subIdentity[sub] = { kind: "as-text", variant };
  }

  // childProp / childrenProp: children as instance references.
  if (sp.childrenProp) {
    route({ order: WriteOrder.Children, from: [{ kind: "children" }], to: { kind: "slots", name: sp.childrenProp }, origin: "childrenProp" });
  } else if (sp.childProp) {
    route({ order: WriteOrder.Children, from: [{ kind: "children" }], to: { kind: "slot", name: sp.childProp }, origin: "childProp" });
  }

  // Derived, never authored: a plan that absorbs its subtree into props does
  // not also emit that subtree as children. v1 computed this from the presence
  // of subText/subButtonText/subTable — the same three, now expressed as the
  // routes and collects that consume descendants.
  model.consumesSubtree = Boolean(sp.subText || sp.subButtonText || sp.subTable);

  return model;
}
