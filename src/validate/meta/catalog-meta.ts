/**
 * Runtime mirrors of the catalog-shape meta-schemas. The .json files beside
 * this module stay the reviewable documents (README points reviewers at
 * src/validate/meta/); these constants exist because validateCatalog must run
 * in a browser bundle (dspack-studio composer), where readFileSync is not
 * available. src/schema-mirrors.test.ts asserts mirror and JSON stay
 * identical — edit both together.
 */
import type { A2uiVersion, Json } from "../../types.js";

export const catalogMetaSchemas: Record<A2uiVersion, Json> = {
  "0.9.1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://rdombrowski.dev/meta/a2ui-catalog.v0_9_1.json",
    "title": "A2UI catalog shape (v0.9.1)",
    "description": "Structural invariants an A2UI v0.9.1 catalog must satisfy, derived from the checked-in basic catalog fixture. The version-distinguishing requirement is $defs.theme (with primaryColor).",
    "type": "object",
    "required": [
      "$schema",
      "$id",
      "catalogId",
      "title",
      "description",
      "components",
      "$defs"
    ],
    "properties": {
      "catalogId": {
        "type": "string",
        "format": "uri"
      },
      "$id": {
        "type": "string",
        "format": "uri"
      },
      "components": {
        "type": "object",
        "minProperties": 1,
        "additionalProperties": {
          "type": "object",
          "required": [
            "allOf",
            "unevaluatedProperties"
          ],
          "properties": {
            "allOf": {
              "type": "array",
              "minItems": 1
            },
            "unevaluatedProperties": {
              "const": false
            }
          }
        }
      },
      "$defs": {
        "type": "object",
        "required": [
          "anyComponent",
          "theme"
        ],
        "not": {
          "required": [
            "surfaceProperties"
          ]
        },
        "properties": {
          "anyComponent": {
            "type": "object",
            "required": [
              "oneOf"
            ]
          },
          "theme": {
            "type": "object",
            "required": [
              "properties"
            ],
            "properties": {
              "properties": {
                "type": "object",
                "required": [
                  "primaryColor"
                ]
              }
            }
          }
        }
      }
    }
  },
  "1.0": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://rdombrowski.dev/meta/a2ui-catalog.v1_0.json",
    "title": "A2UI catalog shape (v1.0)",
    "description": "Structural invariants an A2UI v1.0 catalog must satisfy, derived from the checked-in basic catalog fixture. The version-distinguishing requirement is $defs.surfaceProperties (and the absence of $defs.theme).",
    "type": "object",
    "required": [
      "$schema",
      "$id",
      "catalogId",
      "title",
      "description",
      "components",
      "$defs"
    ],
    "properties": {
      "catalogId": {
        "type": "string",
        "format": "uri"
      },
      "$id": {
        "type": "string",
        "format": "uri"
      },
      "instructions": {
        "type": "string"
      },
      "components": {
        "type": "object",
        "minProperties": 1,
        "additionalProperties": {
          "type": "object",
          "required": [
            "allOf",
            "unevaluatedProperties"
          ],
          "properties": {
            "allOf": {
              "type": "array",
              "minItems": 1
            },
            "unevaluatedProperties": {
              "const": false
            }
          }
        }
      },
      "$defs": {
        "type": "object",
        "required": [
          "anyComponent",
          "surfaceProperties"
        ],
        "not": {
          "required": [
            "theme"
          ]
        },
        "properties": {
          "anyComponent": {
            "type": "object",
            "required": [
              "oneOf"
            ]
          },
          "surfaceProperties": {
            "type": "object",
            "required": [
              "properties"
            ]
          }
        }
      }
    }
  },
};
