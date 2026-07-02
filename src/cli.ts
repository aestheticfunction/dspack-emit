#!/usr/bin/env -S npx tsx
/**
 * dspack-to-a2ui CLI.
 *
 *   tsx src/cli.ts --in <dspack.json> --a2ui-version <0.9.1|1.0> --out <dir> [--surface <surface.json>]
 *                  [--emit-surface <surface.dsurface.json>]
 *
 * Emits a versioned A2UI catalog + a validation/fidelity report. Exits non-zero
 * if the hard gate (catalog schema validation) fails, so it is CI-friendly.
 *
 * With --emit-surface, additionally compiles a dspack surface document (CSR)
 * into A2UI surface messages (out/<name>.surface.json), instance-validated
 * against the freshly generated catalog (gate A3). A malformed or
 * out-of-vocabulary surface exits 4.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { A2uiVersion, DspackDoc, DspackSurface } from "./types.js";
import { transform } from "./transform/index.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";

interface Args {
  in: string;
  version: A2uiVersion;
  out: string;
  surface: string;
  emitSurface?: string;
  strictCoverage: boolean;
}

/** Flags that take no value; their presence means `true`. */
const BOOLEAN_FLAGS = new Set(["strict-coverage"]);

function parseArgs(argv: string[]): Args {
  // Supports `--key value`, `--key=value`, and valueless boolean flags; fails fast
  // on a malformed flag or a value-taking `--key` missing its value.
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) fail(`unexpected argument '${tok}' (flags must start with --)`);
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      m.set(tok.slice(2, eq), tok.slice(eq + 1));
    } else if (BOOLEAN_FLAGS.has(tok.slice(2))) {
      m.set(tok.slice(2), "true");
    } else {
      const value = argv[++i];
      if (value === undefined) fail(`flag '${tok}' is missing a value`);
      m.set(tok.slice(2), value);
    }
  }
  const version = m.get("a2ui-version");
  if (version !== "0.9.1" && version !== "1.0") {
    fail("--a2ui-version must be '0.9.1' or '1.0'");
  }
  const input = m.get("in");
  if (!input) fail("--in <dspack.json> is required");
  return {
    in: input!,
    version: version as A2uiVersion,
    out: m.get("out") ?? "out",
    surface: m.get("surface") ?? "surface/settings-card.surface.json",
    emitSurface: m.get("emit-surface"),
    strictCoverage: m.get("strict-coverage") === "true",
  };
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const seg = args.version === "0.9.1" ? "v0_9_1" : "v1_0";

  const doc = JSON.parse(readFileSync(resolve(args.in), "utf8")) as DspackDoc;
  const surface = JSON.parse(readFileSync(resolve(args.surface), "utf8"));

  const { catalog, mapping, validation, report } = transform(doc, args.version, surface);

  mkdirSync(resolve(args.out), { recursive: true });
  const base = resolve(args.out);
  writeFileSync(join(base, `catalog.${seg}.json`), JSON.stringify(catalog, null, 2) + "\n");
  writeFileSync(join(base, `validation-report.${seg}.md`), report.md);
  writeFileSync(join(base, `validation-report.${seg}.json`), JSON.stringify(report.json, null, 2) + "\n");

  const tag = `[a2ui ${args.version}]`;
  console.log(`${tag} catalog -> ${join(args.out, `catalog.${seg}.json`)}`);
  console.log(`${tag} report  -> ${join(args.out, `validation-report.${seg}.md`)}`);
  for (const g of validation.gates) console.log(`${tag}   ${g.pass ? "PASS" : "FAIL"}  ${g.name}`);
  console.log(`${tag} ${validation.pass ? "VALIDATION PASSED" : "VALIDATION FAILED"}`);

  const unclassified = mapping.coverage.filter((c) => c.disposition === "unclassified");
  if (unclassified.length) {
    console.log(`${tag} COVERAGE: ${unclassified.length} unclassified component(s): ${unclassified.map((c) => c.id).join(", ")}`);
  }

  if (!validation.pass) process.exit(1);
  if (args.strictCoverage && unclassified.length) process.exit(3);

  if (args.emitSurface) {
    const csr = JSON.parse(readFileSync(resolve(args.emitSurface), "utf8")) as DspackSurface;
    let emitted;
    try {
      emitted = emitSurface(csr, doc);
    } catch (e) {
      if (e instanceof EmitSurfaceError) {
        console.error(`${tag} EMIT-SURFACE FAILED: ${e.message}`);
        process.exit(4);
      }
      throw e;
    }
    const name = basename(args.emitSurface).replace(/\.dsurface\.json$|\.json$/, "");
    const outPath = join(base, `${name}.surface.json`);
    writeFileSync(outPath, JSON.stringify({ messages: emitted.messages }, null, 2) + "\n");
    for (const w of emitted.warnings) console.log(`${tag}   note  ${w.code}: ${w.message}`);
    // Gate A3 over the emitted surface: its instances must validate against the
    // catalog generated in this same run.
    const check = transform(doc, args.version, { messages: emitted.messages });
    const instanceGate = check.validation.gates.find((g) => g.name === "instance");
    console.log(`${tag} emitted surface -> ${outPath}`);
    console.log(`${tag}   ${instanceGate?.pass ? "PASS" : "FAIL"}  instance (emitted surface vs generated catalog)`);
    if (!instanceGate?.pass) {
      for (const err of instanceGate?.errors ?? []) console.error(`${tag}     ${err}`);
      process.exit(4);
    }
  }
}

main();
