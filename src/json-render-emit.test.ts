/**
 * PR-9 acceptance gates: the json-render target.
 *
 * THE THESIS TEST, with its guarantee stated precisely: governance runs
 * pre-emission on the CSR (gates S1–S3, dspack-gen), so governed/violating
 * status is identical across emitters BY CONSTRUCTION. What this test
 * demonstrates is that every governed CSR this repo carries — the contract's
 * worked example and the delete-account fixture — is ACCEPTED BY BOTH
 * emitters: the a2ui target (emitter gates A1–A3, both A2UI versions) and
 * the json-render target (emission + catalog-model vocabulary). It does NOT
 * claim protocol expressiveness equivalence.
 *
 * The framework-level json-render gates (J1 generated modules compile, J2
 * validateSpec, J3 catalog.validate with real zod v4) run in
 * scripts/json-render-gate.sh — a separate pinned package, because
 * @a2ui/web_core pins the root tree to zod v3 while json-render requires
 * zod v4. This file asserts everything that is assertable offline.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DspackDoc, DspackSurface, SurfaceNode } from "./types.js";
import { transform } from "./transform/index.js";
import { emitSurface } from "./targets/a2ui/surface.js";
import {
  emitJsonRenderSpec,
  EmitJsonRenderError,
  validateSpecAgainstModel,
} from "./targets/json-render/emit.js";
import { generateJsonRenderModules } from "./targets/json-render/codegen.js";
import { buildCatalogModel } from "./targets/json-render/model.js";
import { shadcnJsonRenderProfile } from "./targets/json-render/profile.js";

const doc = JSON.parse(readFileSync("input/shadcn-ui.dspack.json", "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const workedExample = doc.examples.find((e) => e.id === "ex.delete-account-confirmation")!;
const deleteAccountFixture = JSON.parse(
  readFileSync("surface/delete-account.dsurface.json", "utf8"),
) as DspackSurface;

const governedCorpus: Array<[string, DspackSurface]> = [
  ["worked example ex.delete-account-confirmation", workedExample.surface],
  ["surface/delete-account.dsurface.json", deleteAccountFixture],
];

describe("thesis test: governed CSRs are accepted by both emitters", () => {
  for (const [label, surface] of governedCorpus) {
    it(`${label}: a2ui target accepts (gates A1–A3, both A2UI versions)`, () => {
      const { messages } = emitSurface(surface, doc);
      for (const version of ["0.9.1", "1.0"] as const) {
        const { validation } = transform(doc, version, { messages });
        expect(
          Object.fromEntries(validation.gates.map((g) => [g.name, g.pass])),
          `a2ui gates for ${version}`,
        ).toEqual({
          "schema-compile + no-external-ref": true,
          "catalog-shape": true,
          instance: true,
        });
      }
    });

    it(`${label}: json-render target accepts (emission + catalog-model vocabulary)`, () => {
      const { spec } = emitJsonRenderSpec(surface, doc);
      const model = buildCatalogModel(doc, shadcnJsonRenderProfile);
      expect(validateSpecAgainstModel(spec, model)).toEqual([]);
    });
  }
});

describe("emitJsonRenderSpec: composition survives (no flattening)", () => {
  const { spec, warnings } = emitJsonRenderSpec(workedExample.surface, doc);

  it("the root emits under key 'root' and nesting is preserved by reference", () => {
    expect(spec.root).toBe("root");
    expect(spec.elements.root.type).toBe("Card");
    // Card -> AlertDialog -> AlertDialogTrigger -> Button: the chain the a2ui
    // target flattens onto AlertDialog props exists here as real elements.
    const dialogKey = spec.elements.root.children[0];
    expect(spec.elements[dialogKey].type).toBe("AlertDialog");
    const triggerKey = spec.elements[dialogKey].children[0];
    expect(spec.elements[triggerKey].type).toBe("AlertDialogTrigger");
    const buttonKey = spec.elements[triggerKey].children[0];
    expect(spec.elements[buttonKey].type).toBe("Button");
    expect(spec.elements[buttonKey].props).toMatchObject({ variant: "destructive", text: "Delete account" });
  });

  it("sub-components are first-class elements with their text carried verbatim", () => {
    const title = Object.values(spec.elements).find((e) => e.type === "AlertDialogTitle")!;
    expect(title.props.text).toBe("Delete your account?");
    const cancel = Object.values(spec.elements).find((e) => e.type === "AlertDialogCancel")!;
    expect(cancel.props.text).toBe("Cancel");
  });

  it("emits no flattening/synthesis warnings for a slot-free compound surface", () => {
    expect(warnings).toEqual([]);
  });

  it("every element satisfies json-render's element shape (children keys resolve, visible present)", () => {
    for (const element of Object.values(spec.elements)) {
      expect(element.visible).toBe(true);
      for (const child of element.children) expect(spec.elements[child]).toBeDefined();
    }
  });

  it("is deterministic", () => {
    expect(emitJsonRenderSpec(workedExample.surface, doc)).toEqual(
      emitJsonRenderSpec(workedExample.surface, doc),
    );
  });
});

describe("emitJsonRenderSpec: honesty of the recorded projections", () => {
  it("rejects unknown components with a typed error", () => {
    const surface = structuredClone(workedExample.surface);
    surface.root.children![0].component = "not-a-component";
    expect(() => emitJsonRenderSpec(surface, doc)).toThrow(EmitJsonRenderError);
  });

  it("drops handler props with a warning (declarative-catalog boundary)", () => {
    const surface = structuredClone(workedExample.surface);
    surface.root.children![0].props = { onOpenChange: "noop" };
    const { spec, warnings } = emitJsonRenderSpec(surface, doc);
    const dialog = Object.values(spec.elements).find((e) => e.type === "AlertDialog")!;
    expect(dialog.props.onOpenChange).toBeUndefined();
    expect(warnings.map((w) => w.code)).toContain("jr-prop-dropped");
  });

  it("flattens slotted children into child order with a warning (slot names are not representable)", () => {
    const badge: SurfaceNode = { component: "badge", text: "beta" };
    const surface: DspackSurface = {
      dspackSurface: "0.1",
      system: doc.name,
      intent: "destructive-action",
      root: { component: "card", children: [{ component: "button", text: "b" }], slots: { footer: [badge] } },
    };
    const { spec, warnings } = emitJsonRenderSpec(surface, doc);
    expect(spec.elements.root.children.map((k) => spec.elements[k].type)).toEqual(["Button", "Badge"]);
    expect(warnings.map((w) => w.code)).toContain("jr-slot-names-flattened");
  });

  it("the offline model check is non-vacuous (bad enum value, dangling child, unknown type all found)", () => {
    const model = buildCatalogModel(doc, shadcnJsonRenderProfile);
    const { spec } = emitJsonRenderSpec(workedExample.surface, doc);
    const bad = structuredClone(spec);
    const buttonKey = Object.keys(bad.elements).find((k) => bad.elements[k].type === "Button")!;
    bad.elements[buttonKey].props.variant = "not-a-variant";
    bad.elements[buttonKey].children.push("dangling");
    bad.elements.rogue = { type: "Rogue", props: {}, children: [], visible: true };
    const messages = validateSpecAgainstModel(bad, model).map((f) => f.message);
    expect(messages.some((m) => m.includes("not in enum vocabulary"))).toBe(true);
    expect(messages.some((m) => m.includes("'dangling' not found"))).toBe(true);
    expect(messages.some((m) => m.includes("unknown component type 'Rogue'"))).toBe(true);
  });
});

describe("codegen: generated modules match the reviewed goldens", () => {
  // The goldens are the hand-review artifact for the generated code: any
  // change to what the codegen emits shows up as a reviewable diff here.
  const { catalogTs, registryTsx, model } = generateJsonRenderModules(doc);

  it("catalog.ts equals golden", () => {
    expect(catalogTs).toBe(readFileSync("golden/json-render/catalog.ts.golden", "utf8"));
  });

  it("registry.tsx equals golden", () => {
    expect(registryTsx).toBe(readFileSync("golden/json-render/registry.tsx.golden", "utf8"));
  });

  it("catalogs the full contract vocabulary: components + sub-components, 1:1", () => {
    const contractIds = Object.entries(doc.components ?? {}).flatMap(([id, c]) => [
      id,
      ...(((c as { composition?: { subComponents?: Array<{ id: string }> } }).composition?.subComponents) ?? []).map(
        (s) => s.id,
      ),
    ]);
    expect(model.components.map((c) => c.dspackId)).toEqual(contractIds);
  });

  it("excludes exactly the handler props, with reasons recorded", () => {
    const excluded = model.components.flatMap((c) => c.excludedProps.map((e) => `${c.dspackId}.${e.name}`));
    expect(excluded).toEqual(["alert-dialog.onOpenChange", "dialog.onOpenChange", "dropdown-menu.onOpenChange"]);
  });
});
