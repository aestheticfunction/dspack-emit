#!/usr/bin/env node
/**
 * dspack-emit CLI (also installed as the `dspack-emit` bin).
 *
 *   tsx src/cli.ts --in <dspack.json> --a2ui-version <0.9.1|1.0> --out <dir> [--surface <surface.json>]
 *                  [--profile <profile.json>] [--emit-surface <surface.dsurface.json>]
 *   tsx src/cli.ts --target json-render --in <dspack.json> --out <dir>
 *                  [--emit-surface <surface.dsurface.json>]
 *
 * --profile loads a JSON mapping profile (validated against
 * profile.v1.schema.json via loadProfile) instead of the built-in shadcn
 * profile — the flag that makes out-of-repo contracts emittable from CI.
 * When --profile is given and --surface is not, the sample-surface default
 * (a repo-relative fixture) is skipped and gate A3 runs on --emit-surface
 * output only.
 *
 * Default target (a2ui): emits a versioned A2UI catalog + a
 * validation/fidelity report. Exits non-zero if the hard gate (catalog schema
 * validation) fails, so it is CI-friendly. With --emit-surface, additionally
 * compiles a dspack surface document (CSR) into A2UI surface messages
 * (out/<name>.surface.json), instance-validated against the freshly generated
 * catalog (gate A3). A malformed or out-of-vocabulary surface exits 4.
 *
 * json-render target: generates catalog.ts + registry.tsx (Zod component
 * defs + typed stub registry) from the contract. With --emit-surface,
 * additionally compiles the CSR into a json-render spec
 * (out/<name>.spec.json), validated against the catalog model — failure
 * exits 4, mirroring the a2ui path. The framework-level gates J1–J3 (tsc +
 * real Zod parse) run in gates/json-render, not here.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { A2uiVersion, DspackDoc, DspackSurface } from "./types.js";
import { transform } from "./transform/index.js";
import { shadcnProfile, type Profile } from "./transform/profiles.js";
import { loadProfile, ProfileLoadError } from "./transform/profile-load.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";
import { generateJsonRenderModules } from "./targets/json-render/codegen.js";
import { emitJsonRenderSpec, EmitJsonRenderError, validateSpecAgainstModel } from "./targets/json-render/emit.js";

interface Args {
  target: "a2ui" | "json-render";
  in: string;
  version: A2uiVersion;
  out: string;
  surface?: string;
  profile?: string;
  emitSurface?: string;
  strictCoverage: boolean;
  /** Fidelity classes that fail an emitted surface; undefined = not strict. */
  strictSurface?: string[];
}

/** Flags that take no value; their presence means `true`. */
const BOOLEAN_FLAGS = new Set(["strict-coverage"]);

/**
 * Flags whose value is optional: bare `--strict-surface` means the default
 * class set; `--strict-surface=lossy,synthesis-defaults` configures it.
 */
const OPTIONAL_VALUE_FLAGS = new Set(["strict-surface"]);
const STRICT_SURFACE_DEFAULT = ["lossy", "cannot-represent"];
const FIDELITY_CLASSES = new Set(["maps-cleanly", "synthesis-defaults", "lossy", "cannot-represent"]);

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
    } else if (OPTIONAL_VALUE_FLAGS.has(tok.slice(2))) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        m.set(tok.slice(2), next);
        i++;
      } else {
        m.set(tok.slice(2), "");
      }
    } else {
      const value = argv[++i];
      if (value === undefined) fail(`flag '${tok}' is missing a value`);
      m.set(tok.slice(2), value);
    }
  }
  const target = m.get("target") ?? "a2ui";
  if (target !== "a2ui" && target !== "json-render") {
    fail("--target must be 'a2ui' or 'json-render'");
  }
  const version = m.get("a2ui-version");
  if (target === "a2ui" && version !== "0.9.1" && version !== "1.0") {
    fail("--a2ui-version must be '0.9.1' or '1.0'");
  }
  if (target === "json-render" && version !== undefined) {
    fail("--a2ui-version does not apply to --target json-render");
  }
  const input = m.get("in");
  if (!input) fail("--in <dspack.json> is required");
  const profile = m.get("profile");
  return {
    target,
    in: input!,
    version: (version ?? "0.9.1") as A2uiVersion,
    out: m.get("out") ?? "out",
    // The sample-surface default is a repo-relative fixture; external callers
    // (--profile) get a vacuous A3 unless they pass --surface/--emit-surface.
    surface: m.get("surface") ?? (profile ? undefined : "surface/settings-card.surface.json"),
    profile,
    emitSurface: m.get("emit-surface"),
    strictCoverage: m.get("strict-coverage") === "true",
    strictSurface: parseStrictSurface(m),
  };
}

function parseStrictSurface(m: Map<string, string>): string[] | undefined {
  if (!m.has("strict-surface")) return undefined;
  const raw = m.get("strict-surface")!;
  const classes = raw === "" ? STRICT_SURFACE_DEFAULT : raw.split(",").map((c) => c.trim());
  for (const c of classes) {
    if (!FIDELITY_CLASSES.has(c)) {
      fail(`--strict-surface: unknown fidelity class '${c}' (known: ${[...FIDELITY_CLASSES].join(", ")})`);
    }
  }
  return classes;
}

