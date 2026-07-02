/**
 * Public library surface of dspack-to-a2ui (the A2UI emitter target).
 *
 * Consumers (dspack-gen) depend on exactly this module; everything not
 * re-exported here is internal. The CLI (src/cli.ts) is a thin wrapper over
 * the same functions.
 */
export { transform, transformFromJson, type TransformOutput } from "./transform/index.js";
export { shadcnProfile, type Profile, type ComponentPlan, type SurfacePlanDirectives } from "./transform/profiles.js";
export { validateCatalog, extractInstances, type ValidationReport, type GateResult } from "./validate/ajv.js";
export {
  emitSurface,
  slug,
  EmitSurfaceError,
  type EmitSurfaceResult,
  type EmitSurfaceOptions,
} from "./targets/a2ui/surface.js";
export type {
  A2uiCatalog,
  A2uiVersion,
  DspackDoc,
  DspackSurface,
  SurfaceNode,
  Json,
  Warning,
} from "./types.js";
