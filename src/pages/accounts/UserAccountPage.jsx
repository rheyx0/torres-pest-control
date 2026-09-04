import { useState } from "react";

function UserAccountPage({ user, onUpdateUser }) {
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    username: user?.username || "",
  });
  const [message, setMessage] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onUpdateUser({
      name: form.name,
      email: form.email,
      username: form.username,
    });
    setMessage("Your profile has been updated.");
  };

  if (!user) {
    return <div style={{ padding: "2rem", background: "#fff", borderRadius: "16px" }}>No active user found.</div>;
  }

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ color: "#8b1e1e", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.72rem" }}>
          Profile
        </p>
        <h1 style={{ margin: "0.3rem 0 0", fontSize: "2.2rem", color: "#0f172a", fontWeight: 800 }}>User Account Profile</h1>
      </div>

      <form onSubmit={handleSubmit} style={{ background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: "20px", padding: "1.5rem", boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)" }}>
        <div style={{ display: "grid", gap: "1rem" }}>
          <Field label="Full Name">
            <input name="name" value={form.name} onChange={handleChange} style={inputStyle} />
          </Field>

          <Field label="Email Address">
            <input name="email" type="email" value={form.email} onChange={handleChange} style={inputStyle} />
          </Field>

          <Field label="Username">
            <input name="username" value={form.username} onChange={handleChange} style={inputStyle} />
          </Field>

          <Field label="Role">
            <input value={user.role} readOnly style={{ ...inputStyle, background: "#f9fafb", color: "#6b7280" }} />
          </Field>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button type="submit" style={{ border: "none", borderRadius: "12px", background: "linear-gradient(135deg, #7f1111 0%, #bf3e3e 100%)", color: "#fff", padding: "0.9rem 1.2rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 12px 24px rgba(127, 17, 17, 0.22)" }}>
            Save Changes
          </button>
          {message && <span style={{ color: "#1f7a5f", fontWeight: 700 }}>{message}</span>}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: "0.5rem", color: "#374151", fontWeight: 700 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid #dfe4ea",
  borderRadius: "12px",
  padding: "0.8rem 0.9rem",
  fontSize: "0.96rem",
  background: "#ffffff",
  color: "#111827",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

export default UserAccountPage;
