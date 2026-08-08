/**
 * T4: multi-slot compounds — `sub(x).children -> slot:name`.
 *
 * Fail-first (/tmp/t4-failfirst.txt, captured at main e21e0bf before any
 * code): the spelling was refused by the v2 grammar ("must match pattern");
 * the 50-unresolved ledger carried dialog 7 + sheet 7 + popover 6 +
 * dropdown-menu 12; ex.invite-teammates-dialog and
 * ex.customer-context-sheet refused end-to-end; and the containment
 * re-baseline's overlay-task produced a fully lint-clean surface the
 * emitter refused on unmapped 'dialog'.
 *
 * The primitive is ONE closed spelling: the ordered children of exactly one
 * descendant instance of the named region become instances; the slot
 * carries the reference (multi wraps in Column — T3's joined-children
 * discipline). Regions have no fallback chains, one region feeds one slot,
 * zero regions leave the destination absent for gate A3, several refuse.
 * Claimed subs (text harvests, sibling slots) are skipped at any
 * dissolution depth — their consumption is their own route's ledger line.
 *
 * The measured surprise, followed rather than the roadmap: dropdown-menu is
 * DATA-shaped (a T2 collect + scalar text routes) and needs no slot at all.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";
import { loadProfile, ProfileLoadError } from "./transform/profile-load.js";
import { SHADCN_V3_T4_PLANS } from "./transform/shadcn-v2-respelling.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const contract = JSON.parse(readFileSync(repo("eval/shadcn-v3.dspack.json"), "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const fixture = JSON.parse(readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"));

const KEEP = ["card", "badge", "button", "input", "textarea", "select", "field", "field-set", "field-group", "scroll-area", "dialog", "sheet", "popover", "dropdown-menu"];

const t4Profile = (mutate?: (doc: Record<string, unknown>) => void) => {
  const base = structuredClone(fixture) as Record<string, unknown> & {
    components: Array<Record<string, unknown> & { dspackId: string }>;
  };
  base.components = base.components.map((plan) => {
    const t4 = SHADCN_V3_T4_PLANS[plan.dspackId];
    return t4 ? (structuredClone(t4) as typeof plan) : plan;
  });
  const keepSet = new Set(KEEP);
  base.intentionallyOmitted = base.components.filter((c) => !keepSet.has(c.dspackId)).map((c) => c.dspackId).sort();
  base.components = base.components.filter((c) => keepSet.has(c.dspackId));
  delete (base as Record<string, unknown>)["x-scaffold"];
  mutate?.(base);
  return loadProfile(base);
};

const surfaceOf = (root: unknown, intent = "overlay-task"): DspackSurface =>
  ({ dspackSurface: "0.1", system: contract.name as string, intent, root }) as DspackSurface;

const emit = (root: unknown, profile = t4Profile()) => emitSurface(surfaceOf(root), contract, { profile });

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

const instancesOf = (messages: unknown[]) =>
  (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;

describe("T4 grammar and gates", () => {
  it("the slot spelling loads (the fail-first refusal, inverted)", () => {
    expect(t4Profile().language).toBe("v2");
  });

  it("a region has no fallback chain: sub(a|b).children refuses", () => {
    expect(() =>
      t4Profile((doc) => {
        const d = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "dialog")!;
        (d.surface as { routes: unknown[] }).routes = [{ from: ["sub(dialog-content|dialog-footer).children"], to: "slot:child" }];
      }),
    ).toThrowError(ProfileLoadError);
  });

  it("one region, one slot: the same sub sourcing two slot routes refuses", () => {
    expect(() =>
      t4Profile((doc) => {
        const d = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "dialog")!;
        (d.surface as { routes: unknown[] }).routes = [
          { from: ["sub(dialog-content).children"], to: "slot:child" },
          { from: ["sub(dialog-content).children"], to: "slot:footer" },
        ];
      }),
    ).toThrowError(ProfileLoadError);
  });

  it("sub(x).children lands only in a slot: prop destination refuses", () => {
    expect(() =>
      t4Profile((doc) => {
        const d = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "dialog")!;
        (d.surface as { routes: unknown[] }).routes = [{ from: ["sub(dialog-content).children"], to: "prop:title" }];
      }),
    ).toThrowError(ProfileLoadError);
  });
});

describe("T4 — dialog (the production invite-teammates shape, verbatim)", () => {
  it("emits {title, description, triggerLabel, closeLabel, child, footer}; fields inside the slot dissolve and donate", () => {
    const { messages, fidelity } = emit(fromExample("ex.invite-teammates-dialog", "dialog"));
    const comps = instancesOf(messages);
    const dialog = comps.find((c) => c.component === "Dialog")!;
    expect(dialog.title).toBe("Invite people to Northwind");
    expect(dialog.triggerLabel).toBe("Invite people");
    expect(dialog.closeLabel).toBe("Cancel");
    expect(typeof dialog.description).toBe("string");

    // The body slot: two fields dissolve to Textarea + Select, each followed
    // by its field-description as a Text caption — four instances,
    // Column-wrapped, in reading order.
    const body = comps.find((c) => c.id === dialog.child)!;
    expect(body.component).toBe("Column");
    const textarea = comps.find((c) => c.component === "Textarea")!;
    const select = comps.find((c) => c.component === "Select")!;
    expect(textarea.label).toBe("Email addresses");
    expect(select.label).toBe("Role");
    expect((select.options as unknown[]).length).toBe(3);
    const bodyIds = body.children as string[];
    expect(bodyIds).toHaveLength(4);
    expect(bodyIds[0]).toBe(textarea.id);
    expect(bodyIds[2]).toBe(select.id);
    for (const i of [1, 3]) {
      const t = comps.find((c) => c.id === bodyIds[i])!;
      expect(t.component).toBe("Text");
      expect(t.variant).toBe("caption");
    }

    // The footer slot: close is a claimed text lift; the send button remains.
    const footerRef = comps.find((c) => c.id === dialog.footer)!;
    expect(footerRef.component).toBe("Button");
    expect(footerRef.child).toBeDefined();

    // No wrapper instance for header; the regions ledger as moved.
    expect(comps.some((c) => c.component === "DialogHeader")).toBe(false);
    expect(fidelity.some((f) => f.kind === "moved" && f.source.includes("dialog-content children"))).toBe(true);

    const profile = t4Profile();
    const check = transformFromJson(contract, { profile, surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("two instances of a region refuse: a slot names ONE region", () => {
    expect(() =>
      emit({
        component: "dialog",
        children: [
          { component: "dialog-content", children: [{ component: "dialog-title", text: "A" }] },
          { component: "dialog-content", children: [{ component: "badge", text: "B" }] },
        ],
      }),
    ).toThrowError(/ONE region/);
  });

  it("an unclaimed direct child of a slot compound refuses — fail-closed, never approximated", () => {
    expect(() =>
      emit({
        component: "dialog",
        children: [
          { component: "dialog-content", children: [{ component: "dialog-title", text: "T" }] },
          { component: "badge", text: "stray" },
        ],
      }),
    ).toThrowError(/no destination/);
  });

  it("a casualty inside a slot still refuses (casualty enforcement is live inside regions)", () => {
    const profile = t4Profile((doc) => {
      (doc.casualtyComponents as unknown[]) = [
        { dspackId: "badge", attempted: "(none)", class: "cannot-represent", reason: "test casualty" },
      ];
      (doc.components as Array<Record<string, unknown>>).splice(
        (doc.components as Array<Record<string, unknown>>).findIndex((c) => c.dspackId === "badge"),
        1,
      );
    });
    expect(() =>
      emit(
        {
          component: "dialog",
          children: [
            { component: "dialog-content", children: [{ component: "dialog-title", text: "T" }, { component: "badge", text: "x" }] },
          ],
        },
        profile,
      ),
    ).toThrowError(/declared casualty/);
  });
});

describe("T4 — sheet composes with shipped primitives (the customer-context shape, verbatim)", () => {
  it("scroll-area DISSOLVES inside the body slot; cards emit; footer keeps the non-close action", () => {
    const { messages } = emit(fromExample("ex.customer-context-sheet", "sheet"));
    const comps = instancesOf(messages);
    const sheet = comps.find((c) => c.component === "Sheet")!;
    expect(sheet.title).toBe("Amara Okafor");
    expect(sheet.triggerLabel).toBe("Customer context");
    expect(sheet.closeLabel).toBe("Close");
    expect(comps.some((c) => c.component === "ScrollArea")).toBe(false);
    const body = comps.find((c) => c.id === sheet.child)!;
    expect(body.component).toBe("Column");
    expect((body.children as string[]).length).toBe(3);
    for (const cid of body.children as string[]) {
      expect(comps.find((c) => c.id === cid)!.component).toBe("Card");
    }
    const check = transformFromJson(contract, { profile: t4Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });
});

describe("T4 — popover's measured empty body stays absent", () => {
  it("emits {triggerLabel, title, description}; the child slot is absent and A3 accepts it", () => {
    const { messages } = emit(fromExample("ex.usage-help-affordances", "popover"));
    const comps = instancesOf(messages);
    const pop = comps.find((c) => c.component === "Popover")!;
    expect(pop.triggerLabel).toBe("How usage is measured");
    expect(pop.title).toBe("How usage is measured");
    expect(pop.child).toBeUndefined();
    const check = transformFromJson(contract, { profile: t4Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });
});

describe("T4 finding — dropdown-menu is data, not slots (measurement over roadmap)", () => {
  it("the production workspace menu emits {triggerLabel, menuLabel, items}; the separator drops with record", () => {
    const { messages, fidelity } = emit(fromExample("ex.workspace-members-directory", "dropdown-menu"));
    const comps = instancesOf(messages);
    const menu = comps.find((c) => c.component === "DropdownMenu")!;
    expect(menu.triggerLabel).toBe("Member actions");
    expect(menu.menuLabel).toBe("Selected members");
    expect(menu.items).toEqual([
      { label: "Resend invitation" },
      { label: "Change role" },
      { label: "Export as CSV" },
    ]);
    // The nested separator's loss rides the collect's flatten record (it is
    // inside dropdown-menu-content, not a direct child); the authored drop
    // reason lives on the coverage row — the same two-channel honesty as A0.
    expect(fidelity.some((f) => f.kind === "flattened" && f.class === "lossy")).toBe(true);
    const out = transformFromJson(contract, { profile: t4Profile() });
    expect(out.mapping.coverage.find((c) => c.id === "dropdown-menu.dropdown-menu-separator")?.detail).toContain("divider");
    const check = transformFromJson(contract, { profile: t4Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });
});

describe("T4 — ledger and determinism", () => {
  it("all four families derive zero unresolved subs", () => {
    const out = transformFromJson(contract, { profile: t4Profile() });
    const unresolved = out.mapping.coverage.filter(
      (c) => c.disposition === "unclassified" &&
        ["dialog.", "sheet.", "popover.", "dropdown-menu."].some((p) => c.id.startsWith(p)),
    );
    expect(unresolved).toEqual([]);
    expect(out.mapping.coverage.find((c) => c.id === "dialog.dialog-content")?.detail).toContain("slot");
  });

  it("emission is deterministic across runs", () => {
    const subtree = fromExample("ex.invite-teammates-dialog", "dialog");
    const a = emit(subtree);
    const b = emit(subtree);
    expect(JSON.stringify([a.messages, a.warnings, a.fidelity])).toBe(JSON.stringify([b.messages, b.warnings, b.fidelity]));
  });
});
