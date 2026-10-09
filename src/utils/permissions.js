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
  CLIENT_DOCUMENTS: "clientDocuments",
  INVENTORY: "inventory",
  SCHEDULING: "scheduling",
  LOGS: "logs",
  SETTINGS: "settings",
  // Quotes, invoices and payments (Sprint 3). Mirrors the database: the office
  // reads and writes billing (assert_billing_office), only an admin reverses
  // or voids ("delete" here), and technicians have none.
  BILLING: "billing",
  // The Reports page (Sprint 4): sales, stock usage and technician reports.
  REPORTS: "reports",
};

const ALL = ["view", "create", "edit", "delete"];
const READ_ONLY = ["view"];
const NONE = [];

const MATRIX = {
  [ROLES.ADMIN]: {
    users: ALL,
    // "archive" is archiving and restoring a client; "delete" is deleting
    // one permanently.
    clients: [...ALL, "archive"],
    clientDocuments: ALL,
    inventory: ALL,
    scheduling: ALL,
    logs: READ_ONLY,
    settings: ALL,
    billing: ALL,
    reports: READ_ONLY,
  },
  [ROLES.STAFF]: {
    users: NONE,
    // Staff run the office (070): everything but deleting a client for good.
    clients: ["view", "create", "edit", "archive"],
    clientDocuments: ["view", "create", "delete"],
    // Items, deliveries, corrections and batch tools as well as stock out (070).
    inventory: ALL,
    // Staff book appointments (the office's daily work); the server's
    // create_appointment already admits any signed-in office account.
    scheduling: ["view", "create", "edit"],
    logs: NONE,
    // The service catalog and its prices (070).
    settings: ALL,
    // Reversing a payment and voiding an invoice ("delete") stay with the
    // admin: whoever takes the money should not be able to erase it.
    billing: ["view", "create", "edit"],
    // Staff read the sales, stock and technician reports too.
    reports: READ_ONLY,
  },
  [ROLES.TECHNICIAN]: {
    users: NONE,
    clients: READ_ONLY,
    clientDocuments: ["view", "create"],
    inventory: READ_ONLY,
    scheduling: ["view", "edit"],
    logs: NONE,
    settings: NONE,
    billing: NONE,
    reports: NONE,
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

const permissionsApi = { can, visibleSubsystems, SUBSYSTEMS };
export default permissionsApi;
