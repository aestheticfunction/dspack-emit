/**
 * A0: the zero-new-capability authoring milestone — production-v3 profile
 * judgment expressed entirely in the shipped Identity/Routing/Repetition
 * vocabulary (T1 transparency + donation, routes, drops-with-record). No
 * new primitive; every decision grounded in measured usage and recorded
 * with fidelity.
 *
 * Fail-first: before this overlay the six compound families sat in the
 * 67-unresolved ledger (alert 3, avatar 5, scroll-area 2, field 5,
 * field-set 1, field-group 1 — eval-fixture.test.ts pins the 67), and the
 * touched examples refused end-to-end (ex.order-detail-summary on
 * 'avatar', ex.delete-project-confirmation on 'alert', …).
 *
 * The two honest losses, dropped WITH RECORD, never approximated:
 *  - alert-action holds component children; routing a sub's children to a
 *    slot is T4's mechanism — one production instance affected;
 *  - avatar-image is an EMPTY node (the contract declares no src/alt —
 *    the dspack#39 contract-gap class, named on the drop).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { loadProfile } from "./transform/profile-load.js";
import { SHADCN_V3_A0_PLANS, SHADCN_V3_A0_LABEL_ADDITIONS } from "./transform/shadcn-v2-respelling.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const contract = JSON.parse(readFileSync(repo("eval/shadcn-v3.dspack.json"), "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const fixture = JSON.parse(readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"));

/** The builder's A0 merge, hermetically: keep a family set, apply the overlay. */
const a0Profile = (keep: string[]) => {
  const base = structuredClone(fixture) as Record<string, unknown> & {
    components: Array<Record<string, unknown> & { dspackId: string; structural?: Record<string, unknown> }>;
  };
  base.components = base.components.map((plan) => {
    const a0 = SHADCN_V3_A0_PLANS[plan.dspackId];
    return a0 ? (structuredClone(a0) as typeof plan) : plan;
  });
  for (const [id, note] of Object.entries(SHADCN_V3_A0_LABEL_ADDITIONS)) {
    const plan = base.components.find((c) => c.dspackId === id);
    if (plan && !(plan.structural ?? {}).label) {
      plan.structural = { ...(plan.structural ?? {}), label: { schema: { type: "string" }, description: note.description, synthNote: note.synthNote } };
    }
  }
  const keepSet = new Set(keep);
  base.intentionallyOmitted = base.components.filter((c) => !keepSet.has(c.dspackId)).map((c) => c.dspackId).sort();
  base.components = base.components.filter((c) => keepSet.has(c.dspackId));
  delete (base as Record<string, unknown>)["x-scaffold"];
  return loadProfile(base);
};

const surfaceOf = (root: unknown, intent = "record-detail"): DspackSurface =>
  ({ dspackSurface: "0.1", system: contract.name as string, intent, root }) as DspackSurface;

/** Find the first subtree of a component in a worked example, verbatim. */
const fromExample = (exampleId: string, component: string): Record<string, unknown> => {
  const ex = contract.examples.find((e) => e.id === exampleId)!;
  let hit: Record<string, unknown> | undefined;
  const walk = (n: Record<string, unknown>): void => {
    if (hit) return;
    if (n.component === component) { hit = n; return; }
    for (const c of (n.children as Record<string, unknown>[] | undefined) ?? []) walk(c);
  };
  walk(ex.surface.root as unknown as Record<string, unknown>);
  expect(hit, `${component} in ${exampleId}`).toBeDefined();
  return structuredClone(hit!);
};

const firstInstance = (messages: unknown[], component: string): Record<string, unknown> => {
  const comps = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;
  const inst = comps.find((c) => c.component === component);
  expect(inst, `an emitted ${component}`).toBeDefined();
  return inst!;
};

