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
import { describeSelector, isCollect, WriteOrder, type Collect, type Route, type Selector, type SurfaceModel } from "../../transform/model.js";

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
  const emitter = new SurfaceEmitter(profile, byDspackId);
  const rootId = emitter.emitNode(surface.root, "$.root");

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
  emitNode(node: SurfaceNode, path: string, treePath: readonly number[] = []): string {
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

    if (!model.consumesSubtree) {
      this.emitChildren(node, model, instance, id, path, treePath);
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

  /** Writes `value` unless the destination is taken and the route is first-wins. */
  private write(instance: Json, name: string, value: Json[keyof Json], overwrite?: boolean): void {
    if (overwrite || instance[name] === undefined) instance[name] = value;
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
        this.write(instance, route.to.name, found as Json[keyof Json], route.overwrite);
        this.diagnostics.pushFidelity(
          {
            source: `${path} (${describeSelector(selector)})`,
            destination: route.to.name,
            origin: route.origin,
            kind: selector.kind === "self-prop" ? "projected" : "moved",
            class: "maps-cleanly",
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
    // A prop routed verbatim to a same-named destination is projected by that
    // route, not by the prop map — v1 spelled this `structuralPassthrough`.
    const routedVerbatim = new Set(
      model.routes
        .filter((r) => r.from.some((s) => s.kind === "self-prop"))
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
      this.write(instance, collect.as.name, value as Json[keyof Json]);
      this.diagnostics.pushFidelity(
        {
          source: `${path} (${collect.of.join("|")} repetitions)`,
          destination: collect.as.name,
          origin: collect.origin,
          kind: "moved",
          class: "maps-cleanly",
          note: this.isFlatTarget(collect)
            ? `${flat.length} cell(s) collected into one flat list`
            : `${out.length} record(s) collected`,
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
  private closeCollects(
    node: SurfaceNode,
    model: SurfaceModel,
    path: string,
    treePath: readonly number[],
  ): void {
    const claimedByCollect = new Set(model.collects.flatMap((c) => c.of));
    for (const child of collectChildren(node)) {
      const c = child.node.component;
      if (claimedByCollect.has(c) || this.claimedByRoute(model, c)) continue;
      const childPath = `${path}${child.suffix}`;
      const reason = model.drops[c];
      this.diagnostics.push(
        {
          code: "surface-sub-dropped",
          message: reason
            ? `${childPath}: '${c}' dropped: ${reason}.`
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

    this.diagnostics.push(
      {
        code: "surface-composition-flattened",
        message: `${path}: compound '${node.component}' subtree consumed into the synthesized table shape (documented casualty; cell content beyond text is not carried).`,
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
    const childNodes =
      Object.keys(model.subIdentity).length > 0 ? this.rewriteChildren(node, model, path, treePath) : collectChildren(node).map((c) => ({ node: c.node, suffix: c.suffix }));
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
        : this.emitNode(child.node, `${path}${child.suffix}[${i}]`, [...treePath, Band.Children, i]),
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
   * Identity applied to named sub-components met in this node's child list:
   * `transparent` dissolves (its children rise in document order, recursively),
   * `as-text` becomes the profile's text primitive carrying its subtree text.
   */
  private rewriteChildren(
    node: SurfaceNode,
    model: SurfaceModel,
    path: string,
    treePath: readonly number[],
  ): Array<{ node: SurfaceNode; suffix: string } | { text: string; textVariant: string }> {
    const out: Array<{ node: SurfaceNode; suffix: string } | { text: string; textVariant: string }> = [];
    const visit = (n: SurfaceNode, suffix: string): void => {
      const identity = model.subIdentity[n.component];
      if (identity?.kind === "transparent") {
        this.diagnostics.push(
          {
            code: "surface-sub-flattened",
            message: `${path}: grouping sub-component '${n.component}' spliced inline (subFlatten strategy); its own structure is not carried.`,
          },
          treePath,
          Band.BeforeChildren,
          Phase.ChildRewrite,
        );
        this.diagnostics.pushFidelity(
          { source: `${path} (${n.component})`, destination: "(children rise in place)", origin: `subs.${n.component}`, kind: "flattened", class: "lossy", note: "transparent grouping dissolved; its own structure is not carried" },
          treePath,
          Band.BeforeChildren,
          Phase.ChildRewrite,
        );
        if (n.text !== undefined && n.text !== "") out.push({ text: n.text, textVariant: "body" });
        for (const child of collectChildren(n)) visit(child.node, child.suffix);
        return;
      }
      if (identity?.kind === "as-text") {
        const text = this.subtreeText(n);
        if (text !== "") {
          out.push({ text, textVariant: identity.variant });
        } else {
          this.diagnostics.push(
            { code: "surface-sub-dropped", message: `${path}: '${n.component}' carried no text to synthesize; dropped.` },
            treePath,
            Band.BeforeChildren,
            Phase.ChildRewrite,
          );
          this.diagnostics.pushFidelity(
            { source: `${path} (${n.component})`, destination: "(discarded)", origin: `subs.${n.component}`, kind: "dropped", class: "lossy", note: "re-identified as text but carried none" },
            treePath,
            Band.BeforeChildren,
            Phase.ChildRewrite,
          );
        }
        return;
      }
      out.push({ node: n, suffix });
    };
    for (const child of collectChildren(node)) visit(child.node, child.suffix);
    return out;
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
