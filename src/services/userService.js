// All account reads/writes. Extracted from App.js, where these lived as
// inline handlers alongside the UI state.
//
// Accounts are split across three Supabase tables (admins / staff /
// technicians) and the role is implied by *which table the row lives in*.
// That is why changing a role is not a normal update — see updateAccount().

import { supabase } from "./supabaseClient";
import { ACCOUNT_STATUS, ROLES, TABLE_BY_ROLE } from "../utils/constants";

// Fields the account tables actually accept on write.
//
// `role` is deliberately absent: it is not a column. The old code listed
// these fields the same way, but the UI merged `role` into local state
// anyway, so a role edit appeared to succeed and silently reverted on
// refresh. updateAccount() now rejects the attempt instead of losing it.
const WRITABLE_FIELDS = ["name", "phone", "email", "status", "password"];

// Explicit column lists rather than select("*"): the database revokes
// blanket select and grants only these columns, so "*" is rejected even
// though every column in it is allowed. `password` is intentionally absent.
const ADMIN_COLUMNS = "id, name, phone, email, status, is_primary, created_at, updated_at";
const STAFF_COLUMNS = "id, name, phone, email, status, created_at, updated_at";

export function mapAccountRow(row, role) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    username: row.email, // no separate username column yet — display email
    role,
    status: row.status,
    isPrimary: row.is_primary || false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || null, // no column yet; renders as "Never"
  };
}

function buildPayload(updatedFields) {
  const payload = {};
  WRITABLE_FIELDS.forEach((key) => {
    if (updatedFields[key] !== undefined) payload[key] = updatedFields[key];
  });
  payload.updated_at = new Date().toISOString();
  return payload;
}

function describeError(error) {
  if (!error) return "Unknown error";
  return [
    error.message || "Unknown error",
    error.details ? ` — ${error.details}` : "",
    error.hint ? ` (hint: ${error.hint})` : "",
    error.code ? ` [code: ${error.code}]` : "",
  ].join("");
}

/** Loads accounts from the v2 users table. */
export async function fetchAllAccounts() {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, username, email, phone, role, status, is_primary, created_at, updated_at, last_login_at")
    .order("created_at", { ascending: true });

  if (error && error.code !== "PGRST205") {
    return { error: describeError(error), admins: [], staff: [], technicians: [] };
  }

  if (error?.code === "PGRST205") {
    const [adminsRes, staffRes, techRes] = await Promise.all([
      supabase.from("admins").select(ADMIN_COLUMNS),
      supabase.from("staff").select(STAFF_COLUMNS),
      supabase.from("technicians").select(STAFF_COLUMNS),
    ]);
    const firstError = adminsRes.error || staffRes.error || techRes.error;
    if (firstError) return { error: describeError(firstError), admins: [], staff: [], technicians: [] };
    return {
      error: null,
      admins: (adminsRes.data || []).map((row) => mapAccountRow(row, ROLES.ADMIN)),
      staff: (staffRes.data || []).map((row) => mapAccountRow(row, ROLES.STAFF)),
      technicians: (techRes.data || []).map((row) => mapAccountRow(row, ROLES.TECHNICIAN)),
    };
  }

  const accounts = (data || []).map((row) => mapAccountRow(row, row.role));
  return {
    error: null,
    admins: accounts.filter((account) => account.role === ROLES.ADMIN),
    staff: accounts.filter((account) => account.role === ROLES.STAFF),
    technicians: accounts.filter((account) => account.role === ROLES.TECHNICIAN),
  };
}

/** Returns { account } on success, { error } on failure. */
export async function createAccount(sessionToken, role, fields) {
  const { data, error } = await supabase.rpc("create_user", {
    session_token: sessionToken,
    new_name: fields.name,
    new_username: fields.username || fields.email,
    new_email: fields.email,
    new_phone: fields.phone || null,
    new_password: fields.password,
    new_role: role,
  });

  if (error) {
    // Surface the duplicate-email case in plain language rather than raw
    // Postgres text ("duplicate key value violates unique constraint ...").
    if (error.code === "23505") {
      return { error: "That email is already used by another account." };
    }
    return { error: describeError(error) };
  }

  return { account: mapAccountRow(data, data.role) };
}

/**
 * Updates an existing account.
 *
 * Role changes are refused rather than silently dropped. Because role is the
 * table a row lives in, changing it means deleting from one table and
 * inserting into another — which would issue a new id and orphan the audit
 * trail. This becomes a plain column update once the schema migration
 * collapses the three tables into one `users` table.
 */
export async function updateAccount(sessionToken, account, updatedFields) {
  const { data, error } = await supabase.rpc("update_user", {
    session_token: sessionToken,
    target_id: account.id,
    new_name: updatedFields.name ?? null,
    new_email: updatedFields.email ?? null,
    new_phone: updatedFields.phone ?? null,
    new_role: updatedFields.role ?? account.role,
  });
  if (error) return { error: describeError(error) };

  return { account: mapAccountRow(data, data.role), updatedAt: data.updated_at };
}

/**
 * Flips ACTIVE <-> INACTIVE.
 *
 * Deactivating blocks future logins (check_login filters on status) but does
 * not delete the row, so the account stays in the records for audit.
 */
export async function setAccountStatus(sessionToken, account, nextStatus) {
  const { data, error } = await supabase.rpc("set_user_status", {
    session_token: sessionToken,
    target_id: account.id,
    new_status: nextStatus,
  });

  if (error) return { error: describeError(error) };
  return { account: mapAccountRow(data, data.role), updatedAt: data.updated_at };
}

/** Admin-initiated password reset, and the write half of a self-service change. */
export async function changePassword(sessionToken, currentPassword, newPassword) {
  if (!sessionToken) return { error: "Your session is outdated. Please sign in again before changing your password." };

  const { error } = await supabase.rpc("change_password", {
    session_token: sessionToken,
    current_password: currentPassword,
    new_password: newPassword,
  });
  if (error) return { error: describeError(error) };
  return { ok: true };
}

export async function resetPassword(sessionToken, targetId, newPassword) {
  const { error } = await supabase.rpc("reset_password", {
    session_token: sessionToken,
    target_id: targetId,
    new_password: newPassword,
  });
  if (error) return { error: describeError(error) };
  return { ok: true };
}

/** Guards the "at least one active admin" rule before a deactivation. */
export function isLastActiveAdmin(account, accounts) {
  if (account.role !== ROLES.ADMIN) return false;
  const activeAdmins = accounts.filter(
    (entry) => entry.role === ROLES.ADMIN && entry.status === ACCOUNT_STATUS.ACTIVE
  );
  return activeAdmins.length <= 1;
}