/**
 * The strict-surface gate: print the emitted surface's fidelity ledger, then
 * fail (exit 5) when any entry's class is in the configured set. Loss is
 * never invisible — without the flag the ledger still prints; the flag makes
 * the configured classes FATAL rather than informational.
 */
function gateSurfaceFidelity(
  tag: string,
  fidelity: Array<{ source: string; destination: string; origin: string; kind: string; class: string; note?: string }>,
  strict: string[] | undefined,
): void {
  const counts = new Map<string, number>();
  for (const f of fidelity) counts.set(f.class, (counts.get(f.class) ?? 0) + 1);
  const summary = [...counts.entries()].map(([c, n]) => `${c}=${n}`).join(" ") || "none";
  console.log(`${tag}   fidelity  ${fidelity.length} transformation(s): ${summary}`);
  if (!strict) return;
  const failing = fidelity.filter((f) => strict.includes(f.class));
  if (failing.length === 0) {
    console.log(`${tag}   PASS  strict-surface (no ${strict.join("/")} transformations)`);
    return;
  }
  console.error(`${tag} STRICT-SURFACE: ${failing.length} transformation(s) in failing class(es) ${strict.join(", ")}:`);
  for (const f of failing) {
    console.error(`${tag}     [${f.class}] ${f.kind}  ${f.source} -> ${f.destination}  (${f.origin})${f.note ? ` — ${f.note}` : ""}`);
  }
  process.exit(5);
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function jsonRenderMain(args: Args, doc: DspackDoc): void {
  const tag = "[json-render]";
  const { catalogTs, registryTsx, model } = generateJsonRenderModules(doc);
  mkdirSync(resolve(args.out), { recursive: true });
  const base = resolve(args.out);
  writeFileSync(join(base, "catalog.ts"), catalogTs);
  writeFileSync(join(base, "registry.tsx"), registryTsx);
  console.log(`${tag} catalog  -> ${join(args.out, "catalog.ts")} (${model.components.length} components)`);
  console.log(`${tag} registry -> ${join(args.out, "registry.tsx")} (stub implementations)`);
  for (const component of model.components) {
    for (const excluded of component.excludedProps) {
      console.log(`${tag}   note  prop-excluded: ${component.dspackId}.${excluded.name} — ${excluded.reason}`);
    }
  }

  if (args.emitSurface) {
    const csr = JSON.parse(readFileSync(resolve(args.emitSurface), "utf8")) as DspackSurface;
    let emitted;
    try {
      emitted = emitJsonRenderSpec(csr, doc);
    } catch (e) {
      if (e instanceof EmitJsonRenderError) {
        console.error(`${tag} EMIT-SPEC FAILED: ${e.message}`);
        process.exit(4);
      }
      throw e;
    }
    const name = basename(args.emitSurface).replace(/\.dsurface\.json$|\.json$/, "");
    const outPath = join(base, `${name}.spec.json`);
    writeFileSync(outPath, JSON.stringify(emitted.spec, null, 2) + "\n");
    for (const w of emitted.warnings) console.log(`${tag}   note  ${w.code}: ${w.message}`);
    // Offline mirror of gates J2/J3 over the emitted spec; the framework-level
    // gates (tsc + real Zod parse) run in gates/json-render.
    const findings = validateSpecAgainstModel(emitted.spec, model);
    console.log(`${tag} emitted spec -> ${outPath}`);
    console.log(`${tag}   ${findings.length === 0 ? "PASS" : "FAIL"}  model-vocabulary (emitted spec vs generated catalog model)`);
    if (findings.length > 0) {
      for (const f of findings) console.error(`${tag}     ${f.path}: ${f.message}`);
      process.exit(4);
    }
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const seg = args.version === "0.9.1" ? "v0_9_1" : "v1_0";

  const doc = JSON.parse(readFileSync(resolve(args.in), "utf8")) as DspackDoc;
  if (args.target === "json-render") {
    jsonRenderMain(args, doc);
    return;
  }
  let profile: Profile = shadcnProfile;
  if (args.profile) {
    try {
      profile = loadProfile(JSON.parse(readFileSync(resolve(args.profile), "utf8")));
    } catch (e) {
      if (e instanceof ProfileLoadError) {
        console.error(`error: --profile ${args.profile}: ${e.message}`);
        process.exit(2);
      }
      throw e;
    }
  }
  const surface = args.surface ? JSON.parse(readFileSync(resolve(args.surface), "utf8")) : { messages: [] };

  const { catalog, mapping, validation, report } = transform(doc, args.version, surface, profile);

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
      emitted = emitSurface(csr, doc, { profile });
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
    gateSurfaceFidelity(tag, emitted.fidelity, args.strictSurface);
    // Gate A3 over the emitted surface: its instances must validate against the
    // catalog generated in this same run.
    const check = transform(doc, args.version, { messages: emitted.messages }, profile);
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
