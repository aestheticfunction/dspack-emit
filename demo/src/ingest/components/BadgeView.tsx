/**
 * Shared presentational badge, driven by the `--a2ui-*` design-token CSS variables.
 * Used by the ingested `Badge` component and by `Table`'s status cells.
 */
import type { CSSProperties, ReactNode } from "react";

const base: CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 9999,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.5,
  whiteSpace: "nowrap",
};

export function BadgeView({ variant = "default", children }: { variant?: string; children: ReactNode }) {
  const v: CSSProperties =
    variant === "destructive"
      ? { background: "var(--a2ui-color-error, #ef4444)", color: "var(--a2ui-color-on-error, #fff)" }
      : variant === "secondary"
        ? { background: "var(--a2ui-color-muted, #f1f5f9)", color: "var(--a2ui-color-on-surface, #0f172a)" }
        : variant === "outline"
          ? {
              background: "transparent",
              color: "var(--a2ui-color-on-surface, #0f172a)",
              boxShadow: "inset 0 0 0 1px var(--a2ui-color-border, #e2e8f0)",
            }
          : { background: "var(--a2ui-color-primary, #0f172a)", color: "var(--a2ui-color-on-primary, #f8fafc)" };
  return <span style={{ ...base, ...v }}>{children}</span>;
}
