/**
 * Profile-as-data (PR: profile JSON schema + loadProfile + scaffoldProfile).
 *
 * The center-of-gravity contract for the catalog composer: a Profile expressed
 * as JSON, validated at runtime against schema/profile.v1.schema.json, must
 * drive the engine byte-identically to the same Profile expressed as the
 * in-repo TypeScript object. Judgment stays with the author; the loader only
 * gates shape.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadProfile, ProfileLoadError } from "./transform/profile-load.js";
import { scaffoldProfile } from "./transform/scaffold.js";
import { shadcnProfile } from "./transform/profiles.js";
import { transformFromJson } from "./transform/index.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(repo(p), "utf8"));

const shadcnDoc = load("input/shadcn-ui.dspack.json") as DspackDoc;
const astryxDoc = load("input/astryx.dspack.json") as DspackDoc;

/** The TS profile, round-tripped through JSON exactly as a user file would be. */
const shadcnProfileJson = () => ({ profileVersion: "1", ...structuredClone(shadcnProfile) });

describe("loadProfile", () => {
  it("accepts the canonical shadcn profile expressed as JSON", () => {
    const profile = loadProfile(shadcnProfileJson());
    expect(profile.catalogTitle).toBe(shadcnProfile.catalogTitle);
    // profileVersion is loader envelope, not engine input.
    expect((profile as Record<string, unknown>).profileVersion).toBeUndefined();
  });

  it("drives the engine byte-identically to the TypeScript profile", () => {
    const fromTs = transformFromJson(shadcnDoc, { profile: shadcnProfile });
    const fromJson = transformFromJson(shadcnDoc, { profile: loadProfile(shadcnProfileJson()) });
    expect(JSON.stringify(fromJson.catalog)).toBe(JSON.stringify(fromTs.catalog));
    expect(fromJson.validation.pass).toBe(true);
  });

  it("rejects a malformed profile with typed, pathed findings", () => {
    const bad = shadcnProfileJson() as any;
    bad.components[0].propMap.variant.kind = "vibes";
    expect(() => loadProfile(bad)).toThrowError(ProfileLoadError);
    try {
      loadProfile(bad);
    } catch (e) {
      const issues = (e as ProfileLoadError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i) => i.path.includes("propMap"))).toBe(true);
    }
  });

  it("rejects a non-https catalogIdBase", () => {
    const bad = shadcnProfileJson() as any;
    bad.catalogIdBase = "http://insecure.example/catalog";
    expect(() => loadProfile(bad)).toThrowError(ProfileLoadError);
  });

  it("rejects a missing profileVersion", () => {
    const { profileVersion: _dropped, ...bare } = shadcnProfileJson();
    expect(() => loadProfile(bare)).toThrowError(ProfileLoadError);
  });
});

describe("casualty refusal cites the authored reason", () => {
  it("names the declared casualty and its reason when a surface uses it", () => {
    const surface: DspackSurface = {
      dspackSurface: "0.1",
      system: shadcnDoc.name as string,
      intent: "destructive-action",
      root: { component: "dropdown-menu", props: {} },
    } as DspackSurface;
    try {
      emitSurface(surface, shadcnDoc, { profile: shadcnProfile });
      expect.unreachable("surface using a casualty component must refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(EmitSurfaceError);
      const msg = (e as EmitSurfaceError).message;
      // The profile's authored reason, not just "unknown component".
      expect(msg).toContain("declared casualty");
      expect(msg).toContain("dropdown menu");
    }
  });
});

describe("scaffoldProfile", () => {
  it("produces a loadProfile-valid profile from a bare contract", () => {
    const { profile } = scaffoldProfile(astryxDoc, {
      catalogIdBase: "https://example.test/catalogs/astryx-scaffold",
    });
    // The scaffold is itself a valid v1 profile document.
    const loaded = loadProfile(profile);
    expect(loaded.catalogIdBase).toBe("https://example.test/catalogs/astryx-scaffold");
  });

  it("maps every contract component (full coverage, no judgment invented)", () => {
    const { profile, notes } = scaffoldProfile(astryxDoc, {
      catalogIdBase: "https://example.test/catalogs/astryx-scaffold",
    });
    const loaded = loadProfile(profile);
    const out = transformFromJson(astryxDoc, { profile: loaded });
    expect(out.validation.gates.find((g) => g.name === "schema-compile + no-external-ref")?.pass).toBe(true);
    expect(out.validation.gates.find((g) => g.name === "catalog-shape")?.pass).toBe(true);
    const unclassified = out.mapping.coverage.filter((c) => c.disposition === "unclassified");
    expect(unclassified).toEqual([]);
    // Mechanical means mechanical: no casualties invented, judgment flagged in notes.
    expect(loaded.casualtyComponents).toEqual([]);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("seeds enum props verbatim (identity projection, no valueMap)", () => {
    const { profile } = scaffoldProfile(shadcnDoc, {
      catalogIdBase: "https://example.test/catalogs/shadcn-scaffold",
    });
    const loaded = loadProfile(profile);
    const button = loaded.components.find((c) => c.dspackId === "button");
    expect(button).toBeDefined();
    const variant = button?.propMap?.variant;
    expect(variant?.kind).toBe("enum");
    // Verbatim contract vocabulary, not the hand-tuned lossy projection.
    expect(variant?.targetEnum).toEqual(["default", "destructive", "outline", "secondary", "ghost", "link"]);
    expect(variant?.valueMap).toBeUndefined();
  });
});
