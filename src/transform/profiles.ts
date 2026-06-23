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
    "A2UI catalog compiled from the shadcn/ui dspack v0.2 contract. Component shapes, " +
    "variant enums, and the primary design token are projected onto the A2UI basic " +
    "component vocabulary. See MAPPING.md for per-field fidelity.",
  catalogIdBase: "https://rdombrowski.dev/catalogs/shadcn-ui",
  instructions: "For layout, use the Column component to organize other components.",
  primaryColorToken: { category: "color", name: "primary" },

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
            "(CardHeader/CardContent/CardFooter), which collapse to a single child slot.",
        },
      },
      required: ["child"],
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
      dspackId: "badge",
      attempted: "Text",
      class: "lossy",
      reason:
        "shadcn Badge has no native A2UI component. Its instances fold onto the Text primitive; " +
        "the status-label semantics and the variant enum (default/secondary/outline/destructive) " +
        "have no representation and are lost.",
    },
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
      dspackId: "alert-dialog",
      attempted: "Modal",
      class: "cannot-represent",
      reason:
        "Same composition loss as Dialog, plus the defining AlertDialog semantics (non-dismissible, " +
        "alertdialog role, focus-to-cancel) have no A2UI catalog representation.",
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
