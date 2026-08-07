/**
 * T2: homogeneous repeated sub-structure → data array (item-mode collection).
 *
 * Fail-first (captured before any code, /tmp/t2-failfirst.txt): the eval
 * ledger carries radio-group-item and select's seven subs among its 80
 * unresolved; the item-mode spelling was refused by the v2 grammar; and
 * ex.notification-preferences refused end-to-end.
 *
 * The measured shapes that scoped this milestone:
 *  - `select-item` carries its label as its OWN text — the pure homogeneous
 *    shape, collected completely by T2;
 *  - `radio-group-item` carries ONLY its id; its label is a SIBLING `label`
 *    joined by htmlFor→id — a DECLARED KEY JOIN, which is T3's mechanism.
 *    T2 collects what each item itself carries ({value: self.id}) and the
 *    sibling labels are dropped WITH RECORD — the measured T3 frontier, not
 *    a T2 defect. Position-based pairing is banned by the ratified model.
 *  - Neither item declares a `value` prop in the contract (the example
 *    encodes value into ids by convention) — a contract-modeling gap noted
 *    for the taxonomy trail, not papered over here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { loadProfile, ProfileLoadError } from "./transform/profile-load.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const contract = JSON.parse(readFileSync(repo("eval/shadcn-v3.dspack.json"), "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const fixture = JSON.parse(readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"));

const RG_T2_SURFACE = {
  collects: [{ of: ["radio-group-item"], into: "prop:options", item: { value: "self.id" } }],
};
const SELECT_T2_SURFACE = {
  collects: [{ of: ["select-item"], into: "prop:options", item: { label: "self.text" } }],
  subs: {
    "select-trigger": { drop: "the trigger renders from the bound value, not authored content" },
    "select-value": { drop: "the visible value is runtime state derived from the selection" },
    "select-label": { drop: "group headings are not carried by the flat options shape" },
    "select-separator": { drop: "visual grouping chrome with no data meaning" },
  },
};

/** Hermetic T2 profile: radio-group + select plans over the eval fixture base. */
const t2Profile = (mutate?: (doc: Record<string, unknown>) => void) => {
  const base = structuredClone(fixture) as Record<string, unknown> & { components: Array<Record<string, unknown>> };
  const pick = (id: string) => structuredClone(base.components.find((c) => c.dspackId === id)!);
  const radioGroup = {
    a2ui: "RadioGroup",
    dspackId: "radio-group",
    commons: ["ComponentCommon"],
    structural: {
      options: {
        schema: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value"], additionalProperties: false } },
        description: "The selectable options, one record per item.",
        synthNote: "A2UI models repeated options as data on the group; dspack models them as repeated sub-components.",
      },
    },
    propMap: { name: { a2ui: "name", kind: "string" }, defaultValue: { a2ui: "defaultValue", kind: "string" } },
    required: ["options"],
    surface: structuredClone(RG_T2_SURFACE),
  };
  const select = {
    a2ui: "Select",
    dspackId: "select",
    commons: ["ComponentCommon"],
    structural: {
      options: {
        schema: { type: "array", items: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false } },
        description: "The selectable options.",
        synthNote: "A2UI models repeated options as data on the control.",
      },
    },
    propMap: { defaultValue: { a2ui: "defaultValue", kind: "string" } },
    required: ["options"],
    surface: structuredClone(SELECT_T2_SURFACE),
  };
  const doc: Record<string, unknown> & { components: Array<Record<string, unknown>> } = {
    ...base,
    components: [pick("card"), radioGroup, select],
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

describe("T2 grammar and gates", () => {
  it("the item-mode spelling loads (the fail-first refusal, inverted)", () => {
    expect(t2Profile().language).toBe("v2");
  });

  it("mixing item-mode and table-mode keys refuses", () => {
    expect(() =>
      t2Profile((doc) => {
        const rg = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "radio-group")!;
        rg.surface = { collects: [{ of: ["radio-group-item"], into: "prop:options", item: { value: "self.id" }, shape: "flat", row: ["x"], cells: ["y"] }] };
      }),
    ).toThrowError(ProfileLoadError);
  });

  it("item fields are item-local: a sub() read refuses at the item field's path", () => {
    // The schema's closed item-selector pattern fires first (self.text |
    // self.id | self.props.<prop>); the parse layer carries the same rule
    // with a T3-naming message as defense-in-depth behind it.
    try {
      t2Profile((doc) => {
        const rg = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "radio-group")!;
        rg.surface = { collects: [{ of: ["radio-group-item"], into: "prop:options", item: { label: "sub(label).text" } }] };
      });
      expect.unreachable("a join read must refuse");
    } catch (e) {
      const issues = (e as ProfileLoadError).issues;
      expect(issues.some((i) => i.path.includes("/item/label") || i.path.includes("collects"))).toBe(true);
      expect(issues.map((i) => i.message).join("\n")).toContain("pattern");
    }
  });
});

