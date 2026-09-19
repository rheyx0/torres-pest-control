// The sign-in form. LoginPage owns the route; this owns the fields.

import { useState } from "react";
import { Link } from "react-router-dom";

function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus("");

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());
    const passOk = password.length >= 8;

    if (!emailOk) {
      setError("Enter a valid email address, like you@example.com.");
      return;
    }

    if (!passOk) {
      setError("Your password needs at least 8 characters.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const result = await onLogin?.(identifier.trim(), password);

      if (result !== true) {
        setError(typeof result === "string" ? result : "Invalid email or password.");
        return;
      }

      setStatus("Signed in. This is a demo, so there is nowhere to redirect to.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="standalone-login-card">
      <section className="standalone-form-panel" aria-labelledby="title">
        <span className="accent-bar" aria-hidden="true" />

        <div className="standalone-form-inner">
          <div className="tp-logo" aria-label="Torres Pest Control logo" role="img">
            <img src="/login-logo.png" alt="Torres Pest Control logo" className="tp-logo-image" />
          </div>

          <h1 id="title">Welcome back</h1>
          <p className="sub">Sign in to pick up right where you left off.</p>

          <form className="standalone-login-form" noValidate onSubmit={handleSubmit}>
            <div className="field">
              <label className="lbl" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  if (error) setError("");
                }}
                aria-invalid={Boolean(error)}
              />
            </div>

            <div className="field">
              <label className="lbl" htmlFor="password">Password</label>
              <div className="input-wrap">
                <input
                  id="password"
                  name="password"
                  className="input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError("");
                  }}
                  aria-invalid={Boolean(error)}
                />
                <button
                  className="toggle-pw"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  aria-controls="password"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  <svg className="icon-show" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" hidden={showPassword}>
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg className="icon-hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" hidden={!showPassword}>
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="row">
              <label className="check">
                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                <span>Keep me signed in</span>
              </label>
              <Link className="link" to="/forgot-password">
                Forgot password?
              </Link>
            </div>

            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>

            {error && <p className="err" role="alert">{error}</p>}
            {status && <p className="status" role="status">{status}</p>}
          </form>
        </div>
      </section>

      <aside className="hero-layer on-red" aria-label="Torres Pest Control welcome message">
        <div className="hero">
          <div className="bar" aria-hidden="true" />
          <h2>Good to see you again</h2>
        </div>
      </aside>

      <div className="hero-layer on-cream" aria-hidden="true">
        <div className="hero">
          <div className="bar" aria-hidden="true" />
          <h2>Good to see you again</h2>
        </div>
      </div>
    </main>
  );
}

export default Login;