describe("A0 — alert (routes over the shipped vocabulary)", () => {
  it("the production delete-project alert emits {title, description}", () => {
    const profile = a0Profile(["card", "alert", "badge", "button"]);
    const { messages } = emitSurface(surfaceOf(fromExample("ex.delete-project-confirmation", "alert")), contract, { profile });
    const alert = firstInstance(messages, "Alert");
    expect(typeof alert.title).toBe("string");
    expect((alert.title as string).length).toBeGreaterThan(0);
    expect(typeof alert.description).toBe("string");
    const check = transformFromJson(contract, { profile, surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("alert-action's loss is recorded, never silent: the flatten ledger marks it lossy and the coverage detail names T4", () => {
    const profile = a0Profile(["card", "alert", "badge", "button"]);
    const { messages, warnings, fidelity } = emitSurface(
      surfaceOf(fromExample("ex.import-run-status", "alert")), contract, { profile });
    firstInstance(messages, "Alert");
    // Runtime record: the consumed subtree is ledgered lossy (the engine's
    // consumesSubtree record — the action button is inside it).
    expect(warnings.some((w) => w.code === "surface-composition-flattened")).toBe(true);
    expect(fidelity.some((f) => f.kind === "flattened" && f.class === "lossy" && f.source.includes("alert"))).toBe(true);
    // Documented judgment: the coverage ledger carries the drop reason,
    // naming T4 as the mechanism the slot waits for.
    const out = transformFromJson(contract, { profile });
    const row = out.mapping.coverage.find((c) => c.id === "alert.alert-action");
    expect(row?.disposition).toBe("mapped");
    expect(row?.detail).toContain("T4");
  });
});

describe("A0 — avatar", () => {
  it("the production order-detail avatar emits {size, fallback}; the empty avatar-image drop names the contract gap", () => {
    const profile = a0Profile(["card", "avatar", "badge"]);
    const { messages, fidelity } = emitSurface(surfaceOf(fromExample("ex.order-detail-summary", "avatar")), contract, { profile });
    const avatar = firstInstance(messages, "Avatar");
    expect(avatar.fallback).toBe("AO");
    expect(avatar.size).toBe("lg");
    // The consumed subtree (with the empty avatar-image inside) is ledgered
    // lossy; the drop's dspack#39 rationale lives on the coverage row.
    expect(fidelity.some((f) => f.kind === "flattened" && f.class === "lossy")).toBe(true);
    const out = transformFromJson(contract, { profile });
    expect(out.mapping.coverage.find((c) => c.id === "avatar.avatar-image")?.detail).toContain("dspack#39");
    const check = transformFromJson(contract, { profile, surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });
});

describe("A0 — scroll-area dissolves (T1 vocabulary, no instance)", () => {
  it("children rise; scrollbar chrome drops with record", () => {
    const profile = a0Profile(["card", "scroll-area", "badge"]);
    const { messages } = emitSurface(
      surfaceOf({
        component: "card",
        children: [{ component: "scroll-area", children: [{ component: "badge", text: "42 open" }] }],
      }),
      contract,
      { profile },
    );
    const comps = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;
    expect(comps.some((c) => c.component === "ScrollArea")).toBe(false);
    expect(comps.some((c) => c.component === "Badge")).toBe(true);
  });
});

describe("A0 — the corrected field family (dspack#40) emits end-to-end", () => {
  it("the production notification-preferences field-set subtree: legend becomes text, groups dissolve, labels donate onto switches", () => {
    const profile = a0Profile(["card", "field", "field-set", "field-group", "switch", "radio-group", "separator", "badge", "button"]);
    const subtree = fromExample("ex.notification-preferences", "field-set");
    const { messages, fidelity } = emitSurface(surfaceOf(subtree, "preference-settings"), contract, { profile });
    const comps = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;
    // No wrapper survives.
    for (const gone of ["FieldSet", "FieldGroup", "Field"]) {
      expect(comps.some((c) => c.component === gone), `${gone} must not emit`).toBe(false);
    }
    // The legend text survives as a Text instance.
    expect(comps.some((c) => c.component === "Text")).toBe(true);
    // Every switch carries its donated label.
    const switches = comps.filter((c) => c.component === "Switch");
    expect(switches.length).toBeGreaterThan(0);
    for (const sw of switches) expect(typeof sw.label).toBe("string");
    // Donation provenance is ledgered.
    expect(fidelity.some((f) => f.note?.includes("donated by 'field-label'"))).toBe(true);
    const check = transformFromJson(contract, { profile, surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("a field's textarea and select receive the donated label (the invite-teammates shapes)", () => {
    const profile = a0Profile(["card", "field", "field-set", "field-group", "textarea", "select", "badge"]);
    const t = emitSurface(
      surfaceOf({ component: "field", children: [{ component: "field-label", text: "Personal note" }, { component: "textarea", props: { rows: 3 } }] }),
      contract, { profile });
    expect(firstInstance(t.messages, "Textarea").label).toBe("Personal note");

    const s = emitSurface(
      surfaceOf({
        component: "field",
        children: [
          { component: "field-label", text: "Workspace role" },
          { component: "select", children: [{ component: "select-content", children: [{ component: "select-item", text: "Editor" }] }] },
        ],
      }),
      contract, { profile });
    const sel = firstInstance(s.messages, "Select");
    expect(sel.label).toBe("Workspace role");
    expect(sel.options).toEqual([{ label: "Editor" }]);
  });
});

describe("A0 — shipped primitives compose: transparency inside a joined panel", () => {
  it("a transparent scroll-area inside tabs-content dissolves instead of refusing (the ex.project-workspace-panels shape)", () => {
    // Discovered by the A0 re-measurement: the T3 joined-children path fed
    // raw children to emitNode, skipping the parent-style rewrite that
    // dissolves transparent children — a composition bug between shipped
    // primitives, fixed by mirroring the transparent-root host pattern.
    const profile = a0Profile(["card", "tabs", "scroll-area", "badge"]);
    const { messages } = emitSurface(
      surfaceOf({
        component: "tabs",
        children: [
          { component: "tabs-list", children: [{ component: "tabs-trigger", id: "t1", text: "Overview" }] },
          { component: "tabs-content", id: "t1", children: [{ component: "scroll-area", children: [{ component: "badge", text: "42 open" }] }] },
        ],
      }),
      contract, { profile });
    const comps = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;
    expect(comps.some((c) => c.component === "ScrollArea")).toBe(false);
    const tabs = comps.find((c) => c.component === "Tabs")!;
    const sections = tabs.sections as Array<{ child: string }>;
    expect(sections).toHaveLength(1);
    const badge = comps.find((c) => c.component === "Badge")!;
    expect(sections[0].child).toBe(badge.id);
    const check = transformFromJson(contract, { profile, surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });
});

describe("A0 — ledger and determinism", () => {
  it("the six authored families derive zero unresolved subs", () => {
    const profile = a0Profile(["card", "alert", "avatar", "scroll-area", "field", "field-set", "field-group", "switch", "badge", "button"]);
    const out = transformFromJson(contract, { profile });
    const unresolved = out.mapping.coverage.filter(
      (c) => c.disposition === "unclassified" &&
        ["alert.", "avatar.", "scroll-area.", "field.", "field-set.", "field-group."].some((p) => c.id.startsWith(p)),
    );
    expect(unresolved).toEqual([]);
  });

  it("emission is deterministic across runs", () => {
    const profile = a0Profile(["card", "field", "field-set", "field-group", "switch", "badge"]);
    const subtree = fromExample("ex.notification-preferences", "field-set");
    const a = emitSurface(surfaceOf(subtree, "preference-settings"), contract, { profile });
    const b = emitSurface(surfaceOf(subtree, "preference-settings"), contract, { profile });
    expect(JSON.stringify([a.messages, a.warnings, a.fidelity])).toBe(JSON.stringify([b.messages, b.warnings, b.fidelity]));
  });
});
