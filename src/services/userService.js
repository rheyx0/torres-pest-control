// All account reads/writes. Extracted from App.js, where these lived as
// inline handlers alongside the UI state.
//
// Accounts are split across three Supabase tables (admins / staff /
// technicians) and the role is implied by *which table the row lives in*.
// That is why changing a role is not a normal update — see updateAccount().

import { supabase } from "./supabaseClient";
import { ACCOUNT_STATUS, ROLES } from "../utils/constants";

// Fields the account tables actually accept on write.
//
// `role` is deliberately absent: it is not a column. The old code listed
// these fields the same way, but the UI merged `role` into local state
// anyway, so a role edit appeared to succeed and silently reverted on
// refresh. updateAccount() now rejects the attempt instead of losing it.
const WRITABLE_FIELDS = ["name", "phone", "email", "status", "password"];
const TABLE_BY_ROLE = { ADMIN: "admins", STAFF: "staff", TECHNICIAN: "technicians" };
const ACCOUNT_COLUMNS = "id, name, username, phone, email, status, created_at, updated_at, last_login_at";

// Explicit column lists rather than select("*"): the database revokes
// blanket select and grants only these columns, so "*" is rejected even
// though every column in it is allowed. `password` is intentionally absent.
export function mapAccountRow(row, role) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    username: row.username || row.email,
    role,
    status: row.status,
    isPrimary: row.is_primary || false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || null,
  };
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

function describeAccountRpcError(error, operation) {
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return `${operation} is not available in Supabase. Run supabase/schema-v2.sql and supabase/migrations/009-user-editing-and-stock-cost.sql, then reload the schema.`;
  }
  return describeError(error);
}

/** Loads accounts from the role-specific account tables. */
export async function fetchAllAccounts() {
  const results = await Promise.all(
    Object.entries(TABLE_BY_ROLE).map(async ([role, table]) => {
      const { data, error } = await supabase.from(table).select(ACCOUNT_COLUMNS).order("created_at", { ascending: true });
      return { role, data, error };
    })
  );
  const failed = results.find((result) => result.error);
  if (failed) return { error: describeError(failed.error), admins: [], staff: [], technicians: [] };
  const accounts = results.flatMap(({ role, data }) => (data || []).map((row) => mapAccountRow(row, role)));
  return {
    error: null,
    admins: accounts.filter((account) => account.role === ROLES.ADMIN),
    staff: accounts.filter((account) => account.role === ROLES.STAFF),
    technicians: accounts.filter((account) => account.role === ROLES.TECHNICIAN),
  };
}

/** Returns { account } on success, { error } on failure. */
export async function createAccount(sessionToken, role, fields) {
  const table = TABLE_BY_ROLE[role];
  if (!table) return { error: "Unsupported account role." };
  const { data, error } = await supabase.from(table).insert({
    name: fields.name,
    username: fields.username || fields.email,
    email: fields.email,
    phone: fields.phone || null,
    password: fields.password,
    status: ACCOUNT_STATUS.ACTIVE,
  }).select(ACCOUNT_COLUMNS).single();

  if (error) {
    // Surface the duplicate-email case in plain language rather than raw
    // Postgres text ("duplicate key value violates unique constraint ...").
    if (error.code === "23505") {
      return { error: "That email is already used by another account." };
    }
    return { error: describeError(error) };
  }

  return { account: mapAccountRow(data, role) };
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
  const table = TABLE_BY_ROLE[account.role];
  if (!table) return { error: "Unsupported account role." };
  if (updatedFields.role && updatedFields.role !== account.role) return { error: "Role changes are not supported between separate account tables." };
  const { data, error } = await supabase.from(table).update({
    name: updatedFields.name,
    username: updatedFields.username,
    email: updatedFields.email,
    phone: updatedFields.phone,
    updated_at: new Date().toISOString(),
  }).eq("id", account.id).select(ACCOUNT_COLUMNS).single();
  if (error) return { error: describeError(error) };
  const mapped = mapAccountRow(data, account.role);
  return { account: mapped, updatedAt: data.updated_at };
}

/**
 * Flips ACTIVE <-> INACTIVE.
 *
 * Deactivating blocks future logins (check_login filters on status) but does
 * not delete the row, so the account stays in the records for audit.
 */
export async function setAccountStatus(sessionToken, account, nextStatus) {
  const table = TABLE_BY_ROLE[account.role];
  if (!table) return { error: "Unsupported account role." };
  const { data, error } = await supabase.from(table).update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", account.id).select(ACCOUNT_COLUMNS).single();

  if (error) return { error: describeError(error) };
  return { account: mapAccountRow(data, account.role), updatedAt: data.updated_at };
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
