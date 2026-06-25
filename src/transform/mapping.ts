/**
 * Source-agnostic mapping engine. Given a dspack document and a mapping Profile,
 * it produces the A2UI component schemas, a fidelity record (per field), warnings
 * for unsupported constructs, and the design-token projection. It reads only the
 * dspack JSON and the profile — never framework code.
 */
import type {
  CoverageEntry,
  DspackComponent,
  DspackDoc,
  FidelityEntry,
  Json,
  Warning,
} from "../types.js";
import type { ComponentPlan, Profile } from "./profiles.js";
import { toHex6 } from "./color.js";

export interface MappingResult {
  /** A2UI component name -> component schema (JSON-Schema-shaped). */
  components: Record<string, Json>;
  /** Emission order for `$defs.anyComponent`. */
  componentOrder: string[];
  /** Hex value for theme.primaryColor / surfaceProperties (null if unresolvable). */
  primaryColorHex: string | null;
  primaryColorSource: string | null;
  /** Full design-token palette carried as a documented extension. */
  tokenExtension: Json;
  fidelity: FidelityEntry[];
  warnings: Warning[];
  /** Disposition of every input dspack component (no silent drops). */
  coverage: CoverageEntry[];
}

export function mapDspack(doc: DspackDoc, profile: Profile): MappingResult {
  const components: Record<string, Json> = {};
  const componentOrder: string[] = [];
  const fidelity: FidelityEntry[] = [];
  const warnings: Warning[] = [];

  const addComponent = (plan: ComponentPlan) => {
    const dspackComp = plan.dspackId ? doc.components?.[plan.dspackId] : undefined;
    if (plan.dspackId && !dspackComp) {
      warnings.push({
        code: "missing-source-component",
        message: `Profile maps dspack component '${plan.dspackId}' but it is absent from the input.`,
      });
      return;
    }
    components[plan.a2ui] = buildComponent(plan, dspackComp, fidelity, warnings);
    componentOrder.push(plan.a2ui);
  };

  for (const plan of profile.components) addComponent(plan);
  for (const plan of profile.synthesized) addComponent(plan);

  // Casualty components: documented, not emitted.
  for (const c of profile.casualtyComponents) {
    const present = !!doc.components?.[c.dspackId];
    fidelity.push({
      source: `components.${c.dspackId}`,
      target: c.attempted === "(none)" ? "(omitted)" : `components.${c.attempted}`,
      class: c.class,
      note: c.reason,
    });
    if (present) {
      warnings.push({
        code: `unsupported-component:${c.dspackId}`,
        message: `dspack component '${c.dspackId}' ${
          c.class === "lossy" ? "folds onto " + c.attempted + " with loss" : "cannot be represented"
        }: ${c.reason}`,
      });
    }
  }

  // Coverage: account for EVERY input dspack component. Anything not mapped,
  // synthesized-from, declared a casualty, or intentionally omitted is a silent
  // drop; surface it as `unclassified` with a warning and a fidelity entry.
  const coverage = computeCoverage(doc, profile, warnings, fidelity);

  // Tokens -> primaryColor + palette extension.
  const { primaryColorHex, primaryColorSource, tokenExtension } = mapTokens(
    doc,
    profile,
    fidelity,
    warnings,
  );

  // dspack knowledge layer that an A2UI catalog cannot carry.
  recordKnowledgeLayerCasualties(doc, fidelity, warnings);

  return {
    components,
    componentOrder,
    primaryColorHex,
    primaryColorSource,
    tokenExtension,
    fidelity,
    warnings,
    coverage,
  };
}

function computeCoverage(
  doc: DspackDoc,
  profile: Profile,
  warnings: Warning[],
  fidelity: FidelityEntry[],
): CoverageEntry[] {
  const mapped = new Map<string, string>(); // dspackId -> A2UI name
  // Both `components` and any `synthesized` plan that declares a `dspackId` count as mapped.
  for (const p of [...profile.components, ...profile.synthesized]) {
    if (p.dspackId) mapped.set(p.dspackId, p.a2ui);
  }

  const casualties = new Map<string, (typeof profile.casualtyComponents)[number]>();
  for (const c of profile.casualtyComponents) casualties.set(c.dspackId, c);

  const omitted = new Set(profile.intentionallyOmitted ?? []);

  const coverage: CoverageEntry[] = [];
  for (const id of Object.keys(doc.components ?? {})) {
    if (mapped.has(id)) {
      coverage.push({ id, disposition: "mapped", detail: `-> ${mapped.get(id)}` });
    } else if (omitted.has(id)) {
      coverage.push({ id, disposition: "omitted", detail: "declared in profile.intentionallyOmitted" });
    } else if (casualties.has(id)) {
      const c = casualties.get(id)!;
      coverage.push({
        id,
        disposition: c.class === "cannot-represent" ? "unsupported" : "adapted",
        detail: c.attempted === "(none)" ? c.reason : `${c.attempted}: ${c.reason}`,
      });
    } else {
      // Silent drop: not accounted for anywhere. Surface it loudly.
      coverage.push({ id, disposition: "unclassified" });
      warnings.push({
        code: `unclassified-component:${id}`,
        message: `dspack component '${id}' is not mapped, omitted, or declared a casualty. It was dropped with no representation. Add it to the profile (components, casualtyComponents, or intentionallyOmitted).`,
      });
      fidelity.push({
        source: `components.${id}`,
        target: "(silently dropped)",
        class: "cannot-represent",
        note: "Unclassified by the profile. This is a coverage gap, not a deliberate casualty.",
      });
    }
  }
  return coverage;
}

