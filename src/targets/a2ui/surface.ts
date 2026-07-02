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
 *    (`subText` / `subButtonText` consume the node's whole subtree).
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

    const id = this.allocateId(node.id ?? plan.a2ui.toLowerCase(), path);
    // Reserve the slot so parent components precede children in the flat list.
    const index = this.components.length;
    this.components.push({});
    const instance: Json = { id, component: plan.a2ui };

    this.applyPropMap(node, plan, instance, path);
    const sp = plan.surfacePlan ?? {};
    const consumesSubtree = Boolean(sp.subText || sp.subButtonText);

    if (sp.structuralPassthrough) {
      for (const key of sp.structuralPassthrough) {
        const value = node.props?.[key];
        if (value !== undefined) instance[key] = value as Json[keyof Json];
      }
    }
    if (sp.subText || sp.subButtonText) this.applySubContent(node, sp.subText ?? {}, sp.subButtonText ?? {}, instance, path);
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
      const childNodes = collectChildren(node);
      if (childNodes.length > 0) {
        const childIds = childNodes.map((child, i) => this.emitNode(child.node, `${path}${child.suffix}[${i}]`));
        if (sp.childrenProp) {
          instance[sp.childrenProp] = childIds;
        } else if (sp.childProp) {
          instance[sp.childProp] = childIds.length === 1 ? childIds[0] : this.wrapInColumn(childIds, id);
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
        // First text found under the tracked sub-component (typically its button).
        if (!(n.component in subText)) instance[buttonProp] = n.text;
      }
      const nextInside = subButtonText[n.component] !== undefined ? n.component : insideSub;
      for (const child of collectChildren(n)) visit(child.node, nextInside);
    };
    visit(node, null);
    this.warnings.push({
      code: "surface-composition-flattened",
      message: `${path}: compound '${node.component}' subtree flattened onto emitted props (documented casualty; nested props beyond text are not carried).`,
    });
  }

  private emitTextPrimitive(text: string, preferredId: string, path: string): string {
    const { textComponent, textProp } = this.profile.surfaceSynthesis;
    const id = this.allocateId(preferredId, path);
    this.components.push({ id, component: textComponent, [textProp]: text });
    return id;
  }

  private wrapInColumn(childIds: string[], parentId: string): string {
    const { wrapComponent, wrapChildrenProp } = this.profile.surfaceSynthesis;
    const id = this.allocateId(`${parentId}_col`, "$");
    this.components.push({
      id,
      component: wrapComponent,
      [wrapChildrenProp]: childIds,
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

interface ChildRef {
  node: SurfaceNode;
  suffix: string;
}

/** Ordered children: `children` first, then slots in sorted-key order (deterministic). */
function collectChildren(node: SurfaceNode): ChildRef[] {
  const refs: ChildRef[] = (node.children ?? []).map((n) => ({ node: n, suffix: ".children" }));
  for (const key of Object.keys(node.slots ?? {}).sort()) {
    for (const n of node.slots![key]) refs.push({ node: n, suffix: `.slots.${key}` });
  }
  return refs;
}
