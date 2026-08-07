/**
 * Profile v2: the primitive language, proven against the v1 byte contract.
 *
 * The keystone assertion: the ENTIRE shadcn profile re-spelled in v2 —
 * Identity / Route / Collect strings instead of the ten v1 directives —
 * loads through the v2 dispatcher and emits BYTE-IDENTICALLY to the v1
 * profile: same catalog digests (both A2UI versions), same messages, same
 * warnings, for every pinned directive surface and worked example. v2 is
 * not a new emitter; it is a new spelling for the same transformation.
 *
 * Also here: the version dispatcher's refusals, and the load-time refusal
 * matrix for the v2 grammar — every way a v2 surface block can be wrong,
 * refused with a pathed finding at load, before any emission runs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { loadProfile, ProfileLoadError } from "./transform/profile-load.js";
import { shadcnProfile, type ComponentPlan } from "./transform/profiles.js";
import { SHADCN_V2_SURFACES as V2_SURFACES } from "./transform/shadcn-v2-respelling.js";
import type { A2uiVersion, DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

// ---------------------------------------------------------------------------
// The v2 re-spelling: every v1 directive the shadcn profile uses, as
// primitives. Hand-authored — this is what a v2 profile author would write.
// ---------------------------------------------------------------------------

/**
 * The v2 document, built from the TS profile so every non-surface field is
 * identical by construction — the only authored difference is the language.
 */
function shadcnV2Document(): Record<string, unknown> {
  const strip = (plan: ComponentPlan): Record<string, unknown> => {
    const { surfacePlan: _v1, subCoverage: _prose, ...rest } = structuredClone(plan) as Record<string, unknown> & {
      surfacePlan?: unknown;
      subCoverage?: unknown;
    };
    const dspackId = (rest as { dspackId?: string }).dspackId;
    if (dspackId && V2_SURFACES[dspackId]) rest.surface = V2_SURFACES[dspackId];
    return rest;
  };
  const base = structuredClone(shadcnProfile) as unknown as Record<string, unknown>;
  return {
    profileVersion: "2",
    ...base,
    components: shadcnProfile.components.map(strip),
    synthesized: shadcnProfile.synthesized.map(strip),
  };
}

const VERSIONS: A2uiVersion[] = ["0.9.1", "1.0"];

/** The v1 pins this file must reproduce — same values as byte-neutral.test.ts. */
const V1_CATALOG_DIGESTS: Record<string, string> = {
  "0.9.1": "7c1b72dfd83dde14",
  "1.0": "2dde439bbf643834",
};

describe("the v2 re-spelling emits byte-identically to the v1 profile", () => {
  const v2 = () => loadProfile(shadcnV2Document());

  it("loads through the dispatcher and is stamped as the v2 language", () => {
    const profile = v2();
    expect(profile.language).toBe("v2");
    expect(profile.catalogTitle).toBe(shadcnProfile.catalogTitle);
  });

  for (const version of VERSIONS) {
    it(`catalog digest equals the pinned v1 digest (a2ui ${version})`, () => {
      const out = transformFromJson(doc, { profile: v2(), a2uiVersion: version });
      expect(digest(out.catalog)).toBe(V1_CATALOG_DIGESTS[version]);
      expect(out.validation.pass).toBe(true);
    });
  }

  const surface = (root: unknown, intent = "record-collection"): DspackSurface =>
    ({ dspackSurface: "0.1", system: doc.name as string, intent, root }) as DspackSurface;

  /** Every directive-exercising surface from the byte gate, plus the worked examples. */
  const cases: Array<[string, DspackSurface]> = [
    ["textChild + action (button)", surface({ component: "button", text: "Save changes", props: { variant: "default" } })],
    [
      "self.text routes (input, badge)",
      surface({
        component: "card",
        children: [
          { component: "input", text: "Email" },
          { component: "badge", text: "New", props: { variant: "secondary" } },
        ],
      }),
    ],
    [
      "transparent + asText subs (card family)",
      surface({
        component: "card",
        children: [
          {
            component: "card-header",
            children: [
              { component: "card-title", text: "Members" },
              { component: "card-description", text: "Everyone with access." },
            ],
          },
          { component: "card-content", text: "Three people." },
        ],
      }),
    ],
    [
      "collects (table family)",
      surface({
        component: "table",
        children: [
          { component: "table-caption", text: "Recent orders" },
          { component: "table-header", children: [{ component: "table-row", children: [{ component: "table-head", text: "Order" }, { component: "table-head", text: "Status" }] }] },
          {
            component: "table-body",
            children: [
              { component: "table-row", children: [{ component: "table-cell", text: "#1001" }, { component: "table-cell", text: "Shipped" }] },
              { component: "table-row", children: [{ component: "table-cell", text: "#1002" }, { component: "table-cell", text: "Pending" }] },
            ],
          },
        ],
      }),
    ],
    [
      "consuming routes + label fallback (alert-dialog)",
      surface(
        {
          component: "alert-dialog",
          children: [
            { component: "alert-dialog-trigger", children: [{ component: "button", text: "Delete" }] },
            {
              component: "alert-dialog-content",
              children: [
                { component: "alert-dialog-title", text: "Delete project?" },
                { component: "alert-dialog-description", text: "This cannot be undone." },
              ],
            },
          ],
        },
        "destructive-action",
      ),
    ],
    [
      "wrap synthesis (>1 children in a slot)",
      surface({
        component: "card",
        children: [
          { component: "badge", text: "One" },
          { component: "badge", text: "Two" },
        ],
      }),
    ],
    [
      "id deduplication",
      surface({
        component: "card",
        children: [
          { component: "badge", id: "tag", text: "One" },
          { component: "badge", id: "tag", text: "Two" },
        ],
      }),
    ],
    ...((doc as unknown as { examples?: Array<{ id: string; surface: DspackSurface }> }).examples ?? []).map(
      (e) => [`worked example ${e.id}`, e.surface] as [string, DspackSurface],
    ),
  ];

  it.each(cases)("%s — identical messages and warnings", (_name, s) => {
    const fromV1 = emitSurface(s, doc, { profile: shadcnProfile });
    const fromV2 = emitSurface(s, doc, { profile: v2() });
    expect(digest(fromV2.messages)).toBe(digest(fromV1.messages));
    expect(digest(fromV2.warnings)).toBe(digest(fromV1.warnings));
  });
});

