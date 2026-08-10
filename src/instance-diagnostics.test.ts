/**
 * Instance diagnostics — two ratified fixes, proven fail-first:
 *
 * Fix 1 (gate A3, src/validate/ajv.ts): gate 3 used to validate every
 * instance against `#/$defs/anyComponent` — a flat oneOf over ALL catalog
 * components — with allErrors, so ONE missing prop yielded an error per
 * OTHER branch (their const/required/unevaluatedProperties failures), all
 * prefixed with the instance's own component#id. Branch-aware validation
 * reports only the instance's own branch (semantically equivalent: every
 * branch pins `component: {const: <name>}`), enriches messages from ajv
 * params (enum/const/unevaluated), and carries a structured `errorDetails`
 * channel preserving keyword/params for downstream UIs.
 *
 * Fix 2 (emitSurface, src/targets/a2ui/surface.ts): the emitter could
 * produce instances that cannot validate against the very catalog they
 * name — a required prop silently dropped at projection (authored
 * `props.title` with no propMap), or an enum value passed through verbatim
 * when no valueMap exists. emitSurface now refuses with one aggregated,
 * causal message instead of emitting a catalog-invalid surface. Full-schema
 * rigor stays gate A3's job (defense in depth); this guard covers
 * required-presence and enum-membership, the observed defect class.
 *
 * The fixture is a minimal inline contract + v2 profile with three mapped
 * components carrying DISTINCT required props (label / title / caption) and
 * one enum prop (tone) — so cross-branch noise, if any, is detectable by
 * name.
 */
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { loadProfile } from "./transform/profile-load.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const contract: DspackDoc = {
  dspack: "0.4",
  name: "mini-kit",
  description: "Minimal inline contract for instance diagnostics.",
  tokens: { color: { values: { primary: { value: "#3366ff", type: "color" } } } },
  components: {
    "text-field": { name: "TextField", description: "Single-line text input." },
    alert: {
      name: "Alert",
      description: "Callout whose title comes from its alert-title sub-component.",
      composition: { subComponents: [{ id: "alert-title" }] },
    },
    chip: {
      name: "Chip",
      description: "Small status marker with a tone.",
      props: { tone: { type: "enum", values: ["info", "warning"], description: "Visual tone." } },
    },
  },
};

/** A v2 profile document mapping all three components. */
const profileDoc = (): Record<string, unknown> => ({
  profileVersion: "2",
  catalogTitle: "mini-kit — A2UI catalog",
  catalogDescription: "Minimal catalog exercising branch-aware instance diagnostics.",
  catalogIdBase: "https://example.test/catalogs/mini-kit",
  instructions: "",
  primaryColorToken: { category: "color", name: "primary" },
  surfaceSynthesis: { textComponent: "Text", textProp: "text", wrapComponent: "Column", wrapChildrenProp: "children" },
  synthesized: [],
  casualtyComponents: [],
  components: [
    {
      a2ui: "TextField",
      dspackId: "text-field",
      commons: ["ComponentCommon"],
      structural: {
        label: { schema: { type: "string" }, description: "The field label.", synthNote: "synthesized from node text" },
      },
      required: ["label"],
      surface: { routes: [{ from: ["self.text"], to: "prop:label" }] },
    },
    {
      a2ui: "Alert",
      dspackId: "alert",
      commons: ["ComponentCommon"],
      structural: {
        title: { schema: { type: "string" }, description: "The alert title.", synthNote: "from the alert-title sub-component" },
      },
      required: ["title"],
      surface: { routes: [{ from: ["sub(alert-title).text"], to: "prop:title" }] },
    },
    {
      a2ui: "Chip",
      dspackId: "chip",
      commons: ["ComponentCommon"],
      structural: {
        caption: { schema: { type: "string" }, description: "The chip caption.", synthNote: "synthesized from node text" },
      },
      // Deliberately NO valueMap: an authored tone passes through verbatim today.
      propMap: { tone: { a2ui: "tone", kind: "enum", targetEnum: ["info", "warning"], description: "Visual tone." } },
      required: ["caption"],
      surface: { routes: [{ from: ["self.text"], to: "prop:caption" }] },
    },
  ],
});

const profile = () => loadProfile(profileDoc());

const surfaceOf = (root: unknown, intent = "diagnostics"): DspackSurface =>
  ({ dspackSurface: "0.1", system: "mini-kit", intent, root }) as DspackSurface;

const messagesWith = (...instances: Array<Record<string, unknown>>) => ({
  messages: [{ version: "v0.9", updateComponents: { surfaceId: "s", components: instances } }],
});

