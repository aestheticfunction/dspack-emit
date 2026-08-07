/**
 * Contract-facing validation for v2 profiles.
 *
 * parse-v2.ts checks everything a plan can be wrong about ON ITS OWN — grammar
 * closure, declared destinations, write conflicts. This module checks what a
 * plan can only be wrong about AGAINST A CONTRACT, and it runs at every entry
 * that has one in hand (transform, emitSurface), before any emission:
 *
 *  - every `sub(x)` a route, collect, or disposition names must be a declared
 *    sub-component of the plan's contract component;
 *  - every `self.props.X` must be declared — by the contract as an ordinary
 *    prop, or by the plan's own structural block as a same-named passthrough;
 *  - derived sub-component coverage must be COMPLETE: every declared sub is
 *    routed, collected, absorbed, transparent, re-identified, or explicitly
 *    dropped — anything else is an unresolved authoring decision, and v2
 *    fails closed on it with a finding per sub.
 *
 * v1 is deliberately not gated here: its behaviour is frozen, and its
 * coverage story stays report-plus-`--strict-coverage`. The split is the
 * compatibility policy in one sentence — v2 refuses what v1 merely reports.
 */
import type { DspackDoc } from "../types.js";
import type { Profile } from "./profiles.js";
import { surfaceModelOf } from "./desugar.js";
import { describeDestination, referencedSubs, unclassifiedSubs, type Donation, type SurfaceModel } from "./model.js";

export interface ProfileContractIssue {
  path: string;
  message: string;
}

export class ProfileContractError extends Error {
  constructor(readonly issues: ProfileContractIssue[]) {
    super(
      `profile does not fit this contract (${issues.length} issue${issues.length === 1 ? "" : "s"}): ` +
        issues
          .slice(0, 3)
          .map((i) => `${i.path || "$"}: ${i.message}`)
          .join("; ") +
        (issues.length > 3 ? "; …" : ""),
    );
    this.name = "ProfileContractError";
  }
}

interface ContractComponent {
  props?: Record<string, unknown>;
  composition?: { subComponents?: Array<{ id: string }> };
}

/** Every sub-component id a model's selectors, collects, and subs name. */
function namedSubs(model: SurfaceModel): Set<string> {
  const out = new Set<string>(referencedSubs(model).keys());
  return out;
}

/** Every `self.props.X` a model reads, with the destination reading it. */
function namedSelfProps(model: SurfaceModel): Array<{ prop: string; to: string }> {
  const out: Array<{ prop: string; to: string }> = [];
  for (const r of model.routes) {
    for (const s of r.from) if (s.kind === "self-prop") out.push({ prop: s.prop, to: r.to.name });
  }
  return out;
}

/**
 * Validate a v2 profile against the contract it is about to project. A no-op
 * for v1 profiles (language undefined): their behaviour is frozen.
 */
export function validateProfileAgainstContract(profile: Profile, doc: DspackDoc): void {
  if (profile.language !== "v2") return;

  const issues: ProfileContractIssue[] = [];
  const components = (doc.components ?? {}) as Record<string, ContractComponent>;

  // Both collections: mapping.ts counts any synthesized plan with a dspackId
  // as mapped, so the gate must see exactly what the mapper sees. And a plan
  // with NO surface block validates against the empty model — for a compound,
  // that means every declared sub is unresolved and refuses, identically to
  // `surface: {}`. Presence of an empty key must never flip the gate.
  const collections: Array<["components" | "synthesized", typeof profile.components]> = [
    ["components", profile.components],
    ["synthesized", profile.synthesized],
  ];
  for (const [collection, plans] of collections) {
  for (const [i, plan] of plans.entries()) {
    if (!plan.dspackId) continue;
    const at = `/${collection}/${i}/surface`;
    const component = components[plan.dspackId];
    if (!component) continue; // mapping.ts already warns on unknown dspackIds

    const declaredSubs = (component.composition?.subComponents ?? []).map((s) => s.id);
    const declaredProps = new Set(Object.keys(component.props ?? {}));
    const model = surfaceModelOf(plan);

    for (const sub of namedSubs(model)) {
      if (!declaredSubs.includes(sub)) {
        issues.push({
          path: at,
          message: `'${sub}' is not a declared sub-component of '${plan.dspackId}' in this contract (declared: ${declaredSubs.length ? declaredSubs.join(", ") : "none"})`,
        });
      }
    }

    // A self-prop read is declared either by the CONTRACT (an ordinary prop)
    // or by the PLAN's own structural block when source and destination share
    // its name — the passthrough shape, where an A2UI structural slot may be
    // authored directly on the surface node (v1's structuralPassthrough, and
    // the reason the Table's caption/columns/rows are legal without the
    // contract declaring them). Reading an undeclared prop into a
    // DIFFERENTLY-named destination declares nothing anywhere, and refuses.
    for (const { prop, to } of namedSelfProps(model)) {
      const contractDeclared = declaredProps.has(prop);
      const passthroughShaped = to === prop && prop in (plan.structural ?? {});
      if (!contractDeclared && !passthroughShaped) {
        issues.push({
          path: at,
          message: `self.props.${prop} reads a prop '${plan.dspackId}' does not declare in this contract, and it is not a same-named structural passthrough`,
        });
      }
    }

    // Derived coverage, enforced. The measured gates behind making this fatal:
    // pinned shadcn v2.3.0, astryx and acme all derive zero-unresolved, and
    // the production v3 pair's single finding (radio-group -> radio-group-item)
    // is the known T2 gap — see scripts/sub-coverage-report.mjs and the
    // 2aac076 measurement record.
    for (const sub of unclassifiedSubs(model, declaredSubs)) {
      issues.push({
        path: at,
        message: `sub-component '${sub}' of '${plan.dspackId}' is unresolved: no route consumes it, no collect gathers it, no disposition dissolves or drops it. Decide it — route, collect, transparent, asText, or drop with a reason.`,
      });
    }
  }
  }

  // T1 donations: every donated destination must be declared by at least one
  // mapped, NON-transparent plan — otherwise no surface could ever satisfy
  // the exactly-one-eligible-control rule and every use would refuse at emit.
  // Checked profile-wide (the eligible control is chosen per surface).
  const receiverProps = new Set<string>();
  for (const plan of [...profile.components, ...profile.synthesized]) {
    const m = surfaceModelOf(plan);
    if (m.transparent) continue;
    for (const k of Object.keys(plan.structural ?? {})) receiverProps.add(k);
    for (const p of Object.values(plan.propMap ?? {})) receiverProps.add(p.a2ui);
  }
  for (const [collection, plans] of collections) {
    for (const [i, plan] of plans.entries()) {
      const m = surfaceModelOf(plan);
      const donations: Array<{ d: Donation; at: string }> = [
        ...m.transparentDonate.map((d) => ({ d, at: `/${collection}/${i}/surface/transparent/donate` })),
        ...Object.values(m.subIdentity).flatMap((id) =>
          id.kind === "transparent" && id.donate ? id.donate.map((d) => ({ d, at: `/${collection}/${i}/surface/subs` })) : [],
        ),
      ];
      for (const { d, at } of donations) {
        if (!receiverProps.has(d.to.name)) {
          issues.push({
            path: at,
            message: `donation writes ${describeDestination(d.to)}, but no mapped non-transparent plan declares '${d.to.name}' — no surface could ever satisfy it`,
          });
        }
      }
    }
  }

  if (issues.length > 0) throw new ProfileContractError(issues);
}
