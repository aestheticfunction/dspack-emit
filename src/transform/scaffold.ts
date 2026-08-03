/**
 * scaffoldProfile: a mechanical 1:1 draft Profile from a dspack contract.
 *
 * Seeded from the json-render CatalogModel (the judgment-free 1:1 IR): every
 * top-level contract component becomes a ComponentPlan with verbatim prop
 * projections; compound sub-components get subFlatten directives derived from
 * their *declared* `acceptsChildren` (text → asText, otherwise transparent).
 *
 * The scaffold invents no judgment: no valueMaps, no casualties, no lossy
 * projections. Everything a human must review is returned as `notes` — the
 * scaffold's analog of dspack-export's `awaitingAuthorship`. The result is a
 * valid v1 profile document (loadProfile accepts it) whose transform passes
 * gates A1/A2 with full coverage; whether each mapping is *right* is the
 * author's call.
 */
import type { DspackDoc, DspackProp } from "../types.js";
import { buildCatalogModel, type CatalogComponent } from "../targets/json-render/model.js";

export interface ScaffoldOptions {
  /** Required: the project's catalog identity root (https URI). */
  catalogIdBase: string;
  catalogTitle?: string;
  catalogDescription?: string;
  instructions?: string;
  /** Which token supplies theme.primaryColor; auto-detects color.primary when omitted. */
  primaryColorToken?: { category: string; name: string };
}

export interface ScaffoldNote {
  /** What the note is about: a component id, "<id>.<prop>", or a profile field. */
  target: string;
  note: string;
}

export interface ScaffoldResult {
  /** A v1 profile *document* (includes profileVersion; loadProfile accepts it). */
  profile: Record<string, unknown>;
  /** Everything that needs human judgment before the profile is trustworthy. */
  notes: ScaffoldNote[];
}

const DYN_STRING = { $ref: "#/$defs/DynamicString" };
const CHILD_LIST = { $ref: "#/$defs/ChildList" };
const COMP_ID = { $ref: "#/$defs/ComponentId" };

const TEXT_PLAN = {
  a2ui: "Text",
  commons: ["ComponentCommon"],
  description: "Displays text content. Synthesized A2UI content primitive (not in the contract).",
  structural: {
    text: {
      schema: DYN_STRING,
      description: "The text content to display.",
      synthNote: "A2UI content primitive required to render labels/titles in a surface.",
    },
  },
  propMap: {
    variant: {
      a2ui: "variant",
      kind: "enum",
      targetEnum: ["h1", "h2", "h3", "h4", "h5", "caption", "body"],
      default: "body",
      description: "A hint for the base text style.",
    },
  },
  required: ["text"],
};

const COLUMN_PLAN = {
  a2ui: "Column",
  commons: ["ComponentCommon"],
  description:
    "Arranges children vertically. Synthesized A2UI structural primitive (the contract has no layout component).",
  structural: {
    children: {
      schema: CHILD_LIST,
      description: "Child component IDs (or a template).",
      synthNote: "A2UI structural primitive required to compose multiple children.",
    },
  },
  required: ["children"],
};

interface SubDecl {
  id: string;
  acceptsChildren?: string;
}

function subsOf(doc: DspackDoc, id: string): SubDecl[] {
  const composition = (doc.components?.[id]?.composition ?? {}) as { subComponents?: unknown[] };
  const out: SubDecl[] = [];
  for (const raw of composition.subComponents ?? []) {
    if (typeof raw === "string") out.push({ id: raw });
    else if (raw && typeof raw === "object" && typeof (raw as SubDecl).id === "string") out.push(raw as SubDecl);
  }
  return out;
}