const instanceGate = (surface: unknown) => {
  const out = transformFromJson(contract, { profile: profile(), surface });
  return out.validation.gates.find((g) => g.name === "instance")!;
};

describe("gate A3 reports branch-scoped errors (fix 1)", () => {
  it("an instance missing its ONE required prop gets own-branch errors only, not every other branch's noise", () => {
    const gate = instanceGate(messagesWith({ id: "x", component: "TextField" }));
    expect(gate.pass).toBe(false);
    const errors = gate.errors ?? [];
    // Branch-scoped: a handful of errors, not one per unrelated branch.
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.length).toBeLessThanOrEqual(4);
    for (const e of errors) {
      // Every error names the instance itself…
      expect(e).toContain("TextField#x");
      // …and NONE leak the other components' branches: their names or their
      // required props must not appear in a report about a TextField.
      expect(e).not.toMatch(/\bAlert\b|\bChip\b|'title'|'caption'|"title"|"caption"/);
    }
    // The genuine error is reported: label is missing.
    expect(errors.join("\n")).toMatch(/label/);
    // Structured evidence rides alongside, preserving ajv keyword/params.
    expect(gate.errorDetails).toBeDefined();
    const detail = gate.errorDetails!.find((d) => d.instance === "TextField#x")!;
    expect(detail).toBeDefined();
    expect(detail.component).toBe("TextField");
    expect(detail.id).toBe("x");
    const required = detail.errors.find((e) => e.keyword === "required");
    expect(required).toBeDefined();
    expect((required!.params as { missingProperty?: string }).missingProperty).toBe("label");
  });

  it("an unknown component yields exactly ONE error naming it and the admitted count", () => {
    const gate = instanceGate(messagesWith({ id: "z", component: "Zorp" }));
    expect(gate.pass).toBe(false);
    expect(gate.errors).toHaveLength(1);
    expect(gate.errors![0]).toBe("Zorp#z: component 'Zorp' is not in this catalog (3 components admitted)");
  });

  it("an enum violation names the allowed values (enriched from ajv params)", () => {
    const gate = instanceGate(
      messagesWith({ id: "c", component: "Chip", caption: "Beta", tone: "loud" }),
    );
    expect(gate.pass).toBe(false);
    const joined = (gate.errors ?? []).join("\n");
    expect(joined).toMatch(/allowed: info, warning/);
  });
});

describe("emitSurface refuses catalog-invalid instances (fix 2)", () => {
  it("a required prop left unset by a dropped authored prop refuses — with the cause", () => {
    // Authored `props.title` has no propMap on 'alert' (title comes from the
    // alert-title sub-component), so today the prop drops with a warning and
    // the emitted Alert instance is missing its required `title`.
    const s = surfaceOf({ component: "alert", props: { title: "Heads up" } });
    expect(() => emitSurface(s, contract, { profile: profile() })).toThrowError(EmitSurfaceError);
    expect(() => emitSurface(s, contract, { profile: profile() })).toThrowError(/required prop 'title'/);
    // The refusal explains the cause: the authored prop had no projection,
    // and the value was expected from the sub-component.
    expect(() => emitSurface(s, contract, { profile: profile() })).toThrowError(/props\.title/);
    expect(() => emitSurface(s, contract, { profile: profile() })).toThrowError(/alert-title/);
  });

  it("an enum value outside the targetEnum refuses, naming the allowed values", () => {
    // No valueMap on tone: the raw value would land verbatim on the instance
    // and fail gate A3 downstream. Refuse at emission instead.
    const s = surfaceOf({ component: "chip", text: "Beta", props: { tone: "loud" } });
    expect(() => emitSurface(s, contract, { profile: profile() })).toThrowError(EmitSurfaceError);
    expect(() => emitSurface(s, contract, { profile: profile() })).toThrowError(/tone/);
    expect(() => emitSurface(s, contract, { profile: profile() })).toThrowError(/allowed: info, warning/);
  });

  it("fixture sanity: valid surfaces emit and pass every gate (true before and after the fixes)", () => {
    for (const root of [
      { component: "text-field", text: "Email" },
      { component: "alert", children: [{ component: "alert-title", text: "Heads up" }] },
      { component: "chip", text: "Beta", props: { tone: "info" } },
    ]) {
      const { messages } = emitSurface(surfaceOf(root), contract, { profile: profile() });
      const out = transformFromJson(contract, { profile: profile(), surface: { messages } });
      expect(out.validation.pass, `gates for ${root.component}`).toBe(true);
    }
  });
});
