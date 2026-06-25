/**
 * Hand-authored React visual for the ingested `Table` component. The catalog governs the
 * name and the `caption`/`columns`/`rows` props; this file renders a real, semantic
 * <table> (thead/tbody/th/td + caption), with the optional per-row `status` rendered as a
 * Badge. Styling is driven by the `--a2ui-*` design-token CSS variables.
 *
 * Row shape (static data carried in the surface): { cells: string[], status?: { label, variant } }.
 */
import type { CSSProperties, FC } from "react";
import { BadgeView } from "./BadgeView";

const cell: CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  borderBottom: "1px solid var(--a2ui-color-border, #e2e8f0)",
  fontSize: 14,
};
const th: CSSProperties = {
  ...cell,
  color: "var(--a2ui-color-muted-foreground, #64748b)",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

interface Row {
  cells?: string[];
  status?: { label: string; variant?: string };
}

export const TableRender: FC<any> = ({ props }) => {
  const columns: string[] = Array.isArray(props.columns) ? props.columns : [];
  const rows: Row[] = Array.isArray(props.rows) ? props.rows : [];
  return (
    <div style={{ overflowX: "auto", width: "100%" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", color: "var(--a2ui-color-on-surface, #0f172a)" }}>
        {props.caption && (
          <caption style={{ textAlign: "left", padding: "0 0 8px", color: "var(--a2ui-color-muted-foreground, #64748b)", fontSize: 13 }}>
            {props.caption}
          </caption>
        )}
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} scope="col" style={th}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {(row.cells ?? []).map((c, j) => (
                <td key={j} style={cell}>
                  {c}
                </td>
              ))}
              {row.status && (
                <td style={cell}>
                  <BadgeView variant={row.status.variant}>{row.status.label}</BadgeView>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
