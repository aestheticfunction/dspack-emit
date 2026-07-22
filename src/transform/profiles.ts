/**
 * A mapping *profile* is pure data describing how a dspack contract's components
 * correspond to A2UI catalog components. The transform engine (mapping.ts) is
 * source-agnostic and reads only this profile + the dspack document — never any
 * framework code. Retargeting a different design system = writing a new profile.
 *
 * The profile below targets the shadcn/ui dspack contract. Two kinds of components
 * are emitted:
 *   - `components`: derived from dspack component entries.
 *   - `synthesized`: A2UI structural/content primitives (Text, Column) that dspack
 *     does NOT contain. dspack describes a component *library*, not a layout system
 *     (its `layout` block is descriptive: breakpoints/grid/spacing, not renderable
 *     components). A2UI surfaces need primitives to be composable/renderable, so we
 *     synthesize them and record that as a fidelity finding.
 *
 * `casualtyComponents` are dspack components with no faithful A2UI representation;
 * they are documented and warned about, not emitted.
 */
import type { FidelityClass, Json } from "../types.js";

export interface Profile {
  catalogTitle: string;
  catalogDescription: string;
  /** Versioned catalogId/$id is built from this base + `/<ver>/catalog.json`. */
  catalogIdBase: string;
  /** v1.0 optional top-level `instructions`. */
  instructions: string;
  /** Which dspack token (category.name) supplies theme.primaryColor. */
  primaryColorToken: { category: string; name: string };
  components: ComponentPlan[];
  synthesized: ComponentPlan[];
  casualtyComponents: CasualtyComponent[];
  /** dspack component ids deliberately left out (not mapped, not a casualty). */
  intentionallyOmitted?: string[];
  /**
   * Which synthesized A2UI primitives the surface emitter uses when a dspack
   * surface needs structure the source vocabulary does not express: text
   * leaves become `textComponent` instances; multiple children in a
   * single-child slot are wrapped in `wrapComponent`.
   */
  surfaceSynthesis: {
    textComponent: string;
    textProp: string;
    wrapComponent: string;
    wrapChildrenProp: string;
  };
}

export interface ComponentPlan {
  a2ui: string;
  /** dspack component id this is derived from; omitted for pure synthesized primitives. */
  dspackId?: string;
  /** Overrides dspack description; if omitted and dspackId set, dspack description is used. */
  description?: string;
  /** Inlined `$defs` to compose via allOf (ComponentCommon is always included). */
  commons: string[];
  /** A2UI-native structural slots — synthesis, not dspack props. */
  structural: Record<string, StructuralSlot>;
  /** dspack prop name -> A2UI property mapping. */
  propMap?: Record<string, PropPlan>;
  /** A2UI required property names (the `component` const is added automatically). */
  required: string[];
  /** How the surface emitter projects a dspack-surface node onto this component. */
  surfacePlan?: SurfacePlanDirectives;
  /**
   * Explicit per-sub-component disposition for compound components: every
   * contract sub id -> one line naming how the surface emitter treats it
   * (which prop consumes it, "transparent grouping", or "dropped: <why>").
   * The profile-parity suite fails any mapped compound whose sub-family is
   * not fully classified here — a parent mapping alone never implies its
   * subs are supported.
   */
  subCoverage?: Record<string, string>;
}

/**
 * Data-only directives for projecting a dspack-surface (CSR) node onto an
 * emitted A2UI component instance. Compound composition that A2UI cannot
 * represent is flattened here, per the documented casualty mapping in
 * MAPPING.md — the emitter consumes the node's whole subtree when sub-content
 * directives (`subText`/`subButtonText`) are present.
 */
