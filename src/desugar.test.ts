/**
 * v1 desugaring is TOTAL.
 *
 * The danger of a desugaring layer is not that it translates something wrongly
 * — byte-neutral.test.ts catches that. It is that it translates something into
 * NOTHING: a directive quietly falling through the desugarer still type-checks,
 * still loads, and simply stops taking effect. So this suite asserts coverage
 * directly: every directive the v1 type declares must be reachable, and every
 * directive actually authored in a shipped profile must produce model facts.
 */
import { describe, expect, it } from "vitest";
import { desugar, surfaceModelOf } from "./transform/desugar.js";
import { deriveSubCoverage, destinationsOf, unclassifiedSubs, type SurfaceModel } from "./transform/model.js";
import { shadcnProfile, type SurfacePlanDirectives } from "./transform/profiles.js";

/** Every key the v1 directive type declares. Update deliberately, never to go green. */
const V1_DIRECTIVES: Array<keyof SurfacePlanDirectives> = [
  "subText",
  "subButtonText",
  "actionProp",
  "textChildProp",
  "textProp",
  "childProp",
  "childrenProp",
  "structuralPassthrough",
  "subTable",
  "subFlatten",
];

/** Did desugaring record anything at all? */
const isEmpty = (m: SurfaceModel): boolean =>
  m.routes.length === 0 &&
  m.collects.length === 0 &&
  Object.keys(m.subIdentity).length === 0 &&
  Object.keys(m.drops).length === 0;

/** A minimal authored value for each directive, enough to exercise its branch. */
const SAMPLE: { [K in keyof SurfacePlanDirectives]-?: SurfacePlanDirectives[K] } = {
  subText: { "x-title": "title" },
  subButtonText: { "x-trigger": "triggerLabel" },
  actionProp: "onConfirm",
  textChildProp: "child",
  textProp: "label",
  childProp: "child",
  childrenProp: "children",
  structuralPassthrough: ["columns"],
  subTable: {
    caption: "t-caption",
    header: "t-header",
    headerCell: "t-head",
    body: "t-body",
    row: "t-row",
    cell: "t-cell",
    targetCaption: "caption",
    targetColumns: "columns",
    targetRows: "rows",
    drops: { "t-footer": "no slot in the synthesized shape" },
  },
  subFlatten: { transparent: ["x-header"], asText: { "x-title": "h3" } },
};

describe("every v1 directive desugars into model facts", () => {
  it.each(V1_DIRECTIVES.map((d) => [d] as const))("%s produces a non-empty model", (directive) => {
    const model = desugar({ [directive]: SAMPLE[directive] } as SurfacePlanDirectives);
    expect(isEmpty(model)).toBe(false);
  });

  it("an empty surface plan produces an empty model (no invented facts)", () => {
    expect(isEmpty(desugar({}))).toBe(true);
    expect(desugar({}).consumesSubtree).toBe(false);
  });

  it("the sample set covers every declared directive — no directive is untested", () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...V1_DIRECTIVES].sort());
  });
});

describe("directives keep their v1 meaning", () => {
  it("only the consuming three absorb the subtree", () => {
    for (const d of ["subText", "subButtonText", "subTable"] as const) {
      expect(desugar({ [d]: SAMPLE[d] } as SurfacePlanDirectives).consumesSubtree).toBe(true);
    }
    // subFlatten rewrites the child list but does NOT consume the subtree.
    for (const d of ["subFlatten", "textProp", "childProp", "childrenProp", "actionProp"] as const) {
      expect(desugar({ [d]: SAMPLE[d] } as SurfacePlanDirectives).consumesSubtree).toBe(false);
    }
  });

  it("textProp and textChildProp overwrite; consuming routes are first-wins", () => {
    expect(desugar({ textProp: "label" }).routes[0].overwrite).toBe(true);
    expect(desugar({ textChildProp: "child" }).routes[0].overwrite).toBe(true);
    expect(desugar({ subText: { a: "title" } }).routes[0].overwrite).toBeUndefined();
  });

  it("structuralPassthrough is ordered before consumed values so it wins", () => {
    const model = desugar({ structuralPassthrough: ["columns"], subTable: SAMPLE.subTable });
    expect(model.routes[0].origin).toBe("structuralPassthrough");
  });

  it("subButtonText carries the lift as an ordered fallback, not a special case", () => {
    const [route] = desugar({ subButtonText: { "x-trigger": "triggerLabel" } }).routes;
    expect(route.from.map((s) => s.kind)).toEqual(["sub-label", "sub-text-lift"]);
  });

  it("childrenProp wins over childProp when a plan declares both (v1 order)", () => {
    const model = desugar({ childProp: "child", childrenProp: "children" });
    expect(model.routes).toHaveLength(1);
    expect(model.routes[0].to).toEqual({ kind: "slots", name: "children" });
  });

  it("subTable becomes nested collects, not a grammar", () => {
    const model = desugar({ subTable: SAMPLE.subTable });
    expect(model.collects).toHaveLength(2);
    // The row-record key was a literal in the v1 emitter; here it is data.
    expect(Object.keys(model.collects[1].item!)).toEqual(["cells"]);
    // A header-cell is accepted wherever a cell is — the set-valued selector.
    const scalar = (model.collects[1].item!.cells as { scalar: { from: Array<{ subs?: string[] }> } }).scalar;
    expect(scalar.from[0].subs).toEqual(["t-cell", "t-head"]);
    // Drops are ordinary drops with their authored reason, not a table concept.
    expect(model.drops["t-footer"]).toContain("no slot");
  });
});

describe("the shipped profile desugars completely", () => {
  const authored = shadcnProfile.components.filter((p) => p.surfacePlan);

  it("every plan with directives produces model facts", () => {
    expect(authored.length).toBeGreaterThan(0);
    for (const plan of authored) {
      expect(`${plan.dspackId}: ${isEmpty(surfaceModelOf(plan)) ? "EMPTY" : "ok"}`).not.toContain("EMPTY");
    }
  });

  it("every destination the model writes names a literal property", () => {
    for (const plan of shadcnProfile.components) {
      for (const dest of destinationsOf(surfaceModelOf(plan))) {
        expect(dest.name).toBeTruthy();
        expect(typeof dest.name).toBe("string");
      }
    }
  });

  it("derived sub coverage accounts for every sub the authored subCoverage lists", () => {
    for (const plan of shadcnProfile.components) {
      const authoredSubs = Object.keys(plan.subCoverage ?? {});
      if (authoredSubs.length === 0) continue;
      // Derivation reproduces the authored prose without being told it — the
      // precondition for retiring `subCoverage` as hand-maintained documentation.
      const derived = deriveSubCoverage(surfaceModelOf(plan), authoredSubs);
      for (const sub of authoredSubs) {
        expect(`${plan.dspackId} -> ${sub}: ${derived.get(sub) ?? "MISSING"}`).not.toContain("MISSING");
      }
      expect(unclassifiedSubs(surfaceModelOf(plan), authoredSubs)).toEqual([]);
    }
  });

  it("a sub the model cannot account for is unclassified, not quietly covered", () => {
    // `badge` has no consuming directive, so an invented sub has nowhere to go.
    const badge = shadcnProfile.components.find((p) => p.dspackId === "badge")!;
    expect(unclassifiedSubs(surfaceModelOf(badge), ["badge-icon"])).toEqual(["badge-icon"]);
  });
});
