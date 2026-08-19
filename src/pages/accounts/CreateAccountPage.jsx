import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const emptyForm = { name: "", phone: "", email: "", password: "", role: "STAFF" };

function CreateAccountPage({ currentUserRole, onCreateAccount }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await onCreateAccount?.(form.role, {
      name: form.name,
      phone: form.phone,
      email: form.email,
      password: form.password,
    });
    setSubmitting(false);
    if (result === true) {
      navigate("/users");
    } else {
      setError(typeof result === "string" ? result : "Something went wrong creating the account.");
    }
  };

  if (currentUserRole !== "ADMIN") {
    return (
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "2rem", background: "#fff", borderRadius: "16px" }}>
        Only admins can create accounts.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ color: "#8b1e1e", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.72rem" }}>
          System Access
        </p>
        <h1 style={{ margin: "0.3rem 0 0", fontSize: "2.2rem", color: "#0f172a", fontWeight: 800 }}>Create Account</h1>
      </div>

      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "16px", padding: "1rem 1.25rem", marginBottom: "1.5rem", color: "#166534", fontSize: "0.9rem", lineHeight: 1.6 }}>
        This creates their login and profile in one step. Pick a temporary password and share it with them
        separately (text, chat, etc.) — they can log in with it right away.
      </div>

      <form onSubmit={handleSubmit} style={{ background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: "20px", padding: "1.5rem", boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)" }}>
        <div style={{ display: "grid", gap: "1rem" }}>
          <Field label="Full Name">
            <input aria-label="Full Name" name="name" value={form.name} onChange={handleFieldChange} style={inputStyle} required />
          </Field>

          <Field label="Phone">
            <input aria-label="Phone" name="phone" value={form.phone} onChange={handleFieldChange} style={inputStyle} />
          </Field>

          <Field label="Email">
            <input aria-label="Email" name="email" type="email" value={form.email} onChange={handleFieldChange} style={inputStyle} required />
          </Field>

          <Field label="Temporary Password (at least 6 characters)">
            <input aria-label="Temporary Password" name="password" type="text" value={form.password} onChange={handleFieldChange} style={inputStyle} required minLength={6} />
          </Field>

          <Field label="Role">
            <select aria-label="Role" name="role" value={form.role} onChange={handleFieldChange} style={inputStyle}>
              <option value="STAFF">STAFF</option>
              <option value="TECHNICIAN">TECHNICIAN</option>
            </select>
          </Field>
        </div>

        {error && <div style={{ marginTop: "1rem", color: "#b91c1c", fontWeight: 700, fontSize: "0.9rem" }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button type="submit" disabled={submitting} style={{ border: "none", borderRadius: "12px", background: "linear-gradient(135deg, #7f1111 0%, #bf3e3e 100%)", color: "#fff", padding: "0.9rem 1.2rem", fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1, boxShadow: "0 12px 24px rgba(127, 17, 17, 0.22)" }}>
            {submitting ? "Creating…" : "Create Account"}
          </button>
          <Link to="/users" style={{ color: "#8b1e1e", textDecoration: "none", fontWeight: 700 }}>
            Back to User Accounts
          </Link>
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

export default CreateAccountPage;