function buildComponent(
  plan: ComponentPlan,
  dspackComp: DspackComponent | undefined,
  fidelity: FidelityEntry[],
  warnings: Warning[],
): Json {
  const properties: Json = { component: { const: plan.a2ui } };
  const objSchema: Json = {
    type: "object",
    properties,
    required: ["component", ...plan.required],
  };

  const description = plan.description ?? dspackComp?.description ?? plan.a2ui;
  objSchema.description = description;
  if (dspackComp) {
    fidelity.push({
      source: `components.${plan.dspackId}.description`,
      target: `components.${plan.a2ui}.description`,
      class: "maps-cleanly",
      note: "dspack component description carried verbatim into the catalog component.",
    });
  }

  // Structural slots (A2UI-native; synthesis).
  for (const [name, slot] of Object.entries(plan.structural)) {
    properties[name] = { ...slot.schema, description: slot.description };
    fidelity.push({
      source: plan.dspackId ? `components.${plan.dspackId}` : `(synthesized)`,
      target: `components.${plan.a2ui}.properties.${name}`,
      class: "synthesis-defaults",
      note: slot.synthNote,
    });
  }

  // Mapped dspack props.
  const mappedSourceProps = new Set<string>();
  for (const [srcProp, pp] of Object.entries(plan.propMap ?? {})) {
    const prop: Json = { type: pp.kind === "boolean" ? "boolean" : pp.kind === "number" ? "number" : "string" };
    if (pp.description) prop.description = pp.description;
    if (pp.targetEnum) prop.enum = pp.targetEnum;
    if (pp.default !== undefined) prop.default = pp.default;

    const sourceProp = plan.dspackId ? dspackComp?.props?.[srcProp] : undefined;
    if (plan.dspackId && sourceProp) {
      mappedSourceProps.add(srcProp);
      const sourceEnum = enumValues(sourceProp.values);
      const annotation: Json = { sourceProp: srcProp, sourceType: sourceProp.type };
      if (sourceEnum.length) annotation.sourceEnum = sourceEnum;
      if (pp.valueMap) annotation.valueMap = pp.valueMap;
      prop["x-dspack-source"] = annotation;

      const targets = pp.valueMap ? new Set(Object.values(pp.valueMap)) : undefined;
      const collapsed = pp.valueMap && targets!.size < Object.keys(pp.valueMap).length;
      const cls = collapsed ? "lossy" : sourceEnum.length || pp.valueMap ? "synthesis-defaults" : "maps-cleanly";
      fidelity.push({
        source: `components.${plan.dspackId}.props.${srcProp}`,
        target: `components.${plan.a2ui}.properties.${pp.a2ui}`,
        class: cls,
        note: collapsed
          ? `Enum projected ${Object.keys(pp.valueMap!).length}->${targets!.size} (many-to-one); distinct source variants collapse.`
          : pp.valueMap
            ? "Enum value-mapped onto the A2UI target vocabulary."
            : "Property mapped onto the A2UI property.",
      });
    } else {
      // Synthesized component property with no dspack source.
      fidelity.push({
        source: "(synthesized)",
        target: `components.${plan.a2ui}.properties.${pp.a2ui}`,
        class: "synthesis-defaults",
        note: "A2UI-native property declared on a synthesized primitive (no dspack source).",
      });
    }
    properties[pp.a2ui] = prop;
  }

  // dspack props that did not map at all -> cannot-represent.
  if (plan.dspackId && dspackComp?.props) {
    for (const srcProp of Object.keys(dspackComp.props)) {
      if (mappedSourceProps.has(srcProp)) continue;
      fidelity.push({
        source: `components.${plan.dspackId}.props.${srcProp}`,
        target: "(dropped)",
        class: "cannot-represent",
        note: `No A2UI ${plan.a2ui} property corresponds to '${srcProp}'.`,
      });
      warnings.push({
        code: `dropped-prop:${plan.dspackId}.${srcProp}`,
        message: `dspack ${plan.dspackId}.${srcProp} has no A2UI representation and was dropped.`,
      });
    }
  }

  // Per-component knowledge fields that cannot be represented.
  if (plan.dspackId && dspackComp) {
    for (const field of ["accessibility", "composition", "constraints", "whenToUse", "whenNotToUse"] as const) {
      if (dspackComp[field] != null) {
        fidelity.push({
          source: `components.${plan.dspackId}.${field}`,
          target: "(dropped)",
          class: "cannot-represent",
          note: `dspack ${field} is design-intent / a11y knowledge with no A2UI catalog representation.`,
        });
      }
    }
  }

  // Catalog metadata where applicable: keep dspack provenance as an annotation.
  if (plan.dspackId) {
    const meta: Json = { sourceId: plan.dspackId };
    if (dspackComp?.status !== undefined) meta.status = dspackComp.status;
    if (dspackComp?.tags) meta.tags = dspackComp.tags;
    objSchema["x-dspack"] = meta;
    if (dspackComp?.tags || dspackComp?.status !== undefined) {
      fidelity.push({
        source: `components.${plan.dspackId}.{status,tags}`,
        target: `components.${plan.a2ui}.x-dspack`,
        class: "maps-cleanly",
        note: "dspack status/tags carried as catalog component metadata (x-dspack annotation).",
      });
    }
  }

  const allOf = [
    ...plan.commons.map((c) => ({ $ref: `#/$defs/${c}` })),
    objSchema,
  ];

  return {
    type: "object",
    allOf,
    unevaluatedProperties: false,
  };
}

