// Stat tile used by all three role dashboards.

import { colors } from "../../styles/theme";

function MetricCard({ title, value, accent, Icon }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)",
        border: `1px solid ${colors.softLine}`,
        borderRadius: "20px",
        padding: "1.25rem",
        boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)",
        minHeight: "128px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span
          style={{
            fontSize: "0.8rem",
            color: colors.muted,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
        <div
          style={{
            width: "42px",
            height: "42px",
            borderRadius: "14px",
            display: "grid",
            placeItems: "center",
            background: accent,
            color: "#ffffff",
            boxShadow: "0 12px 24px rgba(127, 17, 17, 0.2)",
          }}
        >
          {Icon && <Icon size={18} />}
        </div>
      </div>
      <div style={{ fontSize: "2.1rem", fontWeight: 800, color: colors.ink, lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

export default MetricCard;
