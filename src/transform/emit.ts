/**
 * Versioned catalog emitter. The two supported A2UI versions differ only in:
 *   - v0.9.1: a `$defs.theme` object (carries `primaryColor`, #rrggbb).
 *   - v1.0:   a `$defs.surfaceProperties` object + a top-level `instructions`.
 * Everything else (components, inlined `$defs`, `anyComponent`) is identical.
 *
 * The theme / surfaceProperties shapes are copied from the checked-in fixtures
 * (fixtures/a2ui/basic-catalog.{v0_9_1,v1_0}.json) and confirmed in pre-flight.
 * We additionally carry the resolved design tokens as a documented extension
 * (`additionalProperties: true` on both shapes permits it).
 */
import type { A2uiCatalog, A2uiVersion, Json } from "../types.js";
import { INLINED_DEFS } from "./inline-defs.js";
import type { MappingResult } from "./mapping.js";
import type { Profile } from "./profiles.js";

/**
 * The catalog's function surface, from the profile's declared FunctionPlans:
 * a documentation section, the name enum for FunctionCall.call, and the
 * per-function anyFunction branches that validate each call's args shape.
 * Definitions are declarative schemas — implementations live in renderers,
 * exactly as A2UI intends; nothing executable exists here.
 */
function buildFunctions(profile: Profile): {
  section: Record<string, Json>;
  names: string[];
  anyFunction: Json;
} | null {
  const declared = profile.functions;
  if (!declared || Object.keys(declared).length === 0) return null;
  const names = Object.keys(declared).sort();
  const section: Record<string, Json> = {};
  const branches: Json[] = [];
  for (const name of names) {
    const fn = declared[name];
    section[name] = {
      description: fn.description,
      returnType: fn.returns,
      ...(fn.args ? { args: fn.args as Json } : {}),
    } as Json;
    const requiredArgs =
      fn.args && Array.isArray((fn.args as { required?: unknown }).required) &&
      ((fn.args as { required: unknown[] }).required.length > 0);
    branches.push({
      type: "object",
      properties: {
        call: { const: name },
        ...(fn.args ? { args: fn.args as Json } : { args: { type: "object", maxProperties: 0 } }),
        returnType: { const: fn.returns },
      },
      // A function whose declared args carry required params cannot be called
      // without them — the args object itself becomes required.
      required: requiredArgs ? ["call", "args"] : ["call"],
    } as Json);
  }
  return { section, names, anyFunction: { oneOf: branches } as Json };
}

const VER_SEGMENT: Record<A2uiVersion, string> = {
  "0.9.1": "v0_9_1",
  "1.0": "v1_0",
};

export function emitCatalog(
  result: MappingResult,
  version: A2uiVersion,
  profile: Profile,
): A2uiCatalog {
  const seg = VER_SEGMENT[version];
  const id = `${profile.catalogIdBase}/${seg}/catalog.json`;

  const anyComponent: Json = {
    oneOf: result.componentOrder.map((n) => ({ $ref: `#/components/${n}` })),
    discriminator: { propertyName: "component" },
  };

  const $defs: Record<string, Json> = {
    ...structuredClone(INLINED_DEFS),
    anyComponent,
  };

  // Declared functions: the profile's function vocabulary becomes the
  // catalog's `functions` section, and — the fail-closed half — FunctionCall
  // regains the upstream anyFunction constraint our inlined copy dropped
  // (inline-defs.ts) back when no catalog declared any functions to call.
  // With the constraint restored, an instance calling an UNDECLARED function
  // fails gate A3 instead of passing silently. Profiles that declare no
  // functions (every v1 profile) emit byte-identically to before.
  const functions = buildFunctions(profile);
  if (functions) {
    $defs.anyFunction = functions.anyFunction;
    const fc = $defs.FunctionCall as { properties: { call: Json }; oneOf?: Json[] };
    fc.properties.call = {
      type: "string",
      description: "The name of the function to call. Must be declared in this catalog's functions section.",
      enum: functions.names,
    } as Json;
    // The upstream shape our inline copy dropped: the whole call object must
    // match one declared function's branch (name AND args shape together).
    fc.oneOf = [{ $ref: "#/$defs/anyFunction" } as Json];
  }

  if (version === "0.9.1") {
    $defs.theme = themeDef(result);
  } else {
    $defs.surfaceProperties = surfacePropertiesDef(result);
  }

  const catalog: A2uiCatalog = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    title: profile.catalogTitle,
    description: profile.catalogDescription,
    catalogId: id,
    components: result.components,
    ...(functions ? { functions: functions.section } : {}),
    $defs,
  };

  if (version === "1.0") {
    // Insert `instructions` right after description, mirroring the v1.0 fixture order.
    return {
      $schema: catalog.$schema,
      $id: catalog.$id,
      title: catalog.title,
      description: catalog.description,
      instructions: profile.instructions,
      catalogId: catalog.catalogId,
      components: catalog.components,
      ...(catalog.functions ? { functions: catalog.functions } : {}),
      $defs: catalog.$defs,
    };
  }

  return catalog;
}

/** v0.9.1 — shape from fixtures/a2ui/basic-catalog.v0_9_1.json#/$defs/theme. */
function themeDef(result: MappingResult): Json {
  const primaryColor: Json = {
    type: "string",
    description:
      "The primary brand color used for highlights (e.g., primary buttons, active borders). " +
      "Format: Hexadecimal code (e.g., '#00BFFF').",
    pattern: "^#[0-9a-fA-F]{6}$",
  };
  if (result.primaryColorHex) {
    primaryColor.default = result.primaryColorHex;
    primaryColor["x-dspack-source"] = result.primaryColorSource;
  }
  return {
    type: "object",
    properties: {
      primaryColor,
      iconUrl: {
        type: "string",
        format: "uri",
        description: "A URL for an image that identifies the agent or tool associated with the surface.",
      },
      agentDisplayName: {
        type: "string",
        description: "Text displayed next to the surface to identify the agent or tool that created it.",
      },
    },
    additionalProperties: true,
    ...result.tokenExtension,
  };
}

/** v1.0 — shape from fixtures/a2ui/basic-catalog.v1_0.json#/$defs/surfaceProperties. */
function surfacePropertiesDef(result: MappingResult): Json {
  const def: Json = {
    type: "object",
    properties: {
      iconUrl: {
        type: "string",
        format: "uri",
        description: "A URL for an image that identifies the agent or tool associated with the surface.",
      },
      agentDisplayName: {
        type: "string",
        description: "Text displayed next to the surface to identify the agent or tool that created it.",
      },
    },
    additionalProperties: true,
    ...result.tokenExtension,
  };
  // v1.0 basic surfaceProperties has no primaryColor field; carry it as an extension.
  if (result.primaryColorHex) {
    def["x-dspack-primaryColor"] = { value: result.primaryColorHex, source: result.primaryColorSource };
  }
  return def;
}
