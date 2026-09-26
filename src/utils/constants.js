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

// Service types are admin-managed in the `services` table (migration 047) and
// read through useServices(). Each appointment keeps the service NAME it was
// booked under in appointments.service_type, so retiring or deleting a service
// never rewrites history.

// Upper bounds on figures people type. Mirrors migration 047 (the appointment
// RPCs, the services/service_materials checks and the inventory_movements
// trigger) — change both sides together. They exist so a slipped key cannot
// book a ₱10,000,000 visit or stock out 1e9 litres and break every total.
export const LIMITS = {
  MAX_PRICE: 999999.99,
  MAX_UNIT_COST: 999999.99,
  MAX_MOVEMENT_QTY: 100000,
  // An item's stock level (migration 058's inventory_quantity_limit_check).
  MAX_STOCK_LEVEL: 10000000,
  MIN_DURATION_MINUTES: 15,
  MAX_DURATION_MINUTES: 1440,
  NOTES_MAX: 2000,
  SHORT_TEXT_MAX: 120,
  // Grace for "book it for right now": the form opens on the current minute
  // and the RPC allows the same five minutes.
  PAST_BOOKING_GRACE_MS: 5 * 60 * 1000,
};

// Treatment methods are retired (migration 050): a service report records the
// service performed instead. The `treatment_methods` table and the report's
// treatment_methods column stay in the database so old reports keep their data.

// Why stock left the shelf outside an appointment. Values mirror the
// inventory_movements_stock_out_reason_check constraint in migration 040;
// APPOINTMENT is written by stock_out_batch() and is never chosen by hand,
// so it is not offered here.
export const STOCK_OUT_REASONS = [
  {
    value: "TECHNICIAN_CHECKOUT",
    label: "Checked out by a technician",
    requiresTechnician: true,
  },
  { value: "MISSING", label: "Missing stock", requiresTechnician: false },
  { value: "DAMAGED", label: "Damaged stock", requiresTechnician: false },
];

export const STOCK_OUT_REASON_LABELS = {
  APPOINTMENT: "Used on an appointment",
  TECHNICIAN_CHECKOUT: "Checked out by a technician",
  MISSING: "Missing stock",
  DAMAGED: "Damaged stock",
  // An expired chemical batch written off (migration 055). Never chosen by
  // hand: it comes from the batch's Write off.
  EXPIRED: "Expired stock",
};

// Why checked-out stock came back to the shelf (return_checkout, migration
// 054). Values mirror inventory_movements_return_reason_check. A cancelled
// visit names the visit; "Other" needs a note.
export const RETURN_REASONS = [
  { value: "VISIT_CANCELLED", label: "Visit cancelled", needsVisit: true },
  { value: "LEFTOVER", label: "Leftover after the visit" },
  { value: "NOT_NEEDED", label: "Not needed after all" },
  { value: "OTHER", label: "Other", needsNote: true },
];

export const RETURN_REASON_LABELS = Object.fromEntries(RETURN_REASONS.map((entry) => [entry.value, entry.label]));

// Billing (Sprint 3, migration 061). Each list mirrors a CHECK constraint on
// quotes / payments — changing one side needs a migration on the other.
// "EXPIRED" is not stored: a sent quote past its validity date shows as it.
export const QUOTE_STATUS_LABELS = {
  DRAFT: "Draft",
  SENT: "Sent",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

// Invoices (migration 062). Only ISSUED and VOID are stored; the rest follow
// from the payments and the due date (invoiceBalance() in utils/billing.js).
export const INVOICE_STATE_LABELS = {
  VOID: "Void",
  PAID: "Paid",
  PARTIAL: "Partly paid",
  OVERDUE: "Overdue",
  UNPAID: "Unpaid",
};

export const EXTRA_STATUS_LABELS = {
  PROPOSED: "Awaiting client",
  APPROVED: "Approved",
  DECLINED: "Declined",
};

export const PAYMENT_TERMS = [
  { value: "DUE_ON_RECEIPT", label: "Due on receipt", days: 0 },
  { value: "NET_15", label: "15 days", days: 15 },
  { value: "NET_30", label: "30 days", days: 30 },
];

export const VAT_MODES = [
  { value: "ADDED", label: "VAT added on top" },
  { value: "INCLUSIVE", label: "VAT included in the prices" },
  { value: "NONE", label: "No VAT" },
];

export const VAT_RATE = 12;

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "GCASH", label: "GCash" },
  { value: "CHECK", label: "Check" },
];

export const PAYMENT_METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS.map((entry) => [entry.value, entry.label]));

// How often a service recurs. Mirrors the appointments_service_frequency_check
// constraint (migration 041, "Daily" added by 052) — changing one side needs a
// migration on the other.
export const SERVICE_FREQUENCIES = [
  "One-time",
  "Daily",
  "Weekly",
  "Every 2 weeks",
  "Monthly",
  "Quarterly",
  "Semi-annual",
  "Annual",
];

export const APPOINTMENT_STATUSES = [
  "Pending",
  "Scheduled",
  "Confirmed",
  "Reschedule",
  "In progress",
  "Completed",
  "Cancelled",
];

/** Set only by start_visit() (migration 048), never picked from a status select. */
export const IN_PROGRESS = "In progress";

// Follows the appointments_enforce_status_transition trigger in
// supabase/migrations/027-appointment-integrity.sql. Completed is final and
// Cancelled only reopens as Reschedule; keep both in sync.
//
// The Sprint 2 flow is Pending → Scheduled → Confirmed → Completed:
//   Pending    the request is in, not yet arranged;
//   Scheduled  the office has set the date, time and technician;
//   Confirmed  the client has agreed to that slot.
// "Scheduled" was retired for a while, as every booking already has a time;
// it is back so the app matches the sprint. The database always accepted it.
//
// "In progress" (migration 048) is entered only through start_visit(), when a
// technician starts the visit on site, so no status offers it as a target.
// From it the office can still confirm, reschedule, complete or cancel.
export const APPOINTMENT_STATUS_TRANSITIONS = {
  Pending: ["Scheduled", "Confirmed", "Reschedule", "Completed", "Cancelled"],
  Scheduled: ["Pending", "Confirmed", "Reschedule", "Completed", "Cancelled"],
  Confirmed: ["Pending", "Scheduled", "Reschedule", "Completed", "Cancelled"],
  Reschedule: ["Pending", "Scheduled", "Confirmed", "Completed", "Cancelled"],
  "In progress": ["Confirmed", "Reschedule", "Completed", "Cancelled"],
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

// What the Report tab and the technician's visit flow offer to upload. Signed
// forms are no longer uploaded — the customer signs on the report itself — so
// SIGNED_FORM is left out here but kept above, where the check constraint and
// files uploaded before this change still need it.
export const REPORT_UPLOAD_CATEGORIES = ATTACHMENT_CATEGORIES.filter((category) => category.value !== "SIGNED_FORM");

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

// Site monitoring (migration 063): how much pest activity a visit found.
// Mirrors the check constraint on appointments.activity_level.
export const ACTIVITY_LEVELS = [
  { value: "NONE", label: "None", score: 0 },
  { value: "LOW", label: "Low", score: 1 },
  { value: "MEDIUM", label: "Medium", score: 2 },
  { value: "HIGH", label: "High", score: 3 },
];

// Service contracts (migration 063).
export const CONTRACT_STATUS_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};

export const BILLING_SCHEDULES = [
  { value: "PER_VISIT", label: "Per visit" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "UPFRONT", label: "Whole contract up front" },
];