export interface SurfacePlanDirectives {
  /** Descendant sub-component id -> A2UI prop receiving that node's `text`. */
  subText?: Record<string, string>;
  /**
   * Descendant sub-component id -> A2UI prop receiving the `text` of the first
   * label-bearing component under that sub-component — a component whose own
   * surface plan projects text as a child label via `textChildProp` (e.g.
   * AlertDialogTrigger's button label -> triggerLabel). Incidental text on
   * other descendants is never picked up. The label-bearer's own props are a
   * documented casualty.
   */
  subButtonText?: Record<string, string>;
  /** Synthesize a declarative A2UI Action into this prop (event name is a deterministic slug). */
  actionProp?: string;
  /** Node `text` becomes a synthesized text-primitive child referenced by this ComponentId prop. */
  textChildProp?: string;
  /** Node `text` becomes this DynamicString prop directly. */
  textProp?: string;
  /** Children emit as components; exactly one child id in this prop (>1 children are wrapped). */
  childProp?: string;
  /** Children emit as components; their ids form a ChildList in this prop. */
  childrenProp?: string;
  /** CSR props copied verbatim into same-named structural slots (e.g. Table columns/rows). */
  structuralPassthrough?: string[];
  /**
   * Named parent strategy "tableSubs": consume a tabular sub-component
   * subtree into the synthesized caption/columns/rows shape. Domain-neutral
   * by construction: cells flatten to their subtree TEXT in document order —
   * nested component structure and props (whatever the component) are a
   * documented loss, warned per cell, never re-interpreted into semantic
   * fields. Sub ids listed in `drops` are skipped with a warning carrying
   * the declared reason. structuralPassthrough-provided values win over
   * consumed ones (the props path, where a contract expresses one).
   */
  subTable?: {
    caption: string;
    header: string;
    headerCell: string;
    body: string;
    row: string;
    cell: string;
    targetCaption: string;
    targetColumns: string;
    targetRows: string;
    drops: Record<string, string>;
  };
  /**
   * Named parent strategy "subFlatten": grouping sub-components in
   * `transparent` splice their children inline (structure dropped, order
   * kept, warned); text-bearing sub-components in `asText` synthesize the
   * profile's text primitive with the given variant.
   */
  subFlatten?: {
    transparent: string[];
    asText: Record<string, string>;
  };
}

export interface StructuralSlot {
  schema: Json;
  description: string;
  synthNote: string;
}

export interface PropPlan {
  a2ui: string;
  kind: "enum" | "string" | "boolean" | "number";
  /** Target (A2UI) enum vocabulary written into the catalog. */
  targetEnum?: string[];
  /** Source-value -> target-value projection. Many-to-one => lossy. */
  valueMap?: Record<string, string>;
  default?: string;
  description?: string;
}

export interface CasualtyComponent {
  dspackId: string;
  attempted: string;
  class: FidelityClass;
  reason: string;
}

const DynStr = { $ref: "#/$defs/DynamicString" };
const CompId = { $ref: "#/$defs/ComponentId" };

