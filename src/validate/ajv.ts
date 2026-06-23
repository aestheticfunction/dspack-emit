/**
 * A2UI catalog schema validation — three executable gates, mirroring the ajv
 * approach A2UI uses in specification/scripts/validate.py
 * (draft 2020-12, strict:false, ajv-formats):
 *
 *  1. schema-compile + no-external-ref: ajv compiles the catalog AS a JSON Schema.
 *     Compilation fails on any unresolved `$ref`, proving the catalog is a valid,
 *     fully self-contained schema with zero external references.
 *  2. catalog-shape: the catalog validates against the version-specific
 *     a2ui-catalog.meta.<ver>.json (the literal "catalog schema" check; this is what
 *     makes v0.9.1 vs v1.0 conformance distinct — theme vs surfaceProperties).
 *  3. instance: every component instance in the hand-authored surface validates
 *     against the catalog's own #/$defs/anyComponent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { A2uiCatalog, A2uiVersion, Json } from "../types.js";

export interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
  errors?: string[];
}

export interface ValidationReport {
  version: A2uiVersion;
  pass: boolean;
  gates: GateResult[];
}

const metaPath = (ver: A2uiVersion): string =>
  fileURLToPath(new URL(`./meta/a2ui-catalog.meta.${ver === "0.9.1" ? "0_9_1" : "1_0"}.json`, import.meta.url));

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

  // Gate 1 — schema compile + no external $ref.
  const exts = externalRefs(catalog);
  let compiled = false;
  let compileErr = "";
  try {
    newAjv().compile(catalog as unknown as Json);
    compiled = true;
  } catch (e) {
    compileErr = e instanceof Error ? e.message : String(e);
  }
  gates.push({
    name: "schema-compile + no-external-ref",
    pass: compiled && exts.length === 0,
    detail:
      compiled && exts.length === 0
        ? "Catalog compiles as a draft-2020-12 JSON Schema with only internal $refs."
        : !compiled
          ? `ajv failed to compile the catalog as a schema: ${compileErr}`
          : `Catalog contains external $refs: ${[...new Set(exts)].join(", ")}`,
    errors: exts.length ? [...new Set(exts)] : undefined,
  });

  // Gate 2 — catalog shape.
  const meta = JSON.parse(readFileSync(metaPath(version), "utf8")) as Json;
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

  // Gate 3 — instances (only if compilable and a surface was supplied).
  if (surface !== undefined) {
    if (!compiled) {
      gates.push({
        name: "instance",
        pass: false,
        detail: "Skipped: catalog did not compile, so instances cannot be checked.",
      });
    } else {
      const ajv = newAjv();
      ajv.addSchema(catalog as unknown as Json, catalog.$id);
      const validateAny = ajv.getSchema(`${catalog.$id}#/$defs/anyComponent`);
      const instances = extractInstances(surface);
      const failures: string[] = [];
      if (!validateAny) {
        failures.push("Could not resolve #/$defs/anyComponent from the catalog.");
      } else {
        for (const inst of instances) {
          if (!validateAny(inst)) {
            const where = `${inst.component}#${inst.id}`;
            for (const e of validateAny.errors ?? []) failures.push(`${where}: ${fmtErr(e)}`);
          }
        }
      }
      gates.push({
        name: "instance",
        pass: failures.length === 0,
        detail:
          failures.length === 0
            ? `All ${instances.length} surface component instance(s) validate against #/$defs/anyComponent.`
            : `${failures.length} instance validation error(s).`,
        errors: failures.length ? failures : undefined,
      });
    }
  }

  return { version, pass: gates.every((g) => g.pass), gates };
}

function fmtErr(e: { instancePath?: string; message?: string }): string {
  return `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim();
}
