// System activity log.
//
// Sprint AC (Edit / Deactivate User Account): "Changes are logged in the
// system activity log", and "Deactivated accounts remain in records for
// audit purposes."
//
// Backed by localStorage today, which means the log is per-browser,
// clearable, and forgeable — not a real audit trail. It lives behind this
// module so the swap to a `system_logs` table is a change to this file only:
// every caller already goes through addLog().
//
// The tiny subscriber list exists so any service can log without needing a
// React setter passed down to it. useLogs() subscribes on mount.

import { STORAGE_KEYS } from "../utils/constants";
import { initialSystemLogs } from "../data/mockData";

export const LOG_TYPES = {
  AUTH: "auth",
  ADMIN: "admin",
  CLIENT: "client",
  DOCUMENT: "document",
  INVENTORY: "inventory",
};

let subscribers = [];

function read() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.LOGS);
    return saved ? JSON.parse(saved) : initialSystemLogs;
  } catch {
    return initialSystemLogs;
  }
}

function write(logs) {
  localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
  subscribers.forEach((notify) => notify(logs));
}

export function getLogs() {
  return read();
}

/**
 * @param {string} actor   who performed the action (display name)
 * @param {string} message what happened
 * @param {string} type    one of LOG_TYPES
 */
export function addLog(actor, message, type = LOG_TYPES.ADMIN) {
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    actor: actor || "System",
    message,
    timestamp: new Date().toISOString(),
    type,
  };

  write([entry, ...read()]);
  return entry;
}

/** Returns an unsubscribe function. */
export function subscribe(notify) {
  subscribers.push(notify);
  return () => {
    subscribers = subscribers.filter((entry) => entry !== notify);
  };
}
