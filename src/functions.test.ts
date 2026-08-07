/**
 * Declared catalog functions: the fail-closed check vocabulary.
 *
 * The emitted catalog always carried A2UI's check types (Checkable, CheckRule,
 * FunctionCall) — but our inlined FunctionCall had DROPPED the upstream
 * anyFunction constraint (inline-defs.ts documents the drop), and no catalog
 * ever declared a functions section. Net effect: an instance could `call` any
 * name at all and gate A3 passed it silently. Declared checks resolved to
 * nothing, invisibly.
 *
 * Now a v2 profile declares its function vocabulary as data; the catalog
 * carries a `functions` section; FunctionCall.call is constrained to the
 * declared names; and each call's args validate against the declared schema.
 * Undeclared function -> A3 refusal. No functions declared (every v1
 * profile) -> byte-identical emission to before, proven by the byte gate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { loadProfile } from "./transform/profile-load.js";
import type { A2uiVersion, DspackDoc } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;

/** A v2 profile mapping `input`, with a checks slot and two declared functions. */
const profileDoc = (): Record<string, unknown> => ({
  profileVersion: "2",
  catalogTitle: "functions-bearing catalog",
  catalogDescription: "d",
  catalogIdBase: "https://example.test/catalogs/fn",
  instructions: "",
  primaryColorToken: { category: "color", name: "primary" },
  surfaceSynthesis: { textComponent: "Text", textProp: "text", wrapComponent: "Column", wrapChildrenProp: "children" },
  functions: {
    checkRequired: {
      description: "True when the bound value is non-empty.",
      returns: "boolean",
    },
    matchesRegexp: {
      description: "True when the bound value matches the pattern.",
      returns: "boolean",
      args: {
        type: "object",
        properties: { pattern: { type: "string" } },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  synthesized: [
    {
      a2ui: "Text",
      commons: ["ComponentCommon"],
      structural: { text: { schema: { type: "string" }, description: "d", synthNote: "s" } },
      required: ["text"],
    },
    {
      a2ui: "Column",
      commons: ["ComponentCommon"],
      structural: { children: { schema: { type: "array", items: { $ref: "#/$defs/ComponentId" } }, description: "d", synthNote: "s" } },
      required: ["children"],
    },
  ],
  casualtyComponents: [],
  components: [
    {
      a2ui: "TextField",
      dspackId: "input",
      commons: ["ComponentCommon", "Checkable"],
      structural: {
        label: { schema: { type: "string" }, description: "d", synthNote: "s" },
        checks: {
          schema: { type: "array", items: { $ref: "#/$defs/CheckRule" } },
          description: "Client-side validation rules for this field.",
          synthNote: "dspack has no check vocabulary; checks are authored on the surface node.",
        },
      },
      required: ["label"],
      surface: {
        routes: [
          { from: ["self.text"], to: "prop:label", overwrite: true },
          { from: ["self.props.checks"], to: "prop:checks" },
        ],
      },
    },
  ],
});

const VERSIONS: A2uiVersion[] = ["0.9.1", "1.0"];

/** An instance whose check calls a declared function, correctly. */
const okSurface = (call: object) => ({
  messages: [
    { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "https://example.test/catalogs/fn/v0_9_1/catalog.json", theme: {} } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "s",
        components: [
          {
            id: "root",
            component: "TextField",
            label: "Email",
            checks: [{ condition: call, message: "Required." }],
          },
        ],
      },
    },
  ],
});

describe("declared functions reach the catalog and constrain every call", () => {
  for (const version of VERSIONS) {
    it(`the catalog carries the functions section and the call constraint (a2ui ${version})`, () => {
      const out = transformFromJson(doc, { profile: loadProfile(profileDoc()), a2uiVersion: version });
      const catalog = out.catalog as unknown as {
        functions?: Record<string, { returnType: string }>;
        $defs: { anyFunction?: { oneOf: unknown[] }; FunctionCall: { properties: { call: { enum?: string[] } } } };
      };
      expect(Object.keys(catalog.functions ?? {})).toEqual(["checkRequired", "matchesRegexp"]);
      expect(catalog.functions!.checkRequired.returnType).toBe("boolean");
      expect(catalog.$defs.anyFunction?.oneOf).toHaveLength(2);
      expect(catalog.$defs.FunctionCall.properties.call.enum).toEqual(["checkRequired", "matchesRegexp"]);
      // A1/A2 stay green with the section present.
      expect(out.validation.gates.find((g) => g.name === "schema-compile + no-external-ref")?.pass).toBe(true);
      expect(out.validation.gates.find((g) => g.name === "catalog-shape")?.pass).toBe(true);
    });
  }

  it("a check calling a declared function passes gate A3", () => {
    const out = transformFromJson(doc, {
      profile: loadProfile(profileDoc()),
      surface: okSurface({ call: "checkRequired" }),
    });
    expect(out.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("declared args validate: a good pattern passes, a missing required arg refuses", () => {
    const good = transformFromJson(doc, {
      profile: loadProfile(profileDoc()),
      surface: okSurface({ call: "matchesRegexp", args: { pattern: "^.+@.+$" } }),
    });
    expect(good.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);

    const missing = transformFromJson(doc, {
      profile: loadProfile(profileDoc()),
      surface: okSurface({ call: "matchesRegexp" }),
    });
    expect(missing.validation.gates.find((g) => g.name === "instance")?.pass).toBe(false);
  });

  it("an UNDECLARED function call fails gate A3 — the hole this exists to close", () => {
    const out = transformFromJson(doc, {
      profile: loadProfile(profileDoc()),
      surface: okSurface({ call: "checkVibes" }),
    });
    const gate = out.validation.gates.find((g) => g.name === "instance");
    expect(gate?.pass).toBe(false);
  });

  it("without the functions section the same undeclared call passes — the pre-existing hole, kept for v1 byte-compatibility and closed only by declaring", () => {
    const bare = profileDoc();
    delete bare.functions;
    const out = transformFromJson(doc, {
      profile: loadProfile(bare),
      surface: okSurface({ call: "checkVibes" }),
    });
    // Documenting reality, not endorsing it: no declaration, no constraint —
    // exactly today's emitted shape, which the byte gate freezes for v1.
    expect(out.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
    expect((out.catalog as { functions?: unknown }).functions).toBeUndefined();
  });

  it("v1 documents cannot declare functions — the field is v2 language", () => {
    const v1 = { profileVersion: "1", ...profileDoc(), functions: { f: { description: "x", returns: "boolean" } } };
    v1.profileVersion = "1";
    // v1 schema refuses both the functions field and the surface blocks.
    expect(() => loadProfile(v1)).toThrowError();
  });
});