describe("the version dispatcher", () => {
  const v1Doc = () => ({ profileVersion: "1", ...structuredClone(shadcnProfile) });

  it("v1 documents keep loading exactly as before", () => {
    const profile = loadProfile(v1Doc());
    expect(profile.language).toBeUndefined();
  });

  it("an unknown version refuses with a pathed finding naming the supported set", () => {
    for (const bad of ["3", "2.0", 2, undefined, null]) {
      const attempt = { ...v1Doc(), profileVersion: bad } as unknown;
      try {
        loadProfile(attempt);
        expect.unreachable(`version ${JSON.stringify(bad)} must refuse`);
      } catch (e) {
        expect(e).toBeInstanceOf(ProfileLoadError);
        const issue = (e as ProfileLoadError).issues[0];
        expect(issue.path).toBe("/profileVersion");
        expect(issue.message).toContain('"1"');
        expect(issue.message).toContain('"2"');
      }
    }
  });

  it("one language per document: v1 syntax inside a v2 document refuses", () => {
    const mixed = shadcnV2Document();
    (mixed.components as Array<Record<string, unknown>>)[0].surfacePlan = { textProp: "child" };
    expect(() => loadProfile(mixed)).toThrowError(ProfileLoadError);
  });

  it("one language per document: v2 syntax inside a v1 document refuses", () => {
    const mixed = v1Doc() as unknown as { components: Array<Record<string, unknown>> };
    mixed.components[0].surface = { routes: [] };
    expect(() => loadProfile(mixed)).toThrowError(ProfileLoadError);
  });
});

