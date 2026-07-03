/**
 * dspack surface → json-render spec emitter.
 *
 * Compiles a dspack surface document (CSR) into json-render's flat spec
 * shape: `{ root, elements }` where each element is
 * `{ type, props, children, visible }` and children reference element keys.
 *
 * Because the json-render catalog is generated from the contract 1:1
 * (model.ts), this emitter performs no compound flattening and no prop value
 * projection — CSR nesting becomes element nesting, prop names and enum
 * values carry verbatim. The projections that DO happen are each recorded:
 *   - `text` leaves become the universal `text` prop;
 *   - slot *names* are not representable (json-render children are one
 *     ordered array), so slotted children flatten into child order — warned;
 *   - props outside the declarative catalog (function-typed handlers,
 *     unknown names) are dropped — warned.
 *
 * Gate naming (this target's equivalents of the a2ui A-gates):
 *   J1 — generated catalog + registry modules compile (tsc --noEmit).
 *   J2 — spec structural integrity (json-render's validateSpec).
 *   J3 — instance acceptance: catalog.validate() parses the spec with the
 *        generated Zod schemas.
 * J1–J3 run with the real framework in gates/json-render (pinned zod v4,
 * isolated from the a2ui side's zod v3 pin). `validateSpecAgainstModel`
 * below is the offline mirror of J2+J3's vocabulary semantics, used by unit
 * tests and the CLI without the framework dependency.
 */
import type { DspackDoc, DspackSurface, SurfaceNode, Warning } from "../../types.js";
import { collectChildren } from "../csr.js";
import { buildCatalogModel, type CatalogComponent, type CatalogModel } from "./model.js";
import { shadcnJsonRenderProfile, type JsonRenderProfile } from "./profile.js";

