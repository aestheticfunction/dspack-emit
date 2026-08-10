/**
 * Regression pins for the adversarial review of the v2 foundation (workflow
 * wf_1c1cc374-ced: 17 agents, 13 confirmed findings, 10 distinct defects —
 * every one in the new v2/ledger surface, none in the byte-frozen v1 paths).
 *
 * Each test is named for its finding and failed against the pre-fix code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { loadProfile, ProfileLoadError } from "./transform/profile-load.js";
import { ProfileContractError } from "./transform/validate-v2.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;

const surface = (root: unknown, intent = "record-collection"): DspackSurface =>
  ({ dspackSurface: "0.1", system: doc.name as string, intent, root }) as DspackSurface;

const CARD_SUBS = {
  "card-header": "transparent",
  "card-content": "transparent",
  "card-footer": "transparent",
  "card-title": { asText: "h3" },
  "card-description": { asText: "caption" },
};

const v2Doc = (
  cardSurface: unknown,
  opts: { collection?: "components" | "synthesized"; functions?: unknown } = {},
): Record<string, unknown> => {
  const cardPlan = {
    a2ui: "Card",
    dspackId: "card",
    commons: ["ComponentCommon"],
    structural: {
      child: { schema: { type: "string" }, description: "d", synthNote: "s" },
      label: { schema: { type: "string" }, description: "d", synthNote: "s" },
      extra: { schema: { type: "string" }, description: "d", synthNote: "s" },
    },
    required: [],
    ...(cardSurface === undefined ? {} : { surface: cardSurface }),
  };
  return {
    profileVersion: "2",
    catalogTitle: "t",
    catalogDescription: "d",
    catalogIdBase: "https://example.test/catalogs/x",
    instructions: "",
    primaryColorToken: { category: "color", name: "primary" },
    surfaceSynthesis: { textComponent: "Text", textProp: "text", wrapComponent: "Column", wrapChildrenProp: "children" },
    ...(opts.functions ? { functions: opts.functions } : {}),
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
      ...(opts.collection === "synthesized" ? [cardPlan] : []),
    ],
    casualtyComponents: [],
    components: opts.collection === "synthesized" ? [] : [cardPlan],
  };
};

describe("the contract gate has no side doors (findings 1, 6, 8, 9)", () => {
  it("a mapped compound in `synthesized` is validated exactly like one in `components`", () => {
    const withBogusSub = {
      routes: [{ from: ["sub(card-sidebar).text"], to: "prop:label" }],
      subs: CARD_SUBS,
    };
    for (const collection of ["components", "synthesized"] as const) {
      expect(
        () => transformFromJson(doc, { profile: loadProfile(v2Doc(withBogusSub, { collection })) }),
        collection,
      ).toThrowError(ProfileContractError);
    }
  });

  it("omitting the surface block is exactly as unresolved as `surface: {}`", () => {
    for (const spelling of [undefined, {}]) {
      try {
        transformFromJson(doc, { profile: loadProfile(v2Doc(spelling)) });
        expect.unreachable("a compound with undecided subs must refuse either way");
      } catch (e) {
        expect(e).toBeInstanceOf(ProfileContractError);
        const issues = (e as ProfileContractError).issues;
        expect(issues).toHaveLength(5);
        expect(issues.every((i) => i.message.includes("unresolved"))).toBe(true);
      }
    }
  });
});

describe("an authored drop is warn-and-discard everywhere (finding 2)", () => {
  it("a dropped sub on a non-collecting plan is skipped with its reason, not crashed", () => {
    const profile = loadProfile(
      v2Doc({
        routes: [{ from: ["children"], to: "slot:child" }],
        subs: { ...CARD_SUBS, "card-description": { drop: "descriptions are not carried here" } },
      }),
    );
    const { messages, warnings, fidelity } = emitSurface(
      surface({
        component: "card",
        children: [
          { component: "card-description", text: "gone" },
          { component: "card-content", text: "kept" },
        ],
      }),
      doc,
      { profile },
    );
    expect(JSON.stringify(messages)).not.toContain("gone");
    expect(JSON.stringify(messages)).toContain("kept");
    const warn = warnings.find((w) => w.code === "surface-sub-dropped");
    expect(warn?.message).toContain("descriptions are not carried here");
    expect(fidelity.find((f) => f.origin === "drops.card-description")).toMatchObject({ kind: "dropped", class: "lossy" });
  });
});

describe("a renamed self-prop read does not suppress the prop's own projection (finding 3)", () => {
  it("badge keeps its projected variant while the route writes the extra copy", () => {
    // The contract's `badge` declares `variant`, so the renamed read
    // (self.props.variant -> prop:extra) is gate-legal — and must not
    // suppress the propMap projection of variant itself.
    const withBadge = v2Doc({ routes: [{ from: ["children"], to: "slot:child" }], subs: CARD_SUBS });
    (withBadge.components as Array<Record<string, unknown>>).push({
      a2ui: "Badge",
      dspackId: "badge",
      commons: ["ComponentCommon"],
      structural: {
        label: { schema: { type: "string" }, description: "d", synthNote: "s" },
        extra: { schema: { type: "string" }, description: "d", synthNote: "s" },
      },
      propMap: { variant: { a2ui: "variant", kind: "enum", targetEnum: ["default", "secondary", "destructive", "outline"] } },
      required: [],
      surface: {
        routes: [
          { from: ["self.text"], to: "prop:label", overwrite: true },
          { from: ["self.props.variant"], to: "prop:extra" },
        ],
      },
    });
    const { messages } = emitSurface(
      surface({ component: "badge", text: "New", props: { variant: "outline" } }),
      doc,
      { profile: loadProfile(withBadge) },
    );
    const [badge] = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(badge.variant).toBe("outline"); // the projection survived
    expect(badge.extra).toBe("outline"); // and the routed copy landed too
  });
});

describe("dead and contradictory spellings refuse at load (findings 4, 5, 13)", () => {
  const refusal = (s: unknown): string => {
    try {
      loadProfile(v2Doc(s));
      return "LOADED";
    } catch (e) {
      if (e instanceof ProfileLoadError) return e.issues.map((i) => `${i.path}: ${i.message}`).join("\n");
      throw e;
    }
  };

  it("firstText cannot lead a route — it is a fallback selector", () => {
    const out = refusal({ routes: [{ from: ["sub(card-title).firstText"], to: "prop:label" }], subs: CARD_SUBS });
    expect(out).toContain("cannot lead a route");
    // ...while the fallback position stays legal (card-title consumed by the
    // route, so it carries no separate disposition).
    const { "card-title": _consumed, ...rest } = CARD_SUBS;
    expect(
      refusal({
        routes: [{ from: ["sub(card-title).label", "sub(card-title).firstText"], to: "prop:label" }],
        subs: rest,
      }),
    ).toBe("LOADED");
  });

  it("a children route's destination is exclusive in both directions", () => {
    const childrenFirst = refusal({
      routes: [
        { from: ["children"], to: "slot:child" },
        { from: ["self.text"], to: "textChild:child" },
      ],
      subs: CARD_SUBS,
    });
    expect(childrenFirst).toContain("children route");
    const childrenSecond = refusal({
      routes: [
        { from: ["self.text"], to: "textChild:child" },
        { from: ["children"], to: "slot:child" },
      ],
      subs: CARD_SUBS,
    });
    expect(childrenSecond).toContain("first-wins");
  });

  it("a collect cell source cannot also carry a disposition", () => {
    const out = refusal({
      collects: [
        { of: ["card-header"], into: "prop:label", shape: "flat", row: ["card-content"], cells: ["card-title"] },
      ],
      subs: { "card-title": { drop: "also a cell — contradiction" }, "card-description": { asText: "caption" }, "card-footer": "transparent" },
    });
    expect(out).toContain("one sub, one disposition");
  });
});

describe("the ledger never reports a discarded value as landed (findings 7, 11, 12)", () => {
  it("a first-wins-skipped harvest ledgers as dropped/lossy, not moved", () => {
    // The shipped v1 Table: authored caption prop beats the harvested one.
    // columns/rows ride the same structuralPassthrough so the instance stays
    // catalog-valid (both are required; emitSurface now refuses otherwise) —
    // the first-wins dynamics under test concern only the caption.
    const { fidelity } = emitSurface(
      surface({
        component: "table",
        props: { caption: "Authored", columns: ["A"], rows: [{ cells: ["1"] }] },
        children: [{ component: "table-caption", text: "Harvested" }],
      }),
      doc,
      {},
    );
    const discarded = fidelity.find((f) => f.kind === "dropped" && f.note?.includes("already written"));
    expect(discarded).toBeDefined();
    expect(discarded!.destination).toBe("(discarded)");
    // And only ONE entry claims the caption landed.
    expect(fidelity.filter((f) => f.destination === "caption")).toHaveLength(1);
  });

  it("unrouted node text is a ledgered loss (warnings stay byte-frozen)", () => {
    const { warnings, fidelity } = emitSurface(
      surface({ component: "card", text: "orphaned words", children: [{ component: "badge", text: "x" }] }),
      doc,
      {},
    );
    // Warnings are byte-frozen: the discard appears in NO warning...
    expect(warnings.every((w) => !w.message.includes("orphaned words"))).toBe(true);
    // ...and in exactly one ledger entry.
    const entry = fidelity.find((f) => f.note?.includes("no self.text route"));
    expect(entry).toMatchObject({ kind: "dropped", class: "lossy", destination: "(discarded)" });
  });

  it("asText that destroys nested structure records flattened/lossy like the cell path", () => {
    const { fidelity } = emitSurface(
      surface({
        component: "card",
        children: [
          {
            component: "card-title",
            children: [{ component: "badge", text: "Urgent" }],
          },
        ],
      }),
      doc,
      {},
    );
    const loss = fidelity.find((f) => f.kind === "flattened" && f.source.includes("card-title"));
    expect(loss).toMatchObject({ class: "lossy" });
    expect(loss!.source).toContain("'badge'");
  });
});

describe("function args are self-contained (finding 10)", () => {
  it("a $ref inside declared args refuses at load with its path", () => {
    try {
      loadProfile(
        v2Doc(
          { routes: [{ from: ["children"], to: "slot:child" }], subs: CARD_SUBS },
          { functions: { probe: { description: "d", returns: "boolean", args: { $ref: "#/$defs/DoesNotExist" } } } },
        ),
      );
      expect.unreachable("a $ref in function args must refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileLoadError);
      const issue = (e as ProfileLoadError).issues[0];
      expect(issue.path).toBe("/functions/probe/args");
      expect(issue.message).toContain("self-contained");
    }
  });
});
