/**
 * Layered dissolution contexts (emit#37, ratified 2026-08-07).
 *
 * A dissolving boundary shadows the enclosing compound contexts where they
 * overlap, but does not erase them: dispositions remain available through
 * the ancestor chain. This closes the seam the post-T4 Build matrix measured
 * (eval/t4-build-matrix.json, preference-settings) — an outer compound's sub
 * inside a transparent inner boundary.
 *
 * Fail-first (recorded on main d3aab9f, before the change): the shape below
 * refused at emit with
 *
 *   unknown component 'card-footer': not a mapped component of the '…' profile
 *
 * because T1 dissolution governed the inner boundary's subtree by ITS OWN
 * model alone, so `card-footer` (a sub of the OUTER `card`) found no
 * disposition in the inner `field` model and fell through to emitNode. The
 * surface was S1/S2/S3-clean — spec v0.4 §5.1 accepts it (a `card` ancestor
 * exists at any depth) — so this was purely an emitter seam.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { loadProfile } from "./transform/profile-load.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const contract = JSON.parse(readFileSync(repo("eval/shadcn-v3.dspack.json"), "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const fixture = JSON.parse(readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"));

const profileOf = (keep: string[]) => {
  const doc = structuredClone(fixture) as Record<string, unknown> & { components: Array<{ dspackId: string }> };
  const keepSet = new Set(keep);
  (doc as Record<string, unknown>).intentionallyOmitted = doc.components.filter((c) => !keepSet.has(c.dspackId)).map((c) => c.dspackId).sort();
  doc.components = doc.components.filter((c) => keepSet.has(c.dspackId));
  delete (doc as Record<string, unknown>)["x-scaffold"];
  return loadProfile(doc);
};

const surfaceOf = (root: unknown, intent = "preference-settings"): DspackSurface =>
  ({ dspackSurface: "0.1", system: contract.name as string, intent, root }) as DspackSurface;

const instancesOf = (messages: unknown[]) =>
  (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } }).updateComponents.components;

describe("layered dissolution: an outer compound's sub survives inside a dissolved inner boundary", () => {
  const profile = profileOf(["card", "field", "field-set", "field-group", "switch", "button", "badge"]);

  it("card-footer inside a transparent field resolves against card's model and its button rises", () => {
    const { messages } = emitSurface(
      surfaceOf({
        component: "card",
        children: [
          { component: "card-header", children: [{ component: "card-title", text: "Preferences" }] },
          {
            component: "card-content",
            children: [
              {
                component: "field",
                children: [
                  { component: "field-label", text: "Weekly digest" },
                  { component: "switch", props: { name: "digest" } },
                  { component: "card-footer", children: [{ component: "button", text: "Save" }] },
                ],
              },
            ],
          },
        ],
      }),
      contract,
      { profile },
    );
    const comps = instancesOf(messages);
    // No wrapper instance survives for any dissolved boundary.
    for (const gone of ["Card_footer", "Field", "CardFooter", "CardHeader"]) {
      expect(comps.some((c) => c.component === gone)).toBe(false);
    }
    // The field donated its label onto the switch (T1 still works through the layering).
    const sw = comps.find((c) => c.component === "Switch")!;
    expect(sw.label).toBe("Weekly digest");
    // card-footer dissolved (card's disposition, reached through the ancestor
    // chain) and its button rose as a real instance.
    const button = comps.find((c) => c.component === "Button")!;
    expect(button.child).toBeDefined();
    // The whole thing is emittable and A3-valid.
    const check = transformFromJson(contract, { profile, surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("the inner boundary's own dispositions resolve first (innermost-first walk)", () => {
    // Genuine same-id overlap between two frames is structurally impossible —
    // sub-component ids are unique document-wide (enforced by S2), so the
    // ratified "inner shadows outer" is defined but unreachable for real
    // contracts. What IS observable is that the inner frame is consulted
    // first: field-title inside a dissolved field takes FIELD's asText (h4),
    // never a fallthrough to some outer default.
    const { messages } = emitSurface(
      surfaceOf({
        component: "card",
        children: [
          {
            component: "card-content",
            children: [
              {
                component: "field",
                children: [
                  { component: "field-title", text: "Section" },
                  { component: "switch", props: { name: "x" } },
                ],
              },
            ],
          },
        ],
      }),
      contract,
      { profile },
    );
    const comps = instancesOf(messages);
    const text = comps.find((c) => c.component === "Text" && c.text === "Section")!;
    expect(text).toBeDefined();
    expect(text.variant).toBe("h4"); // field's asText, not card's h3
  });

  it("determinism holds across the layered walk", () => {
    const root = {
      component: "card",
      children: [
        { component: "card-content", children: [{ component: "field", children: [{ component: "field-label", text: "L" }, { component: "switch" }, { component: "card-footer", children: [{ component: "button", text: "Go" }] }] }] },
      ],
    };
    const a = emitSurface(surfaceOf(root), contract, { profile });
    const b = emitSurface(surfaceOf(root), contract, { profile });
    expect(JSON.stringify([a.messages, a.warnings, a.fidelity])).toBe(JSON.stringify([b.messages, b.warnings, b.fidelity]));
  });
});
