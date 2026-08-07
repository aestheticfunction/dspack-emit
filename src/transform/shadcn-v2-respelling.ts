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

/**
 * T2 resolutions for the production v3 contract — item-mode collection
 * spellings proven by src/t2.test.ts. `radio-group` collects what each item
 * itself carries ({value: self.id}); its htmlFor-joined sibling labels are
 * the measured T3 frontier, dropped with record until declared joins land.
 * `select` is the pure homogeneous shape ({label: self.text}).
 *
 * Each entry carries the full receiving plan (structural options schema) —
 * unlike T1's transparent plans, a collecting plan IS a catalog component.
 */
export const SHADCN_V3_T2_PLANS: Record<string, Record<string, unknown>> = {
  "radio-group": {
    a2ui: "RadioGroup",
    dspackId: "radio-group",
    commons: ["ComponentCommon"],
    structural: {
      options: {
        schema: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value"], additionalProperties: false } },
        description: "The selectable options, one record per item.",
        synthNote: "A2UI models repeated options as data on the group; dspack models them as repeated sub-components (T2 item-mode collection).",
      },
    },
    propMap: {
      name: { a2ui: "name", kind: "string" },
      defaultValue: { a2ui: "defaultValue", kind: "string" },
    },
    required: ["options"],
    surface: { collects: [{ of: ["radio-group-item"], into: "prop:options", item: { value: "self.id" } }] },
  },
  select: {
    a2ui: "Select",
    dspackId: "select",
    commons: ["ComponentCommon"],
    structural: {
      options: {
        schema: { type: "array", items: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false } },
        description: "The selectable options.",
        synthNote: "A2UI models repeated options as data on the control (T2 item-mode collection).",
      },
    },
    propMap: { defaultValue: { a2ui: "defaultValue", kind: "string" } },
    required: ["options"],
    surface: {
      collects: [{ of: ["select-item"], into: "prop:options", item: { label: "self.text" } }],
      subs: {
        "select-trigger": { drop: "the trigger renders from the bound value, not authored content" },
        "select-value": { drop: "the visible value is runtime state derived from the selection" },
        "select-label": { drop: "group headings are not carried by the flat options shape" },
        "select-separator": { drop: "visual grouping chrome with no data meaning" },
      },
    },
  },
};
