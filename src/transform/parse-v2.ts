/**
 * Profile v2 surface syntax → the internal transformation model.
 *
 * v2 is the first profile language that authors the internal model DIRECTLY:
 * where v1 accumulated ten directives named after collisions (`subText`,
 * `subButtonText`, `subTable`, …), a v2 plan writes Identity / Route / Collect
 * facts in a closed string syntax. This module parses that syntax, derives the
 * things v1 made authors imply (write order, subtree consumption), and REFUSES
 * everything else — a v2 plan that parses is a plan the engine can emit.
 *
 * The grammar is deliberately closed. Selectors and destinations are fixed
 * string forms with two parameterized holes (a prop name, a sub-component id
 * set); there is no expression language, no JSON paths, no predicates, no
 * computed destination names, and no cross-instance routing. Those absences
 * are the design: a plan you cannot write is a plan nobody has to audit.
 *
 * Capability note: v2 in this foundation expresses exactly the transformation
 * surface the engine has today — the v1 semantic surface, respelled. The
 * grammar refuses spellings whose engine support has not landed (plan-level
 * `transparent` identity, `onto` donation, `joinOn` pairing, multi-slot
 * children routing). Each arrives with its capability class (T1–T5), as an
 * addition to this grammar, never as a reinterpretation of it.
 */
import type { ComponentPlan } from "./profiles.js";
import {
  WriteOrder,
  emptySurfaceModel,
  type Collect,
  type Destination,
  type Route,
  type Selector,
  type SurfaceModel,
} from "./model.js";

/** One pathed finding; parse-v2 refusals reuse the loader's issue shape. */
export interface ParseIssue {
  path: string;
  message: string;
}

export class ProfileParseError extends Error {
  constructor(readonly issues: ParseIssue[]) {
    super(
      `profile v2 surface syntax is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}): ` +
        issues
          .slice(0, 3)
          .map((i) => `${i.path || "$"}: ${i.message}`)
          .join("; ") +
        (issues.length > 3 ? "; …" : ""),
    );
    this.name = "ProfileParseError";
  }
}

// ---------------------------------------------------------------------------
// The authored v2 shapes (what the JSON schema admits)
// ---------------------------------------------------------------------------

export interface SurfaceV2Route {
  /** Ordered fallback chain; the first selector that yields a value wins. */
  from: string[];
  to: string;
  overwrite?: boolean;
}

export interface SurfaceV2Collect {
  /** Sections: direct children that open the collection. */
  of: string[];
  /** Array-valued destination (`prop:<name>`). */
  into: string;
  /** `flat`: all rows concatenate into one list. `records`: one record per row. */
  shape: "flat" | "records";
  /** Record field carrying each row's cells; required when shape is `records`. */
  field?: string;
  /** Repetitions inside a section. */
  row: string[];
  /** Cells inside a repetition, flattened to their subtree text. */
  cells: string[];
}

export type SurfaceV2Sub = "transparent" | { asText: string } | { drop: string };

export interface SurfaceV2 {
  routes?: SurfaceV2Route[];
  collects?: SurfaceV2Collect[];
  /** Identity or disposition of named sub-components met in this node's subtree. */
  subs?: Record<string, SurfaceV2Sub>;
}

// ---------------------------------------------------------------------------
// Selector / destination string grammar
// ---------------------------------------------------------------------------

const ID = "[a-z][a-z0-9-]*";
const PROP = "[A-Za-z][A-Za-z0-9]*";
const SELECTOR = new RegExp(
  `^(self\\.text|self\\.props\\.(${PROP})|sub\\((${ID}(?:\\|${ID})*)\\)\\.(text|label|firstText|subtreeText)|children|synthesized\\.action)$`,
);
const DESTINATION = new RegExp(`^(prop|textChild|slot|slots|action):(${PROP})$`);

export function parseSelector(raw: string): Selector | null {
  const m = SELECTOR.exec(raw);
  if (!m) return null;
  if (m[1] === "self.text") return { kind: "self-text" };
  if (m[1] === "children") return { kind: "children" };
  if (m[1] === "synthesized.action") return { kind: "synthesized-action" };
  if (m[2]) return { kind: "self-prop", prop: m[2] };
  const subs = m[3].split("|");
  switch (m[4]) {
    case "text":
      return { kind: "sub-text", subs };
    case "label":
      return { kind: "sub-label", subs };
    case "firstText":
      return { kind: "sub-text-lift", subs };
    default:
      return { kind: "subtree-text", subs };
  }
}

