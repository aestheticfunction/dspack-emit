/**
 * Emit-profile parity with the canonical shadcn contract (P1.E).
 *
 * Two invariants, born from two latent defects found the day governance
 * first reached the table and card sub-families (both were nominally mapped
 * while their sub-families refused to emit):
 *
 * 1. EVERY worked example in the synced contract emits. The example set is
 *    the contract's own definition of "expressible"; it grows via check-sync
 *    and this suite grows with it.
 * 2. EVERY component id in the contract — including compound sub-components —
 *    is classified as exactly one of: directly mapped; consumed by a named
 *    parent strategy (the parent's explicit subCoverage entry); explicitly
 *    unsupported with a reason (casualtyComponents, covering its subs); or
 *    UNCLASSIFIED, which fails here. A parent mapping never implies support
 *    for its sub-family: only its own subCoverage declarations do.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DspackDoc, DspackSurface } from "./types.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { shadcnProfile } from "./transform/profiles.js";

const doc = JSON.parse(readFileSync("input/shadcn-ui.dspack.json", "utf8")) as DspackDoc & {
  examples: Array<{ id: string; intent: string; surface: DspackSurface }>;
};

describe("every synced worked example emits through the shadcn profile", () => {
  it("the contract carries at least two examples (destructive-action + record-collection)", () => {
    expect(doc.examples.length).toBeGreaterThanOrEqual(2);
  });

  it.each(doc.examples.map((e) => [e.id] as const))("%s", (id) => {
    const example = doc.examples.find((e) => e.id === id)!;
    const { messages, warnings } = emitSurface(example.surface, doc, { profile: shadcnProfile });
    expect(messages).toHaveLength(2);
    // Nothing is silent: lossy projections surface as warnings, never throws.
    for (const w of warnings) expect(w.code).toMatch(/^surface-/);
  });
});

describe("card sub-family flattens instead of refusing", () => {
  it("card-header/card-title/card-description/card-content emit as grouped text", () => {
    const surface: DspackSurface = {
      dspackSurface: "0.1",
      system: "shadcn/ui",
      intent: "record-collection",
      root: {
        component: "card",
        children: [
          { component: "card-header", children: [{ component: "card-title", text: "Open tickets" }] },
          { component: "card-content", text: "Three tickets are open." },
        ],
      },
    } as unknown as DspackSurface;
    const { messages } = emitSurface(surface, doc, { profile: shadcnProfile });
    const flat = JSON.stringify(messages);
    expect(flat).toContain("Open tickets");
    expect(flat).toContain("Three tickets are open.");
  });
});

describe("completeness: every contract id is classified, sub-components included", () => {
  const mapped = new Map(shadcnProfile.components.map((p) => [p.dspackId, p]));
  const casualties = new Map(shadcnProfile.casualtyComponents.map((c) => [c.dspackId, c.reason]));

  it("every component is directly mapped or explicitly unsupported with a reason", () => {
    for (const id of Object.keys(doc.components ?? {})) {
      const classification = mapped.has(id) ? "mapped" : casualties.has(id) ? "casualty" : "UNCLASSIFIED";
      expect(`${id}: ${classification}`).not.toContain("UNCLASSIFIED");
      if (casualties.has(id)) expect(casualties.get(id)!.length).toBeGreaterThan(10);
    }
  });

  it("every sub-component of a mapped compound is classified by its parent's subCoverage", () => {
    for (const [id, component] of Object.entries(doc.components ?? {})) {
      const subs = (component as { composition?: { subComponents?: Array<{ id: string }> } }).composition?.subComponents ?? [];
      if (subs.length === 0) continue;
      if (casualties.has(id)) continue; // the parent's reason covers its family
      const plan = mapped.get(id)!;
      const coverage = plan.subCoverage ?? {};
      for (const sub of subs) {
        const disposition = coverage[sub.id];
        expect(`${id} → ${sub.id}: ${disposition ?? "UNCLASSIFIED"}`).not.toContain("UNCLASSIFIED");
        expect((disposition ?? "").length).toBeGreaterThan(5);
      }
    }
  });

  it("the profile maps nothing the contract does not declare", () => {
    const contractIds = new Set(Object.keys(doc.components ?? {}));
    for (const plan of shadcnProfile.components) {
      expect(contractIds.has(plan.dspackId)).toBe(true);
    }
  });
});
