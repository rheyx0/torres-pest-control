// Admin / System Admin view: account oversight plus the activity log.

import { Link } from "react-router-dom";
import { BriefcaseBusiness, ShieldCheck, Users } from "lucide-react";
import MetricCard from "../common/MetricCard";
import PageHeader from "../common/PageHeader";
import ActivityFeed from "./ActivityFeed";
import useUsers from "../../hooks/useUsers";
import useClients from "../../hooks/useClients";
import useLogs from "../../hooks/useLogs";
import { ACCOUNT_STATUS, ROLES } from "../../utils/constants";
import { colors, pageShell } from "../../styles/theme";

function AdminDashboard() {
  const { users } = useUsers();
  const { clients } = useClients();
  const logs = useLogs(6);

  const totalStaffAccounts = users.filter((user) => user.role !== ROLES.ADMIN).length;
  const activeAccounts = users.filter(
    (user) => (user.status || "").toUpperCase() === ACCOUNT_STATUS.ACTIVE
  ).length;

  return (
    <div style={pageShell}>
      <PageHeader eyebrow="Overview" title="Admin Dashboard" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <MetricCard
          title="Total Staff Accounts"
          value={totalStaffAccounts}
          accent={`linear-gradient(135deg, ${colors.brand} 0%, #b43d3d 100%)`}
          Icon={Users}
        />
        <MetricCard
          title="Active Accounts"
          value={activeAccounts}
          accent="linear-gradient(135deg, #0f766e 0%, #34d399 100%)"
          Icon={ShieldCheck}
        />
        <MetricCard
          title="Total Clients"
          value={clients.length}
          accent="linear-gradient(135deg, #374151 0%, #64748b 100%)"
          Icon={BriefcaseBusiness}
        />
      </div>

      <ActivityFeed
        logs={logs}
        footer={
          <Link to="/activity" style={{ color: colors.brandInk, fontWeight: 700, textDecoration: "none" }}>
            View full activity log →
          </Link>
        }
      />
    </div>
  );
}

export default AdminDashboard;
