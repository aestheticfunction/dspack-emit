/**
 * Contract-facing validation: what a profile can only be wrong about against
 * a contract, proven to refuse (v2) and proven NOT to change behaviour (v1).
 *
 * The enforcement decision this file records: derived sub-component coverage
 * is fatal for v2 profiles at every entry, and report-plus-`--strict-coverage`
 * for v1. Measured before enforcement (scripts/sub-coverage-report.mjs, the
 * 2aac076 record): pinned shadcn v2.3.0, astryx and acme all derive zero
 * unresolved subs — so the fatal gate refuses no shipped artifact, only
 * future profiles with genuine gaps, which is the point.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { loadProfile } from "./transform/profile-load.js";
import { ProfileContractError } from "./transform/validate-v2.js";
import { shadcnProfile } from "./transform/profiles.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;

/** A minimal v2 document whose one plan maps the contract's `card` compound. */
const v2Doc = (surface: unknown): Record<string, unknown> => ({
  profileVersion: "2",
  catalogTitle: "t",
  catalogDescription: "d",
  catalogIdBase: "https://example.test/catalogs/x",
  instructions: "",
  primaryColorToken: { category: "color", name: "primary" },
  surfaceSynthesis: { textComponent: "Text", textProp: "text", wrapComponent: "Column", wrapChildrenProp: "children" },
  synthesized: [
    {
      a2ui: "Text",
      commons: ["ComponentCommon"],
      structural: { text: { schema: { type: "string" }, description: "d", synthNote: "s" } },
      propMap: { variant: { a2ui: "variant", kind: "enum", targetEnum: ["body", "h3", "caption"] } },
      required: ["text"],
    },
    {
      a2ui: "Column",
      commons: ["ComponentCommon"],
      structural: { children: { schema: { type: "array" }, description: "d", synthNote: "s" } },
      required: ["children"],
    },
  ],
  casualtyComponents: [],
  components: [
    {
      a2ui: "Card",
      dspackId: "card",
      commons: ["ComponentCommon"],
      structural: {
        child: { schema: { type: "string" }, description: "d", synthNote: "s" },
        label: { schema: { type: "string" }, description: "d", synthNote: "s" },
      },
      required: ["child"],
      surface,
    },
  ],
});

/** The full card sub-family, resolved — the baseline that passes the gate. */
const RESOLVED = {
  routes: [{ from: ["children"], to: "slot:child" }],
  subs: {
    "card-header": "transparent",
    "card-content": "transparent",
    "card-footer": "transparent",
    "card-title": { asText: "h3" },
    "card-description": { asText: "caption" },
  },
};

const refusal = (surface: unknown): string => {
  try {
    transformFromJson(doc, { profile: loadProfile(v2Doc(surface)) });
    return "PASSED";
  } catch (e) {
    if (e instanceof ProfileContractError) return e.issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    throw e;
  }
};

describe("v2 contract validation refuses before emission", () => {
  it("a fully resolved plan passes the gate", () => {
    expect(refusal(RESOLVED)).toBe("PASSED");
  });

  it("an unresolved sub-component refuses, naming the sub and the decision to make", () => {
    const { subs } = structuredClone(RESOLVED) as { subs: Record<string, unknown> };
    delete subs["card-footer"];
    const out = refusal({ ...RESOLVED, subs });
    expect(out).toContain("'card-footer' of 'card' is unresolved");
    expect(out).toContain("route, collect, transparent, asText, or drop");
  });

  it("a sub the contract does not declare refuses", () => {
    const out = refusal({
      ...RESOLVED,
      subs: { ...RESOLVED.subs, "card-sidebar": "transparent" },
    });
    expect(out).toContain("'card-sidebar' is neither a declared sub-component of 'card' nor a component");
  });

  it("reading an undeclared prop into a renamed destination refuses; the passthrough shape passes", () => {
    const renamed = refusal({
      ...RESOLVED,
      routes: [...RESOLVED.routes, { from: ["self.props.badge"], to: "prop:label" }],
    });
    expect(renamed).toContain("self.props.badge");
    expect(renamed).toContain("not a same-named structural passthrough");

    const passthrough = refusal({
      ...RESOLVED,
      routes: [...RESOLVED.routes, { from: ["self.props.label"], to: "prop:label" }],
    });
    expect(passthrough).toBe("PASSED");
  });

  it("emitSurface runs the same gate as transform", () => {
    const { subs } = structuredClone(RESOLVED) as { subs: Record<string, unknown> };
    delete subs["card-footer"];
    const surface: DspackSurface = {
      dspackSurface: "0.1",
      system: doc.name as string,
      intent: "record-collection",
      root: { component: "card", children: [] },
    } as unknown as DspackSurface;
    expect(() => emitSurface(surface, doc, { profile: loadProfile(v2Doc({ ...RESOLVED, subs })) })).toThrowError(
      ProfileContractError,
    );
  });
});

describe("v1 behaviour is frozen: report, not refusal", () => {
  it("a v1 profile with an unresolved sub still transforms — the gap lands in coverage", () => {
    // The shipped card plan, its subFlatten stripped: card's five subs become
    // unresolved. v1 must keep transforming (byte-frozen behaviour) while the
    // coverage report says exactly what is missing.
    const gappy = {
      ...structuredClone(shadcnProfile),
      components: shadcnProfile.components.map((p) =>
        p.dspackId === "card" ? { ...p, surfacePlan: { childProp: "child" } } : p,
      ),
    };
    const out = transformFromJson(doc, { profile: gappy });
    const unresolved = out.mapping.coverage.filter(
      (c) => c.disposition === "unclassified" && c.id.startsWith("card."),
    );
    expect(unresolved.map((c) => c.id).sort()).toEqual([
      "card.card-content",
      "card.card-description",
      "card.card-footer",
      "card.card-header",
      "card.card-title",
    ]);
    // And the strict-coverage contract: these are exactly what exit 3 keys on.
    expect(out.mapping.warnings.some((w) => w.code === "unresolved-sub:card.card-title")).toBe(true);
  });

  it("the shipped profiles derive zero unresolved subs — the measured gate behind enforcement", () => {
    const out = transformFromJson(doc, { profile: shadcnProfile });
    const unresolved = out.mapping.coverage.filter((c) => c.disposition === "unclassified");
    expect(unresolved).toEqual([]);
    // Derived sub rows exist and carry their classification.
    const subRows = out.mapping.coverage.filter((c) => c.id.includes("."));
    expect(subRows.length).toBeGreaterThanOrEqual(20);
    expect(subRows.every((c) => c.disposition === "mapped" && c.detail)).toBe(true);
  });
});
