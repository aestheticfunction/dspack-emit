/**
 * The internal surface transformation model.
 *
 * Ten authored surface-plan directives accumulated one at a time, each named
 * after the collision that produced it (`subText`, `subButtonText`, `subTable`,
 * `subFlatten`, …). Measured against two design systems and a second emit
 * target, that vocabulary does not generalize: only four directives are used by
 * both shipped profiles, the second target reuses none of them, and the
 * scaffolder can reach two. They are not a vocabulary for projecting design
 * systems onto protocols — they are point-fixes for one collision, shadcn's
 * compound sub-component composition meeting A2UI's fixed catalog vocabulary.
 *
 * Underneath, every one of them answers exactly one of three questions:
 *
 *   Identity    does this node become an instance, and as which component?
 *   Routing     for each piece of this node's subtree, where does it land?
 *   Repetition  when a sub-structure repeats, how does it become an array?
 *
 * This module is that answer as types. The authored directives become surface
 * syntax that desugars here (see desugar.ts); the engine reads only this.
 *
 * THREE THINGS IMPLEMENTATION CONTACT ADDED, and why they are refinements of
 * the model rather than escapes from it:
 *
 *  1. `Selector[]`, not `Selector`. The audited label lift — "take the sub's
 *     label, else the first direct text under it" — is a fallback chain, not a
 *     special case. Ordered selectors express it, and express nothing else.
 *  2. `subs: string[]`, not `sub: string`. A table body accepts both a cell and
 *     a header-cell in the same row. One selector naming a set is honest; two
 *     collects racing for one destination is not.
 *  3. First-write-wins as a uniform WRITE DISCIPLINE rather than per-directive
 *     `??=` scattered through the emitter. Every v1 directive already behaved
 *     this way; only `textProp`/`textChildProp` overwrote, and that asymmetry
 *     is preserved explicitly (see `Route.overwrite`) rather than silently.
 *
 * What is deliberately NOT here, and must not arrive later: JSON paths,
 * expression evaluation, predicates, computed destination names, and writes to
 * arbitrary other instances. Those would each buy generality at the cost of the
 * property that makes emission auditable — that a plan can be checked against
 * its contract before it runs.
 */
import type { Json } from "../types.js";

/**
 * Whether a dspack node becomes an emitted instance, and under which catalog
 * identity. `transparent` and `as-text` are v1's `subFlatten` halves: today
 * they are declared by a compound about its own sub-family (subs have no plans
 * of their own), which is why they live in `Plan.subIdentity` rather than on
 * the node's plan. When plans gain identities of their own, that field becomes
 * the narrower spelling of this same idea.
 */
export type Identity =
  /** Emits one instance of the named A2UI component. */
  | { kind: "mapped"; a2ui: string }
  /**
   * Emits nothing; its children rise to the destination its parent would use.
   * A transparent identity may carry DONATIONS (T1's constrained control
   * donation): each dissolved instance harvests the donated values from its
   * own subtree and hands them to the single eligible emitted control within
   * that subtree — the boundary IS the scope, which is what makes a
   * three-field form donate three labels to three inputs instead of refusing.
   */
  | { kind: "transparent"; donate?: Donation[] }
  /** Emits as the profile's synthesized text primitive, carrying its subtree text. */
  | { kind: "as-text"; variant: string };

/**
 * One constrained control donation (the ratified `onto: "control"` mechanism):
 * a value harvested inside a dissolving boundary, written onto the boundary's
 * single eligible control. Fail-closed at emit: zero or multiple eligible
 * controls refuse; the receiving plan must declare the destination. The write
 * is carried EXPLICITLY in the rewritten child list and applied as a pre-write
 * when the control's own emission constructs its instance — never by mutating
 * another node's committed instance mid-traversal.
 */
export interface Donation {
  /** Where the value comes from, inside the dissolving boundary. */
  from: Selector;
  /** The receiving prop on the control (`prop:` destinations only). */
  to: Destination;
  /** Which authored rule produced this — provenance for the ledger. */
  origin: string;
}

/**
 * Where information comes from. A closed enumeration: every selector is
 * statically checkable against the contract before emission runs.
 */
export type Selector =
  /** This node's own `text`. */
  | { kind: "self-text" }
  /** One declared prop on this node, verbatim. */
  | { kind: "self-prop"; prop: string }
  /** `text` of any descendant whose component is one of `subs`. */
  | { kind: "sub-text"; subs: string[] }
  /**
   * The label of a descendant inside one of `subs` — a component whose own plan
   * projects text as a child label. Incidental text elsewhere never qualifies.
   */
  | { kind: "sub-label"; subs: string[] }
  /**
   * First direct text under one of `subs`, document order, the sub's own text
   * included. This is a LIFT: relocation of text that exists, never synthesis.
   * Only ever reached as a fallback, and always recorded.
   */
  | { kind: "sub-text-lift"; subs: string[] }
  /** All text in a descendant's subtree, document order, space-joined. */
  | { kind: "subtree-text"; subs: string[] }
  /** This node's ordered children, emitted as instances. */
  | { kind: "children" }
  /**
   * T2: the node's own surface `id`. Item-local — only valid inside a
   * collect's item fields, where each repeated item contributes the one
   * datum it carries (the production radio-group-item carries nothing else).
   */
  | { kind: "self-id" }
  /** No source: a declarative A2UI action synthesized from a deterministic slug. */
  | { kind: "synthesized-action" };

