import { useEffect, useMemo, useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import ClientProfilesPage from "./pages/ClientProfilesPage";
import CreateClientPage from "./pages/CreateClientPage";
import ClientDetailPage from "./pages/ClientDetailPage";
import UserAccountsPage from "./pages/UserAccountsPage";
import UserAccountPage from "./pages/UserAccountPage";
import InventoryPage from "./pages/InventoryPage";
import { initialClients, initialInventory, initialSystemLogs, initialUsers } from "./data/mockData";

function App() {
  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem("torres_users");
    return saved ? JSON.parse(saved) : initialUsers;
  });

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

  const currentUser = useMemo(() => users[0], [users]);

  useEffect(() => {
    localStorage.setItem("torres_users", JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem("torres_clients", JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem("torres_inventory", JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    localStorage.setItem("torres_logs", JSON.stringify(logs));
  }, [logs]);

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

  const updateUserProfile = (updatedFields) => {
    setUsers((previous) =>
      previous.map((user) =>
        user.id === currentUser.id
          ? { ...user, ...updatedFields, updatedAt: new Date().toISOString() }
          : user
      )
    );
  };

  const updateUserAccount = (userId, updatedFields) => {
    setUsers((previous) =>
      previous.map((user) =>
        user.id === userId ? { ...user, ...updatedFields, updatedAt: new Date().toISOString() } : user
      )
    );
    const targetUser = users.find((user) => user.id === userId);
    if (targetUser) {
      addSystemLog(currentUser?.name || "System", `Updated account for ${targetUser.name}.`, "admin");
    }
  };

  const toggleUserStatus = (userId) => {
    setUsers((previous) =>
      previous.map((user) => {
        if (user.id !== userId) return user;
        const nextStatus = user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
        return { ...user, status: nextStatus, updatedAt: new Date().toISOString() };
      })
    );
    const targetUser = users.find((user) => user.id === userId);
    if (targetUser) {
      const nextStatus = targetUser.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      addSystemLog(currentUser?.name || "System", `${targetUser.name} account marked ${nextStatus}.`, "admin");
    }
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
      <div style={{ display: "flex", minHeight: "100vh", background: "radial-gradient(circle at top left, #fff3f3 0%, #f7f7f8 36%, #f1f5f9 100%)" }}>
        <Sidebar />
        <div style={{ flex: 1, padding: "2.25rem 2rem 2.5rem", background: "transparent" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
            <Routes>
              <Route path="/" element={<AdminDashboardPage users={users} clients={clients} logs={logs} />} />
              <Route path="/clients" element={<ClientProfilesPage clients={clients} />} />
              <Route path="/clients/new" element={<CreateClientPage onCreateClient={addClient} />} />
              <Route path="/clients/:id" element={<ClientDetailPage clients={clients} onUpdateClient={updateClient} onAddDocument={addDocumentToClient} onRemoveDocument={removeDocumentFromClient} />} />
              <Route path="/users" element={<UserAccountsPage users={users} onEditUser={updateUserAccount} onToggleUserStatus={toggleUserStatus} />} />
              <Route path="/account" element={<UserAccountPage user={currentUser} onUpdateUser={updateUserProfile} />} />
              <Route path="/inventory" element={<InventoryPage inventory={inventory} onAddItem={addInventoryItem} />} />
            </Routes>
          </div>
        </div>
      </div>
    </Router>
  );
}

export default App;
