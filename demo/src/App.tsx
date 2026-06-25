import { useEffect, useMemo, useState } from "react";
import { MessageProcessor, type A2uiClientAction } from "@a2ui/web_core/v0_9";
import { A2uiSurface, MarkdownContext, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { renderMarkdown } from "@a2ui/markdown-it";
import { buildCatalog, registry } from "./ingest";

// The exact same artifacts the transformer produced — imported, not duplicated.
import settingsSurface from "../../surface/settings-card.surface.json";
import accessSurface from "../../surface/access-management.surface.json";
import catalog from "../../out/catalog.v0_9_1.json";

const SURFACES: Record<string, { label: string; doc: any }> = {
  access: { label: "Access management (revoke)", doc: accessSurface },
  settings: { label: "Account settings", doc: settingsSurface },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyCatalog = any;
type AnySurface = any;

function buttonVariantInfo(cat: AnyCatalog) {
  const v = cat.components.Button.allOf.at(-1).properties.variant;
  return {
    catalogEnum: v.enum as string[],
    defaultValue: v.default as string,
    sourceEnum: v["x-dspack-source"].sourceEnum as string[],
    valueMap: v["x-dspack-source"].valueMap as Record<string, string>,
  };
}

function componentProvenance(cat: AnyCatalog): Array<{ a2ui: string; source: string }> {
  return Object.entries(cat.components).map(([name, schema]: [string, any]) => {
    // x-dspack lives on the component's inline allOf object (or the component root).
    const meta =
      schema["x-dspack"] ?? schema.allOf?.find((s: any) => s["x-dspack"])?.["x-dspack"];
    return { a2ui: name, source: meta?.sourceId ?? "(synthesized primitive)" };
  });
}

/**
 * A2UI delivers theming to the renderer as `--a2ui-*` CSS variables that the host
 * supplies (the renderer's components read them). We populate those variables from
 * the *compiled dspack tokens* carried in the catalog, so the rendered surface is
 * themed entirely by the design system: dspack tokens -> A2UI CSS vars -> pixels.
 */
function a2uiThemeVars(cat: AnyCatalog): React.CSSProperties {
  const tokens = cat.$defs.theme["x-dspack-tokens"];
  const c = tokens.color as Record<string, string>;
  // Read the radius from the dspack token palette in its native units (0.5rem),
  // rather than hard-coding a px value that could drift from the token.
  const radius = (tokens["border-radius"]?.radius as string) ?? "0.5rem";
  return {
    ["--a2ui-color-primary" as any]: c.primary,
    ["--a2ui-color-on-primary" as any]: c["primary-foreground"],
    ["--a2ui-color-secondary" as any]: c.secondary,
    ["--a2ui-color-surface" as any]: c.background,
    ["--a2ui-color-on-surface" as any]: c.foreground,
    ["--a2ui-color-background" as any]: c.background,
    ["--a2ui-color-on-background" as any]: c.foreground,
    ["--a2ui-border" as any]: `1px solid ${c.border}`,
    ["--a2ui-color-border" as any]: c.border,
    ["--a2ui-color-muted" as any]: c.muted,
    ["--a2ui-color-muted-foreground" as any]: c["muted-foreground"],
    ["--a2ui-border-radius" as any]: radius,
    ["--a2ui-color-error" as any]: c.destructive,
    ["--a2ui-color-on-error" as any]: c["destructive-foreground"],
  };
}

export function App() {
  const [surfaceKey, setSurfaceKey] = useState<string>("access");
  const [surface, setSurface] = useState<AnySurface | null>(null);
  const [actions, setActions] = useState<A2uiClientAction[]>([]);

  // Build a renderable Catalog from the GENERATED catalog JSON (its vocabulary + accepted
  // schema come from the file via the ingestion adapter). Reused basics delegate their visual
  // to the Basic Catalog; unimplemented names render a visible placeholder.
  const ingested = useMemo(() => buildCatalog(catalog as any, registry), []);

  useEffect(() => {
    setActions([]);
    setSurface(null);
    const processor = new MessageProcessor<ReactComponentImplementation>(
      [ingested.catalog],
      async (action: A2uiClientAction) => setActions((prev) => [...prev, action]),
    );
    processor.processMessages(structuredClone(SURFACES[surfaceKey].doc.messages) as any);
    const model = Array.from(processor.model.surfacesMap.values())[0];
    if (model) setSurface(processor.model.getSurface(model.id));
    return () => processor.model.dispose();
  }, [ingested, surfaceKey]);

  const primaryColor = catalog.$defs.theme.properties.primaryColor.default as string;
  const btn = buttonVariantInfo(catalog);
  const provenance = componentProvenance(catalog);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>dspack → A2UI</h1>
        <p style={styles.sub}>
          A surface compiled from the <code>shadcn/ui</code> dspack contract, rendered off the
          <strong> generated catalog</strong> ingested into the <code>@a2ui/react</code> v0.9.1
          renderer.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {Object.entries(SURFACES).map(([key, s]) => (
            <button
              key={key}
              onClick={() => setSurfaceKey(key)}
              style={{
                ...styles.code,
                cursor: "pointer",
                border: "1px solid #cbd5e1",
                background: key === surfaceKey ? "#0f172a" : "#fff",
                color: key === surfaceKey ? "#fff" : "#0f172a",
                padding: "6px 12px",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <main style={styles.grid}>
        {/* Rendered surface */}
        <section style={styles.card}>
          <h2 style={styles.h2}>Rendered surface</h2>
          <div style={{ ...styles.surfaceFrame, ...a2uiThemeVars(catalog) }} className="a2ui-surface">
            {surface ? (
              <MarkdownContext.Provider value={renderMarkdown}>
                <A2uiSurface surface={surface} />
              </MarkdownContext.Provider>
            ) : (
              <p style={{ color: "#64748b" }}>Loading surface…</p>
            )}
          </div>
          <p style={styles.note}>
            Rendered off our <strong>generated catalog</strong> (id <code>{ingested.catalog.id}</code>):
            the accepted component vocabulary and each component's schema are built from
            <code> out/catalog.v0_9_1.json</code> by the ingestion adapter. Reused basics
            (<code>{[...registry.reuseBasic].filter((n) => ingested.names.includes(n)).join(", ")}</code>)
            delegate their visual to the Basic Catalog; the catalog still governs what the renderer
            accepts.
            {ingested.unimplemented.length > 0 && (
              <>
                {" "}
                Unimplemented visuals: <code>{ingested.unimplemented.join(", ")}</code>.
              </>
            )}
          </p>
          {actions.length > 0 && (
            <p style={styles.note}>
              Dispatched action(s): {actions.map((a) => JSON.stringify(a)).join(", ")}
            </p>
          )}
        </section>

        {/* Survival proof */}
        <section style={styles.card}>
          <h2 style={styles.h2}>What survived the transform</h2>

          <h3 style={styles.h3}>Token → theme</h3>
          <div style={styles.kv}>
            <span>
              dspack <code>color.primary</code> → <code>theme.primaryColor</code>
            </span>
            <span style={styles.swatchRow}>
              <span style={{ ...styles.swatch, background: primaryColor }} />
              <code>{primaryColor}</code>
            </span>
          </div>
          <p style={styles.note}>
            The primary “Save changes” button is painted in this color via the surface’s
            <code> createSurface.theme</code>.
          </p>

          <h3 style={styles.h3}>Variant + enum → Button</h3>
          <table style={styles.table}>
            <tbody>
              <tr>
                <td style={styles.tdKey}>catalog enum</td>
                <td>
                  {btn.catalogEnum.map((v) => (
                    <code key={v} style={v === btn.defaultValue ? styles.codeActive : styles.code}>
                      {v}
                    </code>
                  ))}
                </td>
              </tr>
              <tr>
                <td style={styles.tdKey}>dspack source enum</td>
                <td>
                  {btn.sourceEnum.map((v) => (
                    <code key={v} style={styles.code}>
                      {v}
                    </code>
                  ))}
                </td>
              </tr>
            </tbody>
          </table>
          <p style={styles.note}>
            shadcn’s 6 variants project onto A2UI’s 3 (<em>lossy</em>): the full source enum is kept
            in the catalog as an <code>x-dspack-source</code> annotation. The surface uses
            <code> variant: "primary"</code>.
          </p>

          <h3 style={styles.h3}>Component provenance</h3>
          <table style={styles.table}>
            <tbody>
              {provenance.map((p) => (
                <tr key={p.a2ui}>
                  <td style={styles.tdKey}>
                    <code>{p.a2ui}</code>
                  </td>
                  <td>
                    {p.source === "(synthesized primitive)" ? (
                      <em>{p.source}</em>
                    ) : (
                      <>
                        dspack <code>{p.source}</code>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", color: "#0f172a", maxWidth: 1100, margin: "0 auto", padding: 24 },
  header: { marginBottom: 16 },
  h1: { margin: 0, fontSize: 28 },
  sub: { color: "#475569", marginTop: 4 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" },
  card: { border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, background: "#fff" },
  surfaceFrame: { border: "1px dashed #cbd5e1", borderRadius: 8, padding: 16, minHeight: 160, background: "#f8fafc" },
  h2: { fontSize: 16, marginTop: 0 },
  h3: { fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748b", marginBottom: 6 },
  note: { fontSize: 12.5, color: "#64748b", lineHeight: 1.5 },
  kv: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  swatchRow: { display: "inline-flex", alignItems: "center", gap: 8 },
  swatch: { width: 18, height: 18, borderRadius: 4, border: "1px solid #00000022", display: "inline-block" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  tdKey: { color: "#64748b", padding: "4px 8px 4px 0", whiteSpace: "nowrap", verticalAlign: "top" },
  code: { background: "#f1f5f9", borderRadius: 4, padding: "1px 6px", margin: 2, display: "inline-block", fontSize: 12 },
  codeActive: { background: "#0f172a", color: "#fff", borderRadius: 4, padding: "1px 6px", margin: 2, display: "inline-block", fontSize: 12 },
};