/**
 * Where information lands on the emitted instance. Names are literal — never
 * computed — so a plan's destinations can be validated against its own
 * `propMap`/`structural` at load time. This matters more than it looks: gate A3
 * validates emitted messages against the catalog and so catches an OMITTED
 * property, but an INVENTED one would pass. Load-time checking is the only
 * place that asymmetry can be closed.
 */
export type Destination =
  /** A scalar property. */
  | { kind: "prop"; name: string }
  /** A ComponentId property referencing a synthesized text primitive. */
  | { kind: "text-child"; name: string }
  /** A single ComponentId property (>1 child is wrapped in the profile's wrap component). */
  | { kind: "slot"; name: string }
  /** A ChildList property. */
  | { kind: "slots"; name: string }
  /** An Action property. */
  | { kind: "action"; name: string };

/**
 * Legacy write order. The engine applies routes and collects sorted by this,
 * never by declaration index or traversal happenstance — the same discipline
 * the diagnostics use, applied to output. Object key order is observable
 * (artifacts are hashed), so "when a route writes" is part of the contract and
 * belongs in data rather than in the shape of a method.
 */
export enum WriteOrder {
  /** Props copied verbatim into same-named destinations; wins over consumption. */
  Verbatim = 10,
  /** Sub-scoped consumption. Resolved by ONE document-order walk (see below). */
  Consume = 20,
  /** Repetition, and the caption-style routes that belong to the same strategy. */
  CollectLead = 30,
  Collect = 31,
  /** The node's own text. */
  SelfText = 40,
  SelfTextChild = 41,
  /** Synthesis with no source in the subtree. */
  Action = 50,
  /** Children as instance references, once every value destination is settled. */
  Children = 60,
}

/** Moves one piece of information from a source to a destination. */
export interface Route {
  /** When this route writes, relative to every other route and collect. */
  order: WriteOrder;
  /** Tried in order; the first that yields a value wins. */
  from: Selector[];
  to: Destination;
  /**
   * v1 asymmetry, preserved deliberately: `textProp`/`textChildProp` overwrite
   * whatever is already there, while every consuming directive is first-wins.
   * Making it a field rather than a code path keeps the difference reviewable.
   */
  overwrite?: boolean;
  /** Which authored directive produced this route — provenance for fidelity. */
  origin: string;
}

/**
 * Collects a repeated sub-structure into an array-valued destination. Item
 * fields are themselves routes or nested collects, which is why a paired group
 * (an options array whose value is a child reference) needs no separate
 * primitive — and why `subTable`'s three-level shape is nesting rather than a
 * grammar.
 */
export interface Collect {
  /** When this collect writes, relative to every other route and collect. */
  order: WriteOrder;
  /**
   * T2 item-mode: each descendant matching `of` becomes ONE RECORD whose
   * fields resolve against that item's own node (self.text, self.props.X,
   * self.id — never joins, never siblings). Mutually exclusive with the
   * table-mode `item`/`scalar` nesting.
   */
  fields?: Record<string, Selector>;
  /**
   * True when every repetition's cells concatenate into ONE flat list (v1's
   * header semantics: two header rows append into a single column list);
   * false when each repetition becomes its own record. Declared data — the
   * engine must never infer this from names or origins.
   */
  flatten: boolean;
  /** Descendant components that open one repetition. */
  of: string[];
  /** Array-valued destination, or `inline` when nested into a parent's field. */
  as: Destination | { kind: "inline" };
  /**
   * Per-item fields. A collect whose item is a single unnamed scalar (a table
   * row's cells) uses `scalar` instead.
   */
  item?: Record<string, Route | Collect>;
  /** The item IS one scalar, produced by this route. Mutually exclusive with `item`. */
  scalar?: Route;
  /** Declared join key for paired collections. Never inferred. Reserved for T3. */
  joinOn?: string;
  origin: string;
}

/**
 * Sub-components this plan explicitly discards, with the authored reason. v1
 * spelled this inside `subTable.drops`; it is not a table concept.
 */
export type Drops = Record<string, string>;

/** The whole of how a plan projects a surface node. Replaces SurfacePlanDirectives. */
export interface SurfaceModel {
  /**
   * T1: this plan's component emits NO instance — every node using it
   * dissolves at its parent's child-collection, children rising in place,
   * with `transparentDonate` harvested per dissolved instance. Refused for
   * the surface root at emit (renderers need components[0] = "root").
   */
  transparent: boolean;
  /** Donations carried by a transparent PLAN (per dissolved instance). */
  transparentDonate: Donation[];
  routes: Route[];
  collects: Collect[];
  /** Identity assigned to named sub-components met inside this node's subtree. */
  subIdentity: Record<string, Identity>;
  drops: Drops;
  /**
   * True when this plan absorbs its whole subtree into props, so children are
   * not emitted as instances. Derived during desugaring from the presence of
   * consuming routes/collects — never authored.
   */
  consumesSubtree: boolean;
}

