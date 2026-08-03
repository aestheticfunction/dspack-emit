/**
 * Profile-as-data: load a mapping Profile from JSON.
 *
 * The Profile has always been pure data (profiles.ts); this module makes it
 * *reachable* as data. `loadProfile` validates an untrusted JSON value against
 * schema `profile.v1.schema.json` (a one-to-one mirror of the TypeScript
 * `Profile` interface plus a `profileVersion` envelope const) and returns the
 * engine-ready `Profile`. Validation gates shape only — every judgment call
 * (valueMaps, casualties, surface plans) stays with the profile's author.
 *
 * Toolchain: ajv draft 2020-12, `strict: false`, ajv-formats — the same
 * convention as the catalog gates (src/validate/ajv.ts) and the dspack
 * harness.
 */
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { profileSchema } from "./profile-schema.js";
import type { Profile } from "./profiles.js";

/** The profile schema, as shipped (also exported for hosts that surface it in UI). */
export { profileSchema } from "./profile-schema.js";

export interface ProfileLoadIssue {
  /** JSON path into the offending document (ajv instancePath). */
  path: string;
  message: string;
}

export class ProfileLoadError extends Error {
  constructor(readonly issues: ProfileLoadIssue[]) {
    super(
      `profile does not conform to profile.v1.schema.json (${issues.length} issue${issues.length === 1 ? "" : "s"}): ` +
        issues
          .slice(0, 3)
          .map((i) => `${i.path || "$"}: ${i.message}`)
          .join("; ") +
        (issues.length > 3 ? "; …" : ""),
    );
    this.name = "ProfileLoadError";
  }
}

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
    addFormats(ajv);
    compiled = ajv.compile(profileSchema);
  }
  return compiled;
}

/**
 * Validate `json` as a v1 profile document and return the engine-ready
 * `Profile`. The `profileVersion` envelope field is stripped — it belongs to
 * the document format, not the engine. Top-level `x-` extension keys are
 * preserved (the engine ignores them; provenance tools may not).
 */
export function loadProfile(json: unknown): Profile {
  const validate = validator();
  if (!validate(json)) {
    const errors = (validate.errors ?? []) as Array<{ instancePath?: string; message?: string }>;
    throw new ProfileLoadError(
      errors.map((e) => ({ path: e.instancePath ?? "", message: e.message ?? "invalid" })),
    );
  }
  const { profileVersion: _envelope, ...profile } = json as Record<string, unknown> & { profileVersion: string };
  return profile as unknown as Profile;
}
