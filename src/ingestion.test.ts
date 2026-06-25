/**
 * Ingestion acceptance gates (Phase 2).
 *
 * These run the REAL transform (compiler) on dspack fixtures and feed the resulting catalog
 * JSON to the UNCHANGED ingestion adapter (demo/src/ingest). The acceptance boundary is:
 * recompiling a changed contract changes the renderer's accepted vocabulary, accepted props,
 * or accept/refuse behavior with NO edit to the adapter or registry (demo/src/ingest/*).
 * The transform + profile are the compiler and are expected to change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scrapeSchemaBehavior } from "@a2ui/web_core/v0_9";
import { transformFromJson } from "./transform/index.js";
import { shadcnProfile, type Profile, type ComponentPlan } from "./transform/profiles.js";
import type { DspackDoc } from "./types.js";
import { buildComponentApi } from "../demo/src/ingest/buildComponentApi";
import { planRegistry } from "../demo/src/ingest/classify";
import { registry } from "../demo/src/ingest/registry";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as DspackDoc;

// The canonical input now includes the `table` component (the updated contract).
const doc = load(repo("input/shadcn-ui.dspack.json"));

const names = (cat: any): string[] => Object.keys(cat.components ?? {});

/** The shadcn profile with the Table mapping removed (Table is neither mapped nor a casualty). */
const tableLessProfile: Profile = {
  ...shadcnProfile,
  components: shadcnProfile.components.filter((c) => c.a2ui !== "Table"),
};

/** A profile that maps dropdown-menu to a component the registry has NO visual for. */
const DROPDOWN_PLAN: ComponentPlan = {
  a2ui: "DropdownMenu",
  dspackId: "dropdown-menu",
  commons: ["ComponentCommon"],
  structural: {
    triggerLabel: {
      schema: { $ref: "#/$defs/DynamicString" },
      description: "Trigger label.",
      synthNote: "synth",
    },
  },
  required: ["triggerLabel"],
};
const dropdownProfile: Profile = {
  ...shadcnProfile,
  components: [...shadcnProfile.components, DROPDOWN_PLAN],
  casualtyComponents: shadcnProfile.casualtyComponents.filter((c) => c.dspackId !== "dropdown-menu"),
};

describe("Gate A — vocabulary is catalog-driven (no adapter edit)", () => {
  it("mapping Table in the compiled contract adds it to the renderer's accepted vocabulary", () => {
    const withTable = transformFromJson(doc, { profile: shadcnProfile }).catalog;
    const withoutTable = transformFromJson(doc, { profile: tableLessProfile }).catalog;

    const added = names(withTable).filter((n) => !names(withoutTable).includes(n));
    expect(added).toEqual(["Table"]);
    // The adapter builds a real ComponentApi for the new name with zero adapter changes.
    expect(buildComponentApi(withTable, "Table").name).toBe("Table");
  });
});

describe("Gate B — accepted props are catalog-driven (no adapter edit)", () => {
  it("adding a Button variant in the contract makes the ingested schema accept it", () => {
    const base = transformFromJson(doc, { profile: shadcnProfile }).catalog;

    const modProfile: Profile = structuredClone(shadcnProfile);
    const button = modProfile.components.find((c) => c.a2ui === "Button")!;
    button.propMap!.variant.targetEnum = [...button.propMap!.variant.targetEnum!, "subtle"];
    const mod = transformFromJson(doc, { profile: modProfile }).catalog;

    const validProps = { child: "lbl", action: { event: { name: "save", context: {} } }, variant: "subtle" };
    expect(buildComponentApi(base, "Button").schema.safeParse(validProps).success).toBe(false);
    expect(buildComponentApi(mod, "Button").schema.safeParse(validProps).success).toBe(true);
  });
});

