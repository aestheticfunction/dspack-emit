/**
 * json-render target profile — pure data, per the same profile mechanism as
 * the a2ui target (the engine reads only profile + dspack document).
 *
 * Deliberately near-empty, and that emptiness is a finding: json-render's
 * catalog is *generated from the contract*, so the target carries the
 * contract's own vocabulary — every component and sub-component becomes a
 * catalog component 1:1, props keep their dspack names and enum values, and
 * compound composition survives as real nesting. There is no per-component
 * projection table because nothing is projected; contrast the a2ui profile's
 * surfacePlan flattening directives and documented casualties.
 */
export interface JsonRenderProfile {
  /**
   * Overrides for the mechanical kebab-case → PascalCase derivation of
   * catalog component names from dspack ids (e.g. if a contract id produced
   * a name colliding with another).
   */
  nameOverrides?: Record<string, string>;
  /** dspack component ids deliberately not cataloged. Must stay documented, never silent. */
  intentionallyOmitted?: string[];
}

export const shadcnJsonRenderProfile: JsonRenderProfile = {
  intentionallyOmitted: [],
};

/**
 * Astryx (facebook/astryx @ v0.1.2, nine-component slice). Also empty — the
 * asymmetry finding's prediction held for a SECOND contract with a different
 * idiom: nothing needs projecting, because the catalog carries the contract's
 * own vocabulary. Astryx's data-driven array props (table.data/columns,
 * dropdown-menu.items) are EXCLUDED by the codegen's prop typing with
 * documented reasons — the lossy edge of the "lossless" target, visible in
 * the generated catalog header and the model's excluded-props record.
 */
export const astryxJsonRenderProfile: JsonRenderProfile = {
  intentionallyOmitted: [],
};
