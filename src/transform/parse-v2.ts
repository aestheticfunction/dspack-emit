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
 * Capability note: the grammar admits exactly what the engine can emit. T1
 * (transparent identity + constrained control donation) landed as the
 * `transparent` / `donate` spellings below; spellings whose engine support
 * has not landed (`joinOn` pairing — T3, multi-slot children routing — T4,
 * variant identity — T5) are still refused, never reinterpreted.
 */
import type { ComponentPlan } from "./profiles.js";
import {
  WriteOrder,
  emptySurfaceModel,
  isCollect,
  type Collect,
  type CollectJoin,
  type Destination,
  type Donation,
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
  /** Sections (table-mode) or the repeated items themselves (item-mode). */
  of: string[];
  /** Array-valued destination (`prop:<name>`). */
  into: string;
  /** table-mode: `flat` concatenates all rows into one list; `records` keeps one record per row. */
  shape?: "flat" | "records";
  /** table-mode: record field carrying each row's cells; required when shape is `records`. */
  field?: string;
  /** table-mode: repetitions inside a section. */
  row?: string[];
  /** table-mode: cells inside a repetition, flattened to their subtree text. */
  cells?: string[];
  /**
   * T2 item-mode: each matching descendant becomes one record; every field
   * resolves against THAT item's own node. Selectors: `self.text`,
   * `self.props.<prop>`, `self.id`.
   */
  item?: Record<string, string>;
  /**
   * T3: a DECLARED key join onto a sibling sub-family. `on.left` extracts the
   * key from each item, `on.right` from each counterpart; `fields` source
   * record fields from the JOINED side (item-local selectors, or the literal
   * `"children"` for the slot-valued field: the counterpart's children emit
   * as instances and the record carries the reference). `optional: true`
   * relaxes exactly-one to 0..1. The profile names the relation; nothing is
   * ever inferred from position or adjacency.
   */
  join?: {
    with: string[];
    on: { left: string; right: string };
    fields: Record<string, string>;
    optional?: boolean;
  };
}

export interface SurfaceV2Donate {
  /** `self.text` or `sub(<id>|…).text` — where the donated value comes from. */
  from: string;
  /** `prop:<name>` on the boundary's single eligible control. */
  to: string;
}

export type SurfaceV2Sub =
  | "transparent"
  | { transparent: true | { donate: SurfaceV2Donate[] } }
  | { asText: string }
  | { drop: string };

export interface SurfaceV2 {
  /**
   * T1 transparent identity: this component emits no instance; children rise.
   * `true`, or an object carrying constrained control donations scoped to
   * each dissolved instance's subtree.
   */
  transparent?: true | { donate: SurfaceV2Donate[] };
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
  `^(self\\.text|self\\.id|self\\.props\\.(${PROP})|sub\\((${ID}(?:\\|${ID})*)\\)\\.(text|label|firstText|subtreeText)|children|synthesized\\.action)$`,
);
const DESTINATION = new RegExp(`^(prop|textChild|slot|slots|action):(${PROP})$`);

