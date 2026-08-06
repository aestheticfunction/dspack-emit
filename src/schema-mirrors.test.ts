/**
 * Drift gate for the schema mirrors. The .json files are the reviewable
 * schema documents (docs/PROFILES.md and the README link them); the TS
 * mirror modules are what the runtime imports, because the library surface
 * must bundle for the browser without filesystem access. Both are committed,
 * so this test is what keeps them the same document: a failure here means
 * one side was edited without the other.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogMetaSchemas } from "./validate/meta/catalog-meta.js";
import { profileSchema } from "./transform/profile-schema.js";
import { profileSchemaV2 } from "./transform/profile-schema-v2.js";

const doc = (rel: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

describe("schema mirrors", () => {
  it("catalog-meta mirror (0.9.1) equals a2ui-catalog.meta.0_9_1.json", () => {
    expect(catalogMetaSchemas["0.9.1"]).toStrictEqual(doc("./validate/meta/a2ui-catalog.meta.0_9_1.json"));
  });

  it("catalog-meta mirror (1.0) equals a2ui-catalog.meta.1_0.json", () => {
    expect(catalogMetaSchemas["1.0"]).toStrictEqual(doc("./validate/meta/a2ui-catalog.meta.1_0.json"));
  });

  it("profile-schema mirror equals profile.v1.schema.json", () => {
    expect(profileSchema).toStrictEqual(doc("./transform/profile.v1.schema.json"));
  });

  it("profile-schema-v2 mirror equals profile.v2.schema.json", () => {
    expect(profileSchemaV2).toStrictEqual(doc("./transform/profile.v2.schema.json"));
  });
});
