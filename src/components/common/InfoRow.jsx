import { colors } from "../../styles/theme";

function InfoRow({ label, value, tone = "default" }) {
  const isBrand = tone === "brand";
  return (
    <div
      style={{
        background: isBrand ? `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandLight} 100%)` : "rgba(255, 255, 255, 0.78)",
        borderRadius: "10px",
        padding: "0.8rem 0.9rem",
        border: isBrand ? "none" : `1px solid ${colors.softLine}`,
        minHeight: "68px",
        boxShadow: isBrand ? "0 10px 18px rgba(127, 17, 17, 0.18)" : "none",
      }}
    >
      <div style={{ fontSize: "0.68rem", color: isBrand ? "rgba(255,255,255,0.8)" : colors.brandInk, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.35rem" }}>{label}</div>
      <div style={{ fontWeight: 600, color: isBrand ? "#fff" : colors.ink, lineHeight: 1.35, wordBreak: "break-word" }}>{value || "—"}</div>
    </div>
  );
}

export default InfoRow;
