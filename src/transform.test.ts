import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toHex6, hslToHex } from "./transform/color.js";
import { transform } from "./transform/index.js";
import { validateCatalog } from "./validate/ajv.js";
import type { DspackDoc } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;
const surface = JSON.parse(readFileSync(repo("surface/settings-card.surface.json"), "utf8"));

describe("color synthesis", () => {
  it("converts the shadcn primary HSL to the expected hex", () => {
    expect(toHex6("hsl(222.2, 47.4%, 11.2%)")).toBe("#0f172a");
  });
  it("passes hex through and expands shorthand", () => {
    expect(toHex6("#00BFFF")).toBe("#00bfff");
    expect(toHex6("#abc")).toBe("#aabbcc");
  });
  it("returns null for unconvertible values", () => {
    expect(toHex6("calc(0.5rem - 4px)")).toBeNull();
  });
  it("hslToHex handles primary/secondary hues", () => {
    expect(hslToHex(0, 0, 100)).toBe("#ffffff");
    expect(hslToHex(0, 0, 0)).toBe("#000000");
  });
});

describe("profile mapping", () => {
  const { catalog, mapping } = transform(doc, "0.9.1", surface);
  it("emits the expected component set", () => {
    expect(Object.keys(catalog.components)).toEqual([
      "Button",
      "Card",
      "TextField",
      "Badge",
      "Table",
      "AlertDialog",
      "Text",
      "Column",
    ]);
  });
  it("projects the 6 shadcn Button variants onto 3 A2UI variants (lossy)", () => {
    const variant = (catalog.components.Button as any).allOf.at(-1).properties.variant;
    expect(variant.enum).toEqual(["default", "primary", "borderless"]);
    expect(variant["x-dspack-source"].sourceEnum).toHaveLength(6);
    const lossy = mapping.fidelity.find(
      (f) => f.source === "components.button.props.variant",
    );
    expect(lossy?.class).toBe("lossy");
  });
  it("records dialog/dropdown-menu as cannot-represent casualties", () => {
    for (const id of ["dialog", "dropdown-menu"]) {
      const f = mapping.fidelity.find((e) => e.source === `components.${id}`);
      expect(f?.class).toBe("cannot-represent");
    }
  });
  it("emits Table/Badge/AlertDialog but records their composition loss as a casualty", () => {
    // alert-dialog is now emitted as a component, yet its dspack composition cannot survive.
    const composition = mapping.fidelity.find(
      (e) => e.source === "components.alert-dialog.composition",
    );
    expect(composition?.class).toBe("cannot-represent");
  });
  it("warns about the unsupported dspack knowledge layer", () => {
    const codes = mapping.warnings.map((w) => w.code);
    expect(codes).toContain("unsupported-section:patterns");
    expect(codes).toContain("unsupported-section:antiPatterns");
  });
});

describe("validation gates", () => {
  it("passes all three gates for both emitted versions", () => {
    for (const v of ["0.9.1", "1.0"] as const) {
      const { validation } = transform(doc, v, surface);
      expect(validation.pass, `v${v} should pass`).toBe(true);
      expect(validation.gates.map((g) => g.name)).toEqual([
        "schema-compile + no-external-ref",
        "catalog-shape",
        "instance",
      ]);
    }
  });

  it("the instance gate is not vacuous: rejects an invalid Button instance", () => {
    const { catalog } = transform(doc, "0.9.1", surface);
    const bad = {
      messages: [
        {
          updateComponents: {
            components: [
              // invalid enum value + missing required `action`
              { id: "b", component: "Button", child: "x", variant: "destructive" },
            ],
          },
        },
      ],
    };
    const report = validateCatalog(catalog, "0.9.1", bad);
    const instance = report.gates.find((g) => g.name === "instance")!;
    expect(instance.pass).toBe(false);
    expect(report.pass).toBe(false);
  });

  it("the catalog-shape gate is version-distinct (a v1.0 catalog fails the v0.9.1 meta-schema)", () => {
    const { catalog: v1 } = transform(doc, "1.0", surface);
    const asNineOne = validateCatalog(v1, "0.9.1");
    const shape = asNineOne.gates.find((g) => g.name === "catalog-shape")!;
    expect(shape.pass).toBe(false);
  });
});
