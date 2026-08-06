#!/usr/bin/env node
/**
 * Derived sub-component coverage report.
 *
 * `subCoverage` is authored prose the engine never reads, enforced only by a
 * test in another repo. The internal model can derive the same facts. Before
 * that derivation is allowed to REFUSE anything, it has to be measured against
 * every profile we can reach — a gate that looks correct and quietly breaks
 * valid legacy behaviour is worse than the prose it replaces.
 *
 * Classifies every sub-component of every mapped compound as one of:
 *   routed     a route consumes its text or label directly
 *   collected  a collect gathers it as a repetition
 *   absorbed   unnamed, but walked through by a consuming route
 *   dropped    explicitly discarded with an authored reason
 *   transparent  dissolved, or re-identified as a text primitive
 *   UNRESOLVED   nothing in the model accounts for it
 *
 * Reports only; exits 0 regardless. Making UNRESOLVED fatal is a later,
 * separate decision that this report exists to inform.
 */
import { readFileSync } from "node:fs";
import { surfaceModelOf } from "../dist/transform/desugar.js";
import { referencedSubs } from "../dist/transform/model.js";
import { shadcnProfile } from "../dist/transform/profiles.js";
import { loadProfile } from "../dist/transform/profile-load.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

/** How a derived reason string maps onto the report's classes. */
const classify = (reason) => {
  if (reason === undefined) return "UNRESOLVED";
  if (reason.startsWith("consumed into")) return "routed";
  if (reason.startsWith("collected")) return "collected";
  if (reason.startsWith("dropped")) return "dropped";
  if (reason.startsWith("transparent") || reason.startsWith("re-identified")) return "transparent";
  return "absorbed";
};

function report(label, doc, profile) {
  const byId = new Map();
  for (const plan of profile.components ?? []) if (plan.dspackId) byId.set(plan.dspackId, plan);

  const totals = { routed: 0, collected: 0, absorbed: 0, dropped: 0, transparent: 0, UNRESOLVED: 0 };
  const unresolved = [];
  let compounds = 0;

  for (const [id, component] of Object.entries(doc.components ?? {})) {
    const subs = (component.composition?.subComponents ?? []).map((s) => s.id);
    if (subs.length === 0) continue;
    const plan = byId.get(id);
    if (!plan) continue; // unmapped or a casualty — its parent's reason covers the family
    compounds++;
    const model = surfaceModelOf(plan);
    const named = referencedSubs(model);
    for (const sub of subs) {
      let cls = classify(named.get(sub));
      // Unnamed subs under a consuming route are walked through on the way to a
      // named one — real, and the reason a name-only derivation under-reports.
      if (cls === "UNRESOLVED" && model.consumesSubtree) cls = "absorbed";
      totals[cls]++;
      if (cls === "UNRESOLVED") unresolved.push(`${id} -> ${sub}`);
    }
  }

  const declared = Object.values(doc.components ?? {}).reduce(
    (n, c) => n + (c.composition?.subComponents ?? []).length,
    0,
  );
  const counted = Object.values(totals).reduce((a, b) => a + b, 0);

  console.log(`\n=== ${label} ===`);
  console.log(`  contract v${doc.version ?? "?"} · ${Object.keys(doc.components ?? {}).length} components · ${declared} sub-components declared`);
  console.log(`  mapped compounds: ${compounds} · sub-components under them: ${counted}`);
  for (const [k, v] of Object.entries(totals)) if (v > 0) console.log(`    ${k.padEnd(12)} ${v}`);
  if (unresolved.length > 0) {
    console.log(`  UNRESOLVED (${unresolved.length}):`);
    for (const u of unresolved.slice(0, 20)) console.log(`    - ${u}`);
    if (unresolved.length > 20) console.log(`    … and ${unresolved.length - 20} more`);
  } else {
    console.log(`  UNRESOLVED: none`);
  }
  return unresolved.length;
}

const ROOT = new URL("..", import.meta.url).pathname;
let missing = [];

report("pinned shadcn v2.3.0 (in-repo profile)", read(`${ROOT}/input/shadcn-ui.dspack.json`), shadcnProfile);

// Astryx declares zero sub-components — the whole sub-* family is dead by
// construction for props-based contracts. Reported so the zero is visible.
report("astryx (scaffold-reachable, props-based)", read(`${ROOT}/input/astryx.dspack.json`), { components: [] });

for (const [label, docPath, profPath] of [
  [
    "acme (composer demo project)",
    "/Users/ryandombrowski/Desktop/dspack-studio/apps/composer/demo-project/acme-ui.dspack.json",
    "/Users/ryandombrowski/Desktop/dspack-studio/apps/composer/demo-project/acme.profile.json",
  ],
  // The durable production measurement: the pinned v3 contract copy plus the
  // reproducible evaluation fixture (see eval/build-eval-profile.mjs — NOT
  // Studio's profile; unresolved entries are deliberate open decisions).
  ["production shadcn v3.0.0 (eval fixture)", `${ROOT}/eval/shadcn-v3.dspack.json`, `${ROOT}/eval/shadcn-v3.eval.profile.json`],
]) {
  try {
    report(label, read(docPath), loadProfile(read(profPath)));
  } catch (e) {
    missing.push(`${label}: ${e.message?.slice(0, 120)}`);
  }
}

if (missing.length) {
  console.log(`\n=== not measured ===`);
  for (const m of missing) console.log(`  ${m}`);
}
