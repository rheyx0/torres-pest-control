// Providers + routes. Everything else moved out:
//   state/handlers -> context/ and services/
//   layout markup  -> components/layout/Layout
//   access rules   -> components/auth/{ProtectedRoute,RoleBasedRoute}

import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { ClientsProvider } from "./context/ClientsContext";
import { InventoryProvider } from "./context/InventoryContext";

import ProtectedRoute from "./components/auth/ProtectedRoute";
import RoleBasedRoute from "./components/auth/RoleBasedRoute";
import Layout from "./components/layout/Layout";
import AccountsGate from "./components/auth/AccountsGate";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import UsersPage from "./pages/UsersPage";
import CreateUserPage from "./pages/CreateUserPage";
import UserAccountPage from "./pages/UserAccountPage";
import ClientsPage from "./pages/ClientsPage";
import CreateClientPage from "./pages/CreateClientPage";
import ClientDetailPage from "./pages/ClientDetailPage";
import InventoryPage from "./pages/InventoryPage";
import SettingsPage from "./pages/SettingsPage";

import { SUBSYSTEMS } from "./utils/permissions";
import { isSupabaseConfigured } from "./services/supabaseClient";
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
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f6f7f9" }}>
        <section style={{ maxWidth: 560, padding: 32, border: "1px solid #d9dee7", borderRadius: 12, background: "#fff", color: "#172033" }}>
          <h1 style={{ marginTop: 0 }}>Supabase configuration required</h1>
          <p>Create a <code>.env.local</code> file in the project root with these variables, then restart the development server:</p>
          <pre style={{ padding: 16, overflowX: "auto", background: "#f1f3f6", borderRadius: 8 }}>{"REACT_APP_SUPABASE_URL=https://your-project-id.supabase.co\nREACT_APP_SUPABASE_PUBLISHABLE_KEY=your-publishable-key"}</pre>
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
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route path="/" element={<Guarded><DashboardPage /></Guarded>} />
                <Route path="/account" element={<Guarded><UserAccountPage /></Guarded>} />
                <Route
                  path="/settings"
                  element={<Guarded subsystem={SUBSYSTEMS.SETTINGS} action="view"><SettingsPage /></Guarded>}
                />

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
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </InventoryProvider>
          </ClientsProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
