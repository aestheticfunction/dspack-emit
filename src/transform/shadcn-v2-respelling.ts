/**
 * The shadcn plans' v2 re-spelling — the six shipped v1 surface plans written
 * in the primitive language. Byte-proven equivalent: src/profile-v2.test.ts
 * emits every pinned artifact identically through these blocks.
 *
 * Shared by the keystone test and by eval/build-eval-profile.mjs, which
 * transplants them onto a scaffold of the production v3 contract to build the
 * reproducible coverage-evaluation fixture. One source, two consumers — the
 * respelling is committed mapping evidence, not per-file copies.
 */
import type { SurfaceV2 } from "./parse-v2.js";

export const SHADCN_V2_SURFACES: Record<string, SurfaceV2> = {
  button: {
    routes: [
      { from: ["self.text"], to: "textChild:child", overwrite: true },
      { from: ["synthesized.action"], to: "action:action" },
    ],
  },
  card: {
    routes: [{ from: ["children"], to: "slot:child" }],
    subs: {
      "card-header": "transparent",
      "card-content": "transparent",
      "card-footer": "transparent",
      "card-title": { asText: "h3" },
      "card-description": { asText: "caption" },
    },
  },
  input: {
    routes: [{ from: ["self.text"], to: "prop:label", overwrite: true }],
  },
  badge: {
    routes: [{ from: ["self.text"], to: "prop:label", overwrite: true }],
  },
  table: {
    routes: [
      { from: ["self.props.caption"], to: "prop:caption" },
      { from: ["self.props.columns"], to: "prop:columns" },
      { from: ["self.props.rows"], to: "prop:rows" },
      { from: ["sub(table-caption).subtreeText"], to: "prop:caption" },
    ],
    collects: [
      { of: ["table-header"], into: "prop:columns", shape: "flat", row: ["table-row"], cells: ["table-cell", "table-head"] },
      { of: ["table-body"], into: "prop:rows", shape: "records", field: "cells", row: ["table-row"], cells: ["table-cell", "table-head"] },
    ],
    subs: {
      "table-footer": { drop: "summary rows have no slot in the synthesized caption/columns/rows shape" },
    },
  },
  "alert-dialog": {
    routes: [
      { from: ["sub(alert-dialog-title).text"], to: "prop:title" },
      { from: ["sub(alert-dialog-description).text"], to: "prop:description" },
      { from: ["sub(alert-dialog-cancel).text"], to: "prop:cancelLabel" },
      { from: ["sub(alert-dialog-action).text"], to: "prop:confirmLabel" },
      { from: ["sub(alert-dialog-trigger).label", "sub(alert-dialog-trigger).firstText"], to: "prop:triggerLabel" },
      { from: ["synthesized.action"], to: "action:action" },
    ],
  },
};

/**
 * T1 resolutions for the production v3 contract — the transparent-identity
 * spellings proven by src/t1.test.ts against the named production failure
 * (`card > form > form-field > form-item > form-label + input`). Consumed by
 * the eval fixture builder as committed mapping evidence; the fixture's other
 * unresolved decisions stay deliberately open.
 */
export const SHADCN_V3_T1_SURFACES: Record<string, SurfaceV2> = {
  form: {
    transparent: true,
    subs: {
      "form-field": "transparent",
      "form-control": "transparent",
      "form-item": { transparent: { donate: [{ from: "sub(form-label).text", to: "prop:label" }] } },
      "form-description": { asText: "caption" },
      "form-message": { drop: "validation state is runtime data the declarative surface does not carry" },
    },
  },
};