describe("load-time refusal matrix (v2 grammar)", () => {
  /** A minimal valid v2 document with one plan whose surface block is under test. */
  const docWith = (surface: unknown, plan: Partial<ComponentPlan> = {}): Record<string, unknown> => ({
    profileVersion: "2",
    catalogTitle: "t",
    catalogDescription: "d",
    catalogIdBase: "https://example.test/catalogs/x",
    instructions: "",
    primaryColorToken: { category: "color", name: "primary" },
    surfaceSynthesis: { textComponent: "Text", textProp: "text", wrapComponent: "Column", wrapChildrenProp: "children" },
    synthesized: [],
    casualtyComponents: [],
    components: [
      {
        a2ui: "Widget",
        dspackId: "widget",
        commons: ["ComponentCommon"],
        structural: {
          label: { schema: { type: "string" }, description: "d", synthNote: "s" },
          child: { schema: { type: "string" }, description: "d", synthNote: "s" },
          items: { schema: { type: "array" }, description: "d", synthNote: "s" },
          go: { schema: { $ref: "#/$defs/Action" }, description: "d", synthNote: "s" },
        },
        required: [],
        surface,
        ...plan,
      },
    ],
  });

  const refusal = (surface: unknown, plan?: Partial<ComponentPlan>): string => {
    try {
      loadProfile(docWith(surface, plan));
      return "LOADED";
    } catch (e) {
      if (e instanceof ProfileLoadError) return e.issues.map((i) => `${i.path}: ${i.message}`).join("\n");
      throw e;
    }
  };

  it("a well-formed block loads", () => {
    expect(
      refusal({
        routes: [
          { from: ["self.text"], to: "prop:label" },
          { from: ["children"], to: "slot:child" },
        ],
      }),
    ).toBe("LOADED");
  });

  it("an unknown selector refuses at its exact path", () => {
    const out = refusal({ routes: [{ from: ["self.magic"], to: "prop:label" }] });
    expect(out).toContain("/routes/0/from/0");
    expect(out).toContain("pattern");
  });

  it("an arbitrary JSON path is not a selector", () => {
    expect(refusal({ routes: [{ from: ["$.children[0].text"], to: "prop:label" }] })).toContain("/from/0");
  });

  it("a computed destination is refused by the grammar", () => {
    expect(refusal({ routes: [{ from: ["self.text"], to: "prop:${name}" }] })).toContain("/to");
  });

  it("an undeclared destination refuses: inventing properties dies here, not at A3", () => {
    const out = refusal({ routes: [{ from: ["self.text"], to: "prop:invented" }] });
    expect(out).toContain("not declared by this plan");
  });

  it("selector/destination incompatibility refuses (action fed by text)", () => {
    const out = refusal({ routes: [{ from: ["self.text"], to: "action:go" }] });
    expect(out).toContain("cannot feed destination kind 'action'");
  });

  it("a fallback chain that mixes write phases refuses", () => {
    const out = refusal({
      routes: [{ from: ["sub(a).text", "self.props.label"], to: "prop:label" }],
    });
    expect(out).toContain("mixes write phases");
  });

  it("a same-phase double-claim refuses; distinct-phase layering loads", () => {
    const clash = refusal({
      routes: [
        { from: ["sub(a).text"], to: "prop:label" },
        { from: ["sub(b).text"], to: "prop:label" },
      ],
    });
    expect(clash).toContain("same write phase");
    const layered = refusal({
      routes: [
        { from: ["self.props.label"], to: "prop:label" },
        { from: ["sub(a).text"], to: "prop:label" },
      ],
    });
    expect(layered).toBe("LOADED");
  });

  it("a second children route refuses (multi-slot arrives with T4)", () => {
    const out = refusal({
      routes: [
        { from: ["children"], to: "slot:child" },
        { from: ["children"], to: "slots:items" },
      ],
    });
    expect(out).toContain("T4");
  });

  it("children routing plus subtree consumption is a contradiction and refuses", () => {
    const out = refusal({
      routes: [
        { from: ["sub(a).text"], to: "prop:label" },
        { from: ["children"], to: "slot:child" },
      ],
    });
    expect(out).toContain("contradictory");
  });

  it("a records collect without a field name refuses", () => {
    const out = refusal({
      collects: [{ of: ["sec"], into: "prop:items", shape: "records", row: ["row"], cells: ["cell"] }],
    });
    expect(out).toContain("field");
  });

  it("a sub with two dispositions refuses", () => {
    const out = refusal({
      routes: [{ from: ["sub(part).text"], to: "prop:label" }],
      subs: { part: "transparent" },
    });
    expect(out).toContain("one sub, one disposition");
  });

  it("unimplemented capability spellings are refused; T1's are now implemented with their own rules", () => {
    // T1 landed: `transparent` is a real spelling — on THIS plan it refuses
    // for its true reason (a transparent plan declares no catalog surface,
    // and Widget declares structural slots), not because the grammar is
    // closed to it.
    expect(refusal({ transparent: true })).toContain("declares no catalog surface");
    // `onto` remains INTERNAL vocabulary: donation is authored via
    // transparent.donate blocks; a raw onto key on a route stays refused.
    expect(refusal({ routes: [{ from: ["self.text"], to: "prop:label", onto: "control" }] })).not.toBe("LOADED");
    // T3 joins have not landed and stay refused, never reinterpreted.
    expect(refusal({ collects: [{ of: ["s"], into: "prop:items", shape: "records", field: "f", row: ["r"], cells: ["c"], joinOn: "id" }] })).not.toBe("LOADED");
  });
});
