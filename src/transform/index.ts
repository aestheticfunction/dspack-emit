/**
 * Orchestrates the transform: load -> map -> emit -> validate -> report.
 */
import type { A2uiCatalog, A2uiVersion, DspackDoc } from "../types.js";
import { shadcnProfile, type Profile } from "./profiles.js";
import { mapDspack, type MappingResult } from "./mapping.js";
import { emitCatalog } from "./emit.js";
import { buildReport, type ReportBundle } from "./report.js";
import { validateCatalog, type ValidationReport } from "../validate/ajv.js";

export interface TransformOutput {
  catalog: A2uiCatalog;
  mapping: MappingResult;
  validation: ValidationReport;
  report: ReportBundle;
}

export function transform(
  doc: DspackDoc,
  version: A2uiVersion,
  surface: unknown,
  profile: Profile = shadcnProfile,
): TransformOutput {
  // Conformance: reject unknown dspack MAJOR version (per dspack §2).
  const major = String(doc.dspack ?? "").split(".")[0];
  if (major !== "0") {
    throw new Error(`Unsupported dspack major version '${doc.dspack}'. This PoC targets dspack 0.x.`);
  }

  const mapping = mapDspack(doc, profile);
  const catalog = emitCatalog(mapping, version, profile);
  const validation = validateCatalog(catalog, version, surface);
  const report = buildReport(version, mapping, validation);

  return { catalog, mapping, validation, report };
}
