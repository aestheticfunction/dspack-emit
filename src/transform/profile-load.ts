/**
 * Profile-as-data: load a mapping Profile from JSON.
 *
 * The Profile has always been pure data (profiles.ts); this module makes it
 * *reachable* as data. `loadProfile` dispatches EXPLICITLY on the document's
 * `profileVersion`:
 *
 *   "1" — the original surface-plan directive language, validated against
 *         profile.v1.schema.json. Frozen: v1 documents keep loading and
 *         emitting byte-identically, indefinitely.
 *   "2" — the primitive language, validated against profile.v2.schema.json,
 *         then every plan's `surface` block is parsed and statically checked
 *         (parse-v2.ts) so that a v2 profile that loads is a profile the
 *         engine can emit. The returned Profile is stamped `language: "v2"`,
 *         which is what keys the transform layer's fail-closed contract
 *         validation — no document is ever silently interpreted under the
 *         wrong version.
 *
 * Anything else refuses with a pathed finding naming the supported versions.
 * Validation gates shape and coherence only — every judgment call (valueMaps,
 * casualties, routes) stays with the profile's author.
 *
 * Toolchain: ajv draft 2020-12, `strict: false`, ajv-formats — the same
 * convention as the catalog gates (src/validate/ajv.ts) and the dspack
 * harness.
 */
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { profileSchema } from "./profile-schema.js";
import { profileSchemaV2 } from "./profile-schema-v2.js";
import { ProfileParseError, parseSurfaceV2 } from "./parse-v2.js";
import type { ComponentPlan, Profile } from "./profiles.js";

/** The profile schemas, as shipped (also exported for hosts that surface them in UI). */
export { profileSchema } from "./profile-schema.js";
export { profileSchemaV2 } from "./profile-schema-v2.js";

export interface ProfileLoadIssue {
  /** JSON path into the offending document (ajv instancePath). */
  path: string;
  message: string;
}

export class ProfileLoadError extends Error {
  constructor(
    readonly issues: ProfileLoadIssue[],
    schemaName = "profile.v1.schema.json",
  ) {
    super(
      `profile does not conform to ${schemaName} (${issues.length} issue${issues.length === 1 ? "" : "s"}): ` +
        issues
          .slice(0, 3)
          .map((i) => `${i.path || "$"}: ${i.message}`)
          .join("; ") +
        (issues.length > 3 ? "; …" : ""),
    );
    this.name = "ProfileLoadError";
  }
}

const compiled = new Map<string, ValidateFunction>();

function validator(version: "1" | "2"): ValidateFunction {
  let v = compiled.get(version);
  if (!v) {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
    addFormats(ajv);
    v = ajv.compile(version === "1" ? profileSchema : profileSchemaV2);
    compiled.set(version, v);
  }
  return v;
}

function ajvIssues(validate: ValidateFunction): ProfileLoadIssue[] {
  const errors = (validate.errors ?? []) as Array<{ instancePath?: string; message?: string }>;
  return errors.map((e) => ({ path: e.instancePath ?? "", message: e.message ?? "invalid" }));
}

/**
 * Validate `json` as a profile document and return the engine-ready `Profile`.
 * The `profileVersion` envelope field is stripped — it belongs to the document
 * format, not the engine. Top-level `x-` extension keys are preserved (the
 * engine ignores them; provenance tools may not).
 */
export function loadProfile(json: unknown): Profile {
  const version = (json as { profileVersion?: unknown } | null)?.profileVersion;
  if (version !== "1" && version !== "2") {
    throw new ProfileLoadError(
      [
        {
          path: "/profileVersion",
          message: `unknown profile version ${JSON.stringify(version)} — this loader speaks "1" (surface-plan directives) and "2" (the primitive language)`,
        },
      ],
      "any supported profile schema",
    );
  }

  const validate = validator(version);
  if (!validate(json)) {
    throw new ProfileLoadError(ajvIssues(validate), `profile.v${version}.schema.json`);
  }

  const { profileVersion: _envelope, ...profile } = json as Record<string, unknown> & { profileVersion: string };

  if (version === "2") {
    // Parse every plan's surface block now, so a v2 profile that LOADS is a
    // profile the engine can EMIT — grammar errors surface at load with
    // pathed findings, not mid-emission.
    const collections: Array<["components" | "synthesized", ComponentPlan[]]> = [
      ["components", (profile.components as ComponentPlan[]) ?? []],
      ["synthesized", (profile.synthesized as ComponentPlan[]) ?? []],
    ];
    for (const [key, plans] of collections) {
      for (const [i, plan] of plans.entries()) {
        if (!plan.surface) continue;
        try {
          parseSurfaceV2(plan.surface, plan, `/${key}/${i}/surface`);
        } catch (e) {
          if (e instanceof ProfileParseError) {
            throw new ProfileLoadError(e.issues, "profile.v2.schema.json (surface syntax)");
          }
          throw e;
        }
      }
    }
    (profile as Record<string, unknown>).language = "v2";
  }

  return profile as unknown as Profile;
}