export class EmitJsonRenderError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path})`);
    this.name = "EmitJsonRenderError";
  }
}

export interface JsonRenderElement {
  type: string;
  props: Record<string, unknown>;
  children: string[];
  /** Required by json-render's element schema; the CSR has no visibility conditions. */
  visible: true;
}

export interface JsonRenderSpec {
  root: string;
  elements: Record<string, JsonRenderElement>;
}

export interface EmitJsonRenderResult {
  spec: JsonRenderSpec;
  /** Every drop/projection performed — nothing is silent. */
  warnings: Warning[];
}

export interface EmitJsonRenderOptions {
  profile?: JsonRenderProfile;
}

export function emitJsonRenderSpec(
  surface: DspackSurface,
  doc: DspackDoc,
  options: EmitJsonRenderOptions = {},
): EmitJsonRenderResult {
  const profile = options.profile ?? shadcnJsonRenderProfile;
  if (surface.dspackSurface !== "0.1") {
    throw new EmitJsonRenderError(
      `unsupported dspackSurface version '${surface.dspackSurface}' (this emitter targets 0.1)`,
      "$",
    );
  }
  if (surface.system !== doc.name) {
    throw new EmitJsonRenderError(
      `surface.system '${surface.system}' does not match contract name '${doc.name}'`,
      "$.system",
    );
  }

  const model = buildCatalogModel(doc, profile);
  const emitter = new SpecEmitter(model);
  const rootKey = emitter.emitNode(surface.root, "$.root", true);
  return { spec: { root: rootKey, elements: emitter.elements }, warnings: emitter.warnings };
}

class SpecEmitter {
  readonly elements: Record<string, JsonRenderElement> = {};
  readonly warnings: Warning[] = [];
  private readonly usedKeys = new Set<string>();
  private readonly byDspackId = new Map<string, CatalogComponent>();

  constructor(model: CatalogModel) {
    for (const component of model.components) this.byDspackId.set(component.dspackId, component);
  }

  emitNode(node: SurfaceNode, path: string, isRoot = false): string {
    const component = this.byDspackId.get(node.component);
    if (!component) {
      throw new EmitJsonRenderError(
        `unknown component '${node.component}': not in the contract vocabulary this catalog was generated from`,
        path,
      );
    }

    // Same convention as the a2ui target: the surface root always emits
    // under the key "root" (deterministic entry point for consumers).
    const key = this.allocateKey(isRoot ? "root" : (node.id ?? node.component), path);
    const props: Record<string, unknown> = {};
    const knownProps = new Map(component.props.map((p) => [p.name, p]));
    for (const [name, value] of Object.entries(node.props ?? {})) {
      if (!knownProps.has(name)) {
        this.warnings.push({
          code: "jr-prop-dropped",
          message: `${path}: prop '${name}' on '${node.component}' is not in the declarative catalog (handler or unknown prop); dropped.`,
        });
        continue;
      }
      props[name] = value;
    }
    if (node.text !== undefined) props.text = node.text;

    if (node.slots && Object.keys(node.slots).length > 0) {
      this.warnings.push({
        code: "jr-slot-names-flattened",
        message: `${path}: json-render children form one ordered array; slot names (${Object.keys(node.slots).sort().join(", ")}) are not carried — slotted children appended in sorted-slot order.`,
      });
    }

    const element: JsonRenderElement = { type: component.name, props, children: [], visible: true };
    this.elements[key] = element; // parent registered before children (insertion order = pre-order)
    element.children = collectChildren(node).map((child, i) =>
      this.emitNode(child.node, `${path}${child.suffix}[${i}]`),
    );
    return key;
  }

  private allocateKey(preferred: string, path: string): string {
    const base = slugKey(preferred);
    let key = base;
    let n = 2;
    while (this.usedKeys.has(key)) key = `${base}_${n++}`;
    if (key !== base) {
      this.warnings.push({
        code: "jr-key-deduplicated",
        message: `${path}: element key '${base}' already used; emitted as '${key}'.`,
      });
    }
    this.usedKeys.add(key);
    return key;
  }
}

function slugKey(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "el";
}

// ---------------------------------------------------------------------------
// Offline structural validation (mirror of J2+J3 vocabulary semantics)
// ---------------------------------------------------------------------------

export interface SpecFinding {
  path: string;
  message: string;
}

/**
 * Validates an emitted spec against the catalog model: root resolves, child
 * references resolve, every element type is cataloged, every prop is known
 * and enum values are in vocabulary. This is the framework-free mirror used
 * by unit tests and the CLI; the authoritative check is gates J2/J3 with the
 * generated Zod catalog (gates/json-render).
 */
export function validateSpecAgainstModel(spec: JsonRenderSpec, model: CatalogModel): SpecFinding[] {
  const findings: SpecFinding[] = [];
  const byName = new Map(model.components.map((c) => [c.name, c]));
  if (!spec.elements[spec.root]) {
    findings.push({ path: "$.root", message: `root '${spec.root}' not found in elements` });
  }
  for (const [key, element] of Object.entries(spec.elements)) {
    const componentPath = `$.elements.${key}`;
    const component = byName.get(element.type);
    if (!component) {
      findings.push({ path: `${componentPath}.type`, message: `unknown component type '${element.type}'` });
      continue;
    }
    const knownProps = new Map(component.props.map((p) => [p.name, p]));
    for (const [name, value] of Object.entries(element.props)) {
      const prop = knownProps.get(name);
      if (!prop) {
        findings.push({ path: `${componentPath}.props.${name}`, message: `unknown prop on '${element.type}'` });
        continue;
      }
      if (prop.kind === "enum" && value !== null && !prop.values!.includes(String(value))) {
        findings.push({
          path: `${componentPath}.props.${name}`,
          message: `value '${String(value)}' not in enum vocabulary [${prop.values!.join(", ")}]`,
        });
      }
    }
    for (const child of element.children) {
      if (!spec.elements[child]) {
        findings.push({ path: `${componentPath}.children`, message: `child '${child}' not found in elements` });
      }
    }
  }
  return findings;
}
