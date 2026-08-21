// Role x subsystem permission matrix.
//
// Sprint AC (Assign Role & Permissions): "Each role has predefined
// permissions (view, create, edit, delete) per subsystem" and "Unauthorized
// users cannot access restricted modules."
//
// This module answers "may this role do X to Y". RoleBasedRoute uses it to
// guard routes; components use can() to hide or disable controls.
//
// NOTE: this is UI-side enforcement only. The database currently grants
// insert/update/delete on the account tables to `anon` (supabase/schema.sql),
// so a determined user with the publishable key can still write directly.
// Closing that belongs to the schema migration, not here.

import { ROLES } from "./constants";

export const SUBSYSTEMS = {
  USERS: "users",
  CLIENTS: "clients",
  INVENTORY: "inventory",
  LOGS: "logs",
  SETTINGS: "settings",
};

const ALL = ["view", "create", "edit", "delete"];
const READ_ONLY = ["view"];
const NONE = [];

// Roles not yet backed by a table (MANAGER, OWNER, SYSTEM_ADMIN) are defined
// here anyway so the matrix is complete when the schema migration lands.
const MATRIX = {
  [ROLES.SYSTEM_ADMIN]: {
    users: ALL,
    clients: ALL,
    inventory: ALL,
    logs: ALL,
    settings: ALL,
  },
  [ROLES.ADMIN]: {
    users: ALL,
    clients: ALL,
    inventory: ALL,
    logs: READ_ONLY,
    settings: READ_ONLY,
  },
  [ROLES.OWNER]: {
    users: READ_ONLY,
    clients: ALL,
    inventory: ALL,
    logs: READ_ONLY,
    settings: READ_ONLY,
  },
  [ROLES.MANAGER]: {
    users: READ_ONLY,
    clients: ["view", "create", "edit"],
    inventory: ["view", "create", "edit"],
    logs: READ_ONLY,
    settings: READ_ONLY,
  },
  [ROLES.STAFF]: {
    users: NONE,
    clients: ["view", "create", "edit"],
    inventory: READ_ONLY,
    logs: NONE,
    settings: READ_ONLY,
  },
  [ROLES.TECHNICIAN]: {
    users: NONE,
    clients: ["view", "edit"],
    inventory: READ_ONLY,
    logs: NONE,
    settings: READ_ONLY,
  },
};

/**
 * @param {string} role      e.g. "ADMIN"
 * @param {string} subsystem one of SUBSYSTEMS
 * @param {string} action    "view" | "create" | "edit" | "delete"
 */
export function can(role, subsystem, action = "view") {
  if (!role) return false;
  const permissions = MATRIX[role]?.[subsystem];
  return Array.isArray(permissions) && permissions.includes(action);
}

/** Every subsystem this role may at least view — used to build the sidebar. */
export function visibleSubsystems(role) {
  return Object.values(SUBSYSTEMS).filter((subsystem) => can(role, subsystem, "view"));
}

export default { can, visibleSubsystems, SUBSYSTEMS };
