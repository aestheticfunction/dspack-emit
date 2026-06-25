/**
 * Hand-authored React visual for the ingested `AlertDialog` component. The catalog governs
 * the name, the text props, and the `action` (dispatched on confirm); this file supplies the
 * non-dismissible confirmation behavior that distinguishes AlertDialog from Dialog:
 *   - opened by an explicit destructive trigger,
 *   - the overlay does NOT dismiss and Escape does NOT close,
 *   - the user must choose Cancel or the destructive Confirm (which dispatches `action`).
 */
import { useState, type CSSProperties, type FC } from "react";

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};
const box: CSSProperties = {
  background: "var(--a2ui-color-surface, #fff)",
  color: "var(--a2ui-color-on-surface, #0f172a)",
  borderRadius: "var(--a2ui-border-radius, 8px)",
  padding: 24,
  width: "min(420px, calc(100% - 32px))",
  boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
};
const btn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "var(--a2ui-border-radius, 8px)",
  border: "none",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
};

export const AlertDialogRender: FC<any> = ({ props }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          ...btn,
          background: "var(--a2ui-color-error, #ef4444)",
          color: "var(--a2ui-color-on-error, #fff)",
        }}
      >
        {props.triggerLabel}
      </button>

      {open && (
        // Non-dismissible: clicking the overlay does nothing; only the buttons close it.
        <div style={overlay} role="presentation">
          <div role="alertdialog" aria-modal="true" aria-label={props.title} style={box}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>{props.title}</h2>
            {props.description && (
              <p style={{ margin: "0 0 20px", color: "var(--a2ui-color-muted-foreground, #64748b)", fontSize: 14, lineHeight: 1.5 }}>
                {props.description}
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ ...btn, background: "var(--a2ui-color-muted, #f1f5f9)", color: "var(--a2ui-color-on-surface, #0f172a)" }}
              >
                {props.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => {
                  props.action?.();
                  setOpen(false);
                }}
                style={{ ...btn, background: "var(--a2ui-color-error, #ef4444)", color: "var(--a2ui-color-on-error, #fff)" }}
              >
                {props.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
