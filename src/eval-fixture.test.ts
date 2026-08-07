/**
 * The production-v3 coverage evaluation fixture: reproducible, honest, and
 * NOT Studio's profile.
 *
 * Supersedes the /tmp-only measurement recorded in 2aac076 ("29 subs under 6
 * compounds, 1 unresolved"): that profile's nine extra compound plans carried
 * judgment that did not survive the reboot. This fixture transplants only
 * COMMITTED mapping evidence — the six shipped plans in their byte-proven v2
 * re-spelling, the T1 transparent-identity resolutions (src/t1.test.ts),
 * the T2 item-mode collection plans (src/t2.test.ts), and the T3
 * declared-join plans (src/t3.test.ts) — onto a mechanical
 * scaffold of the pinned v3 contract, declares zero casualties, and lets
 * every open decision show as open:
 *
 *   106 sub-components under 19 mapped compounds
 *    37 resolved  — the transplanted families (card 5, table 7,
 *                   alert-dialog 8), T1's form family (6), T2's
 *                   radio-group (1) and select (7), T3's tabs (3)
 *    69 unresolved — real, deliberate, and the measure of the T4–T5 work
 *
 * The v2 contract gate refusing this fixture against the v3 contract is not a
 * failure; it is the fatal coverage gate doing on the production corpus
 * precisely what it was built to do.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { loadProfile } from "./transform/profile-load.js";
import { ProfileContractError } from "./transform/validate-v2.js";
import { surfaceModelOf } from "./transform/desugar.js";
import { deriveSubCoverage } from "./transform/model.js";
import type { ComponentPlan } from "./transform/profiles.js";
import type { DspackDoc } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const contract = JSON.parse(readFileSync(repo("eval/shadcn-v3.dspack.json"), "utf8")) as DspackDoc;
const fixtureJson = JSON.parse(readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"));

describe("the production-v3 evaluation fixture", () => {
  it("is reproducible: rebuilding from committed inputs equals the committed fixture", async () => {
    const { buildEvalProfile } = await import(repo("eval/build-eval-profile.mjs"));
    expect(JSON.stringify(buildEvalProfile(), null, 2) + "\n").toBe(
      readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"),
    );
  });

  it("loads as a v2 profile and is labelled as measurement-only", () => {
    const profile = loadProfile(structuredClone(fixtureJson));
    expect(profile.language).toBe("v2");
    const label = (profile as unknown as Record<string, { notStudioProfile?: string }>)["x-eval"];
    expect(label.notStudioProfile).toContain("Studio");
    expect(profile.casualtyComponents).toEqual([]);
  });

  it("the fatal coverage gate refuses it against the v3 contract: 69 unresolved decisions, each pathed", () => {
    try {
      transformFromJson(contract, { profile: loadProfile(structuredClone(fixtureJson)) });
      expect.unreachable("69 open representation decisions must refuse, not emit");
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileContractError);
      const issues = (e as ProfileContractError).issues;
      expect(issues).toHaveLength(69);
      expect(issues.every((i) => i.message.includes("unresolved"))).toBe(true);
    }
  });

  it("derived coverage: 106 subs, 37 resolved (transplants + T1-T3), 69 open", () => {
    const profile = loadProfile(structuredClone(fixtureJson));
    const byId = new Map(profile.components.map((p: ComponentPlan) => [p.dspackId, p]));
    let resolved = 0;
    let unresolved = 0;
    const resolvedByCompound = new Map<string, number>();
    for (const [id, component] of Object.entries(contract.components ?? {})) {
      const subs = ((component as { composition?: { subComponents?: Array<{ id: string }> } }).composition
        ?.subComponents ?? []).map((s) => s.id);
      const plan = byId.get(id);
      if (subs.length === 0 || !plan) continue;
      const covered = deriveSubCoverage(surfaceModelOf(plan), subs);
      for (const sub of subs) {
        if (covered.has(sub)) {
          resolved++;
          resolvedByCompound.set(id, (resolvedByCompound.get(id) ?? 0) + 1);
        } else {
          unresolved++;
        }
      }
    }
    expect(resolved + unresolved).toBe(106);
    expect(unresolved).toBe(69);
    expect(Object.fromEntries(resolvedByCompound)).toEqual({ card: 5, table: 7, "alert-dialog": 8, form: 6, "radio-group": 1, select: 7, tabs: 3 });
  });
});
