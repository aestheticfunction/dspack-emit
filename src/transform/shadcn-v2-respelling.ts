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
export const SHADCN_V3_T3_PLANS: Record<string, Record<string, unknown>> = {
  tabs: {
    a2ui: "Tabs",
    dspackId: "tabs",
    commons: ["ComponentCommon"],
    structural: {
      sections: {
        schema: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, value: { type: "string" }, child: { $ref: "#/$defs/ComponentId" } },
            required: ["title", "child"],
            additionalProperties: false,
          },
        },
        description: "The tab sections: a title and the panel it reveals.",
        synthNote: "A2UI models paired trigger/panel families as one array of {title, child} records (T3 declared join; the worked example keys on ids).",
      },
    },
    propMap: { defaultValue: { a2ui: "defaultValue", kind: "string" } },
    required: ["sections"],
    surface: {
      collects: [
        {
          of: ["tabs-trigger"],
          into: "prop:sections",
          item: { title: "self.text", value: "self.id" },
          join: { with: ["tabs-content"], on: { left: "self.id", right: "self.id" }, fields: { child: "children" } },
        },
      ],
    },
  },
};

export const SHADCN_V3_T2_PLANS: Record<string, Record<string, unknown>> = {
  "radio-group": {
    a2ui: "RadioGroup",
    dspackId: "radio-group",
    commons: ["ComponentCommon"],
    structural: {
      label: {
        schema: { type: "string" },
        description: "The group-level label naming the choice being made.",
        synthNote: "Sourced by T1 form-label donation when the group sits inside a form field; a group without one relies on context.",
      },
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
    // T3: the htmlFor->id join carries each item's sibling label into its
    // record. Value still sources from self.id — a documented limitation:
    // ids are DOM identity, not semantic values ("reimbursement-payroll" vs
    // defaultValue "payroll"); the real shadcn API declares value on the
    // item, and the contract gap is filed upstream.
    surface: {
      collects: [
        {
          of: ["radio-group-item"],
          into: "prop:options",
          item: { value: "self.id" },
          join: { with: ["label"], on: { left: "self.id", right: "self.props.htmlFor" }, fields: { label: "self.text" } },
        },
      ],
    },
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

/**
 * A0 authoring resolutions (the zero-new-capability milestone): production
 * profile judgment for the families the shipped Identity/Routing/Repetition
 * model already supports, proven by src/a0.test.ts. Six compound plans plus
 * label-slot additions on the five controls that appear as a field's single
 * control (the T1 donation destination). No new primitive anywhere.
 *
 * Grounded in measured usage across the 14 worked examples (contract 3.2.0):
 * alert-title 5/5 + alert-description 5/5 carry the content; avatar-fallback
 * carries text while avatar-image is an EMPTY node (the contract declares no
 * src/alt — the dspack#39 class, recorded on the drop); scroll-area's two
 * subs are scrollbar chrome; the field family follows the corrected
 * declaration (dspack#40) with field as its own donating boundary.
 */
export const SHADCN_V3_A0_PLANS: Record<string, Record<string, unknown>> = {
  alert: {
    a2ui: "Alert",
    dspackId: "alert",
    commons: ["ComponentCommon"],
    structural: {
      title: {
        schema: { type: "string" },
        description: "The one-line heading naming what happened.",
        synthNote: "Lifted from the alert-title sub (5/5 worked examples carry it there).",
      },
      description: {
        schema: { type: "string" },
        description: "Supporting detail under the title.",
        synthNote: "Lifted from the alert-description sub.",
      },
    },
    propMap: {
      variant: { a2ui: "variant", kind: "enum", targetEnum: ["default", "destructive"], default: "default" },
    },
    required: ["title"],
    surface: {
      routes: [
        { from: ["sub(alert-title).text"], to: "prop:title" },
        { from: ["sub(alert-description).text"], to: "prop:description" },
      ],
      subs: {
        "alert-action": {
          drop:
            "an action slot holds component children (a button), and routing a sub's children to a slot is T4's mechanism — dropped WITH RECORD until T4, not approximated (one production instance: ex.import-run-status)",
        },
      },
    },
  },
  avatar: {
    a2ui: "Avatar",
    dspackId: "avatar",
    commons: ["ComponentCommon"],
    structural: {
      fallback: {
        schema: { type: "string" },
        description: "Initials shown while no image is available.",
        synthNote: "Lifted from the avatar-fallback sub's text.",
      },
    },
    propMap: { size: { a2ui: "size", kind: "enum", targetEnum: ["sm", "default", "lg"], default: "default" } },
    required: ["fallback"],
    surface: {
      routes: [{ from: ["sub(avatar-fallback).text"], to: "prop:fallback" }],
      subs: {
        "avatar-image": {
          drop: "the contract declares no src/alt on avatar-image — an empty node carries nothing to project (contract-gap class, cf. dspack#39)",
        },
        "avatar-badge": { drop: "no worked example exercises it; no measured shape to project — revisit with usage evidence" },
        "avatar-group": { drop: "no worked example exercises it; a grouped-avatars shape is repetition to be measured, not guessed" },
        "avatar-group-count": { drop: "no worked example exercises it; belongs to the unmeasured avatar-group shape" },
      },
    },
  },
  "scroll-area": {
    a2ui: "ScrollArea",
    dspackId: "scroll-area",
    commons: ["ComponentCommon"],
    structural: {},
    required: [],
    surface: {
      transparent: true,
      subs: {
        "scroll-area-scrollbar": { drop: "scrollbar chrome: presentation of the scroll container, not content" },
        "scroll-area-thumb": { drop: "the scrollbar's drag indicator: chrome, not content" },
      },
    },
  },
  field: {
    a2ui: "Field",
    dspackId: "field",
    commons: ["ComponentCommon"],
    structural: {},
    required: [],
    surface: {
      transparent: { donate: [{ from: "sub(field-label).text", to: "prop:label" }] },
      subs: {
        "field-content": "transparent",
        "field-title": { asText: "h4" },
        "field-description": { asText: "caption" },
        "field-error": { drop: "validation state is runtime data the declarative surface does not carry (mirrors form-message)" },
      },
    },
  },
  "field-set": {
    a2ui: "FieldSet",
    dspackId: "field-set",
    commons: ["ComponentCommon"],
    structural: {},
    required: [],
    surface: {
      transparent: true,
      subs: { "field-legend": { asText: "h4" } },
    },
  },
  "field-group": {
    a2ui: "FieldGroup",
    dspackId: "field-group",
    commons: ["ComponentCommon"],
    structural: {},
    required: [],
    surface: {
      transparent: true,
      subs: {
        "field-separator": { drop: "a visual section boundary; its optional inline text is presentation of the divider, and no worked example carries one" },
      },
    },
  },
};

/**
 * A0 label additions: the five controls that appear as a field's (or
 * form-item's) single control across the worked examples — input already
 * declares `label`; these gain the same structural slot so the T1 donation
 * has a declared destination. Merged onto the scaffolded plans (select's T2
 * plan) by the fixture builder; nothing else on those plans changes.
 */
export const SHADCN_V3_A0_LABEL_ADDITIONS: Record<string, { description: string; synthNote: string }> = {
  switch: {
    description: "The label naming what the switch turns on or off.",
    synthNote: "Sourced by the T1 field-label/form-label donation; 4/4 worked-example switches sit inside a field.",
  },
  checkbox: {
    description: "The label naming what checking the box asserts.",
    synthNote: "Sourced by the T1 form-label donation (ex.expense-report-form's billable field).",
  },
  textarea: {
    description: "The label naming the long-text entry.",
    synthNote: "Sourced by the T1 field-label/form-label donation, exactly as on input.",
  },
  progress: {
    description: "The label naming what is progressing.",
    synthNote: "Sourced by the T1 field-label donation; 2/2 worked-example progress bars sit inside a field.",
  },
  select: {
    description: "The label naming the choice being made.",
    synthNote: "Sourced by the T1 field-label/form-label donation when the select is a field's control (ex.invite-teammates-dialog).",
  },
};
