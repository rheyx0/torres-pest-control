// Login / logout / session persistence.
//
// Supabase Auth is deliberately not used — see the header comment in
// supabase/schema.sql. Credentials are checked by this project's own
// check_login() SQL function against the admins/staff/technicians tables.

import { supabase } from "./supabaseClient";
import { STORAGE_KEYS } from "../utils/constants";

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
  const { data, error } = await supabase.rpc("check_login", {
    login_email: email,
    login_password: password,
  });

  if (error) {
    console.error("Login error:", error);
    return { error: "Invalid email or password." };
  }

  const match = (data || [])[0];
  if (!match) return { error: "Invalid email or password." };

  return {
    session: { id: match.id, role: match.role },
    profile: match,
  };
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
  const { data, error } = await supabase.rpc("check_login", {
    login_email: email,
    login_password: password,
  });

  if (error) return false;
  return (data || []).length > 0;
}
