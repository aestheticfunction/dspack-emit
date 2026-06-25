/**
 * Builds the validation + fidelity report (Markdown + JSON) for one emitted catalog.
 */
import type { A2uiVersion, FidelityClass, FidelityEntry, Warning } from "../types.js";
import type { MappingResult } from "./mapping.js";
import type { ValidationReport } from "../validate/ajv.js";

const CLASS_ORDER: FidelityClass[] = ["maps-cleanly", "synthesis-defaults", "lossy", "cannot-represent"];
const CLASS_LABEL: Record<FidelityClass, string> = {
  "maps-cleanly": "maps cleanly",
  "synthesis-defaults": "requires synthesis / defaults",
  lossy: "currently lossy",
  "cannot-represent": "cannot be represented",
};

export interface ReportBundle {
  md: string;
  json: Json;
}
type Json = Record<string, unknown>;

export function buildReport(
  version: A2uiVersion,
  mapping: MappingResult,
  validation: ValidationReport,
): ReportBundle {
  const counts = countByClass(mapping.fidelity);

  const json: Json = {
    a2uiVersion: version,
    generatedAt: new Date().toISOString(),
    validation: { pass: validation.pass, gates: validation.gates },
    fidelity: {
      summary: counts,
      entries: mapping.fidelity,
    },
    warnings: mapping.warnings,
    emittedComponents: mapping.componentOrder,
    primaryColor: { hex: mapping.primaryColorHex, source: mapping.primaryColorSource },
    coverage: {
      unclassified: mapping.coverage.filter((c) => c.disposition === "unclassified").map((c) => c.id),
      entries: mapping.coverage,
    },
  };

  const md = [
    `# Validation & fidelity report — A2UI v${version}`,
    "",
    `Emitted components: ${mapping.componentOrder.map((c) => "`" + c + "`").join(", ")}`,
    `Primary color token: ${mapping.primaryColorSource ?? "(none)"} → \`${mapping.primaryColorHex ?? "—"}\``,
    "",
    `## Validation — ${validation.pass ? "✅ PASS" : "❌ FAIL"} (hard gate)`,
    "",
    "| Gate | Result | Detail |",
    "| --- | --- | --- |",
    ...validation.gates.map(
      (g) => `| ${g.name} | ${g.pass ? "✅ pass" : "❌ fail"} | ${escapePipes(g.detail)} |`,
    ),
    "",
    ...validation.gates
      .filter((g) => g.errors?.length)
      .flatMap((g) => [`### ${g.name} — details`, "", ...g.errors!.map((e) => `- ${escapePipes(e)}`), ""]),
    `## Fidelity summary`,
    "",
    "| Class | Count |",
    "| --- | --- |",
    ...CLASS_ORDER.map((c) => `| ${CLASS_LABEL[c]} | ${counts[c]} |`),
    "",
    `## Fidelity — per field`,
    "",
    "| Source (dspack) | Target (A2UI) | Class | Note |",
    "| --- | --- | --- | --- |",
    ...mapping.fidelity.map(
      (f) =>
        `| \`${f.source}\` | \`${f.target}\` | ${CLASS_LABEL[f.class]} | ${escapePipes(f.note)} |`,
    ),
    "",
    `## Component coverage (every input dspack component accounted for)`,
    "",
    "| dspack component | Disposition | Detail |",
    "| --- | --- | --- |",
    ...mapping.coverage.map(
      (c) => `| \`${c.id}\` | ${c.disposition === "unclassified" ? "⚠️ **unclassified**" : c.disposition} | ${escapePipes(c.detail ?? "")} |`,
    ),
    "",
    `## Warnings (unsupported dspack constructs)`,
    "",
    mapping.warnings.length === 0
      ? "_None._"
      : mapping.warnings.map((w: Warning) => `- **${w.code}** — ${escapePipes(w.message)}`).join("\n"),
    "",
  ].join("\n");

  return { md, json };
}

function countByClass(entries: FidelityEntry[]): Record<FidelityClass, number> {
  const counts = { "maps-cleanly": 0, "synthesis-defaults": 0, lossy: 0, "cannot-represent": 0 };
  for (const e of entries) counts[e.class]++;
  return counts;
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
