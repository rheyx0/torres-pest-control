import { useEffect, useMemo, useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import AdminDashboardPage from "./pages/dashboard/AdminDashboardPage";
import ClientProfilesPage from "./pages/clients/ClientProfilesPage";
import CreateClientPage from "./pages/clients/CreateClientPage";
import ClientDetailPage from "./pages/clients/ClientDetailPage";
import UserAccountsPage from "./pages/accounts/UserAccountsPage";
import UserAccountPage from "./pages/accounts/UserAccountPage";
import InventoryPage from "./pages/inventory/InventoryPage";
import LoginPage from "./pages/auth/LoginPage";
import CreateAccountPage from "./pages/accounts/CreateAccountPage";
import { initialClients, initialInventory, initialSystemLogs } from "./data/mockData";
import { supabase } from "./lib/supabaseClient";

const TABLE_BY_ROLE = { ADMIN: "admins", STAFF: "staff", TECHNICIAN: "technicians" };
const ACCOUNT_WRITABLE_FIELDS = ["name", "phone", "email", "status", "password"];

const mapAccountRow = (row, role) => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  username: row.email, // no separate username column — display email instead
  role,
  status: row.status,
  isPrimary: row.is_primary || false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildAccountPayload = (updatedFields) => {
  const payload = {};
  ACCOUNT_WRITABLE_FIELDS.forEach((key) => {
    if (updatedFields[key] !== undefined) payload[key] = updatedFields[key];
  });
  payload.updated_at = new Date().toISOString();
  return payload;
};

function LoadingScreen({ text }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontWeight: 600 }}>
      {text}
    </div>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("torres_session");
    return saved ? JSON.parse(saved) : null;
  });

  const [admins, setAdmins] = useState([]);
  const [staff, setStaff] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState("");

  const [clients, setClients] = useState(() => {
    const saved = localStorage.getItem("torres_clients");
    return saved ? JSON.parse(saved) : initialClients;
  });

  const [inventory, setInventory] = useState(() => {
    const saved = localStorage.getItem("torres_inventory");
    return saved ? JSON.parse(saved) : initialInventory;
  });

  const [logs, setLogs] = useState(() => {
    const saved = localStorage.getItem("torres_logs");
    return saved ? JSON.parse(saved) : initialSystemLogs;
  });

  const addSystemLog = (actor, message, type = "admin") => {
    setLogs((previous) => [
      {
        id: `log-${Date.now()}`,
        actor,
        message,
        timestamp: new Date().toISOString(),
        type,
      },
      ...previous,
    ]);
  };

  useEffect(() => {
    if (session) {
      localStorage.setItem("torres_session", JSON.stringify(session));
    } else {
      localStorage.removeItem("torres_session");
    }
  }, [session]);

  // Fetch the account tables from Supabase whenever a session appears/disappears.
  useEffect(() => {
    if (!session) {
      setAdmins([]);
      setStaff([]);
      setTechnicians([]);
      return;
    }

    let cancelled = false;
    setAccountsLoading(true);
    setAccountsError("");

    // Explicit column lists, not select("*") — the DB only grants access to
    // these specific columns (password is intentionally excluded), and "*"
    // requires full-table access so it gets rejected even though these
    // exact columns are allowed.
    Promise.all([
      supabase.from("admins").select("id, name, phone, email, status, is_primary, created_at, updated_at"),
      supabase.from("staff").select("id, name, phone, email, status, created_at, updated_at"),
      supabase.from("technicians").select("id, name, phone, email, status, created_at, updated_at"),
    ])
      .then(([adminsRes, staffRes, techRes]) => {
        if (cancelled) return;
        const firstError = adminsRes.error || staffRes.error || techRes.error;
        if (firstError) {
          console.error("Failed to load accounts:", firstError);
          setAccountsError(
            `${firstError.message || "Unknown error"}${firstError.details ? ` — ${firstError.details}` : ""}${firstError.hint ? ` (hint: ${firstError.hint})` : ""}${firstError.code ? ` [code: ${firstError.code}]` : ""}`
          );
          return;
        }
        setAdmins((adminsRes.data || []).map((row) => mapAccountRow(row, "ADMIN")));
        setStaff((staffRes.data || []).map((row) => mapAccountRow(row, "STAFF")));
        setTechnicians((techRes.data || []).map((row) => mapAccountRow(row, "TECHNICIAN")));
      })
      .catch((err) => {
        console.error("Unexpected error loading accounts:", err);
        setAccountsError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    localStorage.setItem("torres_clients", JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem("torres_inventory", JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    localStorage.setItem("torres_logs", JSON.stringify(logs));
  }, [logs]);

  const accounts = useMemo(() => [...admins, ...staff, ...technicians], [admins, staff, technicians]);

  const currentUser = useMemo(() => {
    if (!session) return null;
    return accounts.find((account) => account.id === session.id) || null;
  }, [session, accounts]);

  const getCollectionSetter = (role) => {
    if (role === "ADMIN") return setAdmins;
    if (role === "STAFF") return setStaff;
    return setTechnicians;
  };

  const login = async (email, password) => {
    const { data, error } = await supabase.rpc("check_login", {
      login_email: email,
      login_password: password,
    });
    if (error) {
      console.error("Login error:", error);
      return error.message;
    }
    const match = (data || [])[0];
    if (!match) return "Invalid email or password.";

    setSession({ id: match.id, role: match.role });
    addSystemLog(match.name, "Logged in.", "auth");
    return true;
  };

  const logout = () => {
    if (currentUser) {
      addSystemLog(currentUser.name, "Logged out.", "auth");
    }
    setSession(null);
  };

  const updateUserProfile = async (updatedFields) => {
    if (!currentUser) return;
    const table = TABLE_BY_ROLE[currentUser.role];
    const payload = buildAccountPayload(updatedFields);
    const { error } = await supabase.from(table).update(payload).eq("id", currentUser.id);
    if (error) return;

    const setCollection = getCollectionSetter(currentUser.role);
    setCollection((previous) =>
      previous.map((account) =>
        account.id === currentUser.id ? { ...account, ...updatedFields, updatedAt: payload.updated_at } : account
      )
    );
  };

  const updateUserAccount = async (userId, updatedFields) => {
    const targetAccount = accounts.find((account) => account.id === userId);
    if (!targetAccount) return;
    const table = TABLE_BY_ROLE[targetAccount.role];
    const payload = buildAccountPayload(updatedFields);
    const { error } = await supabase.from(table).update(payload).eq("id", userId);
    if (error) return;

    const setCollection = getCollectionSetter(targetAccount.role);
    setCollection((previous) =>
      previous.map((account) =>
        account.id === userId ? { ...account, ...updatedFields, updatedAt: payload.updated_at } : account
      )
    );
    addSystemLog(currentUser?.name || "System", `Updated account for ${targetAccount.name}.`, "admin");
  };

  const toggleUserStatus = async (userId) => {
    const targetAccount = accounts.find((account) => account.id === userId);
    if (!targetAccount) return;
    const nextStatus = targetAccount.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    if (targetAccount.role === "ADMIN" && nextStatus === "INACTIVE") {
      const activeAdmins = admins.filter((admin) => admin.status === "ACTIVE");
      if (activeAdmins.length <= 1) {
        window.alert("At least one active admin account is required.");
        return;
      }
    }

    const table = TABLE_BY_ROLE[targetAccount.role];
    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from(table).update({ status: nextStatus, updated_at: updatedAt }).eq("id", userId);
    if (error) return;

    const setCollection = getCollectionSetter(targetAccount.role);
    setCollection((previous) =>
      previous.map((account) =>
        account.id === userId ? { ...account, status: nextStatus, updatedAt } : account
      )
    );
    addSystemLog(currentUser?.name || "System", `${targetAccount.name} account marked ${nextStatus}.`, "admin");
  };

  const addAccount = async (role, fields) => {
    const table = TABLE_BY_ROLE[role];
    const { data: inserted, error } = await supabase
      .from(table)
      .insert({
        name: fields.name,
        phone: fields.phone,
        email: fields.email,
        password: fields.password,
        status: "ACTIVE",
      })
      .select("id, name, phone, email, status, created_at, updated_at")
      .single();

    if (error) {
      console.error("Create account error:", error);
      return error.message;
    }

    const setCollection = getCollectionSetter(role);
    setCollection((previous) => [...previous, mapAccountRow(inserted, role)]);
    addSystemLog(currentUser?.name || "System", `Created ${role.toLowerCase()} account for ${fields.name}.`, "admin");
    return true;
  };

  const updateClient = (clientId, updatedClient) => {
    setClients((previous) =>
      previous.map((client) => (client.id === clientId ? updatedClient : client))
    );
  };

  const addDocumentToClient = (clientId, document) => {
    setClients((previous) =>
      previous.map((client) => {
        if (client.id !== clientId) return client;
        return { ...client, documents: [...(client.documents || []), document] };
      })
    );
  };

  const removeDocumentFromClient = (clientId, documentId) => {
    setClients((previous) =>
      previous.map((client) => {
        if (client.id !== clientId) return client;
        return { ...client, documents: (client.documents || []).filter((doc) => doc.id !== documentId) };
      })
    );
  };

  const addInventoryItem = (newItem) => {
    setInventory((previous) => [...previous, newItem]);
  };

  const addClient = (newClient) => {
    setClients((previous) => [
      {
        ...newClient,
        id: newClient.id || `client-${Date.now()}`,
        createdAt: newClient.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...previous,
    ]);
  };

  return (
    <Router>
      {!session ? (
        <LoginPage onLogin={login} />
      ) : accountsError ? (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", color: "#374151", textAlign: "center", padding: "2rem" }}>
          <div style={{ fontWeight: 700 }}>Could not load accounts.</div>
          <div style={{ fontSize: "0.85rem", color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "0.75rem 1rem", maxWidth: "560px", wordBreak: "break-word" }}>
            {accountsError}
          </div>
          <button type="button" onClick={logout} style={{ border: "none", borderRadius: "12px", background: "linear-gradient(135deg, #7f1111 0%, #bf3e3e 100%)", color: "#fff", padding: "0.75rem 1.2rem", fontWeight: 700, cursor: "pointer" }}>
            Log Out
          </button>
        </div>
      ) : accountsLoading || !currentUser ? (
        <LoadingScreen text="Loading your account…" />
      ) : (
        <div style={{ display: "flex", minHeight: "100vh", background: "radial-gradient(circle at top left, #fff3f3 0%, #f7f7f8 36%, #f1f5f9 100%)" }}>
          <Sidebar currentUser={currentUser} onLogout={logout} />
          <div style={{ flex: 1, padding: "2.25rem 2rem 2.5rem", background: "transparent" }}>
            <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
              <Routes>
                <Route path="/" element={<AdminDashboardPage users={accounts} clients={clients} logs={logs} />} />
                <Route path="/clients" element={<ClientProfilesPage clients={clients} />} />
                <Route path="/clients/new" element={<CreateClientPage onCreateClient={addClient} />} />
                <Route path="/clients/:id" element={<ClientDetailPage clients={clients} onUpdateClient={updateClient} onAddDocument={addDocumentToClient} onRemoveDocument={removeDocumentFromClient} />} />
                <Route path="/users" element={<UserAccountsPage users={accounts} onEditUser={updateUserAccount} onToggleUserStatus={toggleUserStatus} />} />
                <Route path="/users/new" element={<CreateAccountPage currentUserRole={currentUser.role} onCreateAccount={addAccount} />} />
                <Route path="/account" element={<UserAccountPage user={currentUser} onUpdateUser={updateUserProfile} />} />
                <Route path="/inventory" element={<InventoryPage inventory={inventory} onAddItem={addInventoryItem} />} />
              </Routes>
            </div>
          </div>
        </div>
      )}
    </Router>
  );
}

export default App;
