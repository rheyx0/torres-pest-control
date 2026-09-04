// Recent activity list, shared by the dashboards and the full activity log page.

import { Activity } from "lucide-react";
import EmptyState from "../common/EmptyState";
import { colors } from "../../styles/theme";
import { formatDate } from "../../utils/formatters";

function ActivityFeed({ logs, title = "Recent Activity", footer }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)",
        border: `1px solid ${colors.softLine}`,
        borderRadius: "20px",
        boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        style={{
          padding: "1.25rem 1.5rem",
          borderBottom: "1px solid #f1f5f9",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "12px",
            display: "grid",
            placeItems: "center",
            background: `linear-gradient(135deg, ${colors.brand}, #b43d3d)`,
            color: "#fff",
          }}
        >
          <Activity size={18} />
        </div>
        <h2 style={{ margin: 0, fontSize: "1.1rem", color: colors.ink }}>{title}</h2>
      </div>

      <div style={{ padding: "1rem 1.5rem 1.5rem" }}>
        {logs.length === 0 ? (
          <EmptyState message="No activity yet." />
        ) : (
          <div style={{ display: "grid", gap: "0.85rem" }}>
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "0.85rem 0.9rem",
                  borderRadius: "12px",
                  background: "#fafafa",
                  border: "1px solid #f1f1f1",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: "#1f2937" }}>{log.actor}</div>
                  <div style={{ color: "#4b5563", marginTop: "0.15rem" }}>{log.message}</div>
                </div>
                <div style={{ whiteSpace: "nowrap", color: colors.muted, fontSize: "0.8rem" }}>
                  {formatDate(log.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
        {footer && <div style={{ marginTop: "1rem" }}>{footer}</div>}
      </div>
    </div>
  );
}

export default ActivityFeed;
