/**
 * dspack surface → A2UI v0.9 surface emitter.
 *
 * Compiles a dspack surface document (the protocol-neutral component tree
 * defined by dspack.surface.v0_1.schema.json) into the A2UI message array
 * shape used by surface/*.surface.json: one `createSurface` (catalogId +
 * dspack-token theme) followed by one `updateComponents` with a flat,
 * id-referenced component list.
 *
 * Deterministic by construction: same surface + contract + profile => same
 * messages. All projection knowledge is data, and this engine contains no
 * component-name-specific code.
 *
 * It also contains no DIRECTIVE-specific code. The engine reads only the
 * internal Identity / Route / Collect model (transform/model.ts); the authored
 * v1 directives are surface syntax that transform/desugar.ts translates, and
 * that module is the only compatibility boundary. src/engine-boundary.test.ts
 * fails if a legacy directive name reappears here.
 *
 * Two orderings are declared rather than emergent, because both are observable
 * in hashed artifacts and neither should be decided by the shape of a method:
 * `WriteOrder` fixes when each route and collect writes (object key order), and
 * the diagnostics' phase/band keys fix the emitted warning sequence.
 *
 * Honest scope (mirrors MAPPING.md):
 *  - Compound composition flattens per the documented casualty mapping:
 *    consuming routes absorb the node's whole subtree, resolved by ONE
 *    document-order walk so that position, not declaration order, decides
 *    which sibling claims a destination. When no label-bearing component
 *    carries a label, the first direct text under that sub is LIFTED (audited,
 *    `surface-label-lifted`; spec v0.4 amendment 2026-07-04) — relocation of
 *    existing text, never synthesis.
 *  - A2UI requires declarative actions the surface format does not express;
 *    they are synthesized (deterministic event-name slug) and recorded as
 *    warnings, not silently invented.
 *  - The message envelope is A2UI v0.9 (`version: "v0.9"`), the version the
 *    maintained renderers speak. The emitted component instances themselves
 *    are version-independent and instance-validate (gate A3) against both
 *    generated catalogs.
 */
import type { DspackDoc, DspackSurface, Json, SurfaceFidelityEntry, SurfaceNode, Warning } from "../../types.js";
import { shadcnProfile, type ComponentPlan, type Profile } from "../../transform/profiles.js";
import { toHex6 } from "../../transform/color.js";
import { collectChildren } from "../csr.js";
import { Band, Diagnostics, Phase } from "./diagnostics.js";
import { surfaceModelOf } from "../../transform/desugar.js";
import { validateProfileAgainstContract } from "../../transform/validate-v2.js";
import { describeSelector, emptySurfaceModel, isCollect, WriteOrder, type Collect, type Donation, type Route, type Selector, type SurfaceModel } from "../../transform/model.js";

