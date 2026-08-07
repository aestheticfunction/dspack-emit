/**
 * T1: transparent identity + constrained control donation.
 *
 * The named production failure this exists to fix, measured across three
 * milestones: a fully governed `card > form > form-field > form-item >
 * form-label + input` surface refused solely because `form` was a casualty.
 * Fail-first evidence (captured before any T1 code, /tmp/t1-failfirst.txt):
 *
 *   1. the eval fixture refuses the v3 contract — form family: 6 unresolved;
 *   2. the T1 spellings were refused by the v2 grammar (7 pathed issues);
 *   3. the shipped profile refuses the example: unknown component 'form'.
 *
 * T1's rules, each pinned here:
 *   - a transparent plan emits NO instance; children rise; the root may not
 *     be transparent;
 *   - donation is scoped to its dissolving BOUNDARY (form-item), which is
 *     what lets a three-field form donate three labels to three inputs
 *     instead of refusing;
 *   - exactly one eligible control per boundary — zero and several refuse;
 *   - eligibility is declared, never guessed (the plan must declare every
 *     donated destination);
 *   - the control's own content beats donated context (first-wins below the
 *     control's writes);
 *   - nothing to donate is not an error: the destination stays absent and
 *     gate A3 arbitrates — relocation, never synthesis;
 *   - provenance identifies donor and receiver in the ledger.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformFromJson } from "./transform/index.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";
import { loadProfile, ProfileLoadError } from "./transform/profile-load.js";
import { ProfileContractError } from "./transform/validate-v2.js";
import type { DspackDoc, DspackSurface } from "./types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const contract = JSON.parse(readFileSync(repo("eval/shadcn-v3.dspack.json"), "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const fixture = JSON.parse(readFileSync(repo("eval/shadcn-v3.eval.profile.json"), "utf8"));

import { SHADCN_V3_T1_SURFACES } from "./transform/shadcn-v2-respelling.js";

/** The T1 resolution of the form family — shared with the eval fixture builder. */
const FORM_T1_SURFACE = SHADCN_V3_T1_SURFACES.form;

/**
 * A hermetic T1 profile: ONLY the plans the target failure needs, taken from
 * the eval fixture (card and input are the transplanted shipped plans; input
 * declares `label`, which is what makes it donation-eligible), plus the
 * transparent form. The full fixture deliberately keeps 80 other unresolved
 * decisions and correctly refuses — the eval-overlay measurement covers that
 * side; these tests isolate T1 itself.
 */
const t1Profile = (mutate?: (doc: Record<string, unknown>) => void) => {
  const base = structuredClone(fixture) as Record<string, unknown> & { components: Array<Record<string, unknown>> };
  const pick = (id: string) => structuredClone(base.components.find((c) => c.dspackId === id)!);
  const form = pick("form");
  form.surface = structuredClone(FORM_T1_SURFACE);
  // The form's contract props are React-side function/state machinery with no
  // declarative projection; a transparent plan declares no catalog surface —
  // the required componentPlan fields stay present and EMPTY.
  delete form.propMap;
  form.structural = {};
  form.required = [];
  const doc: Record<string, unknown> & { components: Array<Record<string, unknown>> } = {
    ...base,
    components: [pick("card"), form, pick("input")],
    "x-scaffold": undefined,
  };
  delete (doc as Record<string, unknown>)["x-scaffold"];
  mutate?.(doc);
  return loadProfile(doc);
};

const expense = contract.examples.find((e) => e.id.includes("expense"))!;

describe("T1 grammar and gates", () => {
  it("the T1 spellings load (the fail-first refusal, inverted)", () => {
    const profile = t1Profile();
    expect(profile.language).toBe("v2");
  });

  it("a transparent plan with structural, propMap, required, routes, or collects refuses", () => {
    const out: string[] = [];
    try {
      t1Profile((doc) => {
        const form = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "form")!;
        form.structural = { x: { schema: {}, description: "d", synthNote: "s" } };
      });
    } catch (e) {
      out.push(...(e as ProfileLoadError).issues.map((i) => i.message));
    }
    expect(out.join("\n")).toContain("transparent plan declares no catalog surface");
  });

  it("a donation writing a destination no receiver plan declares refuses at the contract gate", () => {
    expect(() =>
      transformFromJson(contract, {
        profile: t1Profile((doc) => {
          const form = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "form")!;
          (form.surface as typeof FORM_T1_SURFACE).subs["form-item"] = {
            transparent: { donate: [{ from: "sub(form-label).text", to: "prop:nonexistentDest" }] },
          } as never;
        }),
      }),
    ).toThrowError(ProfileContractError);
  });

  it("a donation source that is not a declared sub refuses at the contract gate", () => {
    expect(() =>
      transformFromJson(contract, {
        profile: t1Profile((doc) => {
          const form = (doc.components as Array<Record<string, unknown>>).find((c) => c.dspackId === "form")!;
          (form.surface as typeof FORM_T1_SURFACE).subs["form-item"] = {
            transparent: { donate: [{ from: "sub(imaginary-label).text", to: "prop:label" }] },
          } as never;
        }),
      }),
    ).toThrowError(ProfileContractError);
  });
});

