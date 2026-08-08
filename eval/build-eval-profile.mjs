#!/usr/bin/env node
/**
 * Builds eval/shadcn-v3.eval.profile.json — the REPRODUCIBLE coverage-
 * evaluation fixture for the production shadcn v3 contract.
 *
 * WHAT THIS IS NOT. This is not the profile Studio uses (Studio consumes the
 * pinned v2.3.0 contract with the shipped v1 profile — see docs/CONTRACT-PIN
 * in both repos), it is not production-ready, and it is not a claim of v3
 * coverage. Its sole purpose is to measure the current foundation against the
 * production contract HONESTLY, replacing the /tmp-only profile behind the
 * 2aac076 measurement record that did not survive a reboot.
 *
 * Derivation — mechanical by construction, no fresh judgment:
 *   1. eval/shadcn-v3.dspack.json is the production contract at dspack commit
 *      48643ff (sha256 ea87346f…), the v3 evidence corpus. A pinned copy, not
 *      a synced one: the fixture must measure one corpus, stably.
 *   2. scaffoldProfile derives every plan mechanically (identity + verbatim
 *      props + example-observed children/text routes), leaving every
 *      sub-component decision explicitly unresolved.
 *   3. The six components the shipped profile maps (button, card, input,
 *      badge, table, alert-dialog) get their COMMITTED plans transplanted —
 *      structural, propMap, required — with the surface block in the v2
 *      re-spelling that src/profile-v2.test.ts byte-proves equivalent.
 *   4. NO casualties are declared. The representation analysis showed some of
 *      the old casualty reasons were wrong (dialog is representable — T4);
 *      classifying families as casualties here would undercount the very
 *      unresolved surface this fixture exists to measure.
 *
 * Reproducibility: src/eval-fixture.test.ts rebuilds this from the committed
 * inputs and asserts byte-equality with the committed fixture. Regenerate
 * deliberately with `node eval/build-eval-profile.mjs --write`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { scaffoldProfile } = await import(join(root, "dist/transform/scaffold.js"));
const { shadcnProfile } = await import(join(root, "dist/transform/profiles.js"));
const { SHADCN_V2_SURFACES, SHADCN_V3_T1_SURFACES, SHADCN_V3_T2_PLANS, SHADCN_V3_T3_PLANS, SHADCN_V3_A0_PLANS, SHADCN_V3_A0_LABEL_ADDITIONS, SHADCN_V3_T4_PLANS } = await import(join(root, "dist/transform/shadcn-v2-respelling.js"));

export const CONTRACT_SHA256 = "55a02863af330bde1af15e896aac93d6d78109a3bdbbc27ad253ea210a858c93";
export const CONTRACT_COMMIT = "bd2851b (aestheticfunction/dspack, merged as d50f049 / PR #42 — contract 3.2.0, the dspack#40 field correction)";

export function buildEvalProfile() {
  const contractBytes = readFileSync(join(root, "eval/shadcn-v3.dspack.json"));
  const actual = createHash("sha256").update(contractBytes).digest("hex");
  if (actual !== CONTRACT_SHA256) {
    throw new Error(
      `eval contract copy has changed: expected sha256 ${CONTRACT_SHA256}, got ${actual}. ` +
        `The fixture measures ONE pinned corpus (${CONTRACT_COMMIT}); a changed copy is an accident or a deliberate re-pin — never silent.`,
    );
  }
  const contract = JSON.parse(contractBytes.toString("utf8"));

  const { profile } = scaffoldProfile(contract, {
    catalogIdBase: "https://example.invalid/eval/shadcn-v3",
    catalogTitle: "shadcn/ui v3 — coverage-evaluation catalog (NOT production, NOT Studio's profile)",
    catalogDescription:
      "Evaluation fixture measuring the emit foundation against the production shadcn v3 contract. " +
      "Mechanically derived; every sub-component decision outside the six transplanted plans is deliberately unresolved.",
  });

  const shipped = new Map(shadcnProfile.components.map((p) => [p.dspackId, p]));
  profile.components = profile.components.map((plan) => {
    const source = shipped.get(plan.dspackId);
    const surface = SHADCN_V2_SURFACES[plan.dspackId];
    if (source && surface) {
      const { surfacePlan: _v1, subCoverage: _prose, ...rest } = structuredClone(source);
      return { ...rest, surface };
    }
    // T1 resolutions (proven in src/t1.test.ts): the transparent plan carries
    // no catalog surface — required componentPlan fields stay present, EMPTY.
    const t1 = SHADCN_V3_T1_SURFACES[plan.dspackId];
    if (t1) {
      const { propMap: _p, ...rest } = plan;
      return { ...rest, structural: {}, required: [], surface: structuredClone(t1) };
    }
    // T2 resolutions (proven in src/t2.test.ts): a collecting plan IS a
    // catalog component — the whole receiving plan is committed evidence.
    const t2 = SHADCN_V3_T2_PLANS[plan.dspackId];
    if (t2) return structuredClone(t2);
    // T3 resolutions (proven in src/t3.test.ts): declared key joins.
    const t3 = SHADCN_V3_T3_PLANS[plan.dspackId];
    if (t3) return structuredClone(t3);
    // A0 authoring resolutions (proven in src/a0.test.ts): production
    // profile judgment on the shipped primitive vocabulary — no new
    // capability. Compound plans replace; leaves keep their scaffold.
    const a0 = SHADCN_V3_A0_PLANS[plan.dspackId];
    if (a0) return structuredClone(a0);
    // T4 resolutions (proven in src/t4.test.ts): multi-slot compounds —
    // and dropdown-menu, which measurement showed is data-shaped.
    const t4 = SHADCN_V3_T4_PLANS[plan.dspackId];
    if (t4) return structuredClone(t4);
    return plan;
  });

  // A0 label additions: the five field-control leaves gain the structural
  // `label` slot the T1 donation lands on (input already declares it).
  // Applied after every replacement so select's T2 plan receives it too.
  for (const [id, note] of Object.entries(SHADCN_V3_A0_LABEL_ADDITIONS)) {
    const plan = profile.components.find((c) => c.dspackId === id);
    if (plan && !(plan.structural ?? {}).label) {
      plan.structural = {
        ...(plan.structural ?? {}),
        label: { schema: { type: "string" }, description: note.description, synthNote: note.synthNote },
      };
    }
  }

  profile["x-eval"] = {
    purpose:
      "Reproducible derived-coverage measurement of the production shadcn v3 contract against the current foundation.",
    notStudioProfile:
      "Downstream Studio consumes the pinned v2.3.0 contract with the shipped v1 profile; this fixture is measurement-only.",
    contract: { commit: CONTRACT_COMMIT, sha256: CONTRACT_SHA256 },
    derivation:
      "scaffoldProfile(v3) + the six shipped plans transplanted with their byte-proven v2 re-spelling + the T1 transparent-identity resolutions (src/t1.test.ts) + the T2 item-mode collection plans (src/t2.test.ts) + the T3 declared-join plans (src/t3.test.ts) + the T4 slot-route plans (src/t4.test.ts) + the A0 authoring resolutions and label additions (src/a0.test.ts — production profile JUDGMENT on the shipped vocabulary, the one deliberate exception to zero-fresh-judgment, each decision grounded in measured usage and proven by test); zero casualties declared.",
    unresolvedAreDeliberate:
      "Every unresolved sub-component listed by the coverage report is a real, open representation decision — do not resolve them here to make a number look better.",
  };

  return profile;
}

const OUT = join(root, "eval/shadcn-v3.eval.profile.json");

if (process.argv[2] === "--write") {
  const profile = buildEvalProfile();
  writeFileSync(OUT, JSON.stringify(profile, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const rebuilt = JSON.stringify(buildEvalProfile(), null, 2) + "\n";
  const committed = readFileSync(OUT, "utf8");
  if (rebuilt === committed) console.log("eval fixture is reproducible (rebuilt == committed)");
  else {
    console.error("eval fixture DRIFTED from its inputs — rebuild deliberately with --write and commit the change");
    process.exit(1);
  }
}
