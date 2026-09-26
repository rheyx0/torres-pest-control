// Recent activity list, shared by the dashboards and the full activity log page.

import { Activity } from "lucide-react";
import EmptyState from "../common/EmptyState";
import { colors } from "../../styles/theme";
import { formatDateTime, humanizeEnum } from "../../utils/formatters";

function ActivityFeed({ logs, title = "Recent Activity", footer }) {
  return (
    <div
      style={{
        background: "#fcfaf1",
        border: `1px solid ${colors.softLine}`,
        borderRadius: "7.5px",
        boxShadow: "none",
      }}
    >
      <div
        style={{
          padding: "1.25rem 1.5rem",
          borderBottom: "1px solid #efe9e0",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "3.75px",
            display: "grid",
            placeItems: "center",
            background: colors.brand,
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
                  borderRadius: "3.75px",
                  background: "#efe9e0",
                  border: "1px solid #efe9e0",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, color: "#211b15" }}>
                    {log.actor}
                    {log.actorRole && <span style={{ fontWeight: 400, color: colors.muted, fontSize: "0.8rem" }}> · {humanizeEnum(log.actorRole)}</span>}
                  </div>
                  <div style={{ color: "#50463c", marginTop: "0.15rem" }}>{log.message}</div>
                </div>
                {/* Date and time: an audit entry needs both. */}
                <div style={{ whiteSpace: "nowrap", color: colors.muted, fontSize: "0.8rem" }}>
                  {formatDateTime(log.timestamp)}
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