export const shadcnProfile: Profile = {
  catalogTitle: "shadcn/ui — A2UI catalog (compiled from dspack)",
  catalogDescription:
    "A2UI catalog compiled from the shadcn/ui dspack v0.4 contract. Component shapes, " +
    "variant enums, and the primary design token are projected onto the A2UI basic " +
    "component vocabulary. See MAPPING.md for per-field fidelity.",
  catalogIdBase: "https://rdombrowski.dev/catalogs/shadcn-ui",
  instructions: "For layout, use the Column component to organize other components.",
  primaryColorToken: { category: "color", name: "primary" },
  surfaceSynthesis: {
    textComponent: "Text",
    textProp: "text",
    wrapComponent: "Column",
    wrapChildrenProp: "children",
  },

  components: [
    {
      a2ui: "Button",
      dspackId: "button",
      commons: ["ComponentCommon", "Checkable"],
      structural: {
        child: {
          schema: CompId,
          description:
            "The ID of the child component to render inside the button (e.g. a Text). " +
            "Referenced by ID; not defined inline.",
          synthNote:
            "A2UI Buttons render a child component by ID; dspack Button has no equivalent " +
            "slot (children are arbitrary React nodes).",
        },
        action: {
          schema: { $ref: "#/$defs/Action" },
          description: "The interaction dispatched when the button is activated.",
          synthNote:
            "A2UI requires a declarative action; dspack expresses this as an onClick handler prop, " +
            "which is not representable in a declarative catalog.",
        },
      },
      propMap: {
        variant: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["default", "primary", "borderless"],
          valueMap: {
            default: "primary",
            destructive: "default",
            outline: "default",
            secondary: "default",
            ghost: "borderless",
            link: "borderless",
          },
          default: "primary",
          description:
            "Button style hint, projected from shadcn variants onto the A2UI basic vocabulary.",
        },
      },
      required: ["child", "action"],
      surfacePlan: { textChildProp: "child", actionProp: "action" },
    },

    {
      a2ui: "Card",
      dspackId: "card",
      commons: ["ComponentCommon"],
      structural: {
        child: {
          schema: CompId,
          description:
            "The ID of the single child component. Wrap multiple elements in a Column and pass its ID.",
          synthNote:
            "A2UI Card takes exactly one child by ID; dspack Card composes via sub-components " +
            "(CardHeader/CardContent/CardFooter), which flatten (subFlatten strategy: grouping " +
            "subs splice their children inline; title/description synthesize Text) and collapse " +
            "to a single, possibly Column-wrapped, child slot.",
        },
      },
      required: ["child"],
      surfacePlan: {
        childProp: "child",
        subFlatten: {
          transparent: ["card-header", "card-content", "card-footer"],
          asText: { "card-title": "h3", "card-description": "caption" },
        },
      },
      subCoverage: {
        "card-header": "transparent grouping: children splice inline, in order (subFlatten strategy)",
        "card-title": "text -> synthesized Text (variant h3)",
        "card-description": "text -> synthesized Text (variant caption)",
        "card-content": "transparent grouping: children splice inline, in order",
        "card-footer": "transparent grouping: children splice inline, in order",
      },
    },

    {
      a2ui: "TextField",
      dspackId: "input",
      commons: ["ComponentCommon", "Checkable"],
      structural: {
        label: {
          schema: DynStr,
          description: "The text label for the input field.",
          synthNote:
            "A2UI TextField owns its label; dspack Input relies on an external <label> element, " +
            "so the label is synthesized.",
        },
        value: {
          schema: DynStr,
          description: "The bound value of the text field.",
          synthNote: "A2UI two-way-binds value; dspack Input has no value prop in the contract.",
        },
      },
      propMap: {
        type: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["shortText", "longText", "number", "obscured"],
          valueMap: {
            text: "shortText",
            email: "shortText",
            search: "shortText",
            password: "obscured",
            number: "number",
          },
          default: "shortText",
          description: "Input kind, projected from the HTML input type onto A2UI TextField variants.",
        },
      },
      required: ["label"],
      surfacePlan: { textProp: "label" },
    },

    {
      // shadcn Badge -> a real A2UI Badge component shape (variant enum carried verbatim).
      a2ui: "Badge",
      dspackId: "badge",
      commons: ["ComponentCommon"],
      structural: {
        label: {
          schema: DynStr,
          description: "The badge text.",
          synthNote: "A2UI has no Badge; the label is synthesized from the badge's text child.",
        },
      },
      propMap: {
        variant: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["default", "secondary", "outline", "destructive"],
          default: "default",
          description: "Badge visual treatment (carried verbatim from shadcn; the React visual honors all four).",
        },
      },
      required: ["label"],
      surfacePlan: { textProp: "label" },
    },

    {
      // shadcn Table -> a synthesized presentational A2UI Table shape (caption/columns/rows).
      // The contract's table is purely sub-component-composed (it has no props), so the
      // surface emitter consumes the sub tree via the `subTable` strategy: caption text,
      // header-cell texts as columns, body rows as cells-of-text. Nested component
      // structure inside cells flattens to its text with a per-cell warning — the
      // documented loss; nothing is re-interpreted into semantic fields.
      a2ui: "Table",
      dspackId: "table",
      commons: ["ComponentCommon"],
      structural: {
        caption: {
          schema: DynStr,
          description: "Accessible caption naming the table.",
          synthNote: "A2UI has no Table; caption synthesized from TableCaption.",
        },
        columns: {
          schema: { type: "array", items: { type: "string" } },
          description: "Header labels for the data columns (a trailing status column is rendered separately).",
          synthNote: "Static column labels; A2UI has no table-header primitive.",
        },
        rows: {
          schema: { type: "array", items: { type: "object" } },
          description: "Row records, each { cells: string[] }.",
          synthNote: "Row data carried as a static array; A2UI has no tabular data model.",
        },
      },
      required: ["columns", "rows"],
      surfacePlan: {
        structuralPassthrough: ["caption", "columns", "rows"],
        subTable: {
          caption: "table-caption",
          header: "table-header",
          headerCell: "table-head",
          body: "table-body",
          row: "table-row",
          cell: "table-cell",
          targetCaption: "caption",
          targetColumns: "columns",
          targetRows: "rows",
          drops: {
            "table-footer": "summary rows have no slot in the synthesized caption/columns/rows shape",
          },
        },
      },
      subCoverage: {
        "table-caption": "text -> the synthesized `caption` (subTable strategy)",
        "table-header": "structural grouping; its rows' header-cell texts -> `columns` (subTable)",
        "table-head": "text -> a `columns` label (in the header) or a plain row cell string (as a body row header)",
        "table-body": "structural grouping; its rows -> `rows` (subTable)",
        "table-row": "one `rows` record (header row feeds `columns` instead)",
        "table-cell": "subtree text, document order, -> one `rows[].cells` string; nested component structure/props are a warned loss",
        "table-footer": "dropped with warning: summary rows have no slot in the synthesized shape",
      },
    },

    {
      // shadcn AlertDialog -> a synthesized non-dismissible confirmation. Preserves the
      // defining distinction from Dialog; the rich composition is a documented casualty.
      a2ui: "AlertDialog",
      dspackId: "alert-dialog",
      commons: ["ComponentCommon"],
      structural: {
        triggerLabel: {
          schema: DynStr,
          description: "Label of the button that opens the confirmation.",
          synthNote: "Trigger modeled as a label, not an AlertDialogTrigger sub-component.",
        },
        title: {
          schema: DynStr,
          description: "Confirmation title.",
          synthNote: "From AlertDialogTitle.",
        },
        description: {
          schema: DynStr,
          description: "Consequence description shown in the confirmation.",
          synthNote: "From AlertDialogDescription.",
        },
        confirmLabel: {
          schema: DynStr,
          description: "Label of the destructive confirm action.",
          synthNote: "From AlertDialogAction.",
        },
        cancelLabel: {
          schema: DynStr,
          description: "Label of the cancel action.",
          synthNote: "From AlertDialogCancel.",
        },
        action: {
          schema: { $ref: "#/$defs/Action" },
          description: "Event dispatched when the user confirms the destructive action.",
          synthNote: "A2UI declarative action; dspack expresses this as an onClick handler.",
        },
      },
      required: ["triggerLabel", "title", "action"],
      surfacePlan: {
        subText: {
          "alert-dialog-title": "title",
          "alert-dialog-description": "description",
          "alert-dialog-cancel": "cancelLabel",
          "alert-dialog-action": "confirmLabel",
        },
        subButtonText: { "alert-dialog-trigger": "triggerLabel" },
        actionProp: "action",
      },
      subCoverage: {
        "alert-dialog-trigger": "label-bearing text under it -> `triggerLabel` (subButtonText; audited lift when no label-bearer)",
        "alert-dialog-content": "transparent grouping, traversed by the subtree text consumer",
        "alert-dialog-header": "transparent grouping, traversed by the subtree text consumer",
        "alert-dialog-title": "text -> `title` (subText)",
        "alert-dialog-description": "text -> `description` (subText)",
        "alert-dialog-footer": "transparent grouping, traversed by the subtree text consumer",
        "alert-dialog-action": "text -> `confirmLabel` (subText); its action is the synthesized confirm event",
        "alert-dialog-cancel": "text -> `cancelLabel` (subText)",
      },
    },
  ],

  synthesized: [
    {
      a2ui: "Text",
      commons: ["ComponentCommon"],
      description: "Displays text content. Synthesized A2UI content primitive (not in dspack).",
      structural: {
        text: {
          schema: DynStr,
          description: "The text content to display.",
          synthNote: "A2UI content primitive required to render labels/titles in a surface.",
        },
      },
      propMap: {
        // No dspack source; declared directly as an A2UI-native enum.
        variant: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["h1", "h2", "h3", "h4", "h5", "caption", "body"],
          default: "body",
          description: "A hint for the base text style.",
        },
      },
      required: ["text"],
    },
    {
      a2ui: "Column",
      commons: ["ComponentCommon"],
      description:
        "Arranges children vertically. Synthesized A2UI structural primitive (dspack has no " +
        "layout component; its `layout` block is descriptive only).",
      structural: {
        children: {
          schema: { $ref: "#/$defs/ChildList" },
          description: "Child component IDs (or a template).",
          synthNote: "A2UI structural primitive required to compose multiple children.",
        },
      },
      propMap: {
        justify: {
          a2ui: "justify",
          kind: "enum",
          targetEnum: ["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly", "stretch"],
          default: "start",
          description: "Arrangement of children along the vertical main axis.",
        },
        align: {
          a2ui: "align",
          kind: "enum",
          targetEnum: ["center", "end", "start", "stretch"],
          default: "stretch",
          description: "Alignment of children along the horizontal cross axis.",
        },
      },
      required: ["children"],
    },
  ],

  casualtyComponents: [
    {
      dspackId: "dialog",
      attempted: "Modal",
      class: "cannot-represent",
      reason:
        "dspack Dialog is a compound component (DialogTrigger/Content/Header/Title/Description/" +
        "Footer/Close) with required-children composition rules, focus management, and a11y roles. " +
        "A2UI Modal exposes only trigger+content; the composition contract cannot be represented.",
    },
    {
      dspackId: "dropdown-menu",
      attempted: "(none)",
      class: "cannot-represent",
      reason:
        "No A2UI basic component corresponds to a dropdown menu (items, checkbox/radio items, " +
        "sub-menus, separators). Omitted.",
    },
  ],
};
