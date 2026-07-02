/**
 * PR-2 acceptance gates: the dspack surface → A2UI surface emitter.
 *
 * - The contract's worked example (ex.delete-account-confirmation) emits a
 *   surface whose instances pass all emitter gates (A1 schema-compile /
 *   A2 catalog-shape / A3 instance) against the freshly generated catalog,
 *   for both A2UI versions.
 * - Compound flattening lands the documented projection (title/description/
 *   cancelLabel/confirmLabel/triggerLabel + synthesized action).
 * - Unknown components fail with a typed error (never silently dropped).
 * - A CSR violating the emitted component's required props FAILS gate A3 —
 *   the gate is proven non-vacuous.
 * - Emission is deterministic.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DspackDoc, DspackSurface, Json } from "./types.js";
import { transform } from "./transform/index.js";
import { emitSurface, EmitSurfaceError } from "./targets/a2ui/surface.js";

const doc = JSON.parse(readFileSync("input/shadcn-ui.dspack.json", "utf8")) as DspackDoc & {
  examples: Array<{ id: string; surface: DspackSurface }>;
};
const workedExample = doc.examples.find((e) => e.id === "ex.delete-account-confirmation")!;

function componentsOf(messages: Json[]): Json[] {
  const update = messages.find((m) => m.updateComponents) as Json;
  return (update.updateComponents as Json).components as Json[];
}

describe("emitSurface: worked example (ex.delete-account-confirmation)", () => {
  const { messages, warnings } = emitSurface(workedExample.surface, doc);
  const components = componentsOf(messages);

  it("emits createSurface with the versioned catalogId and dspack-token theme", () => {
    const create = (messages[0].createSurface ?? {}) as Json;
    expect(create.catalogId).toBe("https://rdombrowski.dev/catalogs/shadcn-ui/v0_9_1/catalog.json");
    expect((create.theme as Json).primaryColor).toBe("#0f172a");
  });

  it("flattens the AlertDialog compound per the documented casualty mapping", () => {
    const dialog = components.find((c) => c.component === "AlertDialog")!;
    expect(dialog).toMatchObject({
      triggerLabel: "Delete account",
      title: "Delete your account?",
      cancelLabel: "Cancel",
      confirmLabel: "Delete account",
    });
    expect(String(dialog.description)).toMatch(/permanently delete/);
    expect(dialog.action).toEqual({ event: { name: "delete_account", context: {} } });
  });

  it("projects Card onto its single-child slot", () => {
    const card = components.find((c) => c.component === "Card")!;
    const dialog = components.find((c) => c.component === "AlertDialog")!;
    expect(card.child).toBe(dialog.id);
    expect(components[0]).toBe(card); // root first (pre-order)
  });

  it("passes gates A1–A3 against both generated catalogs", () => {
    for (const version of ["0.9.1", "1.0"] as const) {
      const { validation } = transform(doc, version, { messages });
      const gates = Object.fromEntries(validation.gates.map((g) => [g.name, g.pass]));
      expect(gates, `gates for ${version}`).toEqual({
        "schema-compile + no-external-ref": true,
        "catalog-shape": true,
        instance: true,
      });
    }
  });

  it("records every synthesis as a warning — nothing silent", () => {
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("surface-synthesized-action");
    expect(codes).toContain("surface-composition-flattened");
  });

  it("is deterministic", () => {
    const again = emitSurface(workedExample.surface, doc);
    expect(again.messages).toEqual(messages);
  });
});

describe("emitSurface: general projection", () => {
  const settingsLike: DspackSurface = {
    dspackSurface: "0.1",
    system: "shadcn/ui",
    intent: "destructive-action",
    root: {
      component: "card",
      children: [
        { component: "input", id: "email_field", props: { type: "email" }, text: "Email address" },
        { component: "button", id: "save_btn", props: { variant: "default" }, text: "Save changes" },
      ],
    },
  };

  it("wraps multiple card children in a synthesized Column and buttons get Text children", () => {
    const { messages } = emitSurface(settingsLike, doc);
    const components = componentsOf(messages);
    const card = components.find((c) => c.component === "Card")!;
    const column = components.find((c) => c.component === "Column")!;
    expect(card.child).toBe(column.id);
    expect(column.children).toEqual(["email_field", "save_btn"]);

    const field = components.find((c) => c.id === "email_field")!;
    expect(field.component).toBe("TextField");
    expect(field.variant).toBe("shortText"); // email -> shortText projection
    expect(field.label).toBe("Email address");

    const button = components.find((c) => c.id === "save_btn")!;
    expect(button.variant).toBe("primary"); // default -> primary projection
    const label = components.find((c) => c.id === button.child)!;
    expect(label.component).toBe("Text");
    expect(label.text).toBe("Save changes");
    expect(button.action).toEqual({ event: { name: "save_btn", context: {} } });

    const { validation } = transform(doc, "0.9.1", { messages });
    expect(validation.pass).toBe(true);
  });
});

describe("emitSurface: failure modes", () => {
  it("throws a typed error on unknown components", () => {
    const bad: DspackSurface = {
      dspackSurface: "0.1",
      system: "shadcn/ui",
      intent: "destructive-action",
      root: { component: "carousel" },
    };
    expect(() => emitSurface(bad, doc)).toThrowError(EmitSurfaceError);
    expect(() => emitSurface(bad, doc)).toThrowError(/unknown component 'carousel'/);
  });

  it("throws a typed error on a system/contract mismatch", () => {
    const bad = { ...workedExample.surface, system: "someone-elses-system" };
    expect(() => emitSurface(bad, doc)).toThrowError(/does not match contract name/);
  });

  it("gate A3 is non-vacuous: an AlertDialog missing its title fails instance validation", () => {
    const missingTitle: DspackSurface = {
      dspackSurface: "0.1",
      system: "shadcn/ui",
      intent: "destructive-action",
      root: {
        component: "alert-dialog",
        children: [
          {
            component: "alert-dialog-trigger",
            children: [{ component: "button", props: { variant: "destructive" }, text: "Delete" }],
          },
          {
            component: "alert-dialog-content",
            children: [
              { component: "alert-dialog-footer", children: [{ component: "alert-dialog-cancel", text: "Cancel" }] },
            ],
          },
        ],
      },
    };
    const { messages } = emitSurface(missingTitle, doc);
    const { validation } = transform(doc, "0.9.1", { messages });
    const instance = validation.gates.find((g) => g.name === "instance")!;
    expect(instance.pass).toBe(false);
    expect((instance.errors ?? []).join("\n")).toMatch(/title/);
  });
});
