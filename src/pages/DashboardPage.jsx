// Dashboard route — picks the dashboard that matches the signed-in role.
//
// Sprint AC (Login): "User is redirected to the appropriate dashboard based
// on role." Previously every role landed on the Admin Dashboard, so a
// technician saw account counts and the full activity log.

import AdminDashboard from "../components/dashboard/AdminDashboard";
import StaffDashboard from "../components/dashboard/StaffDashboard";
import TechnicianDashboard from "../components/dashboard/TechnicianDashboard";
import useAuth from "../hooks/useAuth";
import { ROLES } from "../utils/constants";

const DASHBOARD_BY_ROLE = {
  [ROLES.ADMIN]: AdminDashboard,
  [ROLES.SYSTEM_ADMIN]: AdminDashboard,
  [ROLES.OWNER]: AdminDashboard,
  [ROLES.MANAGER]: StaffDashboard,
  [ROLES.STAFF]: StaffDashboard,
  [ROLES.TECHNICIAN]: TechnicianDashboard,
};

function DashboardPage() {
  const { role } = useAuth();
  const Dashboard = DASHBOARD_BY_ROLE[role] || TechnicianDashboard;
  return <Dashboard />;
}

export default DashboardPage;