export function parseSelector(raw: string): Selector | null {
  const m = SELECTOR.exec(raw);
  if (!m) return null;
  if (m[1] === "self.text") return { kind: "self-text" };
  if (m[1] === "self.id") return { kind: "self-id" };
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
    case "self-id":
      return WriteOrder.SelfText; // unreachable in routes: `compatible` refuses it
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
    case "self-id":
      return false; // item-field-only: a route may not read self.id
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
/** Parses one donate entry; donation selectors and destinations are narrower than routes'. */
function parseDonation(d: SurfaceV2Donate, at: string, issues: ParseIssue[], origin: string): Donation | null {
  const from = parseSelector(d.from);
  if (!from || (from.kind !== "self-text" && from.kind !== "sub-text")) {
    issues.push({ path: `${at}/from`, message: `'${d.from}' is not a donation source (donations harvest text: self.text or sub(<id>|…).text)` });
    return null;
  }
  const to = parseDestination(d.to);
  if (!to || to.kind !== "prop") {
    issues.push({ path: `${at}/to`, message: `'${d.to}' is not a donation destination (donations write prop:<name> on the receiving control)` });
    return null;
  }
  return { from, to, origin };
}

export function parseSurfaceV2(surface: SurfaceV2, plan: ComponentPlan, path: string): SurfaceModel {
  const issues: ParseIssue[] = [];
  const model = emptySurfaceModel();

  // T1: transparent identity. A transparent plan emits nothing, so nothing it
  // could declare for an instance is meaningful — routes, collects, structural
  // slots, propMap, required all refuse. Only sub dispositions (for its own
  // dissolved subtree) and donations survive.
  if (surface.transparent !== undefined) {
    model.transparent = true;
    if (typeof surface.transparent === "object") {
      surface.transparent.donate.forEach((d, i) => {
        const parsed = parseDonation(d, `${path}/transparent/donate/${i}`, issues, `v2:transparent/donate/${i}`);
        if (parsed) model.transparentDonate.push(parsed);
      });
    }
    if ((surface.routes ?? []).length > 0 || (surface.collects ?? []).length > 0) {
      issues.push({ path, message: "a transparent plan emits no instance; routes and collects have nowhere to land (donations are the only writes it may carry)" });
    }
    for (const [field, label] of [
      [plan.structural ?? {}, "structural"],
      [plan.propMap ?? {}, "propMap"],
    ] as const) {
      if (Object.keys(field).length > 0) {
        issues.push({ path, message: `a transparent plan declares no catalog surface; remove its ${label} block` });
      }
    }
    if ((plan.required ?? []).length > 0) {
      issues.push({ path, message: "a transparent plan declares no catalog surface; remove its required list" });
    }
  }

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
    // The children destination is exclusive in BOTH directions (see the
    // children-route check below for the rationale).
    const children = prior.find((c) => c.order === WriteOrder.Children);
    if (children && order !== WriteOrder.Children) {
      issues.push({
        path: at,
        message: `destination '${name}' is claimed by the children route (${children.by}); instance references do not participate in first-wins layering`,
      });
    }
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

    // firstText is a FALLBACK selector: the engine serves it only after a
    // primary label/text selector yielded nothing. As a primary it would
    // parse, derive Consume, and then never resolve — consuming the subtree
    // while writing nothing. Refuse the dead spelling instead of shipping it.
    if (from[0].kind === "sub-text-lift") {
      issues.push({
        path: `${at}/from/0`,
        message:
          "sub(…).firstText is a fallback selector and cannot lead a route; give the route a primary (sub(…).label or sub(…).text) and put firstText after it",
      });
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
      // A children route produces INSTANCES, not a value: it cannot join
      // first-wins layering, so its destination is exclusively its own. Two
      // writers here would either orphan a synthesized instance in the hashed
      // artifact or silently discard the children — refuse the pair.
      const shared = claimed.get(to.name);
      if (shared && shared.length > 0) {
        issues.push({
          path: `${at}/to`,
          message: `destination '${to.name}' is already claimed by ${shared[0].by}; a children route's destination cannot be layered with value routes (instance references do not participate in first-wins)`,
        });
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

    // T2 item-mode and table-mode are distinct shapes; mixing them is a
    // contradiction, not a preference.
    const itemMode = c.item !== undefined;
    const tableKeys = [c.shape, c.field, c.row, c.cells].some((v) => v !== undefined);
    if (itemMode && tableKeys) {
      issues.push({ path: at, message: "a collect is either item-mode (item) or table-mode (shape/row/cells/field), never both" });
      continue;
    }
    if (itemMode) {
      const fields: Record<string, Selector> = {};
      let ok = true;
      for (const [fieldName, raw] of Object.entries(c.item!)) {
        const sel = parseSelector(raw);
        const itemLocal = sel && (sel.kind === "self-text" || sel.kind === "self-prop" || sel.kind === "self-id");
        if (!itemLocal) {
          issues.push({
            path: `${at}/item/${fieldName}`,
            message: `'${raw}' is not an item field source (item fields resolve on the item's own node: self.text, self.props.<prop>, self.id — sibling reads and joins are T3)`,
          });
          ok = false;
          continue;
        }
        fields[fieldName] = sel;
      }
      if (!ok || Object.keys(fields).length === 0) {
        if (Object.keys(c.item!).length === 0) issues.push({ path: `${at}/item`, message: "an item-mode collect names at least one field" });
        continue;
      }
      // T3 join, only on item-mode collects.
      let join: CollectJoin | undefined;
      if (c.join) {
        const jAt = `${at}/join`;
        const left = parseSelector(c.join.on.left);
        const right = parseSelector(c.join.on.right);
        const itemLocal = (sel: Selector | null): sel is Selector =>
          sel !== null && (sel.kind === "self-text" || sel.kind === "self-prop" || sel.kind === "self-id");
        let jOk = true;
        if (!itemLocal(left)) {
          issues.push({ path: `${jAt}/on/left`, message: `'${c.join.on.left}' is not a join key source (item-local: self.id, self.props.<prop>, self.text)` });
          jOk = false;
        }
        if (!itemLocal(right)) {
          issues.push({ path: `${jAt}/on/right`, message: `'${c.join.on.right}' is not a join key source (item-local: self.id, self.props.<prop>, self.text)` });
          jOk = false;
        }
        const jFields: CollectJoin["fields"] = {};
        for (const [fieldName, raw] of Object.entries(c.join.fields)) {
          if (raw === "children") {
            jFields[fieldName] = { kind: "joined-children" };
            continue;
          }
          const sel = parseSelector(raw);
          if (!itemLocal(sel)) {
            issues.push({ path: `${jAt}/fields/${fieldName}`, message: `'${raw}' is not a joined-side field source (item-local selectors, or "children" for the slot-valued field)` });
            jOk = false;
            continue;
          }
          jFields[fieldName] = sel;
        }
        for (const fieldName of Object.keys(jFields)) {
          if (fieldName in fields) {
            issues.push({ path: `${jAt}/fields/${fieldName}`, message: `field '${fieldName}' is already sourced from the left item; one record field, one source` });
            jOk = false;
          }
        }
        if (Object.keys(jFields).length === 0) {
          issues.push({ path: `${jAt}/fields`, message: "a join names at least one joined-side field — a join that contributes nothing is not a relation" });
          jOk = false;
        }
        if (jOk) {
          join = { with: c.join.with, leftKey: left as Selector, rightKey: right as Selector, fields: jFields, optional: c.join.optional === true, origin: `v2:collects/${i}/join` };
        } else {
          continue;
        }
      }
      claim(into.name, WriteOrder.Collect, `collects/${i}`, `${at}/into`);
      model.collects.push({
        order: WriteOrder.Collect,
        flatten: false,
        of: c.of,
        as: into,
        fields,
        ...(join ? { join } : {}),
        origin: `v2:collects/${i}`,
      });
      continue;
    }
    if (c.shape === undefined || c.row === undefined || c.cells === undefined) {
      issues.push({ path: at, message: "a table-mode collect declares shape, row, and cells (or use item-mode with `item`)" });
      continue;
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
    } else if (typeof disposition === "object" && "transparent" in disposition) {
      const donate: Donation[] = [];
      if (typeof disposition.transparent === "object") {
        disposition.transparent.donate.forEach((d, i) => {
          const parsed = parseDonation(d, `${at}/transparent/donate/${i}`, issues, `v2:subs/${sub}/donate/${i}`);
          if (parsed) donate.push(parsed);
        });
      }
      model.subIdentity[sub] = donate.length > 0 ? { kind: "transparent", donate } : { kind: "transparent" };
    } else if ("asText" in disposition) {
      model.subIdentity[sub] = { kind: "as-text", variant: disposition.asText };
    } else {
      model.drops[sub] = disposition.drop;
    }
    // A sub with an identity/drop must not also be a route or collect source —
    // two dispositions for one sub is a contradiction, not a preference.
    const alsoRouted = model.routes.some((r) => r.from.some((s) => "subs" in s && (s.subs as string[]).includes(sub)));
    const inCollect = (col: Collect): boolean =>
      col.of.includes(sub) ||
      Boolean(col.scalar?.from.some((s) => "subs" in s && (s.subs as string[]).includes(sub))) ||
      Object.values(col.item ?? {}).some((f) => (isCollect(f) ? inCollect(f) : f.from.some((s) => "subs" in s && (s.subs as string[]).includes(sub))));
    const alsoCollected = model.collects.some(inCollect);
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
