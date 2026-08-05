/**
 * Ordered surface diagnostics.
 *
 * The v1 engine emitted warnings by pushing them onto an array wherever it
 * happened to be. That made the emitted order an ACCIDENT of method order and
 * traversal — invisible while one implementation existed, and load-bearing the
 * moment a second one appeared, because the byte gate hashes warnings.
 *
 * An engine driven by routes and collects resolves work in declaration order,
 * which is NOT v1's method order. Left implicit, the rewrite would emit the
 * same warnings in a different sequence and fail the gate for a reason that has
 * nothing to do with correctness — and the temptation would be to "fix" it by
 * re-baselining the hashes, which would silently discard the guarantee.
 *
 * So order becomes explicit data. Every diagnostic carries a sort key; the
 * engine collects them in whatever order it likes and sorts once at the end.
 * The key reproduces v1 exactly, and — because it is declared rather than
 * emergent — keeps reproducing it under later refactors.
 *
 * The phases below are DERIVED from the v1 engine, not designed: each is the
 * point in `emitNode` where that warning was pushed. They are numbered in that
 * method's execution order, and the numbering is the compatibility contract.
 */
import type { Warning } from "../../types.js";

/**
 * Legacy emission phases, in v1 `emitNode` execution order.
 *
 * Read alongside the pre-rewrite `emitNode`: id allocation happened first, then
 * prop projection, then the two consuming strategies (each ending with its own
 * composition warning), then text-child synthesis, then the synthesized action,
 * then the child-list rewrite — and only after every child had emitted did the
 * single-slot wrap run.
 */
export enum Phase {
  /** `allocateId` for this node — v1 allocated before any projection. */
  IdAllocation = 0,
  /** `applyPropMap`: dropped props and unprojectable values. */
  PropMap = 1,
  /** `applySubContent`'s audited label lift. */
  LabelLift = 2,
  /** `applySubContent`'s closing composition-flattened warning. */
  SubContentFlatten = 3,
  /** `applySubTable`'s per-cell flattening and per-sub drops. */
  TableBody = 4,
  /** `applySubTable`'s closing composition-flattened warning. */
  TableFlatten = 5,
  /** `emitTextPrimitive` invoked by the text-child route. */
  TextChild = 6,
  /** The synthesized declarative action. */
  Action = 7,
  /** `flattenSubs` rewriting the child list before children emit. */
  ChildRewrite = 8,
  /** `wrapInColumn` — runs AFTER every child has emitted. */
  Wrap = 9,
}

/**
 * Where a diagnostic sits relative to this node's children. v1's array order is
 * a pre-order walk in which a parent's pre-child warnings precede all of its
 * descendants' warnings, and its post-child warnings follow all of them — so a
 * flat `(node, phase)` sort would wrongly hoist the wrap warning above the
 * children it wraps.
 */
export enum Band {
  BeforeChildren = 0,
  Children = 1,
  AfterChildren = 2,
}

export interface Diagnostic {
  warning: Warning;
  /**
   * Lexicographically ordered key. Shape, per tree level:
   *   [...ancestorPath, Band.Children, childIndex] repeated to reach the node,
   *   then [band, phase, rule, seq].
   * Nesting bands this way is what makes a parent's post-child diagnostics sort
   * after its whole subtree without any special case.
   */
  key: number[];
}

/** Compares two diagnostic keys lexicographically; shorter sorts first on a tie. */
export function compareKeys(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Collects diagnostics with explicit ordering and returns them in legacy order.
 *
 * `seq` is a monotonic counter used only as the final tie-breaker, so two
 * diagnostics identical in every declared dimension still order deterministically
 * — by the order the engine produced them, which is itself deterministic.
 */
export class Diagnostics {
  private readonly items: Diagnostic[] = [];
  private seq = 0;

  /**
   * @param path  the node's tree path (alternating Band.Children / child index)
   * @param band  where this sits relative to the node's children
   * @param phase the legacy emission phase
   * @param rule  index of the desugared rule that produced it, for stable order
   *              among several routes writing in the same phase
   */
  push(warning: Warning, path: readonly number[], band: Band, phase: Phase, rule = 0): void {
    this.items.push({ warning, key: [...path, band, phase, rule, this.seq++] });
  }

  /** Legacy-ordered warnings. Sorting once at the end is the whole point. */
  ordered(): Warning[] {
    return [...this.items].sort((a, b) => compareKeys(a.key, b.key)).map((d) => d.warning);
  }

  get length(): number {
    return this.items.length;
  }
}
