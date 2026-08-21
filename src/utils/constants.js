// Single source of truth for the values that used to be scattered across
// mockData.js, App.js, and hardcoded <option> lists inside forms.

export const ROLES = {
  ADMIN: "ADMIN",
  STAFF: "STAFF",
  TECHNICIAN: "TECHNICIAN",
  MANAGER: "MANAGER",
  OWNER: "OWNER",
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
};

// The sprint backlog names six roles ("Staff/Admin, Technician, Manager,
// Owner, System Admin"). All six are listed here so the UI and the
// permission matrix are ready for them.
export const SPRINT_ROLES = [
  ROLES.ADMIN,
  ROLES.STAFF,
  ROLES.TECHNICIAN,
  ROLES.MANAGER,
  ROLES.OWNER,
  ROLES.SYSTEM_ADMIN,
];

// ...but only these three are actually backed by a database table today.
// Role is currently expressed as *which table the row lives in*, so a role
// with no table cannot be created or logged in as. Selecting an
// unimplemented role is blocked in the UI until the schema migration
// collapses the three tables into one `users` table with a `role` column.
export const IMPLEMENTED_ROLES = [ROLES.ADMIN, ROLES.STAFF, ROLES.TECHNICIAN];

export const isRoleImplemented = (role) => IMPLEMENTED_ROLES.includes(role);

// Maps a role to its Supabase table. Disappears after the schema migration.
export const TABLE_BY_ROLE = {
  [ROLES.ADMIN]: "admins",
  [ROLES.STAFF]: "staff",
  [ROLES.TECHNICIAN]: "technicians",
};

export const ACCOUNT_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
};

export const CLIENT_SOURCES = ["Walk-in", "Referral"];

// Suggestions for the "Pest Concern" field, offered via a <datalist> so staff
// can pick a common one or type anything else. Kept as free text rather than
// an enum because the column is `text` — constraining it would need a
// migration, and the sprint doesn't ask for it either way.
export const PEST_CONCERN_SUGGESTIONS = [
  "Termites",
  "Rodents",
  "Cockroaches",
  "Bed Bugs",
  "Ants",
  "Mosquitoes",
  "Flies",
  "Fleas / Ticks",
  "Snakes",
  "Birds",
  "General Pest Control",
];

export const clientClassificationOptions = [
  "RESIDENTIAL",
  "COMMERCIAL",
  "HOSPITALITY",
  "WAREHOUSE_STORAGE",
  "INDUSTRIAL",
  "AGRICULTURAL",
  "EDUCATIONAL",
  "MEDICAL_FACILITY",
  "GOVERNMENT_OFFICE",
  "RELIGIOUS_INSTITUTION",
  "MILITARY_FACILITY",
  "SCIENCE_LABORATORY",
  "DOCK_PORT_FACILITY",
  "BOAT_SHIP_VESSEL",
  "VACANT_LOT",
  "OTHER",
];

// Document upload rules — enforced by validators.validateDocument().
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
];

export const ALLOWED_DOCUMENT_EXTENSIONS = [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg"];

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024; // 2MB

export const MIN_PASSWORD_LENGTH = 6;

// localStorage keys, in one place so nothing drifts.
export const STORAGE_KEYS = {
  SESSION: "torres_session",
  CLIENTS: "torres_clients",
  INVENTORY: "torres_inventory",
  LOGS: "torres_logs",
};