describe("T2 collects the measured shapes", () => {
  it("select: the pure homogeneous shape collects completely", () => {
    const s = surfaceOf({
      component: "select",
      props: { defaultValue: "all" },
      children: [
        {
          component: "select-content",
          children: [
            { component: "select-item", text: "All roles" },
            { component: "select-item", text: "Admins" },
            { component: "select-item", text: "Editors" },
          ],
        },
      ],
    });
    const { messages } = emitSurface(s, contract, { profile: t2Profile() });
    const [sel] = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(sel.component).toBe("Select");
    expect(sel.options).toEqual([{ label: "All roles" }, { label: "Admins" }, { label: "Editors" }]);
    const check = transformFromJson(contract, { profile: t2Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("radio-group: items collect what they carry; sibling labels are the recorded T3 frontier", () => {
    const { messages, warnings, fidelity } = emitSurface(surfaceOf(RG_SURFACE), contract, { profile: t2Profile() });
    const [rg] = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(rg.component).toBe("RadioGroup");
    expect(rg.name).toBe("digest");
    expect(rg.options).toEqual([{ value: "digest-monday" }, { value: "digest-friday" }]);

    // The htmlFor-joined sibling labels are dropped WITH RECORD, naming T3.
    const labelDrops = warnings.filter((w) => w.code === "surface-sub-dropped" && w.message.includes("'label'"));
    expect(labelDrops).toHaveLength(2);
    expect(labelDrops[0].message).toContain("T3");
    expect(fidelity.filter((f) => f.kind === "dropped" && f.source.includes("label"))).toHaveLength(2);

    // Each collected record is ledgered with its source item.
    const collected = fidelity.filter((f) => f.kind === "moved" && f.note?.includes("item record"));
    expect(collected).toHaveLength(2);
    expect(collected[0].source).toContain("radio-group-item");

    const check = transformFromJson(contract, { profile: t2Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("emission is deterministic across runs", () => {
    const a = emitSurface(surfaceOf(RG_SURFACE), contract, { profile: t2Profile() });
    const b = emitSurface(surfaceOf(RG_SURFACE), contract, { profile: t2Profile() });
    expect(JSON.stringify([a.messages, a.warnings, a.fidelity])).toBe(JSON.stringify([b.messages, b.warnings, b.fidelity]));
  });

  it("an item missing its field omits it, and A3 arbitrates — never synthesis", () => {
    const s = surfaceOf({
      component: "radio-group",
      children: [{ component: "radio-group-item" }], // no id at all
    });
    const { messages } = emitSurface(s, contract, { profile: t2Profile() });
    const [rg] = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(rg.options).toEqual([{}]);
    // The record schema requires `value`, so A3 refuses the emission.
    const check = transformFromJson(contract, { profile: t2Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(false);
  });

  it("derived coverage resolves both families through the collects", () => {
    const out = (() => {
      try {
        return transformFromJson(contract, { profile: t2Profile() });
      } catch {
        return undefined;
      }
    })();
    // The hermetic profile passes the contract gate (card + both T2 plans).
    expect(out).toBeDefined();
    const unresolved = out!.mapping.coverage.filter(
      (c) => c.disposition === "unclassified" && (c.id.startsWith("radio-group.") || c.id.startsWith("select.")),
    );
    expect(unresolved).toEqual([]);
    expect(out!.mapping.coverage.find((c) => c.id === "radio-group.radio-group-item")?.detail).toContain("collected");
  });
});
