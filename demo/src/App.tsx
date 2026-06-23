import { useEffect, useState } from "react";
import { MessageProcessor, type A2uiClientAction } from "@a2ui/web_core/v0_9";
import {
  basicCatalog,
  A2uiSurface,
  MarkdownContext,
  type ReactComponentImplementation,
} from "@a2ui/react/v0_9";
import { renderMarkdown } from "@a2ui/markdown-it";

// The exact same artifacts the transformer produced — imported, not duplicated.
import surfaceDoc from "../../surface/settings-card.surface.json";
import catalog from "../../out/catalog.v0_9_1.json";

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
  return Object.entries(cat.components).map(([name, schema]: [string, any]) => ({
    a2ui: name,
    source: schema["x-dspack"]?.sourceId ?? "(synthesized primitive)",
  }));
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
    ["--a2ui-border-radius" as any]: radius,
    ["--a2ui-color-error" as any]: c.destructive,
  };
}

export function App() {
  const [surface, setSurface] = useState<AnySurface | null>(null);
  const [actions, setActions] = useState<A2uiClientAction[]>([]);

  useEffect(() => {
    const processor = new MessageProcessor<ReactComponentImplementation>(
      [basicCatalog],
      async (action: A2uiClientAction) => setActions((prev) => [...prev, action]),
    );
    processor.processMessages(structuredClone(surfaceDoc.messages) as any);
    const model = Array.from(processor.model.surfacesMap.values())[0];
    if (model) setSurface(processor.model.getSurface(model.id));
    return () => processor.model.dispose();
  }, []);

  const primaryColor = catalog.$defs.theme.properties.primaryColor.default as string;
  const btn = buttonVariantInfo(catalog);
  const provenance = componentProvenance(catalog);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>dspack → A2UI</h1>
        <p style={styles.sub}>
          A surface compiled from the <code>shadcn/ui</code> dspack contract, rendered through the
          published <code>@a2ui/react</code> v0.9.1 renderer.
        </p>
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
            Rendered by the stock A2UI <strong>Basic Catalog</strong> renderer (it implements fixed
            component names; it does not ingest a custom catalog). The same component objects also
            validate against our generated catalog — see the panel at right.
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
