import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

function UserAccountsPage({ users, onEditUser, onToggleUserStatus }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", role: "STAFF", status: "ACTIVE" });

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;

    return users.filter((user) => {
      const searchable = `${user.name || ""} ${user.username || ""} ${user.email || ""} ${user.role || ""}`.toLowerCase();
      return searchable.includes(term);
    });
  }, [users, searchTerm]);

  const startEdit = (user) => {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, role: user.role, status: user.status });
  };

  const handleSave = (userId) => {
    onEditUser?.(userId, {
      name: form.name,
      email: form.email,
      role: form.role,
      status: form.status,
    });
    setEditingId(null);
  };

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ color: "#8b1e1e", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.72rem" }}>
          System Access
        </p>
        <h1 style={{ margin: "0.3rem 0 0", fontSize: "2.2rem", color: "#0f172a", fontWeight: 800 }}>User Accounts</h1>
      </div>

      <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: "20px", padding: "1rem 1.25rem", boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <label style={{ display: "block", fontWeight: 700, color: "#374151", marginBottom: "0.5rem", flex: 1 }}>Search user</label>
          <Link
            to="/account"
            style={{ border: "none", background: "linear-gradient(135deg, #7f1111 0%, #bf3e3e 100%)", color: "#fff", borderRadius: "12px", padding: "0.8rem 1rem", fontWeight: 700, cursor: "pointer", textDecoration: "none", boxShadow: "0 12px 24px rgba(127, 17, 17, 0.22)" }}
          >
            User Account Profile
          </Link>
        </div>

        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by name, username, email, or role"
          style={{ width: "100%", border: "1px solid #dfe4ea", borderRadius: "12px", padding: "0.85rem 0.9rem", fontSize: "0.96rem", boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)" }}
        />

        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          {filteredUsers.length === 0 ? (
            <div style={{ padding: "1.25rem", background: "#fafafa", borderRadius: "12px", color: "#6b7280" }}>
              No users found.
            </div>
          ) : (
            filteredUsers.map((user) => {
              const isEditing = editingId === user.id;

              return (
                <div key={user.id} style={{ border: "1px solid #efefef", borderRadius: "12px", padding: "1rem", display: "grid", gap: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#111827" }}>{user.name}</div>
                      <div style={{ color: "#6b7280", marginTop: "0.15rem" }}>{user.email}</div>
                    </div>
                    <span style={{ background: "#fef2f2", color: "#8b1e1e", borderRadius: "999px", padding: "0.35rem 0.7rem", fontWeight: 700, fontSize: "0.8rem" }}>
                      {user.role}
                    </span>
                  </div>

                  {isEditing ? (
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
                        <Field label="Name">
                          <input value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} style={inputStyle} />
                        </Field>
                        <Field label="Email">
                          <input type="email" value={form.email} onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))} style={inputStyle} />
                        </Field>
                        <Field label="Role">
                          <select value={form.role} onChange={(event) => setForm((previous) => ({ ...previous, role: event.target.value }))} style={inputStyle}>
                            <option value="ADMIN">ADMIN</option>
                            <option value="STAFF">STAFF</option>
                            <option value="TECHNICIAN">TECHNICIAN</option>
                          </select>
                        </Field>
                        <Field label="Status">
                          <select value={form.status} onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value }))} style={inputStyle}>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="INACTIVE">INACTIVE</option>
                          </select>
                        </Field>
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => handleSave(user.id)} style={{ border: "none", background: "linear-gradient(135deg, #7f1111 0%, #bf3e3e 100%)", color: "#fff", borderRadius: "12px", padding: "0.75rem 1rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 12px 24px rgba(127, 17, 17, 0.22)" }}>
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} style={{ border: "1px solid #dfe4ea", background: "#fff", color: "#111827", borderRadius: "12px", padding: "0.75rem 1rem", fontWeight: 700, cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
                      <InfoRow label="Username" value={user.username} />
                      <InfoRow label="Status" value={user.status} />
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                    <button type="button" onClick={() => startEdit(user)} style={{ border: "1px solid #dfe4ea", background: "#fff", color: "#111827", borderRadius: "12px", padding: "0.7rem 0.9rem", fontWeight: 700, cursor: "pointer" }}>
                      Edit User
                    </button>
                    <button type="button" onClick={() => onToggleUserStatus?.(user.id)} style={{ border: "none", background: user.status === "ACTIVE" ? "linear-gradient(135deg, #475569 0%, #64748b 100%)" : "linear-gradient(135deg, #0f766e 0%, #34d399 100%)", color: "#fff", borderRadius: "12px", padding: "0.7rem 0.9rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 18px rgba(15, 23, 42, 0.12)" }}>
                      {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: "0.45rem", color: "#374151", fontWeight: 700 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)", borderRadius: "12px", padding: "0.85rem 1rem", border: "1px solid #edf2f7" }}>
      <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontWeight: 700, color: "#111827" }}>{value || "—"}</div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid #dfe4ea",
  borderRadius: "12px",
  padding: "0.75rem 0.8rem",
  fontSize: "0.96rem",
  background: "#ffffff",
  color: "#111827",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

export default UserAccountsPage;
