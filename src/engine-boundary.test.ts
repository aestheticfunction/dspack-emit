/**
 * Desugaring is the ONLY compatibility boundary.
 *
 * The refactor's value is that the engine reads primitives, not directive
 * names. That property decays silently: the next person to fix a v1 edge case
 * can reach for `plan.surfacePlan.subTable` inside the emitter, everything
 * passes, and the boundary is gone without anyone noticing. So assert it
 * structurally — the engine source must not name a legacy directive at all.
 *
 * Plus focused behavioural coverage of the transformations the byte-gate's
 * artifact digests exercise but do not EXPLAIN: when a digest moves, these say
 * which rule broke.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emitSurface } from "./targets/a2ui/surface.js";
import { Band, compareKeys, Diagnostics, Phase } from "./targets/a2ui/diagnostics.js";
import { shadcnProfile } from "./transform/profiles.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const doc = JSON.parse(readFileSync(repo("input/shadcn-ui.dspack.json"), "utf8")) as DspackDoc;
const src = (p: string) => readFileSync(repo(p), "utf8");

/** Every v1 directive name. The engine may not mention any of them. */
const LEGACY_DIRECTIVES = [
  "subText",
  "subButtonText",
  "actionProp",
  "textChildProp",
  "textProp",
  "childProp",
  "childrenProp",
  "structuralPassthrough",
  "subTable",
  "subFlatten",
];

const surface = (root: unknown, intent = "record-collection"): DspackSurface =>
  ({ dspackSurface: "0.1", system: doc.name as string, intent, root }) as DspackSurface;

