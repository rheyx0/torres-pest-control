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

// Treatment methods are now admin-managed and stored in the
// `treatment_methods` database table (migration 038).  Use the
// useTreatmentMethods hook to read them at runtime.
//
// The "Devices" group has been removed from the system.

export const APPOINTMENT_STATUSES = [
  "Pending",
  "Confirmed",
  "Reschedule",
  "Completed",
  "Cancelled",
];

// Follows the appointments_enforce_status_transition trigger in
// supabase/migrations/027-appointment-integrity.sql, except that the UI no
// longer offers "Scheduled" (the trigger still allows it). Completed is final
// and Cancelled only reopens as Reschedule; keep both in sync.
export const APPOINTMENT_STATUS_TRANSITIONS = {
  Pending: ["Confirmed", "Reschedule", "Completed", "Cancelled"],
  Confirmed: ["Pending", "Reschedule", "Completed", "Cancelled"],
  Reschedule: ["Pending", "Confirmed", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: ["Reschedule"],
  // Retired: "Scheduled" can no longer be chosen. The database still accepts it,
  // so rows saved before this change keep a way out but nothing new lands here.
  Scheduled: ["Pending", "Confirmed", "Reschedule", "Completed", "Cancelled"],
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
  address: "Purok 13 Brgy, Martylville Subdivision, B11A L65, Ula, Tugbok, Davao City, 8000 Davao del Sur",
  phone: "0917 139 1908",
  email: "torresprestcontrol@gmail.com",
  licenseNo: "LTO-3000001234567",
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
