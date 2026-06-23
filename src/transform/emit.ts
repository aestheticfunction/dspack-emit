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