const emit = (root: unknown, intent?: string) => emitSurface(surface(root, intent), doc, { profile: shadcnProfile });
const instances = (root: unknown, intent?: string) =>
  (emit(root, intent).messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
    .updateComponents.components;

describe("the engine reads only the internal model", () => {
  it.each(LEGACY_DIRECTIVES.map((d) => [d] as const))("the surface engine never mentions '%s'", (directive) => {
    const engine = src("src/targets/a2ui/surface.ts");
    // `surfacePlan` itself is the container; naming it would also be a leak.
    expect(engine).not.toContain(`.${directive}`);
    expect(engine).not.toContain(`"${directive}"`);
  });

  it("the surface engine never reaches into surfacePlan at all", () => {
    expect(src("src/targets/a2ui/surface.ts")).not.toContain("surfacePlan");
  });

  it("desugar.ts is where the directive names live — the boundary is somewhere", () => {
    const desugar = src("src/transform/desugar.ts");
    for (const directive of LEGACY_DIRECTIVES) expect(desugar).toContain(directive);
  });
});

describe("diagnostic ordering is declared, not emergent", () => {
  it("a parent's post-child diagnostics sort after its whole subtree", () => {
    const d = new Diagnostics();
    // Deliberately pushed out of order: the wrap (after children) first.
    d.push({ code: "wrap", message: "w" }, [], Band.AfterChildren, Phase.Wrap);
    d.push({ code: "child", message: "c" }, [Band.Children, 0], Band.BeforeChildren, Phase.PropMap);
    d.push({ code: "parent", message: "p" }, [], Band.BeforeChildren, Phase.IdAllocation);
    expect(d.ordered().map((w) => w.code)).toEqual(["parent", "child", "wrap"]);
  });

  it("children order by index, and deeper nodes sort inside their parent", () => {
    const d = new Diagnostics();
    d.push({ code: "child1", message: "" }, [Band.Children, 1], Band.BeforeChildren, Phase.PropMap);
    d.push({ code: "grandchild0", message: "" }, [Band.Children, 0, Band.Children, 0], Band.BeforeChildren, Phase.PropMap);
    d.push({ code: "child0", message: "" }, [Band.Children, 0], Band.BeforeChildren, Phase.IdAllocation);
    expect(d.ordered().map((w) => w.code)).toEqual(["child0", "grandchild0", "child1"]);
  });

  it("equal keys fall back to production order, never to chance", () => {
    const d = new Diagnostics();
    d.push({ code: "first", message: "" }, [], Band.BeforeChildren, Phase.PropMap);
    d.push({ code: "second", message: "" }, [], Band.BeforeChildren, Phase.PropMap);
    expect(d.ordered().map((w) => w.code)).toEqual(["first", "second"]);
  });

  it("compareKeys is a total order (shorter key sorts first on a prefix tie)", () => {
    expect(compareKeys([1, 2], [1, 2, 0])).toBeLessThan(0);
    expect(compareKeys([1, 3], [1, 2, 9])).toBeGreaterThan(0);
    expect(compareKeys([1, 2], [1, 2])).toBe(0);
  });
});

describe("transformations keep their meaning", () => {
  it("label fallback: a label-bearing component supplies the label", () => {
    const [dialog] = instances(
      {
        component: "alert-dialog",
        children: [
          { component: "alert-dialog-trigger", children: [{ component: "button", text: "Delete" }] },
          { component: "alert-dialog-content", children: [{ component: "alert-dialog-title", text: "Sure?" }] },
        ],
      },
      "destructive-action",
    );
    expect(dialog.triggerLabel).toBe("Delete");
  });

  it("label fallback: with no label-bearer the audited lift runs and is recorded", () => {
    const { messages, warnings } = emit(
      {
        component: "alert-dialog",
        children: [
          { component: "alert-dialog-trigger", text: "Remove" },
          { component: "alert-dialog-content", children: [{ component: "alert-dialog-title", text: "Sure?" }] },
        ],
      },
      "destructive-action",
    );
    const [dialog] = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(dialog.triggerLabel).toBe("Remove");
    expect(warnings.some((w) => w.code === "surface-label-lifted")).toBe(true);
  });

  it("consumption resolves in document order, not declaration order", () => {
    // The trigger precedes the content, so triggerLabel is written first.
    const [dialog] = instances(
      {
        component: "alert-dialog",
        children: [
          { component: "alert-dialog-trigger", children: [{ component: "button", text: "Delete" }] },
          { component: "alert-dialog-content", children: [{ component: "alert-dialog-title", text: "Sure?" }] },
        ],
      },
      "destructive-action",
    );
    expect(Object.keys(dialog)).toEqual(["id", "component", "triggerLabel", "title", "action"]);
  });

  it("first-write-wins: the first matching sub claims the destination", () => {
    const [dialog] = instances(
      {
        component: "alert-dialog",
        children: [
          { component: "alert-dialog-content", children: [
            { component: "alert-dialog-title", text: "First" },
            { component: "alert-dialog-title", text: "Second" },
          ] },
        ],
      },
      "destructive-action",
    );
    expect(dialog.title).toBe("First");
  });

  it("collection: rows become records, header cells become one flat column list", () => {
    const [table] = instances({
      component: "table",
      children: [
        { component: "table-header", children: [{ component: "table-row", children: [
          { component: "table-head", text: "A" }, { component: "table-head", text: "B" }] }] },
        { component: "table-body", children: [
          { component: "table-row", children: [{ component: "table-cell", text: "1" }, { component: "table-cell", text: "2" }] }] },
      ],
    });
    expect(table.columns).toEqual(["A", "B"]);
    expect(table.rows).toEqual([{ cells: ["1", "2"] }]);
  });

  it("collection: two header rows concatenate into one column list (v1 behaviour)", () => {
    const [table] = instances({
      component: "table",
      children: [
        { component: "table-header", children: [
          { component: "table-row", children: [{ component: "table-head", text: "A" }] },
          { component: "table-row", children: [{ component: "table-head", text: "B" }] },
        ] },
      ],
    });
    expect(table.columns).toEqual(["A", "B"]);
  });

  it("transparent grouping dissolves and its children rise in document order", () => {
    const emitted = instances({
      component: "card",
      children: [
        { component: "card-header", children: [{ component: "card-title", text: "Members" }] },
        { component: "card-content", text: "Three people." },
      ],
    });
    const texts = emitted.filter((c) => c.component === "Text").map((c) => c.text);
    expect(texts).toContain("Members");
    expect(texts).toContain("Three people.");
  });

  it("synthesized action: deterministic event name, and it is recorded", () => {
    const { messages, warnings } = emit({ component: "button", text: "Save changes" });
    const [button] = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(button.action).toEqual({ event: { name: "save_changes", context: {} } });
    expect(warnings.some((w) => w.code === "surface-synthesized-action")).toBe(true);
  });

  it("warning order across several transformations in one surface", () => {
    // A card whose sub-family flattens, containing a button that synthesizes
    // both a text child and an action, plus a second child forcing a wrap.
    const { warnings } = emit({
      component: "card",
      children: [
        { component: "card-header", children: [{ component: "card-title", text: "Actions" }] },
        { component: "button", text: "Save" },
        { component: "badge", text: "New" },
      ],
    });
    const codes = warnings.map((w) => w.code);
    // The child-list rewrite precedes any child's own diagnostics...
    expect(codes.indexOf("surface-sub-flattened")).toBeLessThan(codes.indexOf("surface-synthesized-action"));
    // ...and the wrap, which runs after every child, comes last.
    expect(codes[codes.length - 1]).toBe("surface-synthesized-wrap");
  });

  it("id allocation stays deterministic and records every collision", () => {
    const run = () =>
      emit({
        component: "card",
        children: [
          { component: "badge", id: "tag", text: "One" },
          { component: "badge", id: "tag", text: "Two" },
          { component: "badge", id: "tag", text: "Three" },
        ],
      });
    const a = run();
    const b = run();
    expect(JSON.stringify(a.messages)).toBe(JSON.stringify(b.messages));
    expect(JSON.stringify(a.warnings)).toBe(JSON.stringify(b.warnings));
    const ids = (a.messages[1] as { updateComponents: { components: Array<{ id: string }> } })
      .updateComponents.components.map((c) => c.id);
    expect(ids).toContain("tag");
    expect(ids).toContain("tag_2");
    expect(ids).toContain("tag_3");
    expect(a.warnings.filter((w) => w.code === "surface-id-deduplicated")).toHaveLength(2);
  });
});
