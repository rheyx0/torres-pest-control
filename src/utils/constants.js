// Single source of truth for the values that used to be scattered across
// mockData.js, App.js, and hardcoded <option> lists inside forms.

export const ROLES = {
  ADMIN: "ADMIN",
  STAFF: "STAFF",
  TECHNICIAN: "TECHNICIAN",
};

// Roles currently supported by the project.
export const SPRINT_ROLES = [
  ROLES.ADMIN,
  ROLES.STAFF,
  ROLES.TECHNICIAN,
];

export const IMPLEMENTED_ROLES = [ROLES.ADMIN, ROLES.STAFF, ROLES.TECHNICIAN];

export const isRoleImplemented = (role) => IMPLEMENTED_ROLES.includes(role);

export const ACCOUNT_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
};

export const CLIENT_SOURCES = [
  "Walk-in",
  "Referral",
  "Website Contact Form",
  "Phone Call",
  "Email",
  "Facebook",
  "Google Business Profile",
  "Other",
];

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

export const SERVICE_TYPES = [
  "Inspection",
  "General Treatment",
  "Termite Control",
  "Rodent Control",
  "Fumigation",
  "Soil Poisoning",
  "Follow-up Visit",
  "Maintenance Contract",
];

export const APPOINTMENT_STATUSES = [
  "Pending",
  "Scheduled",
  "Confirmed",
  "Reschedule",
  "Completed",
  "Cancelled",
];

// Mirrors the appointments_enforce_status_transition trigger in
// supabase/migrations/027-appointment-integrity.sql. Completed is final and
// Cancelled only reopens as Reschedule; keep both in sync.
export const APPOINTMENT_STATUS_TRANSITIONS = {
  Pending: ["Scheduled", "Confirmed", "Reschedule", "Completed", "Cancelled"],
  Scheduled: ["Pending", "Confirmed", "Reschedule", "Completed", "Cancelled"],
  Confirmed: ["Pending", "Scheduled", "Reschedule", "Completed", "Cancelled"],
  Reschedule: ["Pending", "Scheduled", "Confirmed", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: ["Reschedule"],
};

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

// Report attachments are mostly phone photos, which routinely exceed the 2MB
// document cap. Mirrored by the report-attachments bucket in migration 028.
export const ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const ALLOWED_ATTACHMENT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB

export const MIN_PASSWORD_LENGTH = 6;

// localStorage keys, in one place so nothing drifts.
export const STORAGE_KEYS = {
  SESSION: "torres_session",
  CLIENTS: "torres_clients",
  INVENTORY: "torres_inventory",
  LOGS: "torres_logs",
};
