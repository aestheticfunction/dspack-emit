/**
 * scaffoldProfile: a mechanical draft Profile from a dspack contract — in the
 * v2 primitive language, honest about what it cannot decide.
 *
 * The old scaffold had two measured failures. For props-based contracts it
 * emitted no surface plan at all, so any surface with children hit a hard
 * throw — catalog-valid, surface-unusable, for exactly the idiom the docs
 * call typical. And for compounds it INVENTED the judgment it should have
 * surfaced: every sub auto-classified transparent-or-asText from
 * `acceptsChildren`, which is precisely the guess that is wrong for a
 * repeated item like `radio-group-item` (the measured T2 gap).
 *
 * This scaffold derives instead of guessing:
 *
 *  - identity and verbatim prop projections, as before — provable 1:1;
 *  - a `children` route where the contract OBSERVABLY supports children:
 *    the component appears with child nodes in a worked example, or declares
 *    sub-components. Provenance lands in the synthNote;
 *  - a `text` route where a worked example shows the component carrying text;
 *  - sub-components are NOT decided. Each one is an explicit unresolved
 *    decision: listed in `notes`, recorded under `x-scaffold.unresolved`, and
 *    absent from the surface block — which the v2 contract gate then refuses
 *    to transform, per sub, until the author decides (route, collect,
 *    transparent, asText, or drop with a reason). A scaffold that transforms
 *    before those decisions exist would be inventing them.
 *
 * The result loads (loadProfile accepts it). For a contract with no compound
 * sub-families it transforms immediately; for one with compounds, transform
 * refuses with the exact per-sub checklist. That refusal is the deliverable:
 * the scaffold's job is to make the remaining judgment explicit, not to
 * pretend it has been exercised.
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
  /** A v2 profile *document* (includes profileVersion; loadProfile accepts it). */
  profile: Record<string, unknown>;
  /** Everything that needs human judgment before the profile is trustworthy. */
  notes: ScaffoldNote[];
}

const DYN_STRING = { $ref: "#/$defs/DynamicString" };
const CHILD_LIST = { $ref: "#/$defs/ChildList" };

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

interface Observation {
  children?: string; // example id where the component was seen with child nodes
  text?: string; // example id where it was seen carrying text
}

/**
 * What the contract's own worked examples show each component doing. The
 * example corpus is the contract's definition of "expressible", which makes
 * this measurement, not judgment: a component observed with children needs a
 * children story; one observed with text needs a text story.
 */
function observeExamples(doc: DspackDoc): Map<string, Observation> {
  const seen = new Map<string, Observation>();
  const examples = (doc as { examples?: Array<{ id?: string; surface?: { root?: unknown } }> }).examples ?? [];
  const visit = (node: unknown, exampleId: string): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { component?: string; text?: unknown; children?: unknown[]; slots?: Record<string, unknown[]> };
    if (typeof n.component === "string") {
      const entry = seen.get(n.component) ?? {};
      const childNodes = [...(n.children ?? []), ...Object.values(n.slots ?? {}).flat()];
      if (childNodes.length > 0 && entry.children === undefined) entry.children = exampleId;
      if (typeof n.text === "string" && entry.text === undefined) entry.text = exampleId;
      seen.set(n.component, entry);
      for (const child of childNodes) visit(child, exampleId);
    }
  };
  for (const ex of examples) visit(ex.surface?.root, ex.id ?? "(unnamed example)");
  return seen;
}

export function scaffoldProfile(doc: DspackDoc, options: ScaffoldOptions): ScaffoldResult {
  const notes: ScaffoldNote[] = [];
  const model = buildCatalogModel(doc, {});
  const byId = new Map<string, CatalogComponent>(model.components.map((c) => [c.dspackId, c]));
  const topLevelIds = Object.keys(doc.components ?? {});
  const name = (id: string) => byId.get(id)?.name ?? id;
  const observed = observeExamples(doc);

  const usedNames = new Set(topLevelIds.map((id) => name(id)));
  const unresolvedByComponent: Record<string, string[]> = {};

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

    const structural: Record<string, unknown> = {};
    const routes: Array<Record<string, unknown>> = [];
    const subs = subsOf(doc, id);
    const seen = observed.get(id) ?? {};

    // Children: only where the contract observably supports them — a worked
    // example shows child nodes, or the component declares sub-components
    // (whose instances arrive as its children in every surface).
    const childrenBecause = seen.children
      ? `observed with child nodes in worked example '${seen.children}'`
      : subs.length > 0
        ? `declares ${subs.length} sub-component(s), which arrive as its children in surfaces`
        : undefined;
    if (childrenBecause) {
      structural.children = {
        schema: CHILD_LIST,
        description: "Child component IDs, in order.",
        synthNote: `Scaffolded: ${childrenBecause}.`,
      };
      required.push("children");
      routes.push({ from: ["children"], to: "slots:children" });
    }

    // Text: only where a worked example shows the component carrying it.
    if (seen.text) {
      structural.text = {
        schema: DYN_STRING,
        description: "The component's text content.",
        synthNote: `Scaffolded: observed carrying text in worked example '${seen.text}'.`,
      };
      routes.push({ from: ["self.text"], to: "prop:text" });
    }

    if (!childrenBecause && !seen.text && Object.keys(propMap).length === 0) {
      notes.push({
        target: id,
        note: "no declarative props, and never observed with children or text in a worked example; the contract likely needs enrichment before this mapping is useful.",
      });
    }

    const plan: Record<string, unknown> = {
      a2ui: entry.name,
      dspackId: id,
      commons: ["ComponentCommon"],
      structural,
      required,
    };
    if (Object.keys(propMap).length > 0) plan.propMap = propMap;
    if (routes.length > 0) plan.surface = { routes };

    // Sub-components: explicit unresolved decisions, never guesses. The v2
    // contract gate refuses to transform until each is decided — that refusal,
    // with its per-sub checklist, is the scaffold handing judgment to its
    // owner rather than exercising it.
    if (subs.length > 0) {
      unresolvedByComponent[id] = subs.map((s) => s.id);
      for (const sub of subs) {
        notes.push({
          target: `${id}.${sub.id}`,
          note: "unresolved sub-component: decide route (consume its text/label), collect (repeated items), transparent (dissolve), asText (re-identify), or drop (with a reason). transform() refuses until this is decided.",
        });
      }
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
    profileVersion: "2",
    catalogTitle: options.catalogTitle ?? `${doc.name} — A2UI catalog (compiled from dspack)`,
    catalogDescription:
      options.catalogDescription ??
      `A2UI catalog compiled from the ${doc.name} dspack contract by scaffoldProfile. Mechanical draft in the v2 primitive language: review the scaffold notes, and resolve every listed sub-component decision, before trusting any mapping.`,
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
    ...(Object.keys(unresolvedByComponent).length > 0
      ? {
          "x-scaffold": {
            unresolved: unresolvedByComponent,
            note: "Every listed sub-component is an authoring decision the scaffold deliberately did not make. transform() refuses until each is resolved in the owning plan's surface block.",
          },
        }
      : {}),
  };

  notes.push({
    target: "casualtyComponents",
    note: "scaffolds never declare casualties; components that cannot be represented must be moved here by the author, with a reason.",
  });

  return { profile, notes };
}
