import { colors } from "../../styles/theme";

function InfoRow({ label, value }) {
  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.78)",
        borderRadius: "10px",
        padding: "0.8rem 0.9rem",
        border: `1px solid ${colors.softLine}`,
        minHeight: "68px",
      }}
    >
      <div style={{ fontSize: "0.68rem", color: colors.brandInk, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ fontWeight: 500, color: colors.ink, lineHeight: 1.35, wordBreak: "break-word" }}>{value || "—"}</div>
    </div>
  );
}

export default InfoRow;