describe("Gate C — refusal vs unimplemented are distinct and non-silent", () => {
  it("a catalog name without a visual is 'unimplemented'; a name absent from the catalog is refused", () => {
    const cat = transformFromJson(doc, { profile: dropdownProfile }).catalog;
    const plan = planRegistry(names(cat), registry);

    // DropdownMenu is in the catalog (accepted vocabulary) but has no registered visual.
    expect(plan.unimplemented).toContain("DropdownMenu");
    // Reused basics and hand-authored visuals are not flagged unimplemented.
    expect(plan.reuseBasic).toEqual(expect.arrayContaining(["Button", "Card", "TextField"]));
    expect(plan.custom).toEqual(expect.arrayContaining(["Table", "Badge", "AlertDialog"]));
    // A name absent from the catalog is a different state: the renderer refuses it (Unknown).
    expect(names(cat)).not.toContain("Nonexistent");
  });

  it("the default catalog has no unimplemented components (all have a visual)", () => {
    const base = transformFromJson(doc, { profile: shadcnProfile }).catalog;
    expect(planRegistry(names(base), registry).unimplemented).toEqual([]);
  });
});

describe("Binding fidelity — the linchpin", () => {
  const cat = transformFromJson(doc, { profile: shadcnProfile }).catalog;
  const shapeOf = (name: string) => (scrapeSchemaBehavior(buildComponentApi(cat, name).schema) as any).shape;

  it("dynamic, action, child-list, and checkable props are recognized by scrapeSchemaBehavior", () => {
    const tf = shapeOf("TextField");
    expect(tf.value.type).toBe("DYNAMIC");
    expect(tf.label.type).toBe("DYNAMIC");
    expect(tf.variant.type).toBe("STATIC");

    const btn = shapeOf("Button");
    expect(btn.action.type).toBe("ACTION");
    expect(btn.checks.type).toBe("CHECKABLE");

    const col = shapeOf("Column");
    expect(col.children.type).toBe("STRUCTURAL");
  });
});

describe("Tier independence — Tier 1 works with no x-a2ui hints", () => {
  it("stripping all x-a2ui keys leaves binding + enum classification intact", () => {
    const cat = transformFromJson(doc, { profile: shadcnProfile }).catalog;
    const stripped = JSON.parse(
      JSON.stringify(cat, (k, v) => (k.startsWith("x-a2ui") ? undefined : v)),
    );
    const tf = (scrapeSchemaBehavior(buildComponentApi(stripped, "TextField").schema) as any).shape;
    expect(tf.value.type).toBe("DYNAMIC");
    const btnVariant = buildComponentApi(stripped, "Button").schema;
    expect(btnVariant.safeParse({ child: "x", action: { event: { name: "e", context: {} } }, variant: "primary" }).success).toBe(true);
  });
});

describe("Coverage — no silent drops (P1)", () => {
  it("an unmapped dspack component is reported as unclassified, not silently dropped", () => {
    // A profile that does not map `table` (and doesn't list it a casualty) must still account for it.
    const r = transformFromJson(doc, { profile: tableLessProfile });
    const cov = r.mapping.coverage.find((c) => c.id === "table");
    expect(cov?.disposition).toBe("unclassified");
    expect(r.mapping.warnings.map((w) => w.code)).toContain("unclassified-component:table");
    // ...and it is NOT silently present in the emitted catalog.
    expect(names(r.catalog)).not.toContain("Table");
  });
});

describe("Negative control — the adapter has no hardcoded component-name list", () => {
  it("buildComponentApi and buildCatalog name no components", () => {
    for (const file of ["buildComponentApi.ts", "buildCatalog.tsx"]) {
      const src = readFileSync(repo(`demo/src/ingest/${file}`), "utf8");
      for (const name of ["Button", "TextField", "Table", "Card", "Column"]) {
        expect(src.includes(`"${name}"`), `${file} must not name component '${name}'`).toBe(false);
        expect(src.includes(`'${name}'`), `${file} must not name component '${name}'`).toBe(false);
      }
    }
  });
});
