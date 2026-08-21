// Read-only label/value tile. Was defined separately in UserAccountsPage and
// ClientProfilesPage with slightly different borders.

function InfoRow({ label, value }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
        borderRadius: "12px",
        padding: "0.85rem 1rem",
        border: "1px solid #edf2f7",
      }}
    >
      <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#111827" }}>{value || "—"}</div>
    </div>
  );
}

export default InfoRow;
