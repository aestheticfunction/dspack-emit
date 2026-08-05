/**
 * Byte-neutrality gate for the internal transformation model.
 *
 * The emitter is being rewritten onto a smaller internal representation
 * (Identity / Route / Collect) with the v1 surface-plan directives desugaring
 * into it. That refactor is only legitimate if it is INVISIBLE: same contract
 * + same profile => the same bytes, for every profile this package can reach
 * and both supported A2UI versions.
 *
 * So this suite hashes real emitted artifacts and pins the digests. It is a
 * tripwire, not a description: a failure here means output moved, and the only
 * two acceptable responses are to fix the regression, or — when a digest is
 * MEANT to move — to change it in the same commit that explains why.
 *
 * Deliberately hashes the *artifact*, not a summary of it. A shape assertion
 * ("the catalog has 8 components") passes while every description silently
 * changes; a digest does not.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import { loadProfile } from "./transform/profile-load.js";
import { scaffoldProfile } from "./transform/scaffold.js";
import { shadcnProfile } from "./transform/profiles.js";
import type { A2uiVersion, DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(repo(p), "utf8"));

const shadcnDoc = load("input/shadcn-ui.dspack.json") as DspackDoc;
const astryxDoc = load("input/astryx.dspack.json") as DspackDoc;
const settingsCard = load("surface/settings-card.surface.json");

/** Stable digest of any emitted artifact. */
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** The TS profile round-tripped through JSON exactly as a user file would be. */
const shadcnProfileJson = () => ({ profileVersion: "1", ...structuredClone(shadcnProfile) });

const VERSIONS: A2uiVersion[] = ["0.9.1", "1.0"];

/**
 * Pinned digests. Every entry was produced by the pre-refactor engine and is
 * the contract the refactor must honour.
 */
const CATALOGS: Record<string, string> = {
  // The TS and JSON spellings share a digest by design — profile-as-data is
  // only credible if authoring a profile as a file changes nothing.
  "shadcn/ts/0.9.1": "7c1b72dfd83dde14",
  "shadcn/json/0.9.1": "7c1b72dfd83dde14",
  "shadcn/ts/1.0": "2dde439bbf643834",
  "shadcn/json/1.0": "2dde439bbf643834",
  "astryx-scaffold/0.9.1": "56209cb772f8264e",
  "astryx-scaffold/1.0": "5991af499aa13846",
  "shadcn-scaffold/0.9.1": "f111ff44b4caf038",
  "shadcn-scaffold/1.0": "7336ef1a1e148e32",
};

const SURFACES: Record<string, string> = {
  "settings-card": "789f1b148b4ae935",
};

describe("catalog emission is byte-stable", () => {
  for (const version of VERSIONS) {
    it(`shadcn / TypeScript profile / a2ui ${version}`, () => {
      const out = transformFromJson(shadcnDoc, { profile: shadcnProfile, a2uiVersion: version });
      expect(digest(out.catalog)).toBe(CATALOGS[`shadcn/ts/${version}`]);
    });

    it(`shadcn / JSON profile / a2ui ${version} — and identical to the TS profile`, () => {
      const fromJson = transformFromJson(shadcnDoc, {
        profile: loadProfile(shadcnProfileJson()),
        a2uiVersion: version,
      });
      const fromTs = transformFromJson(shadcnDoc, { profile: shadcnProfile, a2uiVersion: version });
      expect(digest(fromJson.catalog)).toBe(CATALOGS[`shadcn/json/${version}`]);
      // Profile-as-data is only credible if the two spellings are the same run.
      expect(digest(fromJson.catalog)).toBe(digest(fromTs.catalog));
    });

    it(`astryx / scaffolded profile / a2ui ${version}`, () => {
      const { profile } = scaffoldProfile(astryxDoc, {
        catalogIdBase: "https://example.test/catalogs/astryx-scaffold",
      });
      const out = transformFromJson(astryxDoc, { profile: loadProfile(profile), a2uiVersion: version });
      expect(digest(out.catalog)).toBe(CATALOGS[`astryx-scaffold/${version}`]);
    });

    it(`shadcn / scaffolded profile / a2ui ${version}`, () => {
      const { profile } = scaffoldProfile(shadcnDoc, {
        catalogIdBase: "https://example.test/catalogs/shadcn-scaffold",
      });
      const out = transformFromJson(shadcnDoc, { profile: loadProfile(profile), a2uiVersion: version });
      expect(digest(out.catalog)).toBe(CATALOGS[`shadcn-scaffold/${version}`]);
    });
  }
});

describe("surface emission is byte-stable", () => {
  it("the hand-authored settings-card surface", () => {
    expect(digest(settingsCard)).toBe(SURFACES["settings-card"]);
  });

  /**
   * The contract's own worked examples are the corpus that defines
   * "expressible". Messages AND warnings are hashed: a refactor that silently
   * stopped warning about a flattened compound would otherwise pass.
   */
  const examples = (shadcnDoc as unknown as { examples?: Array<{ id: string; surface: DspackSurface }> }).examples ?? [];
  it("the contract carries worked examples to hash", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((e) => [e.id] as const))("%s — messages and warnings", (id) => {
    const example = examples.find((e) => e.id === id)!;
    const { messages, warnings } = emitSurface(example.surface, shadcnDoc, { profile: shadcnProfile });
    expect({ id, messages: digest(messages), warnings: digest(warnings) }).toMatchSnapshot();
  });
});

/**
 * The directive-exercising surfaces. The worked examples in the pinned v2.3.0
 * contract do not reach every v1 directive, so these pin the rest by hand —
 * each one is the smallest surface that reaches the named strategy.
 */
describe("every v1 surface-plan directive is byte-pinned", () => {
  const surface = (root: unknown, intent = "record-collection"): DspackSurface =>
    ({ dspackSurface: "0.1", system: shadcnDoc.name as string, intent, root }) as DspackSurface;

  const cases: Array<[string, DspackSurface]> = [
    [
      "textChildProp + actionProp (button)",
      surface({ component: "button", text: "Save changes", props: { variant: "default" } }),
    ],
    [
      "textProp (input, badge)",
      surface({
        component: "card",
        children: [
          { component: "input", text: "Email" },
          { component: "badge", text: "New", props: { variant: "secondary" } },
        ],
      }),
    ],
    [
      "subFlatten.transparent + asText (card sub-family)",
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
      "subTable (table sub-family, header + body + caption)",
      surface({
        component: "table",
        children: [
          { component: "table-caption", text: "Recent orders" },
          {
            component: "table-header",
            children: [{ component: "table-row", children: [{ component: "table-head", text: "Order" }, { component: "table-head", text: "Status" }] }],
          },
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
      "subText + subButtonText + actionProp (alert-dialog)",
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
      "childProp with >1 children (synthesized Column wrap)",
      surface({
        component: "card",
        children: [
          { component: "badge", text: "One" },
          { component: "badge", text: "Two" },
        ],
      }),
    ],
    [
      "id deduplication (two nodes claiming one id)",
      surface({
        component: "card",
        children: [
          { component: "badge", id: "tag", text: "One" },
          { component: "badge", id: "tag", text: "Two" },
        ],
      }),
    ],
  ];

  it.each(cases)("%s", (_name, s) => {
    const { messages, warnings } = emitSurface(s, shadcnDoc, { profile: shadcnProfile });
    expect({ messages: digest(messages), warnings: digest(warnings) }).toMatchSnapshot();
  });
});