export const emptySurfaceModel = (): SurfaceModel => ({
  transparent: false,
  transparentDonate: [],
  routes: [],
  collects: [],
  subIdentity: {},
  drops: {},
  consumesSubtree: false,
});

/** Narrowing helper: a collect's field may be either shape. */
export const isCollect = (field: Route | Collect): field is Collect =>
  (field as Collect).of !== undefined;

/** Human-readable selector, for warnings and fidelity provenance. */
export function describeSelector(s: Selector): string {
  switch (s.kind) {
    case "self-text":
      return "self.text";
    case "self-prop":
      return `self.props.${s.prop}`;
    case "sub-text":
      return `sub(${s.subs.join("|")}).text`;
    case "sub-label":
      return `sub(${s.subs.join("|")}).label`;
    case "sub-text-lift":
      return `sub(${s.subs.join("|")}).firstText`;
    case "subtree-text":
      return `sub(${s.subs.join("|")}).subtreeText`;
    case "children":
      return "children";
    case "self-id":
      return "self.id";
    case "synthesized-action":
      return "synthesized.action";
  }
}

/** Human-readable destination, for warnings and fidelity provenance. */
export const describeDestination = (d: Destination | { kind: "inline" }): string =>
  d.kind === "inline" ? "inline" : `${d.kind}:${d.name}`;

/** Every destination a model writes, for load-time validation against the plan. */
export function destinationsOf(model: SurfaceModel): Destination[] {
  const out: Destination[] = model.routes.map((r) => r.to);
  const walk = (c: Collect): void => {
    if (c.as.kind !== "inline") out.push(c.as);
    for (const field of Object.values(c.item ?? {})) {
      if (isCollect(field)) walk(field);
      else out.push(field.to);
    }
    if (c.scalar) out.push(c.scalar.to);
  };
  for (const c of model.collects) walk(c);
  return out;
}

/**
 * Every sub-component id this model accounts for, and how. This is what makes
 * `subCoverage` derivable instead of authored: a sub is covered when the model
 * consumes it, dissolves it, re-identifies it, or drops it with a reason —
 * and anything else is an unclassified sub, which must fail closed.
 */
export function referencedSubs(model: SurfaceModel): Map<string, string> {
  const subs = new Map<string, string>();
  const note = (id: string, how: string) => {
    if (!subs.has(id)) subs.set(id, how);
  };

  const fromSelector = (s: Selector, how: string): void => {
    if (s.kind === "sub-text" || s.kind === "sub-label" || s.kind === "sub-text-lift" || s.kind === "subtree-text") {
      for (const id of s.subs) note(id, how);
    }
  };

  for (const r of model.routes) {
    for (const s of r.from) fromSelector(s, `consumed into ${describeDestination(r.to)}`);
  }

  const walk = (c: Collect): void => {
    for (const id of c.of) note(id, `collected into ${describeDestination(c.as)}`);
    for (const field of Object.values(c.item ?? {})) {
      if (isCollect(field)) walk(field);
      else for (const s of field.from) fromSelector(s, `collected into ${describeDestination(field.to)}`);
    }
    if (c.scalar) for (const s of c.scalar.from) fromSelector(s, `collected as a scalar item`);
  };
  for (const c of model.collects) walk(c);

  for (const [id, identity] of Object.entries(model.subIdentity)) {
    if (identity.kind === "as-text") {
      note(id, `re-identified as text (${identity.variant})`);
    } else if (identity.kind === "transparent") {
      note(id, "transparent grouping");
      for (const d of identity.donate ?? []) fromSelector(d.from, `donated to ${describeDestination(d.to)}`);
    }
  }
  for (const d of model.transparentDonate) fromSelector(d.from, `donated to ${describeDestination(d.to)}`);
  for (const [id, reason] of Object.entries(model.drops)) note(id, `dropped: ${reason}`);

  return subs;
}

/**
 * Derived sub-component coverage: the honest replacement for the authored
 * `subCoverage` prose, which the engine never reads and which only a test in
 * another repo enforces.
 *
 * A sub is covered when the model NAMES it, or — when the plan absorbs its
 * whole subtree — when it is merely walked through on the way to a named one.
 * That second case is not slack: `alert-dialog-content`, `-header` and
 * `-footer` are real, and a derivation that only counted named subs would
 * report them missing while the emitter handles them correctly.
 *
 * Anything else is unclassified, and must fail closed.
 */
export function deriveSubCoverage(model: SurfaceModel, contractSubs: string[]): Map<string, string> {
  const covered = referencedSubs(model);
  for (const sub of contractSubs) {
    if (covered.has(sub)) continue;
    if (model.consumesSubtree) covered.set(sub, "transparent grouping, traversed by the subtree consumer");
  }
  return covered;
}

/** Subs the contract declares that the model cannot account for at all. */
export const unclassifiedSubs = (model: SurfaceModel, contractSubs: string[]): string[] => {
  const covered = deriveSubCoverage(model, contractSubs);
  return contractSubs.filter((s) => !covered.has(s));
};

export type { Json };
