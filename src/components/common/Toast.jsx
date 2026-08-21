// A single toast. Rendered by ToastProvider, not used directly.

const TONES = {
  success: { background: "#f0fdf4", border: "#bbf7d0", color: "#166534" },
  error: { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
  info: { background: "#f8fafc", border: "#e2e8f0", color: "#334155" },
};

function Toast({ message, tone = "success", onDismiss }) {
  const palette = TONES[tone] || TONES.info;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        background: palette.background,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        borderRadius: "14px",
        padding: "0.85rem 1rem",
        fontWeight: 600,
        fontSize: "0.9rem",
        boxShadow: "0 18px 32px rgba(15, 23, 42, 0.12)",
      }}
    >
      <span style={{ flex: 1, lineHeight: 1.45 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          border: "none",
          background: "transparent",
          color: "inherit",
          fontWeight: 800,
          cursor: "pointer",
          lineHeight: 1,
          fontSize: "1rem",
        }}
      >
        ×
      </button>
    </div>
  );
}

export default Toast;
