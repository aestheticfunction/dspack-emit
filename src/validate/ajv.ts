/**
 * A2UI catalog schema validation — three executable gates, mirroring the ajv
 * approach A2UI uses in specification/scripts/validate.py
 * (draft 2020-12, strict:false, ajv-formats):
 *
 *  1. schema-compile + no-external-ref: ajv compiles the catalog AS a JSON
 *     Schema, no `$ref` points outside it, and — because ajv defers ref
 *     resolution past compile() — every internal `$ref` is resolved by this
 *     gate itself, so a dangling pointer is a pathed finding here rather than
 *     a silent pass or a raw MissingRefError out of gate 3.
 *  2. catalog-shape: the catalog validates against the version-specific
 *     a2ui-catalog.meta.<ver>.json (the literal "catalog schema" check; this is what
 *     makes v0.9.1 vs v1.0 conformance distinct — theme vs surfaceProperties).
 *  3. instance: every component instance in the hand-authored surface validates
 *     against the catalog's own #/$defs/anyComponent — checked by manual
 *     discrimination (each instance against its own #/components/<name>
 *     branch), which is semantically equivalent and keeps every reported
 *     error inside the instance's own branch. See the gate 3 body.
 */
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { catalogMetaSchemas } from "./meta/catalog-meta.js";
import type { A2uiCatalog, A2uiVersion, Json } from "../types.js";

export interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
  errors?: string[];
  /**
   * Structured per-instance evidence for gate 3 failures (advanced channel
   * for downstream UIs). The strings in `errors` remain the primary
   * user-facing form; this preserves ajv's keyword/params/schemaPath, which
   * the strings deliberately compress.
   */
  errorDetails?: Array<{
    /** `component#id` — same prefix the string form carries. */
    instance: string;
    component: string;
    id: string;
    errors: Array<{
      instancePath?: string;
      schemaPath?: string;
      keyword?: string;
      params?: unknown;
      message?: string;
    }>;
  }>;
}

export interface ValidationReport {
  version: A2uiVersion;
  pass: boolean;
  gates: GateResult[];
}

function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  return ajv;
}

/** Collect every external `$ref` (a $ref whose value does not start with '#'). */
function externalRefs(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) externalRefs(n, acc);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string" && !v.startsWith("#")) acc.push(v);
      else externalRefs(v, acc);
    }
  }
  return acc;
}

/**
 * Collect every INTERNAL `$ref` that does not resolve inside the catalog
 * document, with the JSON path of the offending `$ref` keyword.
 *
 * This is what makes gate 1's documented guarantee true. ajv defers ref
 * resolution past `compile()`, so a structural slot schema (or any other
 * authored-schema channel) carrying `{$ref: "#/$defs/DoesNotExist"}` used to
 * produce either all-gates-PASS (no instances checked) or a raw
 * MissingRefError thrown out of gate 3 — pass-or-crash, never a finding.
 * Resolving the pointers ourselves turns the whole class into a pathed gate
 * failure at one boundary, for every channel at once.
 */