function mapTokens(
  doc: DspackDoc,
  profile: Profile,
  fidelity: FidelityEntry[],
  warnings: Warning[],
): { primaryColorHex: string | null; primaryColorSource: string | null; tokenExtension: Json } {
  const { category, name } = profile.primaryColorToken;
  const sourceRef = `tokens.${category}.${name}`;
  const raw = doc.tokens?.[category]?.values?.[name]?.value;

  let primaryColorHex: string | null = null;
  if (raw) {
    primaryColorHex = toHex6(raw);
    if (primaryColorHex) {
      fidelity.push({
        source: sourceRef,
        target: "theme.primaryColor / surfaceProperties.x-dspack-tokens",
        class: "synthesis-defaults",
        note: `dspack '${raw}' converted to '${primaryColorHex}' to satisfy theme.primaryColor's #rrggbb pattern.`,
      });
    } else {
      warnings.push({
        code: "color-unconvertible",
        message: `Primary color token '${sourceRef}' = '${raw}' could not be converted to #rrggbb.`,
      });
    }
  } else {
    warnings.push({
      code: "missing-primary-token",
      message: `Primary color token '${sourceRef}' not found in input.`,
    });
  }

  // Carry the full color palette (resolved values) as a documented extension.
  const palette: Json = {};
  let lostTierOrAlias = false;
  for (const [cat, catObj] of Object.entries(doc.tokens ?? {})) {
    const entries: Json = {};
    for (const [tname, t] of Object.entries(catObj.values ?? {})) {
      const hex = t.type === "color" ? toHex6(t.value) : null;
      entries[tname] = hex ?? t.value;
      if ((t as Json).aliasOf || (t as Json).tier || catObj.tier) lostTierOrAlias = true;
    }
    palette[cat] = entries;
  }

  fidelity.push({
    source: "tokens.*",
    target: "theme/surfaceProperties.x-dspack-tokens",
    class: "synthesis-defaults",
    note: "Full token palette carried as a documented extension (additionalProperties allows it).",
  });
  if (lostTierOrAlias) {
    fidelity.push({
      source: "tokens.*.{tier,aliasOf}",
      target: "(dropped)",
      class: "cannot-represent",
      note: "Token tier/alias relationships have no A2UI representation; only resolved values survive.",
    });
  }

  const tokenExtension: Json = {
    "x-dspack-tokens": palette,
  };

  return { primaryColorHex, primaryColorSource: primaryColorHex ? sourceRef : null, tokenExtension };
}

function recordKnowledgeLayerCasualties(
  doc: DspackDoc,
  fidelity: FidelityEntry[],
  warnings: Warning[],
): void {
  const sections: Array<[string, string]> = [
    ["patterns", "Usage patterns (preferred component combinations)"],
    ["antiPatterns", "Anti-patterns (deliberately ruled-out approaches)"],
    ["frameworkBindings", "Framework bindings (import paths / packages)"],
    ["layout", "Layout primitives (breakpoints/grid/containers/spacing)"],
    ["themes", "Named theme overrides (e.g. dark mode)"],
  ];
  for (const [key, label] of sections) {
    const v = doc[key];
    const present = Array.isArray(v) ? v.length > 0 : v != null && Object.keys(v as object).length > 0;
    if (!present) continue;
    fidelity.push({
      source: key,
      target: "(dropped)",
      class: "cannot-represent",
      note: `${label}: A2UI catalogs describe renderable component shape, not design intent. Deliberate casualty.`,
    });
    warnings.push({
      code: `unsupported-section:${key}`,
      message: `dspack '${key}' has no A2UI catalog representation (deliberate casualty).`,
    });
  }
}

function enumValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) =>
    v != null && typeof v === "object" && "value" in (v as object)
      ? String((v as { value: unknown }).value)
      : String(v),
  );
}