export class EmitSurfaceError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path})`);
    this.name = "EmitSurfaceError";
  }
}

export interface EmitSurfaceResult {
  /** The A2UI v0.9 message array (createSurface + updateComponents). */
  messages: Json[];
  /** Every synthesis/drop performed — nothing is silent. */
  warnings: Warning[];
  /**
   * The transformation ledger: what every route, collect, projection, and
   * synthesis DID to this surface — source, destination, originating profile
   * rule, kind, and fidelity class. Additive alongside the byte-frozen
   * messages and warnings; `--strict-surface` fails on configured classes.
   */
  fidelity: SurfaceFidelityEntry[];
}

export interface EmitSurfaceOptions {
  profile?: Profile;
  /** Defaults to a slug of the surface intent. */
  surfaceId?: string;
}

export function emitSurface(
  surface: DspackSurface,
  doc: DspackDoc,
  options: EmitSurfaceOptions = {},
): EmitSurfaceResult {
  const profile = options.profile ?? shadcnProfile;
  if (surface.dspackSurface !== "0.1") {
    throw new EmitSurfaceError(
      `unsupported dspackSurface version '${surface.dspackSurface}' (this emitter targets 0.1)`,
      "$",
    );
  }
  if (surface.system !== doc.name) {
    throw new EmitSurfaceError(
      `surface.system '${surface.system}' does not match contract name '${doc.name}'`,
      "$.system",
    );
  }

  // A v2 profile that does not fit this contract refuses before any node
  // emits — the same gate transform() runs, so surface-only callers get the
  // same fail-closed story.
  validateProfileAgainstContract(profile, doc);

  const byDspackId = new Map<string, ComponentPlan>();
  for (const plan of profile.components) {
    if (plan.dspackId) byDspackId.set(plan.dspackId, plan);
  }
  // T1: a transparent ROOT still needs an instance renderers can start from
  // (components[0], id "root"). The established arity discipline answers it:
  // the root dissolves and its risen children wrap in the profile's
  // synthesized wrap component, which becomes the root — synthesis, recorded,
  // never silent. (ex.expense-report-form roots at `form` directly; refusing
  // transparent roots would refuse the exact failure T1 exists to fix.)
  const emitter = new SurfaceEmitter(profile, byDspackId);
  const rootPlan = byDspackId.get(surface.root.component);
  const rootId =
    rootPlan && surfaceModelOf(rootPlan).transparent
      ? emitter.emitTransparentRoot(surface.root, "$.root")
      : emitter.emitNode(surface.root, "$.root");

  const surfaceId = options.surfaceId ?? slug(surface.intent);
  const theme: Json = { agentDisplayName: `${doc.name} via dspack` };
  const primaryHex = primaryColor(doc, profile);
  if (primaryHex) theme.primaryColor = primaryHex;

  const messages: Json[] = [
    {
      version: "v0.9",
      createSurface: {
        surfaceId,
        catalogId: `${profile.catalogIdBase}/v0_9_1/catalog.json`,
        theme,
      },
    },
    {
      version: "v0.9",
      updateComponents: { surfaceId, components: emitter.components },
    },
  ];
  void rootId; // root is components[0] by construction (pre-order emission)
  return { messages, warnings: emitter.diagnostics.ordered(), fidelity: emitter.diagnostics.orderedFidelity() };
}

function primaryColor(doc: DspackDoc, profile: Profile): string | null {
  const { category, name } = profile.primaryColorToken;
  const raw = doc.tokens?.[category]?.values?.[name]?.value;
  return typeof raw === "string" ? toHex6(raw) : null;
}

export function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "surface";
}
/**
 * T1: one donation, resolved at its dissolving boundary and carried
 * EXPLICITLY in the rewritten child list until the receiving control's own
 * emission applies it as a first-wins pre-write. The committed instance of
 * another node is never mutated; ordering cannot affect output because the
 * write happens inside the control's own construction, in donation order.
 */
interface PendingDonation {
  prop: string;
  value: string;
  origin: string;
  donorPath: string;
  donorComponent: string;
}

type RewrittenChild =
  | { node: SurfaceNode; suffix: string; donations?: PendingDonation[] }
  | { text: string; textVariant: string };

class SurfaceEmitter {
  readonly components: Json[] = [];
  readonly diagnostics = new Diagnostics();
  private readonly usedIds = new Set<string>();

  constructor(
    private readonly profile: Profile,
    private readonly byDspackId: Map<string, ComponentPlan>,
  ) {}

  /**
   * Emits the component for `node` (and its subtree) and returns its instance id.
   *
   * Reads ONLY the internal model. The v1 directive names live exclusively in
   * desugar.ts; if any of them appears below, the compatibility boundary has
   * leaked (src/engine-boundary.test.ts fails on exactly that).
   */
  emitNode(node: SurfaceNode, path: string, treePath: readonly number[] = [], donations: PendingDonation[] = []): string {
    const plan = this.byDspackId.get(node.component);
    if (!plan) {
      // A declared casualty refuses with its authored reason — the refusal is
      // the profile author's decision, and the message should say so.
      const casualty = this.profile.casualtyComponents.find((c) => c.dspackId === node.component);
      if (casualty) {
        throw new EmitSurfaceError(
          `component '${node.component}' is a declared casualty (${casualty.class}) of the ` +
            `'${this.profile.catalogTitle}' profile: ${casualty.reason}`,
          path,
        );
      }
      throw new EmitSurfaceError(
        `unknown component '${node.component}': not a mapped component of the '${this.profile.catalogTitle}' profile ` +
          `(sub-components are consumed by their compound parent and cannot be emitted standalone)`,
        path,
      );
    }

    const model = surfaceModelOf(plan);
    const at = (band: Band, phase: Phase, rule = 0) =>
      ({ treePath, band, phase, rule }) as const;

    // A2UI renderers begin at the component with id "root" (see the
    // hand-authored surfaces); the surface root always emits under that id.
    const id =
      path === "$.root"
        ? this.allocateId("root", path, at(Band.BeforeChildren, Phase.IdAllocation))
        : this.allocateId(node.id ?? plan.a2ui.toLowerCase(), path, at(Band.BeforeChildren, Phase.IdAllocation));
    // Reserve the slot so parent components precede children in the flat list.
    const index = this.components.length;
    this.components.push({});
    const instance: Json = { id, component: plan.a2ui };

    this.applyPropMap(node, plan, model, instance, path, treePath);

    // A declared casualty is an authored refusal: it must never be laundered
    // into a parent's text fold. The plan-lookup gate above only fires when a
    // casualty is emitted as its OWN node; a consuming route or a re-identified
    // sub walks the subtree directly and would otherwise fold the casualty's
    // text in with a mere warning.
    if (model.consumesSubtree || Object.keys(model.subIdentity).length > 0) {
      this.refuseConsumedCasualty(node, path);
    }

    // Routes and collects, in declared order. Ordering of OUTPUT is first-wins
    // (except where a route declares `overwrite`); ordering of DIAGNOSTICS is
    // the explicit phase model, never this loop's order.
    this.applyOperations(node, model, instance, id, path, treePath);

    // T1 donations: contextual values a dissolved wrapper handed to this
    // control, applied AFTER the control's own writes, first-wins — inherited
    // context fills what the control left absent and never beats its own
    // authored content. The ledger records exactly what happened either way.
    for (const d of donations) {
      const landed = this.write(instance, d.prop, d.value as Json[keyof Json]);
      this.diagnostics.pushFidelity(
        {
          source: `${d.donorPath} (${d.donorComponent}.text)`,
          destination: `${d.prop} @ ${path} (${node.component})`,
          origin: d.origin,
          kind: landed ? "donated" : "dropped",
          class: landed ? "maps-cleanly" : "lossy",
          note: landed
            ? `donated by '${d.donorComponent}' to '${node.component}' — the dissolving boundary's single eligible control`
            : `'${d.prop}' already written on '${node.component}'; the donated value did not land`,
        },
        treePath,
        Band.BeforeChildren,
        Phase.PropMap,
      );
    }

    if (!model.consumesSubtree) {
      this.emitChildren(node, model, instance, id, path, treePath);
    }

    // The one loss channel nothing else ledgers: node text on a plan with no
    // self.text route. v1 has always silently discarded it — warnings are
    // byte-frozen, so the WARNING stays absent — but the ledger exists
    // precisely so no discard is unaccounted. (Consuming plans are exempt:
    // their document-order walk may legitimately read the node's own text.)
    const readsSelfText = model.routes.some((r) => r.from.some((s) => s.kind === "self-text"));
    if (node.text !== undefined && !readsSelfText && !model.consumesSubtree) {
      this.diagnostics.pushFidelity(
        {
          source: `${path} (text)`,
          destination: "(discarded)",
          origin: "(no rule)",
          kind: "dropped",
          class: "lossy",
          note: `'${node.component}' has no self.text route; its text was discarded`,
        },
        treePath,
        Band.BeforeChildren,
        Phase.PropMap,
      );
    }

    this.components[index] = instance;
    return id;
  }

  /**
   * Applies every route and collect in declared WriteOrder — never in
   * declaration order and never in traversal happenstance. Object key order is
   * observable, so this sequence is part of the compatibility contract.
   *
   * Consuming routes are the one group resolved together: a compound is walked
   * ONCE in document order and each destination takes the first thing it sees.
   * That is not an implementation detail leaking through — it is what consuming
   * a compound means, and resolving those routes independently would let
   * declaration order decide which of two siblings wins.
   */
  private applyOperations(
    node: SurfaceNode,
    model: SurfaceModel,
    instance: Json,
    id: string,
    path: string,
    treePath: readonly number[],
  ): void {
    const consuming = model.routes
      .map((route, rule) => ({ route, rule }))
      .filter(({ route }) => route.order === WriteOrder.Consume);

    const steps: Array<{ order: number; run: () => void }> = [];

    for (const { route, rule } of model.routes.map((route, rule) => ({ route, rule }))) {
      if (route.order === WriteOrder.Consume || route.order === WriteOrder.Children) continue;
      if (route.order === WriteOrder.Slot) {
        steps.push({ order: route.order, run: () => this.applySlotRoute(node, model, route, rule, instance, path, treePath) });
        continue;
      }
      steps.push({ order: route.order, run: () => this.applyRoute(node, route, rule, instance, id, path, treePath) });
    }
    for (const [rule, collect] of model.collects.entries()) {
      if (collect.as.kind === "inline") continue;
      steps.push({ order: collect.order, run: () => this.applyCollect(node, model, collect, rule, instance, path, treePath) });
    }
    if (consuming.length > 0) {
      steps.push({ order: WriteOrder.Consume, run: () => this.applyConsuming(node, consuming, instance, path, treePath) });
    }
    if (model.collects.some((c) => c.as.kind !== "inline")) {
      steps.push({ order: WriteOrder.Collect + 1, run: () => this.closeCollects(node, model, path, treePath) });
    }
    if (model.routes.some((r) => r.order === WriteOrder.Slot)) {
      steps.push({ order: WriteOrder.Slot + 1, run: () => this.closeSlots(node, model, path, treePath) });
    }

    steps.sort((a, b) => a.order - b.order);
    for (const step of steps) step.run();
  }

  /**
   * One document-order walk serving every consuming route, then the audited
   * lift for any destination still empty, then the composition warning.
   */
  private applyConsuming(
    node: SurfaceNode,
    consuming: Array<{ route: Route; rule: number }>,
    instance: Json,
    path: string,
    treePath: readonly number[],
  ): void {
    const record = (route: Route, rule: number, nPath: string, component: string): void => {
      this.diagnostics.pushFidelity(
        {
          source: `${nPath} (${component}.text)`,
          destination: route.to.name,
          origin: route.origin,
          kind: "moved",
          class: "maps-cleanly",
        },
        treePath,
        Band.BeforeChildren,
        Phase.SubContentFlatten,
        rule,
      );
    };
    const visit = (n: SurfaceNode, nPath: string, insideSubs: ReadonlySet<string>): void => {
      for (const { route, rule } of consuming) {
        if (instance[route.to.name] !== undefined) continue;
        const primary = route.from[0];
        if (primary.kind === "sub-text") {
          if (primary.subs.includes(n.component) && n.text !== undefined) {
            instance[route.to.name] = n.text;
            record(route, rule, nPath, n.component);
          }
        } else if (primary.kind === "sub-label") {
          if (n !== node && n.text !== undefined && primary.subs.some((sub) => insideSubs.has(sub))) {
            const plan = this.byDspackId.get(n.component);
            const bearsLabel = plan !== undefined && surfaceModelOf(plan).routes.some((r) => r.to.kind === "text-child");
            if (bearsLabel) {
              instance[route.to.name] = n.text;
              record(route, rule, nPath, n.component);
            }
          }
        }
      }
      const next = new Set(insideSubs);
      for (const { route } of consuming) {
        const primary = route.from[0];
        if (primary.kind === "sub-label" && primary.subs.includes(n.component)) next.add(n.component);
      }
      collectChildren(n).forEach((child, i) => visit(child.node, `${nPath}${child.suffix}[${i}]`, next));
    };
    visit(node, path, new Set());

    for (const { route, rule } of consuming) {
      if (instance[route.to.name] !== undefined) continue;
      for (const selector of route.from.slice(1)) {
        const found = this.resolve(node, selector, path, treePath, rule, route);
        if (found !== undefined) {
          instance[route.to.name] = found as Json[keyof Json];
          this.diagnostics.pushFidelity(
            {
              source: `${path} (fallback)`,
              destination: route.to.name,
              origin: route.origin,
              kind: selector.kind === "sub-text-lift" ? "lifted" : "moved",
              class: "maps-cleanly",
              note: selector.kind === "sub-text-lift" ? "audited lift: relocation of existing text, never synthesis" : undefined,
            },
            treePath,
            Band.BeforeChildren,
            Phase.LabelLift,
            rule,
          );
          break;
        }
      }
    }

    this.diagnostics.push(
      {
        code: "surface-composition-flattened",
        message: `${path}: compound '${node.component}' subtree flattened onto emitted props (documented casualty; nested props beyond text are not carried).`,
      },
      treePath,
      Band.BeforeChildren,
      Phase.SubContentFlatten,
    );
    this.diagnostics.pushFidelity(
      {
        source: `${path} (${node.component} subtree)`,
        destination: "(props of this instance)",
        origin: consuming.map(({ route }) => route.origin).join(", "),
        kind: "flattened",
        class: "lossy",
        note: "compound composition consumed into props; structure and nested props beyond text are not carried",
      },
      treePath,
      Band.BeforeChildren,
      Phase.SubContentFlatten,
    );
  }

  /**
   * Writes `value` unless the destination is taken and the route is
   * first-wins. Returns whether the write LANDED — the fidelity ledger must
   * record a discarded harvest as discarded, never as a clean move.
   */
  private write(instance: Json, name: string, value: Json[keyof Json], overwrite?: boolean): boolean {
    if (overwrite || instance[name] === undefined) {
      instance[name] = value;
      return true;
    }
    return false;
  }

  private applyRoute(
    node: SurfaceNode,
    route: Route,
    rule: number,
    instance: Json,
    id: string,
    path: string,
    treePath: readonly number[],
  ): void {
    // `children` is not a value route: it produces instances, and is handled
    // with the child walk so ids exist in emission order.
    if (route.from.some((s) => s.kind === "children")) return;

    for (const selector of route.from) {
      if (selector.kind === "synthesized-action") {
        const eventName = slug(node.id ?? (instance.confirmLabel as string) ?? node.text ?? node.component);
        this.write(instance, route.to.name, { event: { name: eventName, context: {} } } as Json[keyof Json], route.overwrite);
        this.diagnostics.pushFidelity(
          {
            source: "(no source: A2UI requires a declarative action)",
            destination: route.to.name,
            origin: route.origin,
            kind: "synthesized",
            class: "synthesis-defaults",
            note: `event name '${eventName}' derived from the node's id/label/component slug`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.Action,
          rule,
        );
        this.diagnostics.push(
          {
            code: "surface-synthesized-action",
            message: `${path}: A2UI requires a declarative action on ${instance.component as string}; synthesized event '${eventName}'.`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.Action,
          rule,
        );
        return;
      }

      const found = this.resolve(node, selector, path, treePath, rule, route);
      if (found === undefined) continue;

      if (route.to.kind === "text-child") {
        this.write(
          instance,
          route.to.name,
          this.emitTextPrimitive(String(found), `${id}_label`, path, treePath, Phase.TextChild, rule),
          route.overwrite,
        );
      } else {
        const landed = this.write(instance, route.to.name, found as Json[keyof Json], route.overwrite);
        this.diagnostics.pushFidelity(
          landed
            ? {
                source: `${path} (${describeSelector(selector)})`,
                destination: route.to.name,
                origin: route.origin,
                kind: selector.kind === "self-prop" ? "projected" : "moved",
                class: "maps-cleanly",
              }
            : {
                source: `${path} (${describeSelector(selector)})`,
                destination: "(discarded)",
                origin: route.origin,
                kind: "dropped",
                class: "lossy",
                note: `'${route.to.name}' was already written by an earlier phase; the harvested value did not land`,
              },
          treePath,
          Band.BeforeChildren,
          selector.kind === "self-prop" ? Phase.PropMap : Phase.TextChild,
          rule,
        );
      }
      return; // ordered fallback: the first selector that yields wins
    }
  }

  /** Resolves one selector against the node's subtree; `undefined` when it yields nothing. */
  private resolve(
    node: SurfaceNode,
    selector: Selector,
    path: string,
    treePath: readonly number[],
    rule: number,
    route: Route,
  ): string | Json[keyof Json] | undefined {
    switch (selector.kind) {
      case "self-text":
        return node.text;

      case "self-prop":
        return node.props?.[selector.prop] as Json[keyof Json] | undefined;

      case "sub-text": {
        // v1 visited the node itself as well as its descendants.
        let hit: string | undefined;
        const visit = (n: SurfaceNode): void => {
          if (hit === undefined && selector.subs.includes(n.component) && n.text !== undefined) hit = n.text;
          for (const child of collectChildren(n)) visit(child.node);
        };
        visit(node);
        return hit;
      }

      case "sub-label": {
        // Only a label-bearing component qualifies — one whose own model routes
        // its text to a text-child destination — never incidental descendant text.
        let hit: string | undefined;
        const visit = (n: SurfaceNode, insideSub: boolean): void => {
          if (hit === undefined && insideSub && n !== node && n.text !== undefined) {
            const plan = this.byDspackId.get(n.component);
            const bearsLabel =
              plan !== undefined && surfaceModelOf(plan).routes.some((r) => r.to.kind === "text-child");
            if (bearsLabel) hit = n.text;
          }
          for (const child of collectChildren(n)) visit(child.node, insideSub || selector.subs.includes(n.component));
        };
        visit(node, false);
        return hit;
      }

      case "sub-text-lift": {
        // Audited lift: relocation of text that exists, never synthesis. If
        // nothing exists to lift the destination stays missing and gate A3
        // refuses the instance, exactly as before.
        const lift = (n: SurfaceNode, inside: boolean): { text: string; component: string } | undefined => {
          const here = inside || selector.subs.includes(n.component);
          if (here && n.text !== undefined && n.text !== "") return { text: n.text, component: n.component };
          for (const child of collectChildren(n)) {
            const found = lift(child.node, here);
            if (found) return found;
          }
          return undefined;
        };
        const found = lift(node, false);
        if (!found) return undefined;
        this.diagnostics.push(
          {
            code: "surface-label-lifted",
            message: `${path}: '${route.to.name}' lifted from direct text on '${found.component}' inside '${selector.subs.join("|")}' — no label-bearing component carried it (documented projection extension; lift, never synthesis).`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.LabelLift,
          rule,
        );
        return found.text;
      }

      case "subtree-text": {
        let hit: SurfaceNode | undefined;
        const visit = (n: SurfaceNode): void => {
          if (hit === undefined && selector.subs.includes(n.component)) hit = n;
          for (const child of collectChildren(n)) visit(child.node);
        };
        visit(node);
        return hit ? this.subtreeText(hit) : undefined;
      }

      case "children":
      case "synthesized-action":
        return undefined;
    }
  }

  /** CSR props -> A2UI props via the profile's existing PropPlan projections. */
  private applyPropMap(
    node: SurfaceNode,
    plan: ComponentPlan,
    model: SurfaceModel,
    instance: Json,
    path: string,
    treePath: readonly number[],
  ): void {
    // A prop routed verbatim to a SAME-NAMED destination is projected by that
    // route, not by the prop map — v1 spelled this `structuralPassthrough`.
    // The name check matters: a v2 route may read a declared contract prop
    // into a differently-named destination, and that read must not suppress
    // the prop's own projection (both writes are real, to distinct names).
    const routedVerbatim = new Set(
      model.routes
        .filter((r) => r.from.some((s) => s.kind === "self-prop" && s.prop === r.to.name))
        .map((r) => (r.from.find((s) => s.kind === "self-prop") as { prop: string }).prop),
    );
    for (const [prop, raw] of Object.entries(node.props ?? {})) {
      if (routedVerbatim.has(prop)) continue;
      const pp = plan.propMap?.[prop];
      if (!pp) {
        this.diagnostics.push(
          {
            code: "surface-prop-dropped",
            message: `${path}: prop '${prop}' on '${node.component}' has no A2UI projection; dropped.`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.PropMap,
        );
        this.diagnostics.pushFidelity(
          { source: `${path} (props.${prop})`, destination: "(discarded)", origin: `propMap.${prop}`, kind: "dropped", class: "lossy", note: "no A2UI projection" },
          treePath,
          Band.BeforeChildren,
          Phase.PropMap,
        );
        continue;
      }
      const mapped = pp.valueMap ? pp.valueMap[String(raw)] : undefined;
      const value = pp.valueMap ? (mapped ?? pp.default) : raw;
      if (value === undefined) {
        this.diagnostics.push(
          {
            code: "surface-prop-value-dropped",
            message: `${path}: value '${String(raw)}' of prop '${prop}' has no projection and no default; dropped.`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.PropMap,
        );
        this.diagnostics.pushFidelity(
          { source: `${path} (props.${prop}='${String(raw)}')`, destination: "(discarded)", origin: `propMap.${prop}`, kind: "dropped", class: "lossy", note: "value has no projection and no default" },
          treePath,
          Band.BeforeChildren,
          Phase.PropMap,
        );
        continue;
      }
      instance[pp.a2ui] = value as Json[keyof Json];
      this.diagnostics.pushFidelity(
        {
          source: `${path} (props.${prop})`,
          destination: pp.a2ui,
          origin: `propMap.${prop}`,
          kind: "projected",
          class: pp.valueMap && mapped === undefined ? "synthesis-defaults" : "maps-cleanly",
          note: pp.valueMap && mapped === undefined ? `value '${String(raw)}' fell back to the declared default '${String(pp.default)}'` : undefined,
        },
        treePath,
        Band.BeforeChildren,
        Phase.PropMap,
      );
    }
  }

  /**
   * Refuse when a consumed subtree contains a component the profile declared a
   * casualty. Consumption is how compounds fold their parts into props; it is
   * NOT an escape hatch around an author's "this cannot be represented".
   * Fail-closed and loud, with the authored reason, exactly like the direct
   * emission path — including the offending node's own path, so the refusal
   * points at the casualty rather than the parent that would have eaten it.
   */
  private refuseConsumedCasualty(node: SurfaceNode, path: string): void {
    const walk = (n: SurfaceNode, nodePath: string): void => {
      if (n !== node) {
        const casualty = this.profile.casualtyComponents.find((c) => c.dspackId === n.component);
        if (casualty && !this.byDspackId.has(n.component)) {
          throw new EmitSurfaceError(
            `component '${n.component}' is a declared casualty (${casualty.class}) of the ` +
              `'${this.profile.catalogTitle}' profile and cannot be consumed into ` +
              `'${node.component}': ${casualty.reason}`,
            nodePath,
          );
        }
      }
      collectChildren(n).forEach((child, i) => walk(child.node, `${nodePath}${child.suffix}[${i}]`));
    };
    walk(node, path);
  }

  /**
   * Repetition: collect repeated sub-structures into array-valued destinations.
   * Nothing here is table-shaped — the depth is nesting and the record key is an
   * item field name. Cells flatten to their subtree TEXT in document order;
   * nested structure and props are a warned per-cell loss, never re-interpreted.
   */
  /**
   * Repetition: collect one repeated sub-structure into an array-valued
   * destination. Nothing here is table-shaped — the depth is nesting and the
   * record key is an item field name. Cells flatten to their subtree TEXT in
   * document order; nested structure and props are a warned per-cell loss,
   * never re-interpreted into semantic fields.
   */
  private applyCollect(
    node: SurfaceNode,
    model: SurfaceModel,
    collect: Collect,
    rule: number,
    instance: Json,
    path: string,
    treePath: readonly number[],
  ): void {
    void model;
    if (collect.as.kind === "inline") return;

    // T2 item-mode: each descendant matching `of` (document order) becomes
    // one record whose fields resolve against THAT item's own node. Absent
    // sources omit the field — gate A3 arbitrates required record shapes,
    // never synthesis. Sibling content the collect does not claim follows
    // the ordinary consumed-subtree accounting (closeCollects).
    if (collect.fields) {
      const itemLocal = (n: SurfaceNode, sel: Selector): Json[keyof Json] | undefined =>
        sel.kind === "self-text" ? n.text : sel.kind === "self-id" ? n.id : sel.kind === "self-prop" ? (n.props?.[sel.prop] as Json[keyof Json] | undefined) : undefined;

      // Gather left items and (when a join is declared) joined counterparts,
      // both in document order.
      const lefts: Array<{ n: SurfaceNode; nPath: string }> = [];
      const rights: Array<{ n: SurfaceNode; nPath: string }> = [];
      const gather = (n: SurfaceNode, nPath: string): void => {
        if (collect.of.includes(n.component)) {
          lefts.push({ n, nPath });
          return; // an item's subtree is the item's; nested items do not re-match
        }
        if (collect.join?.with.includes(n.component)) {
          rights.push({ n, nPath });
          return;
        }
        collectChildren(n).forEach((c, i) => gather(c.node, `${nPath}${c.suffix}[${i}]`));
      };
      collectChildren(node).forEach((c, i) => gather(c.node, `${path}${c.suffix}[${i}]`));

      // T3: the declared key join. Every edge refuses — the profile names
      // the relation, the emitter never infers one.
      const counterparts = new Map<string, { n: SurfaceNode; nPath: string }>();
      if (collect.join) {
        const j = collect.join;
        const seenLeft = new Map<string, string>();
        for (const item of lefts) {
          const key = itemLocal(item.n, j.leftKey);
          if (typeof key !== "string" || key === "") {
            throw new EmitSurfaceError(
              `join '${j.origin}': item '${item.n.component}' carries no key (${describeSelector(j.leftKey)}); a keyless item cannot participate in a declared join`,
              item.nPath,
            );
          }
          const prior = seenLeft.get(key);
          if (prior !== undefined) {
            throw new EmitSurfaceError(
              `join '${j.origin}': duplicate left key '${key}' (also at ${prior}); join keys must be unique on each side`,
              item.nPath,
            );
          }
          seenLeft.set(key, item.nPath);
        }
        for (const cp of rights) {
          const key = itemLocal(cp.n, j.rightKey);
          if (typeof key !== "string" || key === "") {
            throw new EmitSurfaceError(
              `join '${j.origin}': counterpart '${cp.n.component}' carries no key (${describeSelector(j.rightKey)})`,
              cp.nPath,
            );
          }
          if (counterparts.has(key)) {
            throw new EmitSurfaceError(
              `join '${j.origin}': duplicate right key '${key}'; join keys must be unique on each side`,
              cp.nPath,
            );
          }
          if (!seenLeft.has(key)) {
            throw new EmitSurfaceError(
              `join '${j.origin}': counterpart '${cp.n.component}' key '${key}' matches no item; a dangling counterpart is a contradiction, not surplus`,
              cp.nPath,
            );
          }
          counterparts.set(key, cp);
        }
      }

      const records: Json[] = [];
      for (const item of lefts) {
        const record: Json = {};
        for (const [fieldName, sel] of Object.entries(collect.fields)) {
          const value = itemLocal(item.n, sel);
          if (value !== undefined) record[fieldName] = value;
        }
        this.diagnostics.pushFidelity(
          {
            source: `${item.nPath} (${item.n.component})`,
            destination: collect.as.name,
            origin: collect.origin,
            kind: "moved",
            class: "maps-cleanly",
            note: `item record { ${Object.keys(record).join(", ")} } collected`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.TableBody,
          rule,
        );

        if (collect.join) {
          const j = collect.join;
          const key = itemLocal(item.n, j.leftKey) as string;
          const cp = counterparts.get(key);
          if (!cp && !j.optional) {
            throw new EmitSurfaceError(
              `join '${j.origin}': item '${item.n.component}' key '${key}' has no counterpart among [${j.with.join(", ")}]; exactly one is required (declare optional to relax to 0..1)`,
              item.nPath,
            );
          }
          if (cp) {
            for (const [fieldName, jSel] of Object.entries(j.fields)) {
              if ("kind" in jSel && jSel.kind === "joined-children") {
                // The slot-valued field: the counterpart's children emit as
                // instances; the record carries the reference. Repetition's
                // ratified slot form — not T4 multi-slot routing. The child
                // list goes through the SAME rewriting as any parent's
                // (mirroring the transparent-root host pattern), so a
                // transparent top-level child inside a joined panel
                // dissolves instead of refusing as an unroutable instance.
                const spliced = this.rewriteChildren(cp.n, emptySurfaceModel(), cp.nPath, treePath);
                if (spliced.length === 0) continue;
                const ids = spliced.map((k, ki) =>
                  "textVariant" in k
                    ? this.emitTextPrimitive(
                        k.text,
                        `${slug(key)}_${slug(k.textVariant)}`,
                        cp.nPath,
                        [...treePath, Band.Children, records.length, ki],
                        Phase.TextChild,
                        0,
                        k.textVariant,
                      )
                    : this.emitNode(k.node, `${cp.nPath}${k.suffix}[${ki}]`, [...treePath, Band.Children, records.length], k.donations ?? []),
                );
                record[fieldName] =
                  ids.length === 1 ? ids[0] : this.wrapInColumn(ids, `${slug(key)}`, cp.nPath, treePath);
              } else {
                const value = itemLocal(cp.n, jSel as Selector);
                if (value !== undefined) record[fieldName] = value;
              }
            }
            this.diagnostics.pushFidelity(
              {
                source: `${cp.nPath} (${cp.n.component})`,
                destination: `${collect.as.name} @ item '${key}'`,
                origin: j.origin,
                kind: "joined",
                class: "maps-cleanly",
                note: `counterpart joined on key '${key}' -> fields { ${Object.keys(j.fields).join(", ")} }`,
              },
              treePath,
              Band.BeforeChildren,
              Phase.TableBody,
              rule,
            );
          }
        }
        records.push(record);
      }
      if (records.length > 0) {
        const landed = this.write(instance, collect.as.name, records as Json[keyof Json]);
        if (!landed) {
          this.diagnostics.pushFidelity(
            { source: `${path} (${collect.of.join("|")} items)`, destination: "(discarded)", origin: collect.origin, kind: "dropped", class: "lossy", note: `'${collect.as.name}' was already written by an earlier phase; the collected records did not land` },
            treePath,
            Band.BeforeChildren,
            Phase.TableBody,
            rule,
          );
        }
      }
      return;
    }
    const out: Json[] = [];
    const flat: string[] = [];
    const scalarField = Object.values(collect.item ?? {}).find((f) => isCollect(f) && f.scalar) as Collect | undefined;
    const itemKey = Object.keys(collect.item ?? {})[0] ?? "items";

    for (const child of collectChildren(node)) {
      if (!collect.of.includes(child.node.component)) continue;
      const childPath = `${path}${child.suffix}`;
      for (const inner of collectChildren(child.node)) {
        if (!scalarField || !scalarField.of.includes(inner.node.component)) {
          this.diagnostics.push(
            {
              code: "surface-sub-dropped",
              message: `${childPath}: '${inner.node.component}' inside '${child.node.component}' has no slot; dropped.`,
            },
            treePath,
            Band.BeforeChildren,
            Phase.TableBody,
            rule,
          );
          this.diagnostics.pushFidelity(
            { source: `${childPath} (${inner.node.component})`, destination: "(discarded)", origin: collect.origin, kind: "dropped", class: "lossy", note: "no slot inside the collected repetition" },
            treePath,
            Band.BeforeChildren,
            Phase.TableBody,
            rule,
          );
          continue;
        }
        const cells = this.collectRow(inner.node, scalarField, `${childPath}${inner.suffix}`, treePath, rule);
        if (this.isFlatTarget(collect)) flat.push(...cells);
        else out.push({ [itemKey]: cells } as Json);
      }
    }

    const value = this.isFlatTarget(collect) ? flat : out;
    if (value.length > 0) {
      const landed = this.write(instance, collect.as.name, value as Json[keyof Json]);
      this.diagnostics.pushFidelity(
        landed
          ? {
              source: `${path} (${collect.of.join("|")} repetitions)`,
              destination: collect.as.name,
              origin: collect.origin,
              kind: "moved",
              class: "maps-cleanly",
              note: this.isFlatTarget(collect)
                ? `${flat.length} cell(s) collected into one flat list`
                : `${out.length} record(s) collected`,
            }
          : {
              source: `${path} (${collect.of.join("|")} repetitions)`,
              destination: "(discarded)",
              origin: collect.origin,
              kind: "dropped",
              class: "lossy",
              note: `'${collect.as.name}' was already written by an earlier phase; the collected ${this.isFlatTarget(collect) ? "cells" : "records"} did not land`,
            },
        treePath,
        Band.BeforeChildren,
        Phase.TableBody,
        rule,
      );
    }
  }

  /**
   * After every collect has run: anything the collects and routes did not claim
   * is either an explicit drop or an unrecognized sub — both warned, never
   * silently ignored — followed by the composition casualty for the compound.
   */
  /**
   * T4: one slot route — the ordered children of exactly one descendant
   * instance of the named sub become instances, and the slot carries the
   * reference (multi wraps in the profile's wrap component, exactly like
   * T3's joined-children). The region's child list goes through the SAME
   * rewriting as any parent's (this plan's dispositions apply to nested
   * subs), with subs claimed by sibling routes skipped — their consumption
   * is their own route's ledger entry. Zero regions leave the destination
   * absent (gate A3 arbitrates); several refuse: a slot names one region.
   */
  private applySlotRoute(
    node: SurfaceNode,
    model: SurfaceModel,
    route: Route,
    rule: number,
    instance: Json,
    path: string,
    treePath: readonly number[],
  ): void {
    const sel = route.from[0];
    if (sel.kind !== "sub-children") return;
    const region = sel.subs[0];

    const found: Array<{ n: SurfaceNode; nPath: string }> = [];
    const locate = (n: SurfaceNode, nPath: string): void => {
      for (const c of collectChildren(n)) {
        if (c.node.component === region) found.push({ n: c.node, nPath: `${nPath}${c.suffix}` });
        locate(c.node, `${nPath}${c.suffix}`);
      }
    };
    locate(node, path);

    if (found.length === 0) return; // absent region: the destination stays absent and A3 arbitrates
    if (found.length > 1) {
      throw new EmitSurfaceError(
        `slot route '${route.origin}': ${found.length} instances of '${region}' in this '${node.component}'; ` +
          `a slot names ONE region — exactly one may appear`,
        path,
      );
    }

    const claimed = new Set<string>();
    for (const r of model.routes) {
      if (r === route) continue;
      for (const s of r.from) if ("subs" in s) for (const id of s.subs as string[]) claimed.add(id);
    }
    for (const c of model.collects) for (const id of [...c.of, ...(c.join?.with ?? [])]) claimed.add(id);

    const src = found[0];
    const spliced = this.rewriteChildren(src.n, model, src.nPath, treePath, claimed);
    if (spliced.length === 0) return; // an empty region carries nothing; absent, A3 arbitrates
    const ids = spliced.map((k, ki) =>
      "textVariant" in k
        ? this.emitTextPrimitive(
            k.text,
            `${slug(region)}_${slug(k.textVariant)}`,
            src.nPath,
            [...treePath, Band.BeforeChildren, rule, ki],
            Phase.SubContentFlatten,
            rule,
            k.textVariant,
          )
        : this.emitNode(k.node, `${src.nPath}${k.suffix}[${ki}]`, [...treePath, Band.BeforeChildren, rule, ki], k.donations ?? []),
    );
    const ref = ids.length === 1 ? ids[0] : this.wrapInColumn(ids, slug(region), src.nPath, treePath);
    const landed = this.write(instance, route.to.name, ref);
    this.diagnostics.pushFidelity(
      {
        source: `${src.nPath} (${region} children)`,
        destination: `${route.to.name} @ ${path} (${node.component})`,
        origin: route.origin,
        kind: landed ? "moved" : "dropped",
        class: landed ? "maps-cleanly" : "lossy",
        note: landed
          ? `region '${region}' emitted as instances; the slot carries the reference`
          : `'${route.to.name}' already written; the region's reference did not land`,
      },
      treePath,
      Band.BeforeChildren,
      Phase.SubContentFlatten,
      rule,
    );
  }

  /**
   * Fail-closed closure for a slot-routed compound: every DIRECT child must
   * be a claimed region, a route-consumed sub, a collected family, or carry
   * a disposition — an unclaimed child is structural content with no
   * destination, and approximating it silently is exactly what this engine
   * refuses to do.
   */
  private closeSlots(
    node: SurfaceNode,
    model: SurfaceModel,
    path: string,
    treePath: readonly number[],
  ): void {
    const claimed = new Set<string>();
    for (const r of model.routes) for (const s of r.from) if ("subs" in s) for (const id of s.subs as string[]) claimed.add(id);
    for (const c of model.collects) for (const id of [...c.of, ...(c.join?.with ?? [])]) claimed.add(id);

    for (const child of collectChildren(node)) {
      const c = child.node.component;
      if (claimed.has(c) || c in model.subIdentity) continue;
      const reason = model.drops[c];
      if (reason !== undefined) {
        const childPath = `${path}${child.suffix}`;
        this.diagnostics.push(
          { code: "surface-sub-dropped", message: `${childPath}: '${c}' dropped: ${reason}.` },
          treePath,
          Band.BeforeChildren,
          Phase.SubContentFlatten,
        );
        this.diagnostics.pushFidelity(
          { source: `${childPath} (${c})`, destination: "(discarded)", origin: `drops.${c}`, kind: "dropped", class: "lossy", note: reason },
          treePath,
          Band.BeforeChildren,
          Phase.SubContentFlatten,
        );
        continue;
      }
      throw new EmitSurfaceError(
        `'${c}' is a direct child of slot-routed compound '${node.component}' with no destination — ` +
          `every region must be claimed by a route, collected, or carry a disposition`,
        `${path}${child.suffix}`,
      );
    }
  }

  private closeCollects(
    node: SurfaceNode,
    model: SurfaceModel,
    path: string,
    treePath: readonly number[],
  ): void {
    const claimedByCollect = new Set(model.collects.flatMap((c) => [...c.of, ...(c.join?.with ?? [])]));
    for (const child of collectChildren(node)) {
      const c = child.node.component;
      if (claimedByCollect.has(c) || this.claimedByRoute(model, c)) continue;
      const childPath = `${path}${child.suffix}`;
      const reason = model.drops[c];
      const itemMode = model.collects.some((col) => col.fields);
      this.diagnostics.push(
        {
          code: "surface-sub-dropped",
          message: reason
            ? `${childPath}: '${c}' dropped: ${reason}.`
            : itemMode
              ? `${childPath}: '${c}' is not a collected item and has no disposition; dropped (sibling pairing is T3's declared join).`
              : `${childPath}: '${c}' has no slot in the synthesized table shape; dropped.`,
        },
        treePath,
        Band.BeforeChildren,
        Phase.TableBody,
      );
      this.diagnostics.pushFidelity(
        {
          source: `${childPath} (${c})`,
          destination: "(discarded)",
          origin: reason ? `drops.${c}` : "collect",
          kind: "dropped",
          class: "lossy",
          note: reason ?? "no slot in the collected shape",
        },
        treePath,
        Band.BeforeChildren,
        Phase.TableBody,
      );
    }

    const itemsOnly = model.collects.every((col) => col.fields);
    this.diagnostics.push(
      {
        code: "surface-composition-flattened",
        message: itemsOnly
          ? `${path}: compound '${node.component}' subtree consumed into collected item records (uncollected content is not carried).`
          : `${path}: compound '${node.component}' subtree consumed into the synthesized table shape (documented casualty; cell content beyond text is not carried).`,
      },
      treePath,
      Band.BeforeChildren,
      Phase.TableFlatten,
    );
    this.diagnostics.pushFidelity(
      {
        source: `${path} (${node.component} subtree)`,
        destination: "(collected props)",
        origin: model.collects.map((c) => c.origin).join(", "),
        kind: "flattened",
        class: "lossy",
        note: "compound consumed into the collected shape; cell content beyond text is not carried",
      },
      treePath,
      Band.BeforeChildren,
      Phase.TableFlatten,
    );
  }

  /** True when a collect writes one flat list rather than one record per repetition. */
  private isFlatTarget(collect: Collect): boolean {
    return collect.flatten;
  }

  /** True when some route already consumes this component's text. */
  private claimedByRoute(model: SurfaceModel, component: string): boolean {
    return model.routes.some((r) =>
      r.from.some((s) => "subs" in s && (s.subs as string[]).includes(component)),
    );
  }

  /** One repetition's scalar cells, each flattened to its subtree text. */
  private collectRow(
    row: SurfaceNode,
    field: Collect,
    rowPath: string,
    treePath: readonly number[],
    rule: number,
  ): string[] {
    const cells: string[] = [];
    for (const child of collectChildren(row)) {
      const c = child.node.component;
      const subs = (field.scalar!.from[0] as { subs: string[] }).subs;
      if (subs.includes(c)) {
        cells.push(this.cellText(child.node, `${rowPath}${child.suffix}`, treePath, rule));
      } else {
        this.diagnostics.push(
          {
            code: "surface-sub-dropped",
            message: `${rowPath}: '${c}' has no slot in a synthesized table row; dropped (its text is not lifted).`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.TableBody,
          rule,
        );
        this.diagnostics.pushFidelity(
          { source: `${rowPath} (${c})`, destination: "(discarded)", origin: field.origin, kind: "dropped", class: "lossy", note: "no slot in a collected row; its text is not lifted" },
          treePath,
          Band.BeforeChildren,
          Phase.TableBody,
          rule,
        );
      }
    }
    return cells;
  }

  private cellText(cell: SurfaceNode, cellPath: string, treePath: readonly number[], rule: number): string {
    const nested = collectChildren(cell);
    const text = this.subtreeText(cell);
    if (nested.length > 0) {
      const names = nested.map((c) => `'${c.node.component}'`).join(", ");
      this.diagnostics.push(
        {
          code: "surface-table-cell-flattened",
          message: `${cellPath}: nested ${names} flattened to cell text; component structure and props are not carried by the synthesized table shape.`,
        },
        treePath,
        Band.BeforeChildren,
        Phase.TableBody,
        rule,
      );
      this.diagnostics.pushFidelity(
        { source: `${cellPath} (nested ${names})`, destination: "(cell text)", origin: "collect cell", kind: "flattened", class: "lossy", note: "component structure and props inside the cell are not carried" },
        treePath,
        Band.BeforeChildren,
        Phase.TableBody,
        rule,
      );
    }
    return text;
  }

  /** Children as instance references, after any sub-identity rewriting. */
  private emitChildren(
    node: SurfaceNode,
    model: SurfaceModel,
    instance: Json,
    id: string,
    path: string,
    treePath: readonly number[],
  ): void {
    const childRoute = model.routes.find((r) => r.from.some((s) => s.kind === "children"));
    const raw = collectChildren(node);
    const anyTransparentChild = raw.some((c) => {
      const plan = this.byDspackId.get(c.node.component);
      return plan !== undefined && surfaceModelOf(plan).transparent;
    });
    const childNodes: RewrittenChild[] =
      Object.keys(model.subIdentity).length > 0 || Object.keys(model.drops).length > 0 || anyTransparentChild
        ? this.rewriteChildren(node, model, path, treePath)
        : raw.map((c) => ({ node: c.node, suffix: c.suffix }));
    if (childNodes.length === 0) return;

    const childIds = childNodes.map((child, i) =>
      "textVariant" in child
        ? this.emitTextPrimitive(
            child.text,
            `${id}_${slug(child.textVariant)}`,
            path,
            [...treePath, Band.Children, i],
            Phase.TextChild,
            0,
            child.textVariant,
          )
        : this.emitNode(child.node, `${path}${child.suffix}[${i}]`, [...treePath, Band.Children, i], child.donations ?? []),
    );

    if (!childRoute) {
      throw new EmitSurfaceError(
        `component '${node.component}' has children but its surface plan declares no child slot`,
        path,
      );
    }
    if (childRoute.to.kind === "slots") {
      instance[childRoute.to.name] = childIds;
    } else {
      instance[childRoute.to.name] =
        childIds.length === 1 ? childIds[0] : this.wrapInColumn(childIds, id, path, treePath);
    }
  }

  /**
   * T1, the general root-transparency rule (ratified): a transparent node is
   * a semantic statement that the dspack node has no emitted identity — valid
   * at the root too. The root dissolves through the ORDINARY machinery
   * (presented as a child of a synthetic host, so boundary donations, sub
   * dispositions, and every refusal apply), then:
   *
   *   - exactly one surviving descendant  -> it IS the root (id "root",
   *     components[0]) — the existing root invariant, preserved
   *     deterministically;
   *   - several survivors                 -> they wrap in the synthesized
   *     wrap component, which is structural TRANSPORT, not a replacement
   *     identity for the transparent component;
   *   - nothing survives                  -> refuse. Fabricating content for
   *     an empty root would be synthesis of meaning, not structure.
   *
   * No component is special-cased by name.
   */
  emitTransparentRoot(root: SurfaceNode, path: string): string {
    const { wrapComponent, wrapChildrenProp } = this.profile.surfaceSynthesis;

    // Present the root AS A CHILD of a synthetic host, so the ordinary
    // rewriting machinery performs the whole dissolution — the plan-transparent
    // ledger entry, the boundary's own donations (transparentDonate), sub
    // dispositions, and every refusal — with no root-only special case.
    const host = { component: "__root_host__", children: [root] } as unknown as SurfaceNode;
    const spliced = this.rewriteChildren(host, emptySurfaceModel(), path, []);

    if (spliced.length === 0) {
      throw new EmitSurfaceError(
        `transparent root '${root.component}' dissolved to nothing — no descendant survives to become the root, and fabricating one is refused`,
        path,
      );
    }

    if (spliced.length === 1) {
      const only = spliced[0];
      this.diagnostics.pushFidelity(
        {
          source: `${path} (${root.component})`,
          destination: "root",
          origin: `plan.${root.component}`,
          kind: "moved",
          class: "maps-cleanly",
          note: "transparent root: its single surviving descendant is preserved as the root instance",
        },
        [],
        Band.BeforeChildren,
        Phase.ChildRewrite,
      );
      return "textVariant" in only
        ? this.emitTextPrimitive(only.text, "root", path, [Band.Children, 0], Phase.TextChild, 0, only.textVariant)
        : this.emitNode(only.node, path, [Band.Children, 0], only.donations ?? []);
    }

    const id = this.allocateId("root", path, { treePath: [], band: Band.BeforeChildren, phase: Phase.IdAllocation, rule: 0 });
    const index = this.components.length;
    this.components.push({});
    const childIds = spliced.map((child, i) =>
      "textVariant" in child
        ? this.emitTextPrimitive(child.text, `root_${slug(child.textVariant)}`, path, [Band.Children, i], Phase.TextChild, 0, child.textVariant)
        : this.emitNode(child.node, `${path}.children[${i}]`, [Band.Children, i], child.donations ?? []),
    );

    this.components[index] = { id, component: wrapComponent, [wrapChildrenProp]: childIds };
    this.diagnostics.push(
      {
        code: "surface-synthesized-wrap",
        message: `${path}: transparent root '${root.component}' dissolved; ${childIds.length} risen child(ren) wrapped in a synthesized ${wrapComponent} ('root').`,
      },
      [],
      Band.AfterChildren,
      Phase.Wrap,
    );
    this.diagnostics.pushFidelity(
      { source: `${path} (${childIds.length} risen children)`, destination: `synthesized ${wrapComponent} 'root'`, origin: "surfaceSynthesis.wrapComponent", kind: "wrapped", class: "synthesis-defaults", note: "structural transport for several risen children — not a replacement identity for the transparent root" },
      [],
      Band.AfterChildren,
      Phase.Wrap,
    );
    return id;
  }

  /**
   * Identity applied to the child list: sub dispositions from the surrounding
   * model, T1 plan-level transparency for child COMPONENTS (dissolved under
   * their own model — the `ctx` switch), and donation boundaries. A
   * dissolving boundary that carries donations harvests them from its own
   * subtree, consumes the donor subs, and attaches the pending writes to its
   * single eligible control — refusing on zero or several candidates. The
   * pending writes ride the returned child list explicitly and apply inside
   * the control's own construction: no committed instance is ever mutated.
   */
  private rewriteChildren(
    node: SurfaceNode,
    model: SurfaceModel,
    path: string,
    treePath: readonly number[],
    /**
     * T4: subs claimed by SIBLING routes of the enclosing compound (text
     * harvests, other slot sources). A claimed sub is skipped silently at any
     * dissolution depth — its consumption is ledgered by its own route, and
     * recording it twice would say it was dropped when it was moved.
     */
    claimedSubs: ReadonlySet<string> = new Set(),
  ): RewrittenChild[] {
    const push = (w: Warning) => this.diagnostics.push(w, treePath, Band.BeforeChildren, Phase.ChildRewrite);
    const ledger = (f: SurfaceFidelityEntry) =>
      this.diagnostics.pushFidelity(f, treePath, Band.BeforeChildren, Phase.ChildRewrite);

    const visit = (n: SurfaceNode, suffix: string, ctx: SurfaceModel, out: RewrittenChild[]): void => {
      if (claimedSubs.has(n.component)) return;
      // An authored drop is warn-and-discard, exactly like the collect path.
      const dropReason = ctx.drops[n.component];
      if (dropReason !== undefined) {
        push({ code: "surface-sub-dropped", message: `${path}: '${n.component}' dropped: ${dropReason}.` });
        ledger({ source: `${path} (${n.component})`, destination: "(discarded)", origin: `drops.${n.component}`, kind: "dropped", class: "lossy", note: dropReason });
        return;
      }

      // T1: a child COMPONENT whose plan is transparent dissolves here — its
      // subtree governed by ITS OWN model, not the surrounding one.
      const childPlan = this.byDspackId.get(n.component);
      const childModel = childPlan ? surfaceModelOf(childPlan) : undefined;
      if (childModel?.transparent) {
        ledger({
          source: `${path} (${n.component})`,
          destination: "(children rise in place)",
          origin: `plan.${n.component}`,
          kind: "flattened",
          class: "lossy",
          note: "transparent identity: the component dissolves; its own structure is not carried",
        });
        dissolve(n, suffix, childModel, childModel.transparentDonate, `plan.${n.component}`, out);
        return;
      }

      const identity = ctx.subIdentity[n.component];
      if (identity?.kind === "transparent") {
        push({
          code: "surface-sub-flattened",
          message: `${path}: grouping sub-component '${n.component}' spliced inline (subFlatten strategy); its own structure is not carried.`,
        });
        ledger({ source: `${path} (${n.component})`, destination: "(children rise in place)", origin: `subs.${n.component}`, kind: "flattened", class: "lossy", note: "transparent grouping dissolved; its own structure is not carried" });
        dissolve(n, suffix, ctx, identity.donate ?? [], `subs.${n.component}`, out);
        return;
      }
      if (identity?.kind === "as-text") {
        const text = this.subtreeText(n);
        const nested = collectChildren(n);
        if (nested.length > 0) {
          // Structure destroyed, text preserved — the same loss the cell
          // flatten records, and it must class the same way.
          const names = nested.map((c) => `'${c.node.component}'`).join(", ");
          ledger({ source: `${path} (${n.component} containing ${names})`, destination: "(subtree text)", origin: `subs.${n.component}`, kind: "flattened", class: "lossy", note: "re-identified as text; nested component structure and props are not carried" });
        }
        if (text !== "") {
          out.push({ text, textVariant: identity.variant });
        } else {
          push({ code: "surface-sub-dropped", message: `${path}: '${n.component}' carried no text to synthesize; dropped.` });
          ledger({ source: `${path} (${n.component})`, destination: "(discarded)", origin: `subs.${n.component}`, kind: "dropped", class: "lossy", note: "re-identified as text but carried none" });
        }
        return;
      }
      out.push({ node: n, suffix });
    };

    /**
     * Dissolves one boundary node under `innerCtx`. When the boundary carries
     * donations: harvest first-wins per donation, consume every donor sub,
     * splice the rest, then bind the pending writes to the single eligible
     * control among the spliced replacements — zero or several refuse.
     * Eligibility is declared, never guessed: a control's plan must declare
     * every donated destination.
     */
    const dissolve = (
      n: SurfaceNode,
      suffix: string,
      innerCtx: SurfaceModel,
      donations: readonly Donation[],
      originLabel: string,
      out: RewrittenChild[],
    ): void => {
      const consumedDonorSubs = new Set<string>();
      const pending: PendingDonation[] = [];
      for (const d of donations) {
        let value: string | undefined;
        let donorComponent = n.component;
        if (d.from.kind === "self-text") {
          value = n.text;
        } else if (d.from.kind === "sub-text") {
          for (const sub of d.from.subs) consumedDonorSubs.add(sub);
          const walk = (m: SurfaceNode): void => {
            if (value === undefined && d.from.kind === "sub-text" && d.from.subs.includes(m.component) && m.text !== undefined) {
              value = m.text;
              donorComponent = m.component;
            }
            for (const c of collectChildren(m)) walk(c.node);
          };
          walk(n);
        }
        if (value !== undefined) {
          pending.push({ prop: d.to.name, value, origin: d.origin, donorPath: `${path}${suffix}`, donorComponent });
        }
        // Nothing to donate is not an error: the destination stays absent and
        // gate A3 arbitrates — relocation, never synthesis (the lift rule).
      }

      // The boundary's own text rises as body text unless a self.text
      // donation claimed it (the plain transparent-sub behaviour otherwise).
      const selfDonated = donations.some((d) => d.from.kind === "self-text");
      const spliced: RewrittenChild[] = [];
      if (!selfDonated && n.text !== undefined && n.text !== "") spliced.push({ text: n.text, textVariant: "body" });

      for (const child of collectChildren(n)) {
        if (consumedDonorSubs.has(child.node.component)) {
          const supplied = pending.some((q) => q.donorComponent === child.node.component && q.value === child.node.text);
          if (!supplied) {
            push({ code: "surface-sub-dropped", message: `${path}: '${child.node.component}' dropped: its text was not the donated value (first donor wins).` });
            ledger({ source: `${path}${child.suffix} (${child.node.component})`, destination: "(discarded)", origin: originLabel, kind: "dropped", class: "lossy", note: "surplus donor: the donation was already supplied (first donor wins)" });
          }
          continue;
        }
        visit(child.node, child.suffix, innerCtx, spliced);
      }

      if (pending.length > 0) {
        const controls = spliced.filter((entry): entry is { node: SurfaceNode; suffix: string; donations?: PendingDonation[] } => {
          if (!("node" in entry)) return false;
          const plan = this.byDspackId.get(entry.node.component);
          if (!plan || surfaceModelOf(plan).transparent) return false;
          const declared = new Set([
            ...Object.keys(plan.structural ?? {}),
            ...Object.values(plan.propMap ?? {}).map((pp) => pp.a2ui),
          ]);
          return pending.every((q) => declared.has(q.prop));
        });
        if (controls.length !== 1) {
          const names = controls.map((c) => `'${c.node.component}'`).join(", ");
          throw new EmitSurfaceError(
            `donation boundary '${n.component}' (${originLabel}) requires exactly one eligible control declaring ` +
              `[${pending.map((q) => q.prop).join(", ")}]; found ${controls.length}${controls.length ? ` (${names})` : ""} — ` +
              `a donation relocates onto one control, never broadcasts`,
            `${path}${suffix}`,
          );
        }
        controls[0].donations = [...(controls[0].donations ?? []), ...pending];
      }

      out.push(...spliced);
    };

    const rootOut: RewrittenChild[] = [];
    for (const child of collectChildren(node)) visit(child.node, child.suffix, model, rootOut);
    return rootOut;
  }

  private emitTextPrimitive(
    text: string,
    preferredId: string,
    path: string,
    treePath: readonly number[],
    phase: Phase,
    rule: number,
    variant?: string,
  ): string {
    const { textComponent, textProp } = this.profile.surfaceSynthesis;
    const id = this.allocateId(preferredId, path, { treePath, band: Band.BeforeChildren, phase, rule });
    const instance: Json = { id, component: textComponent, [textProp]: text };
    if (variant !== undefined) instance.variant = variant;
    this.components.push(instance);
    this.diagnostics.push(
      {
        code: "surface-synthesized-text",
        message: `${path}: node text projected as a synthesized ${textComponent} child ('${id}') — the surface format has no text primitive.`,
      },
      treePath,
      Band.BeforeChildren,
      phase,
      rule,
    );
    this.diagnostics.pushFidelity(
      { source: `${path} (text)`, destination: `synthesized ${textComponent} '${id}'`, origin: "surfaceSynthesis.textComponent", kind: "synthesized", class: "synthesis-defaults", note: "the surface format has no text primitive" },
      treePath,
      Band.BeforeChildren,
      phase,
      rule,
    );
    return id;
  }

  /** All text in a node's subtree, document order, space-joined. */
  private subtreeText(node: SurfaceNode): string {
    const parts: string[] = [];
    const visit = (n: SurfaceNode): void => {
      if (n.text !== undefined && n.text !== "") parts.push(n.text);
      for (const child of collectChildren(n)) visit(child.node);
    };
    visit(node);
    return parts.join(" ");
  }

  private wrapInColumn(childIds: string[], parentId: string, path: string, treePath: readonly number[]): string {
    const { wrapComponent, wrapChildrenProp } = this.profile.surfaceSynthesis;
    const id = this.allocateId(`${parentId}_col`, path, {
      treePath,
      band: Band.AfterChildren,
      phase: Phase.Wrap,
      rule: 0,
    });
    this.components.push({ id, component: wrapComponent, [wrapChildrenProp]: childIds });
    this.diagnostics.push(
      {
        code: "surface-synthesized-wrap",
        message: `${path}: ${childIds.length} children wrapped in a synthesized ${wrapComponent} ('${id}') — the target slot takes a single child.`,
      },
      treePath,
      Band.AfterChildren,
      Phase.Wrap,
    );
    this.diagnostics.pushFidelity(
      { source: `${path} (${childIds.length} children)`, destination: `synthesized ${wrapComponent} '${id}'`, origin: "surfaceSynthesis.wrapComponent", kind: "wrapped", class: "synthesis-defaults", note: "the target slot takes a single child" },
      treePath,
      Band.AfterChildren,
      Phase.Wrap,
    );
    return id;
  }

  /**
   * Deterministic and stateful: `slug`, then `_2`, `_3`, … in first-come order.
   * Allocation order is emission order, which the model does not change.
   */
  private allocateId(
    preferred: string,
    path: string,
    where: { treePath: readonly number[]; band: Band; phase: Phase; rule: number },
  ): string {
    let id = slug(preferred);
    let n = 2;
    while (this.usedIds.has(id)) id = `${slug(preferred)}_${n++}`;
    if (id !== slug(preferred)) {
      this.diagnostics.push(
        {
          code: "surface-id-deduplicated",
          message: `${path}: node id '${preferred}' already used; emitted as '${id}'.`,
        },
        where.treePath,
        where.band,
        where.phase,
        where.rule,
      );
      this.diagnostics.pushFidelity(
        { source: `${path} (id '${preferred}')`, destination: `id '${id}'`, origin: "allocateId", kind: "deduplicated", class: "maps-cleanly", note: "surface ids are deterministic first-come; collisions suffix _2, _3, …" },
        where.treePath,
        where.band,
        where.phase,
        where.rule,
      );
    }
    this.usedIds.add(id);
    return id;
  }
}
