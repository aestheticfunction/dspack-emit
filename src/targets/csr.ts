/**
 * Shared CSR (dspack surface) traversal semantics used by every emitter target.
 *
 * The child-ordering rule is part of the CSR's meaning, not of any one
 * protocol projection: `children` first, then slot groups in sorted-key
 * order. Both targets (a2ui, json-render) must walk a surface identically or
 * the same governed CSR would emit differently-ordered artifacts per target.
 */
import type { SurfaceNode } from "../types.js";

export interface ChildRef {
  node: SurfaceNode;
  suffix: string;
}

/** Ordered children: `children` first, then slots in sorted-key order (deterministic). */
export function collectChildren(node: SurfaceNode): ChildRef[] {
  const refs: ChildRef[] = (node.children ?? []).map((n) => ({ node: n, suffix: ".children" }));
  for (const key of Object.keys(node.slots ?? {}).sort()) {
    for (const n of node.slots![key]) refs.push({ node: n, suffix: `.slots.${key}` });
  }
  return refs;
}
