// System activity log.
//
// Sprint 1 (Edit / Deactivate User Account): "Changes are logged in the
// system activity log", and "Deactivated accounts remain in records for
// audit purposes."
//
// Stored in the database since migration 059 (system_logs), so it is one
// shared, append-only audit trail rather than a per-browser list. Entries go
// in through add_system_log(), which works out WHO from the session on the
// server — the `actor` a caller passes is not trusted, and is only used for
// the browser fallback below.
//
// Before 059 is applied there is no table, and the log falls back to this
// browser's localStorage as it used to, so nothing is lost in the meantime.
//
// The tiny subscriber list exists so any service can log without needing a
// React setter passed down to it. useLogs() subscribes on mount and reloads
// when an entry is written.

import { supabase } from "./supabaseClient";
import { STORAGE_KEYS } from "../utils/constants";

export const LOG_TYPES = {
  AUTH: "auth",
  ADMIN: "admin",
  CLIENT: "client",
  DOCUMENT: "document",
  INVENTORY: "inventory",
};

let subscribers = [];
const notify = () => subscribers.forEach((listener) => listener());

/** True when the error is "the log table / function does not exist yet". */
const beforeMigration = (error) =>
  /system_logs|add_system_log|does not exist|schema cache/i.test(`${error?.message || ""} ${error?.details || ""}`);

// --- The browser fallback, used only before migration 059 --------------------

function readLocal() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.LOGS);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function writeLocal(entry) {
  try {
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify([entry, ...readLocal()].slice(0, 500)));
  } catch {
    // Storage full or blocked: the log is best-effort in the fallback.
  }
}

// --- The log -----------------------------------------------------------------

const mapLogRow = (row) => ({
  id: row.id,
  actor: row.actor_name,
  actorRole: row.actor_role,
  message: row.message,
  timestamp: row.created_at,
  type: row.type,
});

/**
 * The newest `limit` entries, newest first: { logs, error, shared }.
 * `shared` is false while the log is still the browser fallback.
 */
export async function fetchLogs(limit = 500) {
  if (!supabase) return { logs: readLocal().slice(0, limit), error: null, shared: false };
  const { data, error } = await supabase
    .from("system_logs")
    .select("id, actor_name, actor_role, type, message, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error && beforeMigration(error)) return { logs: readLocal().slice(0, limit), error: null, shared: false };
  if (error) return { logs: [], error: error.message || "Could not load the activity log.", shared: true };
  return { logs: (data || []).map(mapLogRow), error: null, shared: true };
}

/**
 * Records an action. Never throws and never blocks the action it describes:
 * a log that cannot be written is reported to the console, not to the user.
 *
 * @param {string} actor   display name — used only by the browser fallback
 * @param {string} message what happened
 * @param {string} type    one of LOG_TYPES
 * @param {object} [options]
 * @param {string} [options.token]  the session token, for entries written
 *   before the app has attached the session to its requests (logging in)
 */
export async function addLog(actor, message, type = LOG_TYPES.ADMIN, { token } = {}) {
  let error = null;
  try {
    if (!supabase) throw new Error("does not exist: no database configured");
    ({ error } = await supabase.rpc("add_system_log", {
      p_type: type,
      p_message: message,
      p_session_token: token || null,
    }));
  } catch (thrown) {
    // No database configured, or the request itself failed: fall back below.
    error = thrown;
  }

  if (error && beforeMigration(error)) {
    writeLocal({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      actor: actor || "System",
      message,
      timestamp: new Date().toISOString(),
      type,
    });
  } else if (error) {
    console.warn("Activity log entry not recorded:", error.message || error);
    return false;
  }

  notify();
  return true;
}

/** Called whenever an entry is written. Returns an unsubscribe function. */
export function subscribe(listener) {
  subscribers.push(listener);
  return () => {
    subscribers = subscribers.filter((entry) => entry !== listener);
  };
}
