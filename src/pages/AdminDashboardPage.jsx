import { Activity, BriefcaseBusiness, ShieldCheck, Users } from "lucide-react";

function MetricCard({ title, value, accent, Icon }) {
  return (
    <div style={{
      background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)",
      border: "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: "20px",
      padding: "1.25rem",
      boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)",
      minHeight: "128px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{title}</span>
        <div style={{
          width: "42px",
          height: "42px",
          borderRadius: "14px",
          display: "grid",
          placeItems: "center",
          background: accent,
          color: "#ffffff",
          boxShadow: "0 12px 24px rgba(127, 17, 17, 0.2)",
        }}>
          <Icon size={18} />
        </div>
      </div>
      <div style={{ fontSize: "2.1rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

function AdminDashboardPage({ users, clients, logs }) {
  const totalStaffAccounts = users.filter((user) => user.role !== "ADMIN").length;
  const activeAccounts = users.filter((user) => (user.status || "").toUpperCase() === "ACTIVE").length;
  const totalClients = clients.length;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ color: "#8b1e1e", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.72rem" }}>
          Overview
        </p>
        <h1 style={{ margin: "0.3rem 0 0", fontSize: "2.2rem", color: "#0f172a", fontWeight: 800 }}>Admin Dashboard</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <MetricCard title="Total Staff Accounts" value={totalStaffAccounts} accent="linear-gradient(135deg, #7f1111 0%, #b43d3d 100%)" Icon={Users} />
        <MetricCard title="Active Accounts" value={activeAccounts} accent="linear-gradient(135deg, #0f766e 0%, #34d399 100%)" Icon={ShieldCheck} />
        <MetricCard title="Total Clients" value={totalClients} accent="linear-gradient(135deg, #374151 0%, #64748b 100%)" Icon={BriefcaseBusiness} />
      </div>

      <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: "20px", boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "12px", display: "grid", placeItems: "center", background: "linear-gradient(135deg, #7f1111, #b43d3d)", color: "#fff" }}>
            <Activity size={18} />
          </div>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>Recent Activity</h2>
        </div>

        <div style={{ padding: "1rem 1.5rem 1.5rem" }}>
          {logs.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No activity yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.85rem" }}>
              {logs.slice(0, 6).map((log) => (
                <div key={log.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.85rem 0.9rem", borderRadius: "12px", background: "#fafafa", border: "1px solid #f1f1f1" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#1f2937" }}>{log.actor}</div>
                    <div style={{ color: "#4b5563", marginTop: "0.15rem" }}>{log.message}</div>
                  </div>
                  <div style={{ whiteSpace: "nowrap", color: "#6b7280", fontSize: "0.8rem" }}>
                    {new Date(log.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminDashboardPage;
