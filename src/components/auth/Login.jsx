// The sign-in form. LoginPage owns the route; this owns the fields.

import { useState } from "react";
import Field from "../common/Field";
import { buttonWhen, colors, inputStyle } from "../../styles/theme";

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
    <form
      onSubmit={handleSubmit}
      style={{
        width: "100%",
        maxWidth: "380px",
        background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)",
        border: `1px solid ${colors.softLine}`,
        borderRadius: "20px",
        padding: "2rem",
        boxShadow: "0 18px 32px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <div
          style={{
            color: colors.brand,
            fontWeight: 800,
            fontSize: "1.3rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Torres
        </div>
        <span
          style={{
            display: "block",
            color: colors.brandInk,
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            marginTop: "0.25rem",
          }}
        >
          PEST CONTROL
        </span>
        <h1 style={{ margin: "1rem 0 0", fontSize: "1.4rem", color: colors.ink, fontWeight: 800 }}>
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
            style={inputStyle}
            autoFocus
          />
        </Field>
        <Field label="Password">
          <input
            aria-label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      {error && (
        <div role="alert" style={{ marginTop: "1rem", color: colors.danger, fontWeight: 700, fontSize: "0.9rem" }}>
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting} style={{ ...buttonWhen(submitting), marginTop: "1.5rem", width: "100%" }}>
        {submitting ? "Signing in…" : "Log In"}
      </button>
    </form>
  );
}

export default Login;
