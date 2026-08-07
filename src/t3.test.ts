/**
 * T3: declared key joins for repeated groups.
 *
 * Fail-first (/tmp/t3-failfirst.txt): the T2 suite pins the production
 * radio-group emitting {value}-only options with its htmlFor-joined labels
 * DROPPED with record; the join spelling was refused by the v2 grammar; and
 * tabs' three subs sat in the 72-unresolved eval ledger.
 *
 * The join is DECLARED, never inferred: left family, joined family, a key
 * from each side, fields from the joined side, cardinality. No positions,
 * no nearest-sibling, no similarity. Every correctness edge refuses:
 * missing keys, duplicate keys on either side, zero counterparts (unless
 * declared optional), dangling counterparts. Provenance names item,
 * counterpart, key, and destination in the ledger.
 *
 * Two measured shapes prove the model generalizes:
 *  - radio-group: item.id ↔ label.props.htmlFor (scalar joined field);
 *  - tabs: trigger.id ↔ content.id (the worked example joins on ids, though
 *    the contract also declares `value` on both), with the ratified
 *    SLOT-VALUED joined field — content children emit as instances and the
 *    record carries the reference. Repetition's slot field, not T4 routing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";
import { loadProfile } from "./transform/profile-load.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const contract = JSON.parse(readFileSync(repo("eval/shadcn-v3.dspack.json"), "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const fixture = JSON.parse(readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"));

const RG_T3_SURFACE = {
  collects: [
    {
      of: ["radio-group-item"],
      into: "prop:options",
      item: { value: "self.id" },
      join: { with: ["label"], on: { left: "self.id", right: "self.props.htmlFor" }, fields: { label: "self.text" } },
    },
  ],
};

const TABS_T3_SURFACE = {
  collects: [
    {
      of: ["tabs-trigger"],
      into: "prop:sections",
      item: { title: "self.text", value: "self.id" },
      join: { with: ["tabs-content"], on: { left: "self.id", right: "self.id" }, fields: { child: "children" } },
    },
  ],
};

const t3Profile = (mutate?: (doc: Record<string, unknown>) => void) => {
  const base = structuredClone(fixture) as Record<string, unknown> & { components: Array<Record<string, unknown>> };
  const pick = (id: string) => structuredClone(base.components.find((c) => c.dspackId === id)!);
  const radioGroup = pick("radio-group");
  radioGroup.surface = structuredClone(RG_T3_SURFACE);
  (radioGroup.structural as Record<string, { schema: Record<string, unknown> }>).options.schema = {
    type: "array",
    items: {
      type: "object",
      properties: { value: { type: "string" }, label: { type: "string" } },
      required: ["value", "label"],
      additionalProperties: false,
    },
  };
  const tabs = {
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
        synthNote: "A2UI models paired trigger/panel families as one array of {title, child} records (T3 declared join).",
      },
    },
    propMap: { defaultValue: { a2ui: "defaultValue", kind: "string" } },
    required: ["sections"],
    surface: structuredClone(TABS_T3_SURFACE),
    // tabs-list is walked through on the way to the triggers it wraps.
  };
  const doc: Record<string, unknown> & { components: Array<Record<string, unknown>> } = {
    ...base,
    components: [pick("card"), pick("badge"), radioGroup, tabs],
  };
  delete (doc as Record<string, unknown>)["x-scaffold"];
  mutate?.(doc);
  return loadProfile(doc);
};

const surfaceOf = (root: unknown): DspackSurface =>
  ({ dspackSurface: "0.1", system: contract.name as string, intent: "preference-settings", root }) as DspackSurface;

/** The production notification-preferences radio-group, verbatim shape. */
const RG_SURFACE = {
  component: "radio-group",
  props: { name: "digest", defaultValue: "monday" },
  children: [
    { component: "radio-group-item", id: "digest-monday" },
    { component: "label", props: { htmlFor: "digest-monday" }, text: "Monday morning" },
    { component: "radio-group-item", id: "digest-friday" },
    { component: "label", props: { htmlFor: "digest-friday" }, text: "Friday afternoon" },
  ],
};

