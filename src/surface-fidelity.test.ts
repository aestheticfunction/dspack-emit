/**
 * The surface transformation ledger, and the strict gate over it.
 *
 * Every route, collect, projection, and synthesis reports what it DID —
 * source, destination, originating profile rule, kind, fidelity class. The
 * ledger is additive: messages and warnings stay byte-frozen (the byte gate
 * proves that separately); this file proves the ledger itself is complete,
 * ordered, and honest for each transformation the engine performs.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emitSurface } from "./targets/a2ui/surface.js";
import { shadcnProfile } from "./transform/profiles.js";
import type { DspackDoc, DspackSurface, SurfaceFidelityEntry } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;

const surface = (root: unknown, intent = "record-collection"): DspackSurface =>
  ({ dspackSurface: "0.1", system: doc.name as string, intent, root }) as DspackSurface;

const fidelityOf = (root: unknown, intent?: string): SurfaceFidelityEntry[] =>
  emitSurface(surface(root, intent), doc, { profile: shadcnProfile }).fidelity;

describe("every transformation reports itself", () => {
  it("propMap projection: clean, default-substituted, and dropped are distinguished", () => {
    const entries = fidelityOf({ component: "button", text: "Save", props: { variant: "default" } });
    // 'default' -> 'primary' is a valueMap HIT: projected, maps-cleanly.
    const projected = entries.find((e) => e.origin === "propMap.variant");
    expect(projected).toMatchObject({ kind: "projected", class: "maps-cleanly", destination: "variant" });

    const dropped = fidelityOf({ component: "button", text: "Save", props: { hovercolor: "red" } });
    expect(dropped.find((e) => e.source.includes("hovercolor"))).toMatchObject({
      kind: "dropped",
      class: "lossy",
      destination: "(discarded)",
    });
  });

  it("synthesized action and synthesized text child carry synthesis-defaults and their origin rule", () => {
    const entries = fidelityOf({ component: "button", text: "Save changes" });
    const action = entries.find((e) => e.kind === "synthesized" && e.destination === "action");
    expect(action).toMatchObject({ class: "synthesis-defaults", origin: "actionProp" });
    expect(action!.source).toContain("no source");
    const text = entries.find((e) => e.kind === "synthesized" && e.destination.includes("Text"));
    expect(text).toMatchObject({ class: "synthesis-defaults", origin: "surfaceSynthesis.textComponent" });
  });

  it("consuming a compound records each moved harvest, the lift, and one lossy flatten", () => {
    const entries = fidelityOf(
      {
        component: "alert-dialog",
        children: [
          { component: "alert-dialog-trigger", text: "Remove" },
          {
            component: "alert-dialog-content",
            children: [
              { component: "alert-dialog-title", text: "Sure?" },
              { component: "alert-dialog-description", text: "Gone forever." },
            ],
          },
        ],
      },
      "destructive-action",
    );
    const moved = entries.filter((e) => e.kind === "moved");
    expect(moved.map((e) => e.destination)).toEqual(expect.arrayContaining(["title", "description"]));
    // Source paths locate the harvested node, not just the compound.
    expect(moved.find((e) => e.destination === "title")!.source).toContain("alert-dialog-title");
    const lift = entries.find((e) => e.kind === "lifted");
    expect(lift).toMatchObject({ destination: "triggerLabel", class: "maps-cleanly" });
    expect(lift!.note).toContain("audited");
    const flatten = entries.filter((e) => e.kind === "flattened" && e.class === "lossy");
    expect(flatten).toHaveLength(1);
    expect(flatten[0].origin).toContain("subText");
  });

  it("collection records the gathered rows, per-cell flattening losses, and drops", () => {
    const entries = fidelityOf({
      component: "table",
      children: [
        { component: "table-caption", text: "Orders" },
        {
          component: "table-body",
          children: [
            {
              component: "table-row",
              children: [
                { component: "table-cell", children: [{ component: "badge", text: "Paid" }] },
                { component: "table-cell", text: "#1" },
              ],
            },
          ],
        },
        { component: "table-footer", text: "1 order" },
      ],
    });
    expect(entries.find((e) => e.destination === "rows")).toMatchObject({ kind: "moved", class: "maps-cleanly" });
    const cellFlatten = entries.find((e) => e.kind === "flattened" && e.source.includes("badge"));
    expect(cellFlatten).toMatchObject({ class: "lossy" });
    const footerDrop = entries.find((e) => e.kind === "dropped" && e.source.includes("table-footer"));
    expect(footerDrop).toMatchObject({ class: "lossy", origin: "drops.table-footer" });
    expect(footerDrop!.note).toContain("summary rows");
  });

  it("transparent grouping and the wrap both report; dedup reports as clean", () => {
    const entries = fidelityOf({
      component: "card",
      children: [
        { component: "card-header", children: [{ component: "card-title", text: "T" }] },
        { component: "badge", id: "b", text: "One" },
        { component: "badge", id: "b", text: "Two" },
      ],
    });
    expect(entries.find((e) => e.kind === "flattened" && e.source.includes("card-header"))).toMatchObject({
      class: "lossy",
      origin: "subs.card-header",
    });
    expect(entries.find((e) => e.kind === "wrapped")).toMatchObject({ class: "synthesis-defaults" });
    expect(entries.find((e) => e.kind === "deduplicated")).toMatchObject({ class: "maps-cleanly" });
  });

  it("the ledger is deterministic and ordered like the warnings", () => {
    const run = () =>
      fidelityOf({
        component: "card",
        children: [
          { component: "card-header", children: [{ component: "card-title", text: "T" }] },
          { component: "button", text: "Go" },
          { component: "badge", text: "New" },
        ],
      });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    const entries = run();
    // The wrap (after children) is last, exactly like its warning.
    expect(entries[entries.length - 1].kind).toBe("wrapped");
  });

  it("a clean emission reports maps-cleanly entries and nothing lossy", () => {
    const entries = fidelityOf({ component: "input", text: "Email" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.class === "maps-cleanly" || e.class === "synthesis-defaults")).toBe(true);
  });
});

describe("--strict-surface", () => {
  const cli = (args: string[]): { status: number; output: string } => {
    try {
      const out = execFileSync("npx", ["tsx", "src/cli.ts", ...args], {
        cwd: repo(""),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, output: out };
    } catch (e) {
      const err = e as { status: number; stdout?: string; stderr?: string };
      return { status: err.status, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };

  // A surface whose emission is lossy: a card whose transparent header dissolves.
  const SCRATCH = repo("node_modules/.zz-fidelity-scratch");
  const LOSSY = `${SCRATCH}/zz-lossy.dsurface.json`;
  const CLEAN = `${SCRATCH}/zz-clean.dsurface.json`;

  it("fails on configured classes with exit 5, naming each failing transformation", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(
      LOSSY,
      JSON.stringify(
        surface({
          component: "card",
          children: [{ component: "card-header", children: [{ component: "card-title", text: "T" }] }],
        }),
      ),
    );
    const strict = cli(["--in", "input/shadcn-ui.dspack.json", "--a2ui-version", "0.9.1", "--out", "node_modules/.zz-fidelity-scratch", "--emit-surface", "node_modules/.zz-fidelity-scratch/zz-lossy.dsurface.json", "--strict-surface"]);
    expect(strict.status).toBe(5);
    expect(strict.output).toContain("STRICT-SURFACE");
    expect(strict.output).toContain("[lossy]");
    expect(strict.output).toContain("subs.card-header");

    // Without the flag the same emission succeeds — loss is visible, not fatal.
    const loose = cli(["--in", "input/shadcn-ui.dspack.json", "--a2ui-version", "0.9.1", "--out", "node_modules/.zz-fidelity-scratch", "--emit-surface", "node_modules/.zz-fidelity-scratch/zz-lossy.dsurface.json"]);
    expect(loose.status).toBe(0);
    expect(loose.output).toContain("fidelity");
  });

  it("passes a clean surface, and the class set is configurable", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(CLEAN, JSON.stringify(surface({ component: "input", text: "Email" })));
    const strict = cli(["--in", "input/shadcn-ui.dspack.json", "--a2ui-version", "0.9.1", "--out", "node_modules/.zz-fidelity-scratch", "--emit-surface", "node_modules/.zz-fidelity-scratch/zz-clean.dsurface.json", "--strict-surface"]);
    expect(strict.status).toBe(0);
    expect(strict.output).toContain("PASS  strict-surface");

    // synthesis-defaults included -> a button's synthesized Text child and
    // action now fail it (input stays clean even then: textProp is a plain
    // move, which is exactly why the class set is worth configuring).
    const fs2 = require("node:fs") as typeof import("node:fs");
    fs2.writeFileSync(`${SCRATCH}/zz-synth.dsurface.json`, JSON.stringify(surface({ component: "button", text: "Go" })));
    const strictest = cli(["--in", "input/shadcn-ui.dspack.json", "--a2ui-version", "0.9.1", "--out", "node_modules/.zz-fidelity-scratch", "--emit-surface", "node_modules/.zz-fidelity-scratch/zz-synth.dsurface.json", "--strict-surface=lossy,synthesis-defaults"]);
    expect(strictest.status).toBe(5);
    expect(strictest.output).toContain("[synthesis-defaults]");

    // An unknown class is a usage error, not a silent no-op.
    const bad = cli(["--in", "input/shadcn-ui.dspack.json", "--a2ui-version", "0.9.1", "--out", "node_modules/.zz-fidelity-scratch", "--emit-surface", "node_modules/.zz-fidelity-scratch/zz-clean.dsurface.json", "--strict-surface=vibes"]);
    expect(bad.status).toBe(2);
    expect(bad.output).toContain("unknown fidelity class");
  });
});
