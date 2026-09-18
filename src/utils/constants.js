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

// What the technician actually did, ticked rather than typed. Grouped so the
// Report tab can render them under headings. Values are stored in
// appointment_reports.treatment_methods (migration 035) — changing a `value`
// orphans existing reports, so add new entries rather than renaming old ones.
export const TREATMENT_METHODS = [
  { group: "Application", value: "GEL_BAIT", label: "Gel bait application" },
  { group: "Application", value: "CRACK_CREVICE", label: "Crack & crevice treatment" },
  { group: "Application", value: "RESIDUAL_SPRAY", label: "Residual spraying" },
  { group: "Application", value: "SPACE_FOGGING", label: "Space / ULV fogging" },
  { group: "Application", value: "DUSTING", label: "Dusting / powder application" },
  { group: "Application", value: "SOIL_TREATMENT", label: "Soil poisoning / drilling" },
  { group: "Application", value: "FUMIGATION", label: "Fumigation" },

  { group: "Devices", value: "MONITORING_STATIONS", label: "Monitoring stations placed" },
  { group: "Devices", value: "BAIT_STATIONS", label: "Bait stations serviced" },
  { group: "Devices", value: "RODENT_TRAPS", label: "Rodent traps set" },
  { group: "Devices", value: "GLUE_BOARDS", label: "Glue boards placed" },

  { group: "Other work", value: "INSPECTION_ONLY", label: "Inspection only, no treatment" },
  { group: "Other work", value: "SANITATION_ADVICE", label: "Sanitation advice given" },
  { group: "Other work", value: "EXCLUSION", label: "Exclusion / proofing work" },
  { group: "Other work", value: "FOLLOW_UP_CHECK", label: "Follow-up check of previous treatment" },
];

export const TREATMENT_METHOD_GROUPS = ["Application", "Devices", "Other work"];

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

// Client-level paperwork, chosen at upload time. Values mirror the check
// constraint in migration 031. These belong to the client and outlive any one
// appointment — visit photos and signed forms go to ATTACHMENT_CATEGORIES.
export const DOCUMENT_CATEGORIES = [
  { value: "CLIENT_ID", label: "Valid ID", uploadLabel: "Add valid ID" },
  { value: "CONTRACT", label: "Contracts", uploadLabel: "Add contract" },
  { value: "PROPERTY", label: "Property documents", uploadLabel: "Add property document" },
  { value: "PERMIT", label: "General permits", uploadLabel: "Add permit" },
  { value: "OTHER", label: "Other client files", uploadLabel: "Add document" },
];

// Report attachments are mostly phone photos, which routinely exceed the 2MB
// document cap. Mirrored by the report-attachments bucket in migration 028.
export const ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const ALLOWED_ATTACHMENT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB

// What a report file is, chosen at upload time. Values mirror the check
// constraint in migration 029; OTHER covers service-specific PDFs and anything
// uploaded before categories existed.
export const ATTACHMENT_CATEGORIES = [
  { value: "BEFORE", label: "Before-treatment pictures", uploadLabel: "Add before picture" },
  { value: "AFTER", label: "After-treatment pictures", uploadLabel: "Add after picture" },
  { value: "INSPECTION", label: "Inspection pictures", uploadLabel: "Add inspection picture" },
  { value: "SIGNED_FORM", label: "Signed service forms", uploadLabel: "Add signed form" },
  { value: "TREATMENT_PROOF", label: "Treatment proof", uploadLabel: "Add treatment proof" },
  { value: "OTHER", label: "Other service documents", uploadLabel: "Add document" },
];

// Letterhead for the printed service form. This app serves one business, so
// the details live here rather than behind a settings table and an admin UI.
//
// REPLACE THE PLACEHOLDERS BELOW. They are written to look obviously unset on
// purpose — a customer must never receive a form with a fake address on it.
export const COMPANY = {
  name: "Torres Pest Control",
  address: "[Business address — set COMPANY in src/utils/constants.js]",
  phone: "[Contact number]",
  email: "[Email address]",
  licenseNo: "[License / permit no.]",
  logo: "/brand-logo.png",
};

export const MIN_PASSWORD_LENGTH = 6;

// localStorage keys, in one place so nothing drifts.
export const STORAGE_KEYS = {
  SESSION: "torres_session",
  CLIENTS: "torres_clients",
  INVENTORY: "torres_inventory",
  LOGS: "torres_logs",
};
