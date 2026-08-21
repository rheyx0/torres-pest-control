import { colors } from "../../styles/theme";

function InfoRow({ label, value }) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(255, 247, 247, 0.95) 0%, #ffffff 100%)",
        borderRadius: "10px",
        padding: "0.8rem 0.9rem",
        border: "1px solid rgba(127, 17, 17, 0.12)",
        borderLeft: `3px solid ${colors.brandLight}`,
        minHeight: "68px",
      }}
    >
      <div style={{ fontSize: "0.68rem", color: colors.brandInk, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ fontWeight: 700, color: colors.ink, lineHeight: 1.35, wordBreak: "break-word" }}>{value || "—"}</div>
    </div>
  );
}

export default InfoRow;
