// Providers + routes. Everything else moved out:
//   state/handlers -> context/ and services/
//   layout markup  -> components/layout/Layout
//   access rules   -> components/auth/{ProtectedRoute,RoleBasedRoute}

import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { ClientsProvider } from "./context/ClientsContext";
import { InventoryProvider } from "./context/InventoryContext";
import { ServicesProvider } from "./context/ServicesContext";
import { SchedulingProvider } from "./context/SchedulingContext";
import { NotificationsProvider } from "./context/NotificationsContext";

import ProtectedRoute from "./components/auth/ProtectedRoute";
import RoleBasedRoute from "./components/auth/RoleBasedRoute";
import Layout from "./components/layout/Layout";
import AccountsGate from "./components/auth/AccountsGate";

import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ActivityLogPage from "./pages/ActivityLogPage";
import VisitPage from "./pages/VisitPage";
import DashboardPage from "./pages/DashboardPage";
import UsersPage from "./pages/UsersPage";
import CreateUserPage from "./pages/CreateUserPage";
import UserAccountPage from "./pages/UserAccountPage";
import SettingsPage from "./pages/SettingsPage";
import ClientsPage from "./pages/ClientsPage";
import CreateClientPage from "./pages/CreateClientPage";
import ClientDetailPage from "./pages/ClientDetailPage";
import InventoryPage from "./pages/InventoryPage";
import SchedulingPage from "./pages/SchedulingPage";
import ServicesPage from "./pages/ServicesPage";

import { SUBSYSTEMS } from "./utils/permissions";
import { isSupabaseConfigured } from "./services/supabaseClient";
import { appBackground, card, heading } from "./styles/theme";
import "./styles/globals.css";

/** Wraps a route in auth + layout, and optionally a permission check. */
function Guarded({ subsystem, action, children }) {
  const page = subsystem ? (
    <RoleBasedRoute subsystem={subsystem} action={action}>
      {children}
    </RoleBasedRoute>
  ) : (
    children
  );

  return (
    <ProtectedRoute>
      <AccountsGate>
        <Layout>{page}</Layout>
      </AccountsGate>
    </ProtectedRoute>
  );
}

function App() {
  if (!isSupabaseConfigured) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: appBackground }}>
        <section style={{ ...card, maxWidth: 560 }}>
          <h1 style={{ ...heading, fontSize: "19px", marginBottom: 12 }}>Supabase configuration required</h1>
          <p>Create a <code>.env.local</code> file in the project root with these variables, then restart the development server:</p>
          <pre style={{ padding: 15, overflowX: "auto", background: "#efe9e0", borderRadius: "3.75px", fontSize: 13 }}>{"REACT_APP_SUPABASE_URL=https://your-project-id.supabase.co\nREACT_APP_SUPABASE_PUBLISHABLE_KEY=your-publishable-key"}</pre>
        </section>
      </main>
    );
  }

  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          <ClientsProvider>
            <InventoryProvider>
              <ServicesProvider>
              <SchedulingProvider>
                <NotificationsProvider>
                <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />

                <Route path="/" element={<Guarded><DashboardPage /></Guarded>} />
                <Route path="/account" element={<Guarded><UserAccountPage /></Guarded>} />
                <Route path="/settings" element={<Guarded><SettingsPage /></Guarded>} />
                <Route
                  path="/users"
                  element={<Guarded subsystem={SUBSYSTEMS.USERS} action="view"><UsersPage /></Guarded>}
                />
                <Route
                  path="/users/new"
                  element={<Guarded subsystem={SUBSYSTEMS.USERS} action="create"><CreateUserPage /></Guarded>}
                />

                <Route
                  path="/clients"
                  element={<Guarded subsystem={SUBSYSTEMS.CLIENTS} action="view"><ClientsPage /></Guarded>}
                />
                <Route
                  path="/clients/new"
                  element={<Guarded subsystem={SUBSYSTEMS.CLIENTS} action="create"><CreateClientPage /></Guarded>}
                />
                <Route
                  path="/clients/:id"
                  element={<Guarded subsystem={SUBSYSTEMS.CLIENTS} action="view"><ClientDetailPage /></Guarded>}
                />

                <Route
                  path="/inventory"
                  element={<Guarded subsystem={SUBSYSTEMS.INVENTORY} action="view"><InventoryPage /></Guarded>}
                />
                <Route
                  path="/scheduling"
                  element={<Guarded subsystem={SUBSYSTEMS.SCHEDULING} action="view"><SchedulingPage /></Guarded>}
                />
                <Route
                  path="/services"
                  element={<Guarded subsystem={SUBSYSTEMS.SETTINGS} action="view"><ServicesPage /></Guarded>}
                />
                <Route
                  path="/visit/:id"
                  element={<Guarded subsystem={SUBSYSTEMS.SCHEDULING} action="view"><VisitPage /></Guarded>}
                />
                <Route
                  path="/activity"
                  element={<Guarded subsystem={SUBSYSTEMS.LOGS} action="view"><ActivityLogPage /></Guarded>}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </NotificationsProvider>
              </SchedulingProvider>
              </ServicesProvider>
            </InventoryProvider>
          </ClientsProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
