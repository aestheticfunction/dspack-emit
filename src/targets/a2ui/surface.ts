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
 * messages. All projection knowledge is data in the profile's `surfacePlan`
 * directives; this engine contains no component-name-specific code.
 *
 * Honest scope (mirrors MAPPING.md):
 *  - Compound composition flattens per the documented casualty mapping
 *    (`subText` / `subButtonText` consume the node's whole subtree). When no
 *    label-bearing component carries a `subButtonText` label, the first
 *    direct text under that sub is LIFTED (audited, `surface-label-lifted`;
 *    spec v0.4 amendment 2026-07-04) — relocation of existing text, never
 *    synthesis.
 *  - A2UI requires declarative actions the surface format does not express;
 *    they are synthesized (deterministic event-name slug) and recorded as
 *    warnings, not silently invented.
 *  - The message envelope is A2UI v0.9 (`version: "v0.9"`), the version the
 *    maintained renderers speak. The emitted component instances themselves
 *    are version-independent and instance-validate (gate A3) against both
 *    generated catalogs.
 */
import type { DspackDoc, DspackSurface, Json, SurfaceNode, Warning } from "../../types.js";
import { shadcnProfile, type ComponentPlan, type Profile } from "../../transform/profiles.js";
import { toHex6 } from "../../transform/color.js";
import { collectChildren } from "../csr.js";

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
  return { messages, warnings: emitter.warnings };
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
  readonly warnings: Warning[] = [];
  private readonly usedIds = new Set<string>();

  constructor(
    private readonly profile: Profile,
    private readonly byDspackId: Map<string, ComponentPlan>,
  ) {}

  /** Emits the component for `node` (and its subtree) and returns its instance id. */
  emitNode(node: SurfaceNode, path: string): string {
    const plan = this.byDspackId.get(node.component);
    if (!plan) {
      throw new EmitSurfaceError(
        `unknown component '${node.component}': not a mapped component of the '${this.profile.catalogTitle}' profile ` +
          `(sub-components are consumed by their compound parent and cannot be emitted standalone)`,
        path,
      );
    }

    // A2UI renderers begin at the component with id "root" (see the
    // hand-authored surfaces); the surface root always emits under that id.
    const id = path === "$.root" ? this.allocateId("root", path) : this.allocateId(node.id ?? plan.a2ui.toLowerCase(), path);
    // Reserve the slot so parent components precede children in the flat list.
    const index = this.components.length;
    this.components.push({});
    const instance: Json = { id, component: plan.a2ui };

    this.applyPropMap(node, plan, instance, path);
    const sp = plan.surfacePlan ?? {};
    const consumesSubtree = Boolean(sp.subText || sp.subButtonText || sp.subTable);

    if (sp.structuralPassthrough) {
      for (const key of sp.structuralPassthrough) {
        const value = node.props?.[key];
        if (value !== undefined) instance[key] = value as Json[keyof Json];
      }
    }
    if (sp.subText || sp.subButtonText) this.applySubContent(node, sp.subText ?? {}, sp.subButtonText ?? {}, instance, path);
    if (sp.subTable) this.applySubTable(node, sp.subTable, instance, path);
    if (sp.textProp && node.text !== undefined) instance[sp.textProp] = node.text;
    if (sp.textChildProp && node.text !== undefined) {
      instance[sp.textChildProp] = this.emitTextPrimitive(node.text, `${id}_label`, path);
    }
    if (sp.actionProp) {
      const eventName = slug(node.id ?? (instance.confirmLabel as string) ?? node.text ?? node.component);
      instance[sp.actionProp] = { event: { name: eventName, context: {} } };
      this.warnings.push({
        code: "surface-synthesized-action",
        message: `${path}: A2UI requires a declarative action on ${plan.a2ui}; synthesized event '${eventName}'.`,
      });
    }

    if (!consumesSubtree) {
      const childNodes = sp.subFlatten ? this.flattenSubs(node, sp.subFlatten, path) : collectChildren(node);
      if (childNodes.length > 0) {
        const childIds = childNodes.map((child, i) =>
          "textVariant" in child
            ? this.emitTextPrimitive(child.text, `${id}_${slug(child.textVariant)}`, path, child.textVariant)
            : this.emitNode(child.node, `${path}${child.suffix}[${i}]`),
        );
        if (sp.childrenProp) {
          instance[sp.childrenProp] = childIds;
        } else if (sp.childProp) {
          instance[sp.childProp] = childIds.length === 1 ? childIds[0] : this.wrapInColumn(childIds, id, path);
        } else {
          throw new EmitSurfaceError(
            `component '${node.component}' has children but its surface plan declares no child slot`,
            path,
          );
        }
      }
    }

    this.components[index] = instance;
    return id;
  }

  /** CSR props -> A2UI props via the profile's existing PropPlan projections. */
  private applyPropMap(node: SurfaceNode, plan: ComponentPlan, instance: Json, path: string): void {
    for (const [prop, raw] of Object.entries(node.props ?? {})) {
      if (plan.surfacePlan?.structuralPassthrough?.includes(prop)) continue;
      const pp = plan.propMap?.[prop];
      if (!pp) {
        this.warnings.push({
          code: "surface-prop-dropped",
          message: `${path}: prop '${prop}' on '${node.component}' has no A2UI projection; dropped.`,
        });
        continue;
      }
      const value = pp.valueMap ? (pp.valueMap[String(raw)] ?? pp.default) : raw;
      if (value === undefined) {
        this.warnings.push({
          code: "surface-prop-value-dropped",
          message: `${path}: value '${String(raw)}' of prop '${prop}' has no projection and no default; dropped.`,
        });
        continue;
      }
      instance[pp.a2ui] = value as Json[keyof Json];
    }
  }

  /**
   * Compound flattening: pull text out of named sub-components anywhere in the
   * subtree. The subtree is consumed — the documented composition casualty.
   */
  private applySubContent(
    node: SurfaceNode,
    subText: Record<string, string>,
    subButtonText: Record<string, string>,
    instance: Json,
    path: string,
  ): void {
    const visit = (n: SurfaceNode, insideSub: string | null): void => {
      const textProp = subText[n.component];
      if (textProp !== undefined && n.text !== undefined && instance[textProp] === undefined) {
        instance[textProp] = n.text;
      }
      const buttonProp = insideSub ? subButtonText[insideSub] : undefined;
      if (buttonProp !== undefined && n.text !== undefined && instance[buttonProp] === undefined && n !== node) {
        // Only a label-bearing component qualifies (one whose surface plan
        // projects its text as a child label, e.g. the trigger's button) —
        // never incidental text on other descendants.
        const plan = this.byDspackId.get(n.component);
        if (plan?.surfacePlan?.textChildProp) instance[buttonProp] = n.text;
      }
      const nextInside = subButtonText[n.component] !== undefined ? n.component : insideSub;
      for (const child of collectChildren(n)) visit(child.node, nextInside);
    };
    visit(node, null);

    // Audited label lift (spec v0.4 amendment, 2026-07-04): when no
    // label-bearing component inside a subButtonText sub carried direct text,
    // lift the FIRST direct text found under that sub (the sub's own text
    // included, document order). This is a LIFT of existing text — relocation,
    // never synthesis: if nothing exists to lift, the prop stays missing and
    // gate A3 refuses the instance exactly as before. Every lift is recorded,
    // like the other documented casualties, so audit reports can count them.
    for (const [subId, buttonProp] of Object.entries(subButtonText)) {
      if (instance[buttonProp] !== undefined) continue;
      const lift = (n: SurfaceNode, inside: boolean): { text: string; component: string } | undefined => {
        const here = inside || n.component === subId;
        if (here && n.text !== undefined && n.text !== "") return { text: n.text, component: n.component };
        for (const child of collectChildren(n)) {
          const found = lift(child.node, here);
          if (found) return found;
        }
        return undefined;
      };
      const found = lift(node, false);
      if (found) {
        instance[buttonProp] = found.text;
        this.warnings.push({
          code: "surface-label-lifted",
          message: `${path}: '${buttonProp}' lifted from direct text on '${found.component}' inside '${subId}' — no label-bearing component carried it (documented projection extension; lift, never synthesis).`,
        });
      }
    }

    this.warnings.push({
      code: "surface-composition-flattened",
      message: `${path}: compound '${node.component}' subtree flattened onto emitted props (documented casualty; nested props beyond text are not carried).`,
    });
  }

  private emitTextPrimitive(text: string, preferredId: string, path: string, variant?: string): string {
    const { textComponent, textProp } = this.profile.surfaceSynthesis;
    const id = this.allocateId(preferredId, path);
    const instance: Json = { id, component: textComponent, [textProp]: text };
    if (variant !== undefined) instance.variant = variant;
    this.components.push(instance);
    this.warnings.push({
      code: "surface-synthesized-text",
      message: `${path}: node text projected as a synthesized ${textComponent} child ('${id}') — the surface format has no text primitive.`,
    });
    return id;
  }

  /**
   * Named parent strategy "subFlatten" (e.g. Card): grouping sub-components
   * splice their children inline in document order (their own structure is a
   * warned, documented loss); text-bearing sub-components synthesize the
   * profile's text primitive with the declared variant. Everything else
   * passes through to ordinary child emission.
   */
  private flattenSubs(
    node: SurfaceNode,
    spec: NonNullable<NonNullable<ComponentPlan["surfacePlan"]>["subFlatten"]>,
    path: string,
  ): Array<{ node: SurfaceNode; suffix: string } | { text: string; textVariant: string }> {
    const out: Array<{ node: SurfaceNode; suffix: string } | { text: string; textVariant: string }> = [];
    const visit = (n: SurfaceNode, suffix: string): void => {
      if (spec.transparent.includes(n.component)) {
        this.warnings.push({
          code: "surface-sub-flattened",
          message: `${path}: grouping sub-component '${n.component}' spliced inline (subFlatten strategy); its own structure is not carried.`,
        });
        if (n.text !== undefined && n.text !== "") out.push({ text: n.text, textVariant: "body" });
        for (const child of collectChildren(n)) visit(child.node, child.suffix);
        return;
      }
      const variant = spec.asText[n.component];
      if (variant !== undefined) {
        const text = this.subtreeText(n);
        if (text !== "") {
          out.push({ text, textVariant: variant });
        } else {
          this.warnings.push({
            code: "surface-sub-dropped",
            message: `${path}: '${n.component}' carried no text to synthesize; dropped.`,
          });
        }
        return;
      }
      out.push({ node: n, suffix });
    };
    for (const child of collectChildren(node)) visit(child.node, child.suffix);
    return out;
  }

  /**
   * Named parent strategy "subTable": consume the tabular sub tree into the
   * synthesized caption/columns/rows shape. Domain-neutral: a cell is its
   * subtree's text in document order — nested component structure and props
   * are a per-cell warned loss, never re-interpreted into semantic fields.
   * structuralPassthrough values (the props path) win over consumed ones.
   */
  private applySubTable(
    node: SurfaceNode,
    spec: NonNullable<NonNullable<ComponentPlan["surfacePlan"]>["subTable"]>,
    instance: Json,
    path: string,
  ): void {
    const columns: string[] = [];
    const rows: Json[] = [];
    let caption: string | undefined;

    const cellText = (cell: SurfaceNode, cellPath: string): string => {
      const nested = collectChildren(cell);
      const text = this.subtreeText(cell);
      if (nested.length > 0) {
        const names = nested.map((c) => `'${c.node.component}'`).join(", ");
        this.warnings.push({
          code: "surface-table-cell-flattened",
          message: `${cellPath}: nested ${names} flattened to cell text; component structure and props are not carried by the synthesized table shape.`,
        });
      }
      return text;
    };

    const consumeRow = (row: SurfaceNode, rowPath: string, into: string[]): void => {
      for (const child of collectChildren(row)) {
        const c = child.node.component;
        if (c === spec.cell || c === spec.headerCell) {
          into.push(cellText(child.node, `${rowPath}${child.suffix}`));
        } else if (spec.drops[c] !== undefined) {
          this.warnings.push({ code: "surface-sub-dropped", message: `${rowPath}: '${c}' dropped: ${spec.drops[c]}.` });
        } else {
          this.warnings.push({
            code: "surface-sub-dropped",
            message: `${rowPath}: '${c}' has no slot in a synthesized table row; dropped (its text is not lifted).`,
          });
        }
      }
    };

    for (const child of collectChildren(node)) {
      const c = child.node.component;
      const childPath = `${path}${child.suffix}`;
      if (c === spec.caption) {
        caption ??= cellText(child.node, childPath);
      } else if (c === spec.header) {
        for (const inner of collectChildren(child.node)) {
          if (inner.node.component === spec.row) consumeRow(inner.node, `${childPath}${inner.suffix}`, columns);
          else this.warnings.push({ code: "surface-sub-dropped", message: `${childPath}: '${inner.node.component}' inside '${spec.header}' has no slot; dropped.` });
        }
      } else if (c === spec.body) {
        for (const inner of collectChildren(child.node)) {
          if (inner.node.component === spec.row) {
            const cells: string[] = [];
            consumeRow(inner.node, `${childPath}${inner.suffix}`, cells);
            rows.push({ cells });
          } else {
            this.warnings.push({ code: "surface-sub-dropped", message: `${childPath}: '${inner.node.component}' inside '${spec.body}' has no slot; dropped.` });
          }
        }
      } else if (spec.drops[c] !== undefined) {
        this.warnings.push({ code: "surface-sub-dropped", message: `${childPath}: '${c}' dropped: ${spec.drops[c]}.` });
      } else {
        this.warnings.push({
          code: "surface-sub-dropped",
          message: `${childPath}: '${c}' has no slot in the synthesized table shape; dropped.`,
        });
      }
    }

    if (instance[spec.targetCaption] === undefined && caption !== undefined) instance[spec.targetCaption] = caption;
    if (instance[spec.targetColumns] === undefined && columns.length > 0) instance[spec.targetColumns] = columns;
    if (instance[spec.targetRows] === undefined && rows.length > 0) instance[spec.targetRows] = rows;
    this.warnings.push({
      code: "surface-composition-flattened",
      message: `${path}: compound '${node.component}' subtree consumed into the synthesized table shape (documented casualty; cell content beyond text is not carried).`,
    });
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

  private wrapInColumn(childIds: string[], parentId: string, path: string): string {
    const { wrapComponent, wrapChildrenProp } = this.profile.surfaceSynthesis;
    const id = this.allocateId(`${parentId}_col`, path);
    this.components.push({
      id,
      component: wrapComponent,
      [wrapChildrenProp]: childIds,
    });
    this.warnings.push({
      code: "surface-synthesized-wrap",
      message: `${path}: ${childIds.length} children wrapped in a synthesized ${wrapComponent} ('${id}') — the target slot takes a single child.`,
    });
    return id;
  }

  private allocateId(preferred: string, path: string): string {
    let id = slug(preferred);
    let n = 2;
    while (this.usedIds.has(id)) id = `${slug(preferred)}_${n++}`;
    if (id !== slug(preferred)) {
      this.warnings.push({
        code: "surface-id-deduplicated",
        message: `${path}: node id '${preferred}' already used; emitted as '${id}'.`,
      });
    }
    this.usedIds.add(id);
    return id;
  }
}
