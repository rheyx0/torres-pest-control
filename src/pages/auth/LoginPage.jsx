import { useState } from "react";

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await onLogin?.(email, password);
    setSubmitting(false);
    if (result !== true) {
      setError(typeof result === "string" ? result : "Invalid email or password.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at top left, #fff3f3 0%, #f7f7f8 36%, #f1f5f9 100%)" }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: "380px", background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: "20px", padding: "2rem", boxShadow: "0 18px 32px rgba(15, 23, 42, 0.08)" }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ color: "#7f1111", fontWeight: 800, fontSize: "1.3rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>Torres</div>
          <span style={{ display: "block", color: "#8b1e1e", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", marginTop: "0.25rem" }}>PEST CONTROL</span>
          <h1 style={{ margin: "1rem 0 0", fontSize: "1.4rem", color: "#0f172a", fontWeight: 800 }}>Sign In</h1>
        </div>

        <div style={{ display: "grid", gap: "1rem" }}>
          <Field label="Email">
            <input aria-label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} style={inputStyle} autoFocus />
          </Field>
          <Field label="Password">
            <input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} />
          </Field>
        </div>

        {error && <div style={{ marginTop: "1rem", color: "#b91c1c", fontWeight: 700, fontSize: "0.9rem" }}>{error}</div>}

        <button type="submit" disabled={submitting} style={{ marginTop: "1.5rem", width: "100%", border: "none", borderRadius: "12px", background: "linear-gradient(135deg, #7f1111 0%, #bf3e3e 100%)", color: "#fff", padding: "0.9rem 1.2rem", fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1, boxShadow: "0 12px 24px rgba(127, 17, 17, 0.22)" }}>
          {submitting ? "Signing in…" : "Log In"}
        </button>
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

export default LoginPage;
