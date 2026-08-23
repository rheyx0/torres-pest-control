// The sign-in form. LoginPage owns the route; this owns the fields.

import { useState } from "react";
import Field from "../common/Field";
import { colors } from "../../styles/theme";

function Login({ onLogin }) {
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

    // Sprint AC: the message must not reveal which field was wrong, so both
    // the "no such account" and "wrong password" cases land here identically.
    if (result !== true) {
      setError(typeof result === "string" ? result : "Invalid email or password.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="login-card">
      <div className="login-heading">
        <img className="login-logo" src="/login-logo.png" alt="Torres Pest Control" />
        <h1 style={{ margin: "0.45rem 0 0", fontSize: "1.05rem", color: colors.ink, fontWeight: 800 }}>
          Sign In
        </h1>
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        <Field label="Email">
          <input
            aria-label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={loginInputStyle}
            autoFocus
          />
        </Field>
        <Field label="Password">
          <input
            aria-label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={loginInputStyle}
          />
        </Field>
      </div>

      {error && (
        <div role="alert" style={{ marginTop: "1rem", color: colors.danger, fontWeight: 700, fontSize: "0.9rem" }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        className="login-submit-button"
        disabled={submitting}
        style={{ ...loginButtonStyle, opacity: submitting ? 0.7 : 1, cursor: submitting ? "default" : "pointer" }}
      >
        {submitting ? "Signing in…" : "Log In"}
      </button>
    </form>
  );
}

const loginInputStyle = {
  width: "100%",
  border: "1px solid #d9e3f3",
  borderRadius: "12px",
  padding: "0.82rem 0.9rem",
  fontSize: "0.96rem",
  background: "#eaf1fd",
  color: colors.body,
  boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.03)",
};

const loginButtonStyle = {
  marginTop: "1rem",
  width: "100%",
  border: "none",
  borderRadius: "12px",
  background: "linear-gradient(100deg, #9d1212 0%, #c83e3e 100%)",
  color: "#fff",
  padding: "0.78rem 1rem",
  fontWeight: 800,
  boxShadow: "0 12px 24px rgba(127, 17, 17, 0.24)",
};

export default Login;
