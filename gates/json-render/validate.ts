/**
 * Gates J2 + J3 for the json-render target, with the real framework:
 *
 *   J2 — structural integrity: json-render's own validateSpec() over the
 *        emitted spec (root resolves, child references resolve, no
 *        misplaced fields).
 *   J3 — instance acceptance: catalog.validate() parses the spec with the
 *        Zod schemas of the GENERATED catalog (generated/catalog.ts, written
 *        from the contract by the CLI in scripts/json-render-gate.sh).
 *
 * Corpus: every governed CSR this repo carries — the contract's worked
 * example and the delete-account fixture — emitted in-process through the
 * same emitter the library exports, plus the spec JSON the CLI itself wrote
 * (proving the CLI artifact, not just the in-process object). A deliberately
 * corrupted spec must FAIL J3, so the gate is proven non-vacuous.
 *
 * (Gate J1 — the generated modules compile — is the tsc -p step that runs
 * before this script; see package.json "gate".)
 */
import { readFileSync } from "node:fs";
import { validateSpec, type Spec } from "@json-render/core";
import { catalog } from "./generated/catalog.js";
import { emitJsonRenderSpec, type JsonRenderSpec } from "../../src/targets/json-render/emit.js";
import type { DspackDoc, DspackSurface } from "../../src/types.js";

const here = new URL(".", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, here), "utf8");

const doc = JSON.parse(read("../../input/shadcn-ui.dspack.json")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};

let failures = 0;

function gate(name: string, label: string, pass: boolean, detail?: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}  ${label}${detail && !pass ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

function runGates(label: string, spec: JsonRenderSpec): void {
  const j2 = validateSpec(spec as unknown as Spec);
  gate("J2 structure", label, j2.valid, JSON.stringify(j2.issues));
  const j3 = catalog.validate(spec);
  gate(
    "J3 instance ",
    label,
    j3.success,
    j3.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "),
  );
}

// 1. Governed CSRs, emitted in-process.
const corpus: Array<{ label: string; surface: DspackSurface }> = [
  ...doc.examples.map((e) => ({ label: `example ${e.id}`, surface: e.surface })),
  {
    label: "surface/delete-account.dsurface.json",
    surface: JSON.parse(read("../../surface/delete-account.dsurface.json")) as DspackSurface,
  },
];
for (const { label, surface } of corpus) {
  runGates(label, emitJsonRenderSpec(surface, doc).spec);
}

// 2. The CLI-written artifact itself.
runGates("generated/delete-account.spec.json (CLI artifact)", JSON.parse(read("generated/delete-account.spec.json")) as JsonRenderSpec);

// 3. Non-vacuity: a corrupted spec must FAIL J3.
const corrupted = emitJsonRenderSpec(corpus[0].surface, doc).spec;
const anyElement = corrupted.elements[Object.keys(corrupted.elements)[0]];
(anyElement as { type: string }).type = "NotInTheCatalog";
const j3bad = catalog.validate(corrupted);
gate("J3 non-vacuity", "corrupted spec is refused", !j3bad.success);

if (failures > 0) {
  console.error(`json-render gates: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("json-render gates: all PASS (J2, J3 over the governed corpus; non-vacuity proven)");
