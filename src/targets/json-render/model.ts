/**
 * Catalog model: the deterministic middle representation between a dspack
 * contract and the generated json-render modules.
 *
 * One entry per contract component AND per sub-component — json-render specs
 * nest by reference, so dspack compound composition survives whole (no
 * flattening step, no casualty mapping). The model is also the offline
 * validation vocabulary for emitted specs (see emit.ts); the generated Zod
 * catalog is its authoritative framework-side twin (see codegen.ts and
 * gates/json-render).
 *
 * Declarative boundary: function-typed props (event handlers) cannot appear
 * in a declarative catalog; they are excluded and recorded on the model —
 * never silently dropped.
 */
import type { DspackComponent, DspackDoc, DspackProp } from "../../types.js";
import type { JsonRenderProfile } from "./profile.js";

export interface CatalogModel {
  /** Contract name (surface.system must match, same rule as the a2ui target). */
  system: string;
  /** Ordered: contract component order; each component's sub-components follow it. */
  components: CatalogComponent[];
}

export interface CatalogComponent {
  /** PascalCase catalog/registry key (derived from the dspack id). */
  name: string;
  /** The dspack id a CSR node uses in its `component` field. */
  dspackId: string;
  description: string;
  /** Declarative props only, contract order; a universal `text` prop is appended. */
  props: CatalogProp[];
  /** Contract props excluded from the declarative catalog, with the reason. */
  excludedProps: ExcludedProp[];
}

export interface CatalogProp {
  name: string;
  kind: "enum" | "string" | "boolean" | "number";
  /** Enum vocabulary in contract order (enum kind only). */
  values?: string[];
  description?: string;
  /**
   * True for props this target adds beyond the contract (the universal
   * `text` prop). Synthesized props are populated only by the emitter's own
   * projection (the CSR `text` leaf), never via a node's `props` — the
   * emitter warns and drops attempts to set them there.
   */
  synthesized?: boolean;
}

export interface ExcludedProp {
  name: string;
  reason: string;
}

export class CatalogModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogModelError";
  }
}

/**
 * The universal `text` prop mirrors the CSR node schema, where `text` is a
 * leaf field allowed on any node — the projection is uniform because the
 * source is uniform.
 */
const TEXT_PROP: CatalogProp = {
  name: "text",
  kind: "string",
  description: "Text content (projected from the dspack surface node's `text` field).",
  synthesized: true,
};

export function pascalName(dspackId: string, profile: JsonRenderProfile): string {
  const override = profile.nameOverrides?.[dspackId];
  if (override) return override;
  return dspackId
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((seg) => seg[0].toUpperCase() + seg.slice(1))
    .join("");
}

export function buildCatalogModel(doc: DspackDoc, profile: JsonRenderProfile): CatalogModel {
  const components: CatalogComponent[] = [];
  const byDspackId = new Set<string>();
  const byName = new Set<string>();

  const add = (dspackId: string, description: string, props: Record<string, DspackProp> | undefined): void => {
    if (byDspackId.has(dspackId)) {
      // dspack v0.3 makes sub-component ids unique document-wide (normative
      // for governance contracts); a collision here is a malformed contract.
      throw new CatalogModelError(`duplicate component/sub-component id '${dspackId}' in contract`);
    }
    const name = pascalName(dspackId, profile);
    if (byName.has(name)) {
      throw new CatalogModelError(
        `catalog name '${name}' (from '${dspackId}') collides with another component; add a profile nameOverride`,
      );
    }
    byDspackId.add(dspackId);
    byName.add(name);
    const { props: catalogProps, excluded } = projectProps(props ?? {});
    if (!catalogProps.some((p) => p.name === TEXT_PROP.name)) catalogProps.push(TEXT_PROP);
    components.push({ name, dspackId, description, props: catalogProps, excludedProps: excluded });
  };

  for (const [id, component] of Object.entries(doc.components ?? {})) {
    if (profile.intentionallyOmitted?.includes(id)) continue;
    add(id, component.description, component.props);
    for (const sub of subComponentsOf(component)) {
      add(sub.id, sub.description ?? `${component.name} sub-component.`, sub.props);
    }
  }
  return { system: doc.name, components };
}

function projectProps(props: Record<string, DspackProp>): {
  props: CatalogProp[];
  excluded: ExcludedProp[];
} {
  const out: CatalogProp[] = [];
  const excluded: ExcludedProp[] = [];
  for (const [name, def] of Object.entries(props)) {
    switch (def.type) {
      case "enum": {
        const values = (def.values ?? []).map((v) => (typeof v === "object" && v !== null ? v.value : v));
        if (values.length === 0 || !values.every((v) => typeof v === "string")) {
          excluded.push({ name, reason: `enum prop without an all-string value vocabulary` });
          break;
        }
        out.push({ name, kind: "enum", values: values as string[], description: def.description });
        break;
      }
      case "string":
      case "boolean":
      case "number":
        out.push({ name, kind: def.type, description: def.description });
        break;
      case "function":
        excluded.push({ name, reason: "function-typed (event handler) — not representable in a declarative catalog" });
        break;
      default:
        excluded.push({ name, reason: `unsupported prop type '${def.type}'` });
    }
  }
  return { props: out, excluded };
}

interface SubComponentEntry {
  id: string;
  description?: string;
  props?: Record<string, DspackProp>;
}

function subComponentsOf(component: DspackComponent): SubComponentEntry[] {
  const composition = component.composition as { subComponents?: unknown[] } | undefined;
  const entries: SubComponentEntry[] = [];
  for (const raw of composition?.subComponents ?? []) {
    if (typeof raw === "string") {
      entries.push({ id: raw });
    } else if (raw && typeof raw === "object" && typeof (raw as SubComponentEntry).id === "string") {
      entries.push(raw as SubComponentEntry);
    }
  }
  return entries;
}
