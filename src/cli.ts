#!/usr/bin/env -S npx tsx
/**
 * dspack-to-a2ui CLI.
 *
 *   tsx src/cli.ts --in <dspack.json> --a2ui-version <0.9.1|1.0> --out <dir> [--surface <surface.json>]
 *
 * Emits a versioned A2UI catalog + a validation/fidelity report. Exits non-zero
 * if the hard gate (catalog schema validation) fails, so it is CI-friendly.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { A2uiVersion, DspackDoc } from "./types.js";
import { transform } from "./transform/index.js";

interface Args {
  in: string;
  version: A2uiVersion;
  out: string;
  surface: string;
}

function parseArgs(argv: string[]): Args {
  // Supports `--key value` and `--key=value`; fails fast on a malformed flag or a
  // `--key` missing its value rather than silently recording `undefined`.
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) fail(`unexpected argument '${tok}' (flags must start with --)`);
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      m.set(tok.slice(2, eq), tok.slice(eq + 1));
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

  const { catalog, validation, report } = transform(doc, args.version, surface);

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

  if (!validation.pass) process.exit(1);
}

main();