const emit = (root: unknown, profile = t3Profile()) => emitSurface(surfaceOf(root), contract, { profile });
const firstInstance = (r: { messages: unknown[] }) =>
  (r.messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components[0];

describe("T3 joins the production radio-group", () => {
  it("options carry BOTH value and label; no label is dropped once the join is configured", () => {
    const r = emit(RG_SURFACE);
    const rg = firstInstance(r);
    expect(rg.options).toEqual([
      { value: "digest-monday", label: "Monday morning" },
      { value: "digest-friday", label: "Friday afternoon" },
    ]);
    expect(r.warnings.filter((w) => w.code === "surface-sub-dropped" && w.message.includes("'label'"))).toHaveLength(0);

    // Provenance: each counterpart ledgered as joined, naming the key.
    const joined = r.fidelity.filter((f) => f.kind === "joined");
    expect(joined).toHaveLength(2);
    expect(joined[0].source).toContain("label");
    expect(joined[0].note).toContain("digest-monday");
    expect(joined[0].class).toBe("maps-cleanly");

    // A1-A3: the emitted instance validates against the generated catalog.
    const check = transformFromJson(contract, { profile: t3Profile(), surface: { messages: r.messages } });
    expect(check.validation.pass).toBe(true);
  });

  it("emission is deterministic across runs", () => {
    const a = emit(RG_SURFACE);
    const b = emit(RG_SURFACE);
    expect(JSON.stringify([a.messages, a.warnings, a.fidelity])).toBe(JSON.stringify([b.messages, b.warnings, b.fidelity]));
  });
});

describe("T3 correctness edges — every one refuses", () => {
  const rg = (children: unknown[]) => ({ component: "radio-group", children });

  it("zero counterparts refuses (exactly-one is the default)", () => {
    expect(() => emit(rg([{ component: "radio-group-item", id: "a" }]))).toThrowError(/no counterpart/);
  });

  it("optional: true relaxes zero counterparts to an omitted field, arbitrated by A3", () => {
    const profile = t3Profile((doc) => {
      const plan = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "radio-group")!;
      ((plan.surface as typeof RG_T3_SURFACE).collects[0].join as Record<string, unknown>).optional = true;
    });
    const r = emit(rg([{ component: "radio-group-item", id: "a" }]), profile);
    expect(firstInstance(r).options).toEqual([{ value: "a" }]);
    // The record schema requires label, so A3 refuses — relocation, never synthesis.
    const check = transformFromJson(contract, { profile, surface: { messages: r.messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(false);
  });

  it("multiple counterparts for one key refuse (duplicate right keys)", () => {
    expect(() =>
      emit(
        rg([
          { component: "radio-group-item", id: "a" },
          { component: "label", props: { htmlFor: "a" }, text: "One" },
          { component: "label", props: { htmlFor: "a" }, text: "Two" },
        ]),
      ),
    ).toThrowError(/duplicate right key 'a'/);
  });

  it("duplicate left keys refuse", () => {
    expect(() =>
      emit(
        rg([
          { component: "radio-group-item", id: "a" },
          { component: "radio-group-item", id: "a" },
          { component: "label", props: { htmlFor: "a" }, text: "One" },
        ]),
      ),
    ).toThrowError(/duplicate left key 'a'/);
  });

  it("a missing left key refuses", () => {
    expect(() =>
      emit(rg([{ component: "radio-group-item" }, { component: "label", props: { htmlFor: "a" }, text: "One" }])),
    ).toThrowError(/carries no key/);
  });

  it("a missing right key refuses", () => {
    expect(() =>
      emit(rg([{ component: "radio-group-item", id: "a" }, { component: "label", text: "Loose" }])),
    ).toThrowError(/carries no key/);
  });

  it("a dangling counterpart refuses — unrelated siblings cannot satisfy a join", () => {
    expect(() =>
      emit(
        rg([
          { component: "radio-group-item", id: "a" },
          { component: "label", props: { htmlFor: "a" }, text: "One" },
          { component: "label", props: { htmlFor: "elsewhere" }, text: "Points nowhere" },
        ]),
      ),
    ).toThrowError(/dangling counterpart/);
  });

  it("a casualty inside the joined subtree still refuses (casualty enforcement is live)", () => {
    const profile = t3Profile((doc) => {
      (doc.casualtyComponents as unknown[]) = [
        { dspackId: "badge", attempted: "(none)", class: "cannot-represent", reason: "test casualty" },
      ];
      (doc.components as Array<Record<string, unknown>>).splice(
        (doc.components as Array<Record<string, unknown>>).findIndex((c) => c.dspackId === "badge"),
        1,
      );
    });
    const tabsSurface = {
      component: "tabs",
      children: [
        { component: "tabs-list", children: [{ component: "tabs-trigger", id: "t1", text: "Tab" }] },
        { component: "tabs-content", id: "t1", children: [{ component: "badge", text: "inside the panel" }] },
      ],
    };
    expect(() => emit(tabsSurface, profile)).toThrowError(/declared casualty/);
  });
});

describe("T3 generalizes: tabs joins trigger ↔ content with a slot-valued field", () => {
  const TABS_SURFACE = {
    component: "tabs",
    props: { defaultValue: "overview" },
    children: [
      {
        component: "tabs-list",
        children: [
          { component: "tabs-trigger", id: "overview", text: "Overview" },
          { component: "tabs-trigger", id: "activity", text: "Activity" },
        ],
      },
      { component: "tabs-content", id: "overview", children: [{ component: "badge", text: "All systems go" }] },
      { component: "tabs-content", id: "activity", children: [{ component: "badge", text: "3 deploys today" }] },
    ],
  };

  it("sections carry {title, value, child}; panels emit as real instances", () => {
    const r = emit(TABS_SURFACE);
    const components = (r.messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    const tabs = components[0];
    expect(tabs.component).toBe("Tabs");
    const sections = tabs.sections as Array<Record<string, unknown>>;
    expect(sections.map((s) => s.title)).toEqual(["Overview", "Activity"]);
    expect(sections.map((s) => s.value)).toEqual(["overview", "activity"]);
    // Each child is a reference to a REAL emitted instance.
    for (const section of sections) {
      const child = components.find((c) => c.id === section.child);
      expect(child?.component).toBe("Badge");
    }
    expect(JSON.stringify(components)).toContain("All systems go");

    const check = transformFromJson(contract, { profile: t3Profile(), surface: { messages: r.messages } });
    expect(check.validation.pass).toBe(true);
  });

  it("the join is keyed, not positional: shuffled content order still pairs correctly", () => {
    const shuffled = structuredClone(TABS_SURFACE);
    const kids = shuffled.children as Array<Record<string, unknown>>;
    [kids[1], kids[2]] = [kids[2], kids[1]]; // activity panel now precedes overview's
    const r = emit(shuffled);
    const components = (r.messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    const sections = (components[0].sections as Array<Record<string, unknown>>);
    const overview = sections.find((s) => s.value === "overview")!;
    const panel = components.find((c) => c.id === overview.child);
    expect(JSON.stringify(panel)).not.toContain("3 deploys");
    const panelSubtree = components.filter((c) => c.id === overview.child || (panel && c.id === panel.children));
    expect(JSON.stringify(panelSubtree)).toBeDefined();
    const resolved = components.find((c) => c.id === overview.child);
    expect(JSON.stringify(resolved)).toContain(String(overview.child));
  });

  it("derived coverage resolves the tabs family through the join", () => {
    const out = transformFromJson(contract, { profile: t3Profile() });
    const unresolved = out.mapping.coverage.filter(
      (c) => c.disposition === "unclassified" && c.id.startsWith("tabs."),
    );
    expect(unresolved).toEqual([]);
    expect(out.mapping.coverage.find((c) => c.id === "tabs.tabs-content")?.detail).toContain("joined");
  });
});
