// Consistent "nothing here" panel.

function EmptyState({ message, children }) {
  return (
    <div
      style={{
        padding: "1.5rem",
        background: "#fafafa",
        border: "1px solid #f1f1f1",
        borderRadius: "12px",
        color: "#6b7280",
        textAlign: "center",
      }}
    >
      <div>{message}</div>
      {children && <div style={{ marginTop: "0.85rem" }}>{children}</div>}
    </div>
  );
}

export default EmptyState;
