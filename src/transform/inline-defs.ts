/**
 * Self-contained `$defs` for the generated catalog.
 *
 * The official A2UI basic catalogs reference shared types via EXTERNAL `$ref`s
 * into `common_types.json` (e.g.
 * `https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString`).
 * Our success criterion forbids external `$ref`s, so we mirror the exact shapes
 * of the defs we use as INTERNAL `#/$defs/...` entries. Internal refs resolve
 * within the document, so the emitted catalog validates standalone.
 *
 * Two deliberate simplifications versus the upstream defs, noted in MAPPING.md:
 *  - `FunctionCall` drops the upstream `oneOf: [{ $ref: "catalog.json#/$defs/anyFunction" }]`
 *    constraint (that ref is external and couples to a function catalog we do not emit).
 *  - We only mirror the defs actually reachable from the components we emit.
 *
 * Shapes copied verbatim from the checked-in fixtures
 * (fixtures/a2ui/common_types.v0_9_1.json).
 */
import type { Json } from "../types.js";

const FunctionCall: Json = {
  type: "object",
  description: "Invokes a named function on the client.",
  properties: {
    call: { type: "string", description: "The name of the function to call." },
    args: {
      type: "object",
      description: "Arguments passed to the function.",
      additionalProperties: true,
    },
    returnType: {
      type: "string",
      description: "The expected return type of the function call.",
      enum: ["string", "number", "boolean", "array", "object", "any", "void"],
      default: "boolean",
    },
  },
  required: ["call"],
};

export const INLINED_DEFS: Record<string, Json> = {
  ComponentId: {
    type: "string",
    description:
      "The unique identifier for a component, used for both definitions and references within the same surface.",
  },

  AccessibilityAttributes: {
    type: "object",
    description:
      "Attributes to enhance accessibility when using assistive technologies like screen readers.",
    properties: {
      label: { $ref: "#/$defs/DynamicString" },
      description: { $ref: "#/$defs/DynamicString" },
    },
  },

  ComponentCommon: {
    type: "object",
    properties: {
      id: { $ref: "#/$defs/ComponentId" },
      accessibility: { $ref: "#/$defs/AccessibilityAttributes" },
    },
    required: ["id"],
  },

  DataBinding: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "A JSON Pointer path to a value in the data model.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },

  FunctionCall,

  DynamicValue: {
    description: "A value that can be a literal, a path, or a function call returning any type.",
    oneOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "array" },
      { $ref: "#/$defs/DataBinding" },
      { $ref: "#/$defs/FunctionCall" },
    ],
  },

  DynamicString: {
    description: "Represents a string",
    oneOf: [
      { type: "string" },
      { $ref: "#/$defs/DataBinding" },
      {
        allOf: [
          { $ref: "#/$defs/FunctionCall" },
          { properties: { returnType: { const: "string" } } },
        ],
      },
    ],
  },

  DynamicBoolean: {
    description: "Represents a boolean",
    oneOf: [
      { type: "boolean" },
      { $ref: "#/$defs/DataBinding" },
      {
        allOf: [
          { $ref: "#/$defs/FunctionCall" },
          { properties: { returnType: { const: "boolean" } } },
        ],
      },
    ],
  },

  ChildList: {
    oneOf: [
      {
        type: "array",
        items: { $ref: "#/$defs/ComponentId" },
        description: "A static list of child component IDs.",
      },
      {
        type: "object",
        description:
          "A template for generating a dynamic list of children from a data model list.",
        properties: {
          componentId: { $ref: "#/$defs/ComponentId" },
          path: {
            type: "string",
            description: "The path to the list of component property objects in the data model.",
          },
        },
        required: ["componentId", "path"],
        additionalProperties: false,
      },
    ],
  },

  CheckRule: {
    type: "object",
    description: "A single validation rule applied to an input component.",
    properties: {
      condition: { $ref: "#/$defs/DynamicBoolean" },
      message: {
        type: "string",
        description: "The error message to display if the check fails.",
      },
    },
    required: ["condition", "message"],
    additionalProperties: false,
  },

  Checkable: {
    type: "object",
    description: "Properties for components that support client-side checks.",
    properties: {
      checks: {
        type: "array",
        description: "A list of checks to perform.",
        items: { $ref: "#/$defs/CheckRule" },
      },
    },
  },

  Action: {
    description:
      "Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.",
    oneOf: [
      {
        type: "object",
        description: "Triggers a server-side event.",
        properties: {
          event: {
            type: "object",
            properties: {
              name: { type: "string" },
              context: {
                type: "object",
                additionalProperties: { $ref: "#/$defs/DynamicValue" },
              },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        required: ["event"],
        additionalProperties: false,
      },
      {
        type: "object",
        description: "Executes a local client-side function.",
        properties: {
          functionCall: { $ref: "#/$defs/FunctionCall" },
        },
        required: ["functionCall"],
        additionalProperties: false,
      },
    ],
  },
};

/** Names of the inlined helper defs (everything that is not a component or anyComponent). */
export const INLINED_DEF_NAMES = Object.keys(INLINED_DEFS);