function danglingInternalRefs(root: unknown): string[] {
  const bad: string[] = [];
  const resolves = (pointer: string): boolean => {
    if (pointer === "#" || pointer === "#/") return true;
    if (!pointer.startsWith("#/")) return false; // #foo anchors are not used in our catalogs
    let node: unknown = root;
    for (const raw of pointer.slice(2).split("/")) {
      const key = decodeURIComponent(raw).replaceAll("~1", "/").replaceAll("~0", "~");
      if (Array.isArray(node)) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0 || i >= node.length) return false;
        node = node[i];
      } else if (node && typeof node === "object" && key in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[key];
      } else {
        return false;
      }
    }
    return true;
  };
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${at}/${i}`));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref" && typeof v === "string" && v.startsWith("#") && !resolves(v)) {
          bad.push(`${at}/$ref: '${v}' does not resolve inside this catalog`);
        } else {
          walk(v, `${at}/${k}`);
        }
      }
    }
  };
  walk(root, "");
  return bad;
}

/** Pull every component instance (object with string `component` + `id`) from a surface. */
export function extractInstances(surface: unknown, acc: Json[] = []): Json[] {
  if (Array.isArray(surface)) {
    for (const n of surface) extractInstances(n, acc);
  } else if (surface && typeof surface === "object") {
    const o = surface as Json;
    if (typeof o.component === "string" && typeof o.id === "string") acc.push(o);
    for (const v of Object.values(o)) extractInstances(v, acc);
  }
  return acc;
}

export function validateCatalog(
  catalog: A2uiCatalog,
  version: A2uiVersion,
  surface?: unknown,
): ValidationReport {
  const gates: GateResult[] = [];

  // Gate 1 — schema compile + no external $ref + every internal $ref resolves.
  const exts = externalRefs(catalog);
  const dangling = danglingInternalRefs(catalog);
  let compiled = false;
  let compileErr = "";
  try {
    newAjv().compile(catalog as unknown as Json);
    compiled = true;
  } catch (e) {
    compileErr = e instanceof Error ? e.message : String(e);
  }
  const selfContained = compiled && exts.length === 0 && dangling.length === 0;
  gates.push({
    name: "schema-compile + no-external-ref",
    pass: selfContained,
    detail: selfContained
      ? "Catalog compiles as a draft-2020-12 JSON Schema; every $ref is internal and resolves."
      : !compiled
        ? `ajv failed to compile the catalog as a schema: ${compileErr}`
        : exts.length
          ? `Catalog contains external $refs: ${[...new Set(exts)].join(", ")}`
          : `Catalog is not self-contained: ${dangling.length} internal $ref(s) do not resolve.`,
    errors: exts.length ? [...new Set(exts)] : dangling.length ? dangling : undefined,
  });

  // Gate 2 — catalog shape.
  const meta = catalogMetaSchemas[version];
  const validateShape = newAjv().compile(meta);
  const shapeOk = validateShape(catalog) as boolean;
  gates.push({
    name: "catalog-shape",
    pass: shapeOk,
    detail: shapeOk
      ? `Catalog satisfies the A2UI v${version} catalog-shape meta-schema.`
      : `Catalog violates the v${version} catalog-shape meta-schema.`,
    errors: shapeOk ? undefined : (validateShape.errors ?? []).map(fmtErr),
  });

  // Gate 3 — instances (only if the catalog is usable and a surface was supplied).
  if (surface !== undefined) {
    if (!compiled || dangling.length > 0) {
      gates.push({
        name: "instance",
        pass: false,
        detail: !compiled
          ? "Skipped: catalog did not compile, so instances cannot be checked."
          : "Skipped: catalog is not self-contained (gate 1 lists the dangling $refs), so instances cannot be checked.",
      });
    } else {
      // Belt and braces: gate 1 has already proven every ref resolves, but a
      // raw ajv throw must never escape this function regardless.
      const failures: string[] = [];
      const errorDetails: NonNullable<GateResult["errorDetails"]> = [];
      let instances: Json[] = [];
      try {
        const ajv = newAjv();
        ajv.addSchema(catalog as unknown as Json, catalog.$id);
        instances = extractInstances(surface);
        // Manual discrimination instead of the flat `#/$defs/anyComponent`
        // oneOf. Semantically equivalent: every branch of the emitted
        // anyComponent is `{$ref: "#/components/<name>"}` and each component
        // schema pins `component: {const: <name>}` inside its allOf (and
        // requires it), so an instance tagged component X can only ever match
        // branch X — validating the instance against ITS OWN branch accepts
        // and rejects exactly the same instances the oneOf does. What changes
        // is the report: allErrors WITHIN the matching branch (rigor
        // preserved, every genuine error surfaced) without echoing every
        // other branch's const/required/unevaluatedProperties noise.
        const admitted = Object.keys(catalog.components ?? {});
        for (const inst of instances) {
          const comp = String(inst.component);
          const id = String(inst.id);
          const where = `${comp}#${id}`;
          if (!admitted.includes(comp)) {
            failures.push(
              `${where}: component '${comp}' is not in this catalog (${admitted.length} components admitted)`,
            );
            errorDetails.push({
              instance: where,
              component: comp,
              id,
              errors: [
                {
                  message: `component '${comp}' is not in this catalog`,
                  params: { admittedComponents: admitted },
                },
              ],
            });
            continue;
          }
          const validateBranch = ajv.getSchema(`${catalog.$id}#/components/${comp}`);
          if (!validateBranch) {
            failures.push(`${where}: could not resolve #/components/${comp} from the catalog.`);
            continue;
          }
          if (!validateBranch(inst)) {
            const errs = validateBranch.errors ?? [];
            for (const e of errs) failures.push(`${where}: ${fmtErr(e)}`);
            errorDetails.push({
              instance: where,
              component: comp,
              id,
              errors: errs.map((e) => ({
                instancePath: e.instancePath,
                schemaPath: e.schemaPath,
                keyword: e.keyword,
                params: e.params as unknown,
                message: e.message,
              })),
            });
          }
        }
      } catch (e) {
        failures.push(`instance validation could not run: ${e instanceof Error ? e.message : String(e)}`);
      }
      gates.push({
        name: "instance",
        pass: failures.length === 0,
        detail:
          failures.length === 0
            ? `All ${instances.length} surface component instance(s) validate against #/$defs/anyComponent.`
            : `${failures.length} instance validation error(s).`,
        errors: failures.length ? failures : undefined,
        ...(errorDetails.length ? { errorDetails } : {}),
      });
    }
  }

  return { version, pass: gates.every((g) => g.pass), gates };
}

/**
 * One ajv error as a user-facing line: instancePath + message, enriched from
 * the error's params where they carry the actionable detail ajv's message
 * omits — the allowed enum values, the expected const, or the name of the
 * offending unevaluated/additional property.
 */
function fmtErr(e: { instancePath?: string; keyword?: string; params?: unknown; message?: string }): string {
  const params = (e.params ?? {}) as Record<string, unknown>;
  let out = `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim();
  if (e.keyword === "enum" && Array.isArray(params.allowedValues)) {
    out += ` (allowed: ${(params.allowedValues as unknown[]).map((v) => String(v)).join(", ")})`;
  } else if (e.keyword === "const" && "allowedValue" in params) {
    out += ` (expected: ${JSON.stringify(params.allowedValue)})`;
  } else if (e.keyword === "unevaluatedProperties" && typeof params.unevaluatedProperty === "string") {
    out += ` ('${params.unevaluatedProperty}')`;
  } else if (e.keyword === "additionalProperties" && typeof params.additionalProperty === "string") {
    out += ` ('${params.additionalProperty}')`;
  }
  return out;
}
