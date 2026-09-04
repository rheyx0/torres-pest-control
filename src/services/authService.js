// Login / logout / session persistence.
//
// Supabase Auth is deliberately not used — see the header comment in
// supabase/schema.sql. Credentials are checked by this project's own
// check_login() SQL function against the admins/staff/technicians tables.

import { supabase } from "./supabaseClient";
import { STORAGE_KEYS } from "../utils/constants";

function describeLoginError(error) {
  if (!error) return "Login service is unavailable.";
  // Show the real error so we can diagnose connection / schema issues.
  const detail = [
    error.message || "Unknown error",
    error.code ? ` [code: ${error.code}]` : "",
    error.details ? ` — ${error.details}` : "",
    error.hint ? ` (hint: ${error.hint})` : "",
  ].join("");
  if (error.code === "PGRST202" || error.code === "42883") {
    return `check_login not found: ${detail}. Run supabase/schema-v2.sql in Supabase SQL Editor.`;
  }
  return detail || "Login service is unavailable.";
}

async function checkLogin(email, password) {
  const v2Response = await supabase.rpc("check_login", {
    login_identifier: email,
    login_password: password,
  });

  // Only fall back to the old v1 parameter names when PostgREST itself says
  // the v2 signature doesn't exist in the schema cache (PGRST202).
  // Do NOT fall back on 42883 — that is a Postgres-level error that can come
  // from *inside* the function (e.g. missing pgcrypto extension), and
  // retrying with different param names won't help.
  if (!v2Response.error || v2Response.error.code !== "PGRST202") {
    return v2Response;
  }

  return supabase.rpc("check_login", {
    login_email: email,
    login_password: password,
  });
}

/**
 * Sprint AC (Login): "System validates credentials and denies access if
 * incorrect" and "Failed login attempts show an error message without
 * revealing which field was incorrect."
 *
 * Both the no-match case and the backend-error case return the same generic
 * string. The old code returned error.message straight from Postgres, which
 * leaked backend detail into the login form.
 *
 * @returns {{ session?: {id, role}, profile?: object, error?: string }}
 */
export async function login(email, password) {
  const { data, error } = await checkLogin(email, password);

  if (error) {
    console.error("Login error:", error);
    return { error: describeLoginError(error) };
  }

  const match = (data || [])[0];
  if (!match) return { error: "Invalid email or password." };
  if (!match.token) {
    return {
      error: "The database is using the old login function. Apply schema-v2.sql and migration 008, then try again.",
    };
  }

  return {
    session: { token: match.token, id: match.id, role: match.role },
    profile: match,
  };
}

/** Validate the opaque session issued by check_login(). */
export async function validateSession(token) {
  if (!token) return { error: "Session expired." };

  const { data, error } = await supabase.rpc("validate_session", { session_token: token });
  if (error) return { error: "Session expired." };

  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile || profile.status !== "ACTIVE") return { error: "Session expired." };
  return { profile };
}

export async function logout(token) {
  if (!token) return;
  await supabase.rpc("logout", { session_token: token });
}

export function loadSession() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SESSION);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  if (session) {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
  }
}

/**
 * Verifies a stored password before allowing a self-service change.
 * Sprint AC (Change Password): "entering current and new password".
 *
 * Reuses check_login because the password column is not readable directly —
 * column-level grants hide it from ordinary selects.
 */
export async function verifyPassword(email, password) {
  const { data, error } = await checkLogin(email, password);

  if (error) return false;
  return (data || []).length > 0;
}
