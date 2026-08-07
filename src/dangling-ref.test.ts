/**
 * Internal $ref discipline — one boundary, every authored-schema channel.
 *
 * Gate 1's documented guarantee ("compilation fails on any unresolved $ref,
 * proving the catalog is a valid, fully self-contained schema") was FALSE:
 * ajv defers ref resolution past compile(), so a structural slot schema
 * carrying `{$ref: "#/$defs/DoesNotExist"}` produced either all-gates-PASS
 * (no surface supplied) or a raw MissingRefError thrown out of gate 3's
 * un-guarded getSchema (the main transform path) — pass-or-crash, never a
 * finding. The functions channel was closed at load (profile-load refuses
 * $ref in args outright); structural schemas legitimately ref the catalog's
 * own $defs, so their discipline lives where the catalog exists: gate 1 now
 * RESOLVES every internal ref and fails with the ref and its JSON path, and
 * gate 3 is crash-proofed so no path ever escapes as a raw ajv error.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { validateCatalog } from "./validate/ajv.js";
import { loadProfile } from "./transform/profile-load.js";
import { shadcnProfile } from "./transform/profiles.js";
import type { A2uiCatalog, DspackDoc } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;

/** The shipped profile with ONE structural slot schema pointing at nothing. */
const withDanglingStructural = () => {
  const profile = structuredClone(shadcnProfile);
  profile.components = profile.components.map((p) =>
    p.dspackId === "badge"
      ? {
          ...p,
          structural: {
            ...p.structural,
            label: { ...p.structural.label, schema: { $ref: "#/$defs/DoesNotExist" } },
          },
        }
      : p,
  );
  return profile;
};

describe("a dangling internal $ref is a finding, never a pass and never a crash", () => {
  it("gate 1 fails with the ref and its location — no surface supplied (the silent-pass path)", () => {
    const out = transformFromJson(doc, { profile: withDanglingStructural(), surface: undefined });
    const gate = out.validation.gates.find((g) => g.name === "schema-compile + no-external-ref");
    expect(gate?.pass).toBe(false);
    expect(gate?.errors?.join("\n")).toContain("#/$defs/DoesNotExist");
    expect(gate?.errors?.join("\n")).toContain("components/Badge");
    expect(out.validation.pass).toBe(false);
  });

  it("the main transform path reports the same finding instead of throwing raw (the crash path)", () => {
    // Pre-fix: this exact call escaped as an uncaught ajv MissingRefError.
    const out = transformFromJson(doc, { profile: withDanglingStructural() });
    expect(out.validation.pass).toBe(false);
    const gate1 = out.validation.gates.find((g) => g.name === "schema-compile + no-external-ref");
    expect(gate1?.pass).toBe(false);
    const gate3 = out.validation.gates.find((g) => g.name === "instance");
    expect(gate3?.pass).toBe(false); // skipped-as-failed, with a reason — not a crash
    expect(gate3?.detail).toContain("self-contained");
  });

  it("a dangling ref in a v2 document's structural schema is caught by the same boundary", () => {
    const v2 = {
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
          structural: { text: { schema: { $ref: "#/$defs/Nope" }, description: "d", synthNote: "s" } },
          required: ["text"],
        },
      ],
      casualtyComponents: [],
      components: [],
    };
    const out = transformFromJson(doc, { profile: loadProfile(v2), surface: undefined });
    const gate = out.validation.gates.find((g) => g.name === "schema-compile + no-external-ref");
    expect(gate?.pass).toBe(false);
    expect(gate?.errors?.join("\n")).toContain("#/$defs/Nope");
  });

  it("validateCatalog as a public API reports rather than passes on a hand-built broken catalog", () => {
    const broken = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.test/broken/catalog.json",
      title: "t",
      description: "d",
      catalogId: "https://example.test/broken/catalog.json",
      components: { Widget: { type: "object", properties: { part: { $ref: "#/$defs/Missing" } } } },
      $defs: { anyComponent: { oneOf: [{ $ref: "#/components/Widget" }] } },
    } as unknown as A2uiCatalog;
    const report = validateCatalog(broken, "0.9.1");
    const gate = report.gates.find((g) => g.name === "schema-compile + no-external-ref");
    expect(gate?.pass).toBe(false);
    expect(gate?.errors?.join("\n")).toContain("#/$defs/Missing");
  });

  it("every legitimate ref shape the shipped profiles use keeps passing", () => {
    // The shipped v1 profile refs ComponentId, Action, DynamicString,
    // ChildList, CheckRule via structural schemas — all must still resolve.
    const out = transformFromJson(doc, { profile: shadcnProfile });
    expect(out.validation.pass).toBe(true);
    // And a valid ref into a NESTED pointer (components/<Name>) resolves too:
    // the catalog's own anyComponent does exactly this.
    const gate = out.validation.gates.find((g) => g.name === "schema-compile + no-external-ref");
    expect(gate?.pass).toBe(true);
  });
});