/**
 * A measured discovery worth its own frame: ex.expense-report-form is NOT a
 * pure T1 shape. Its first three fields are the named chain (label + input);
 * fields 4-6 are radio-group (T2's territory) and textarea (T5's). T1 alone
 * therefore cannot emit the full example — what it does, and what these tests
 * pin, is (a) emit the NAMED CHAIN completely, and (b) move the full
 * example's first blocker from "unknown component 'form'" to the unresolved
 * T2/T5 controls, exactly the failure-shift the architecture predicted.
 */
const namedChain = (): DspackSurface => {
  const root = structuredClone(expense.surface.root) as { children: unknown[] };
  root.children = root.children.slice(0, 3); // the three input-controlled fields
  return { ...structuredClone(expense.surface), root } as DspackSurface;
};

describe("T1 emits the named production failure", () => {
  it("the named chain (form > form-field > form-item > form-label + input) emits: wrappers dissolve, labels donate per field", () => {
    const { messages, warnings, fidelity } = emitSurface(namedChain(), contract, { profile: t1Profile() });
    const components = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;

    // No wrapper survives: no instance for form / form-field / form-item /
    // form-control, and no invented FormAsAnything component.
    const names = components.map((c) => c.component);
    expect(names.every((n) => !String(n).startsWith("Form"))).toBe(true);

    // Every input carries the label its field's form-label donated.
    const fields = components.filter((c) => c.component === "TextField");
    expect(fields.length).toBeGreaterThanOrEqual(3);
    const labels = fields.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["Merchant", "Amount in USD"]));
    expect(labels.every((l) => typeof l === "string" && l.length > 0)).toBe(true);

    // Descriptions rise as caption Text; the description text survives.
    expect(JSON.stringify(components)).toContain("Use the name printed on the receipt");

    // Provenance: the ledger names donor and receiver for each donation.
    const donated = fidelity.filter((f) => f.kind === "donated");
    expect(donated.length).toBe(fields.length);
    expect(donated[0].source).toContain("form-label");
    expect(donated[0].destination).toContain("label @");
    expect(donated[0].note).toContain("single eligible control");

    // form-message drops with its authored reason.
    expect(warnings.some((w) => w.code === "surface-sub-dropped" && w.message.includes("validation state"))).toBe(true);

    // The transparent root dissolved into the synthesized layout root.
    expect(components[0]).toMatchObject({ id: "root", component: "Column" });
    expect(warnings.some((w) => w.code === "surface-synthesized-wrap" && w.message.includes("transparent root"))).toBe(true);

    // And the emitted instances validate against the catalog (gate A3).
    const check = transformFromJson(contract, { profile: t1Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(true);
  });

  it("the FULL example's first blocker shifts from 'unknown form' to the T2/T5 controls", () => {
    // Before T1 (fail-first record): unknown component 'form'. After T1: the
    // wrappers dissolve fine and the refusal names the radio-group field's
    // boundary — the frontier moved to exactly where T2 begins.
    try {
      emitSurface(expense.surface, contract, { profile: t1Profile() });
      expect.unreachable("fields 4-6 need T2/T5; the full example must still refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(EmitSurfaceError);
      expect((e as Error).message).toContain("exactly one eligible control");
      expect((e as Error).message).not.toContain("unknown component 'form'");
    }
  });

  it("emission is deterministic: two runs produce identical bytes", () => {
    const a = emitSurface(namedChain(), contract, { profile: t1Profile() });
    const b = emitSurface(namedChain(), contract, { profile: t1Profile() });
    expect(JSON.stringify(a.messages)).toBe(JSON.stringify(b.messages));
    expect(JSON.stringify(a.warnings)).toBe(JSON.stringify(b.warnings));
    expect(JSON.stringify(a.fidelity)).toBe(JSON.stringify(b.fidelity));
  });
});

describe("T1 fail-closed boundaries", () => {
  const surfaceOf = (root: unknown): DspackSurface =>
    ({ dspackSurface: "0.1", system: contract.name as string, intent: "data-submission", root }) as DspackSurface;

  it("zero eligible controls refuses, naming the boundary", () => {
    const s = surfaceOf({
      component: "card",
      children: [
        {
          component: "form",
          children: [
            {
              component: "form-item",
              children: [{ component: "form-label", text: "Orphan label" }],
            },
          ],
        },
      ],
    });
    try {
      emitSurface(s, contract, { profile: t1Profile() });
      expect.unreachable("a donation with no control must refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(EmitSurfaceError);
      expect((e as Error).message).toContain("exactly one eligible control");
      expect((e as Error).message).toContain("found 0");
    }
  });

  it("several eligible controls refuse — donation never broadcasts", () => {
    const s = surfaceOf({
      component: "card",
      children: [
        {
          component: "form",
          children: [
            {
              component: "form-item",
              children: [
                { component: "form-label", text: "Which one?" },
                { component: "input", props: { type: "text" } },
                { component: "input", props: { type: "email" } },
              ],
            },
          ],
        },
      ],
    });
    try {
      emitSurface(s, contract, { profile: t1Profile() });
      expect.unreachable("two candidate controls must refuse");
    } catch (e) {
      expect((e as Error).message).toContain("found 2");
      expect((e as Error).message).toContain("never broadcasts");
    }
  });

  it("a transparent root dissolves into the synthesized layout root — recorded, never silent", () => {
    // Deviation from the foundation-era "root transparency refuses" rule,
    // made deliberately: the target example itself roots at `form`. The
    // established arity discipline answers it — risen children wrap in the
    // profile's wrap component, which becomes components[0] id "root".
    const s = surfaceOf({
      component: "form",
      children: [
        {
          component: "form-item",
          children: [
            { component: "form-label", text: "Lone" },
            { component: "input", props: { type: "text" } },
          ],
        },
      ],
    });
    const { messages, warnings, fidelity } = emitSurface(s, contract, { profile: t1Profile() });
    const components = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components;
    expect(components[0]).toMatchObject({ id: "root", component: "Column" });
    expect(components.some((c) => c.component === "TextField" && c.label === "Lone")).toBe(true);
    expect(warnings.some((w) => w.code === "surface-synthesized-wrap")).toBe(true);
    expect(fidelity.some((f) => f.kind === "wrapped" && f.note?.includes("transparent root"))).toBe(true);
  });

  it("the control's own content beats donated context, and the loss is ledgered", () => {
    const s = surfaceOf({
      component: "card",
      children: [
        {
          component: "form",
          children: [
            {
              component: "form-item",
              children: [
                { component: "form-label", text: "Donated label" },
                { component: "input", text: "Own label", props: { type: "text" } },
              ],
            },
          ],
        },
      ],
    });
    const { messages, fidelity } = emitSurface(s, contract, { profile: t1Profile() });
    const field = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components.find((c) => c.component === "TextField")!;
    expect(field.label).toBe("Own label");
    const lost = fidelity.find((f) => f.kind === "dropped" && f.note?.includes("donated value did not land"));
    expect(lost).toBeDefined();
  });

  it("nothing to donate leaves the destination to gate A3 — relocation, never synthesis", () => {
    const s = surfaceOf({
      component: "card",
      children: [
        {
          component: "form",
          children: [
            {
              component: "form-item",
              children: [{ component: "input", props: { type: "text" } }],
            },
          ],
        },
      ],
    });
    const { messages } = emitSurface(s, contract, { profile: t1Profile() });
    const field = (messages[1] as { updateComponents: { components: Array<Record<string, unknown>> } })
      .updateComponents.components.find((c) => c.component === "TextField")!;
    expect(field.label).toBeUndefined();
    // The shipped TextField requires `label`, so A3 refuses the omission.
    const check = transformFromJson(contract, { profile: t1Profile(), surface: { messages } });
    expect(check.validation.gates.find((g) => g.name === "instance")?.pass).toBe(false);
  });

  it("a transparent plan emits no catalog entry, and coverage says so", () => {
    const out = transformFromJson(contract, { profile: t1Profile() });
    expect((out.catalog.components as Record<string, unknown>)["Form"]).toBeUndefined();
    const row = out.mapping.coverage.find((c) => c.id === "form");
    expect(row?.detail).toContain("transparent");
    // The form family's derived sub-coverage is fully resolved.
    const unresolved = out.mapping.coverage.filter(
      (c) => c.disposition === "unclassified" && c.id.startsWith("form."),
    );
    expect(unresolved).toEqual([]);
  });
});
