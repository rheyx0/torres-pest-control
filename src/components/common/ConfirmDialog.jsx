// Replaces window.alert / window.confirm, which App.js used for the
// "at least one active admin" guard.

import { primaryButton, secondaryButton } from "../../styles/theme";

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const confirmStyle =
    tone === "danger"
      ? { ...primaryButton, background: "linear-gradient(135deg, #991b1b 0%, #dc2626 100%)" }
      : primaryButton;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "grid",
        placeItems: "center",
        padding: "1.5rem",
        zIndex: 1100,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "20px",
          padding: "1.75rem",
          maxWidth: "440px",
          width: "100%",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.25)",
        }}
      >
        <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.25rem", color: "#0f172a" }}>{title}</h2>
        <p style={{ margin: 0, color: "#4b5563", lineHeight: 1.6 }}>{message}</p>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={onConfirm} style={confirmStyle}>
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel} style={secondaryButton}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