export function parseDestination(raw: string): Destination | null {
  const m = DESTINATION.exec(raw);
  if (!m) return null;
  const name = m[2];
  switch (m[1]) {
    case "prop":
      return { kind: "prop", name };
    case "textChild":
      return { kind: "text-child", name };
    case "slot":
      return { kind: "slot", name };
    case "slots":
      return { kind: "slots", name };
    default:
      return { kind: "action", name };
  }
}

// ---------------------------------------------------------------------------
// Derived write order — v2 authors never write WriteOrder; it is a function
// of what the route reads and writes, reproducing v1's phase semantics.
// ---------------------------------------------------------------------------

function orderOfSelector(s: Selector, to: Destination): WriteOrder {
  switch (s.kind) {
    case "self-prop":
      return WriteOrder.Verbatim;
    case "sub-text":
    case "sub-label":
    case "sub-text-lift":
      return WriteOrder.Consume;
    case "subtree-text":
      return WriteOrder.CollectLead;
    case "self-text":
      return to.kind === "text-child" ? WriteOrder.SelfTextChild : WriteOrder.SelfText;
    case "synthesized-action":
      return WriteOrder.Action;
    case "children":
      return WriteOrder.Children;
  }
}

/** Selector-kind → destination-kind compatibility (closed, refused otherwise). */
function compatible(s: Selector, to: Destination): boolean {
  switch (s.kind) {
    case "children":
      return to.kind === "slot" || to.kind === "slots";
    case "synthesized-action":
      return to.kind === "action";
    case "self-text":
      return to.kind === "prop" || to.kind === "text-child";
    default:
      return to.kind === "prop";
  }
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/**
 * Parse and statically validate one plan's v2 surface block.
 *
 * `path` roots the pathed findings (e.g. `/components/3/surface`). Validation
 * here needs only the plan itself: destinations against its own declared
 * structural slots and propMap targets, conflict detection under the write
 * discipline, and grammar closure. Contract-facing checks (sub ids exist,
 * self-props are declared, derived coverage is complete) run at transform
 * time, where the contract is in hand — see validate-v2.ts.
 */
export function parseSurfaceV2(surface: SurfaceV2, plan: ComponentPlan, path: string): SurfaceModel {
  const issues: ParseIssue[] = [];
  const model = emptySurfaceModel();

  // The plan's own declared destination names: structural slots plus the
  // a2ui-side names its propMap writes. Gate A3 catches an OMITTED property
  // but silently passes an INVENTED one, so this is where invention dies.
  const declared = new Set<string>([
    ...Object.keys(plan.structural ?? {}),
    ...Object.values(plan.propMap ?? {}).map((p) => p.a2ui),
  ]);

  // Write-conflict detection under the declared discipline. Two writers on one
  // destination are LEGAL when they resolve in distinct write orders — the
  // outcome is then fully determined by order plus the overwrite flag (v1's
  // Table does exactly this: a passthrough prop wins over the collect harvest
  // because Verbatim runs first and later writers are first-wins). What is
  // refused is a SAME-order double-claim, where nothing but declaration order
  // would decide the winner — that is ambiguity, not layering.
  const claimed = new Map<string, Array<{ order: WriteOrder; by: string }>>();
  const claim = (name: string, order: WriteOrder, by: string, at: string): void => {
    const prior = claimed.get(name) ?? [];
    const clash = prior.find((c) => c.order === order);
    if (clash) {
      issues.push({
        path: at,
        message: `destination '${name}' is already claimed in the same write phase by ${clash.by}; two same-phase writers would be ordered only by declaration position (fallbacks belong inside a single route's 'from' chain)`,
      });
    }
    prior.push({ order, by });
    claimed.set(name, prior);
  };

  let childrenRoutes = 0;

  for (const [i, r] of (surface.routes ?? []).entries()) {
    const at = `${path}/routes/${i}`;
    const to = parseDestination(r.to);
    if (!to) {
      issues.push({ path: `${at}/to`, message: `'${r.to}' is not a destination (expected prop:|textChild:|slot:|slots:|action: followed by a name)` });
      continue;
    }
    if (!declared.has(to.name)) {
      issues.push({
        path: `${at}/to`,
        message: `destination '${to.name}' is not declared by this plan (declare it in structural or map a prop onto it; inventing properties is refused because gate A3 cannot catch them)`,
      });
    }

    const from: Selector[] = [];
    let order: WriteOrder | undefined;
    for (const [j, rawSel] of r.from.entries()) {
      const sel = parseSelector(rawSel);
      if (!sel) {
        issues.push({ path: `${at}/from/${j}`, message: `'${rawSel}' is not a selector (closed forms: self.text, self.props.<prop>, sub(<id>|…).<text|label|firstText|subtreeText>, children, synthesized.action)` });
        continue;
      }
      if (!compatible(sel, to)) {
        issues.push({ path: `${at}/from/${j}`, message: `selector '${rawSel}' cannot feed destination kind '${to.kind}'` });
        continue;
      }
      const selOrder = orderOfSelector(sel, to);
      if (order === undefined) order = selOrder;
      else if (order !== selOrder) {
        issues.push({
          path: `${at}/from/${j}`,
          message: `fallback chain mixes write phases ('${rawSel}' resolves in a different phase than the first selector); a route resolves in exactly one phase`,
        });
        continue;
      }
      from.push(sel);
    }
    if (from.length === 0) {
      issues.push({ path: `${at}/from`, message: "route has no valid selectors" });
      continue;
    }

    if (from[0].kind === "children") {
      childrenRoutes++;
      if (from.length > 1) {
        issues.push({ path: `${at}/from`, message: "a children route takes no fallbacks" });
      }
      if (childrenRoutes > 1) {
        issues.push({ path: at, message: "only one children route is supported (multiple named slots arrive with capability class T4)" });
      }
    }

    claim(to.name, order!, `routes/${i}`, `${at}/to`);
    const route: Route = { order: order!, from, to, origin: `v2:routes/${i}` };
    if (r.overwrite) route.overwrite = true;
    model.routes.push(route);
  }

  for (const [i, c] of (surface.collects ?? []).entries()) {
    const at = `${path}/collects/${i}`;
    const into = parseDestination(c.into);
    if (!into || into.kind !== "prop") {
      issues.push({ path: `${at}/into`, message: `'${c.into}' is not an array-valued destination (collects write prop:<name>)` });
      continue;
    }
    if (!declared.has(into.name)) {
      issues.push({ path: `${at}/into`, message: `destination '${into.name}' is not declared by this plan` });
    }
    if (c.shape === "records" && !c.field) {
      issues.push({ path: `${at}/field`, message: "a records collect names the field its rows' cells land in" });
      continue;
    }
    claim(into.name, WriteOrder.Collect, `collects/${i}`, `${at}/into`);

    const origin = `v2:collects/${i}`;
    const inner: Collect = {
      order: WriteOrder.Collect,
      flatten: false,
      of: c.row,
      as: { kind: "inline" },
      scalar: {
        order: WriteOrder.Collect,
        from: [{ kind: "subtree-text", subs: c.cells }],
        to: { kind: "prop", name: c.field ?? "cells" },
        origin,
      },
      origin,
    };
    model.collects.push({
      order: WriteOrder.Collect,
      flatten: c.shape === "flat",
      of: c.of,
      as: into,
      item: { [c.field ?? "cells"]: inner },
      origin,
    });
  }

  for (const [sub, disposition] of Object.entries(surface.subs ?? {})) {
    const at = `${path}/subs/${sub}`;
    if (disposition === "transparent") {
      model.subIdentity[sub] = { kind: "transparent" };
    } else if ("asText" in disposition) {
      model.subIdentity[sub] = { kind: "as-text", variant: disposition.asText };
    } else {
      model.drops[sub] = disposition.drop;
    }
    // A sub with an identity/drop must not also be a route or collect source —
    // two dispositions for one sub is a contradiction, not a preference.
    const alsoRouted = model.routes.some((r) => r.from.some((s) => "subs" in s && (s.subs as string[]).includes(sub)));
    const alsoCollected = model.collects.some(
      (col) => col.of.includes(sub) || (col.item && Object.values(col.item).some((f) => "of" in f && f.of.includes(sub))) || Boolean(col.scalar?.from.some((s) => "subs" in s && (s.subs as string[]).includes(sub))),
    );
    if (alsoRouted || alsoCollected) {
      issues.push({ path: at, message: `sub-component '${sub}' has a disposition here and is also consumed by a ${alsoRouted ? "route" : "collect"}; one sub, one disposition` });
    }
  }

  // Derived, never authored: a plan that reads its subtree into props does not
  // also emit that subtree as children.
  model.consumesSubtree =
    model.collects.length > 0 ||
    model.routes.some((r) => r.order === WriteOrder.Consume || r.order === WriteOrder.CollectLead);

  const childrenRoute = model.routes.find((r) => r.from[0].kind === "children");
  if (model.consumesSubtree && childrenRoute) {
    issues.push({
      path,
      message:
        "this plan both consumes its subtree into props and routes children as instances; the two are contradictory (the consumed subtree has no children left to emit)",
    });
  }

  if (issues.length > 0) throw new ProfileParseError(issues);
  return model;
}
