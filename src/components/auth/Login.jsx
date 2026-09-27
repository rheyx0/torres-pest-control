// The sign-in form. LoginPage owns the route; this owns the fields.

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";

function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Off by default: this app runs on shared office PCs, and a session that
  // outlives the browser there is someone else's session tomorrow.
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    // No format or length rules here on purpose. check_login() matches the
    // identifier against BOTH email and username, so an email regex would
    // lock out every username holder. The only thing worth catching in the
    // browser is an empty box.
    if (!identifier.trim()) {
      setError("Enter your email or username.");
      return;
    }

    if (!password) {
      setError("Enter your password.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const result = await onLogin?.(identifier.trim(), password, { remember: rememberMe });
      if (result !== true) setError(typeof result === "string" ? result : "Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby="login-title">
      <p className="auth-eyebrow">Staff sign-in</p>
      <h1 id="login-title">Welcome back</h1>
      <p className="auth-lede">Use the account your administrator gave you.</p>

      <label className="auth-label" htmlFor="login-identifier">
        Email or username
      </label>
      <input
        id="login-identifier"
        name="email"
        className="auth-input"
        type="text"
        autoComplete="username"
        placeholder="jun@torres.ph"
        value={identifier}
        onChange={(event) => {
          setIdentifier(event.target.value);
          if (error) setError("");
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "login-error" : undefined}
      />

      <div className="auth-label">
        <label htmlFor="login-password">Password</label>
        <Link className="auth-link" to="/forgot-password">
          Forgot password?
        </Link>
      </div>
      <div className="auth-input-wrap">
        <input
          id="login-password"
          name="password"
          className="auth-input"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError("");
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
        />
        <button
          className="auth-toggle"
          type="button"
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          aria-controls="login-password"
          onClick={() => setShowPassword((current) => !current)}
        >
          {showPassword ? <EyeOff aria-hidden="true" strokeWidth={1.6} /> : <Eye aria-hidden="true" strokeWidth={1.6} />}
        </button>
      </div>

      <label className="auth-check">
        <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
        Keep me signed in on this device
      </label>

      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
        {!submitting && <ArrowRight size={19} strokeWidth={1.8} aria-hidden="true" />}
      </button>

      {error && (
        <p className="auth-error" id="login-error" role="alert">
          {error}
        </p>
      )}

      <p className="auth-note">
        <Lock size={15} strokeWidth={1.6} aria-hidden="true" />
        Shared computer? Leave “keep me signed in” off.
      </p>
    </form>
  );
}

export default Login;
