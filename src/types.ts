/**
 * Minimal types for the dspack input and the A2UI catalog output.
 * Only the fields the transformer reads/writes are modeled; dspack documents
 * may carry more (we ignore unknown properties per dspack conformance rules).
 */

// ---------------------------------------------------------------------------
// dspack (v0.2) — subset we consume
// ---------------------------------------------------------------------------

export interface DspackDoc {
  dspack: string;
  name: string;
  description?: string;
  version?: string;
  metadata?: Record<string, unknown>;
  tokens?: Record<string, DspackTokenCategory>;
  components?: Record<string, DspackComponent>;
  patterns?: unknown[];
  antiPatterns?: unknown[];
  frameworkBindings?: Record<string, unknown>;
  themes?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface DspackTokenCategory {
  description?: string;
  tier?: string;
  values: Record<string, DspackToken>;
}

export interface DspackToken {
  value: string;
  description?: string;
  type?: string;
  [k: string]: unknown;
}

export interface DspackComponent {
  name: string;
  description: string;
  status?: unknown;
  whenToUse?: string;
  whenNotToUse?: string;
  props?: Record<string, DspackProp>;
  tokens?: string[];
  tags?: string[];
  accessibility?: unknown;
  composition?: unknown;
  constraints?: unknown[];
  relatedComponents?: string[];
  [k: string]: unknown;
}

export interface DspackProp {
  type: string;
  description?: string;
  values?: Array<string | number | boolean | { value: unknown; description?: string; deprecated?: boolean }>;
  default?: unknown;
  required?: boolean;
  propRole?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// A2UI catalog — JSON-Schema-shaped output (kept loose: it *is* a JSON Schema)
// ---------------------------------------------------------------------------

export type Json = Record<string, unknown>;

export interface A2uiCatalog extends Json {
  $schema: string;
  $id: string;
  title: string;
  description: string;
  catalogId: string;
  instructions?: string;
  components: Record<string, Json>;
  functions?: Record<string, Json>;
  $defs: Record<string, Json>;
}

export type A2uiVersion = "0.9.1" | "1.0";

// ---------------------------------------------------------------------------
// Fidelity reporting
// ---------------------------------------------------------------------------

export type FidelityClass =
  | "maps-cleanly"
  | "synthesis-defaults"
  | "lossy"
  | "cannot-represent";

export interface FidelityEntry {
  source: string; // dspack construct, e.g. "components.button.props.variant"
  target: string; // A2UI target, e.g. "components.Button.properties.variant"
  class: FidelityClass;
  note: string;
}

export interface Warning {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Coverage: every input dspack component must be explicitly accounted for.
// ---------------------------------------------------------------------------

export type Disposition =
  | "mapped" // emitted as an A2UI component derived from this dspack component
  | "adapted" // emitted but lossy (folds onto another component)
  | "omitted" // intentionally left out (declared in the profile)
  | "unsupported" // cannot be represented (declared casualty)
  | "unclassified"; // NOT accounted for anywhere — a silent drop, now surfaced

export interface CoverageEntry {
  id: string; // dspack component id
  disposition: Disposition;
  detail?: string;
}