export function scaffoldProfile(doc: DspackDoc, options: ScaffoldOptions): ScaffoldResult {
  const notes: ScaffoldNote[] = [];
  const model = buildCatalogModel(doc, {});
  const byId = new Map<string, CatalogComponent>(model.components.map((c) => [c.dspackId, c]));
  const topLevelIds = Object.keys(doc.components ?? {});
  const name = (id: string) => byId.get(id)?.name ?? id;

  const usedNames = new Set(topLevelIds.map((id) => name(id)));

  const components = topLevelIds.map((id) => {
    const entry = byId.get(id)!;
    const contractProps = (doc.components?.[id]?.props ?? {}) as Record<string, DspackProp>;

    const propMap: Record<string, unknown> = {};
    for (const prop of entry.props) {
      if (prop.synthesized) continue; // the model's universal text prop belongs to json-render, not here
      const plan: Record<string, unknown> = { a2ui: prop.name, kind: prop.kind };
      if (prop.kind === "enum") plan.targetEnum = prop.values;
      const dflt = contractProps[prop.name]?.default;
      if (typeof dflt === "string") plan.default = dflt;
      if (prop.description) plan.description = prop.description;
      propMap[prop.name] = plan;
    }
    for (const excluded of entry.excludedProps) {
      notes.push({
        target: `${id}.${excluded.name}`,
        note: `prop not scaffolded (${excluded.reason}); map it via a structural slot, or declare the component a casualty if it cannot be represented.`,
      });
    }

    const required = Object.entries(contractProps)
      .filter(([, p]) => p.required === true)
      .map(([propName]) => propName)
      .filter((propName) => propName in propMap);

    const plan: Record<string, unknown> = {
      a2ui: entry.name,
      dspackId: id,
      commons: ["ComponentCommon"],
      structural: {},
      required,
    };
    if (Object.keys(propMap).length > 0) plan.propMap = propMap;
    else
      notes.push({
        target: id,
        note: "no declarative props were scaffolded; the contract likely needs prop enrichment before this mapping is useful.",
      });

    const subs = subsOf(doc, id);
    if (subs.length > 0) {
      const transparent = subs.filter((s) => s.acceptsChildren !== "text").map((s) => s.id);
      const asText = Object.fromEntries(subs.filter((s) => s.acceptsChildren === "text").map((s) => [s.id, "body"]));
      plan.structural = {
        child: {
          schema: COMP_ID,
          description: "The ID of the single child component. Wrap multiple elements in a Column and pass its ID.",
          synthNote:
            "Scaffolded: the compound's sub-components flatten (subFlatten) and collapse to a single, possibly Column-wrapped, child slot.",
        },
      };
      (plan.required as string[]).push("child");
      plan.surfacePlan = { childProp: "child", subFlatten: { transparent, asText } };
      plan.subCoverage = Object.fromEntries(
        subs.map((s) => [
          s.id,
          s.acceptsChildren === "text"
            ? "text -> synthesized Text (variant body) [scaffolded from acceptsChildren: text — review]"
            : "transparent grouping: children splice inline, in order [scaffolded — review]",
        ]),
      );
      notes.push({
        target: id,
        note: `compound scaffolded from declared acceptsChildren (${subs.length} sub-components: ${transparent.length} transparent, ${Object.keys(asText).length} asText); review each subCoverage line and pick text variants.`,
      });
    }

    return plan;
  });

  const synthesized: Record<string, unknown>[] = [];
  for (const primitive of [TEXT_PLAN, COLUMN_PLAN]) {
    if (usedNames.has(primitive.a2ui)) {
      notes.push({
        target: primitive.a2ui,
        note: `contract already has a component named '${primitive.a2ui}'; the synthesized primitive was skipped — verify surfaceSynthesis points at a component with the expected '${primitive.a2ui === "Text" ? "text" : "children"}' prop.`,
      });
    } else {
      synthesized.push(structuredClone(primitive) as Record<string, unknown>);
    }
  }

  let primaryColorToken = options.primaryColorToken;
  if (!primaryColorToken) {
    const hasColorPrimary = Boolean((doc.tokens as Record<string, { values?: Record<string, unknown> }> | undefined)?.color?.values?.primary);
    primaryColorToken = { category: "color", name: "primary" };
    notes.push({
      target: "primaryColorToken",
      note: hasColorPrimary
        ? "auto-detected color.primary; verify it is the intended theme primary."
        : "defaulted to color.primary, which this contract does not define — theme.primaryColor will emit null with a warning until you point this at a real token.",
    });
  }

  const profile: Record<string, unknown> = {
    profileVersion: "1",
    catalogTitle: options.catalogTitle ?? `${doc.name} — A2UI catalog (compiled from dspack)`,
    catalogDescription:
      options.catalogDescription ??
      `A2UI catalog compiled from the ${doc.name} dspack contract by scaffoldProfile. Mechanical 1:1 draft: review the scaffold notes before trusting any mapping.`,
    catalogIdBase: options.catalogIdBase,
    instructions: options.instructions ?? "For layout, use the Column component to organize other components.",
    primaryColorToken,
    components,
    synthesized,
    casualtyComponents: [],
    surfaceSynthesis: {
      textComponent: "Text",
      textProp: "text",
      wrapComponent: "Column",
      wrapChildrenProp: "children",
    },
  };

  notes.push({
    target: "casualtyComponents",
    note: "scaffolds never declare casualties; components that cannot be represented must be moved here by the author, with a reason.",
  });

  return { profile, notes };
}
