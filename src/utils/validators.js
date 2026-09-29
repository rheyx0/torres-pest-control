// Form validation, extracted so the rules live in one place instead of being
// re-implemented (or skipped) inside each form.
//
// Every validator returns an errors object: {} means valid, otherwise
// { fieldName: "message" }. Callers do `if (Object.keys(errors).length)`.

import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ALLOWED_ATTACHMENT_TYPES,
  ALLOWED_DOCUMENT_EXTENSIONS,
  ALLOWED_DOCUMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_DOCUMENT_BYTES,
  LIMITS,
  MIN_PASSWORD_LENGTH,
} from "./constants";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isBlank = (value) => !value || !String(value).trim();

export function validateEmailFormat(email) {
  if (isBlank(email)) return "Email is required.";
  if (!EMAIL_PATTERN.test(email.trim())) return "Enter a valid email address.";
  return null;
}

/**
 * Sprint AC: "System validates that email/username is unique before saving."
 *
 * The database only enforces uniqueness *per table*, so the same email can
 * exist in admins, staff and technicians simultaneously. Checking against the
 * combined account list here is what actually makes it unique system-wide.
 *
 * @param {Array}  accounts    every known account, across all roles
 * @param {string} ignoreId    account being edited, so it doesn't clash with itself
 */
export function isEmailTaken(email, accounts = [], ignoreId = null) {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return false;
  return accounts.some(
    (account) => account.id !== ignoreId && String(account.email || "").toLowerCase() === needle
  );
}

export function isUsernameTaken(username, accounts = [], ignoreId = null) {
  const needle = String(username || "").trim().toLowerCase();
  if (!needle) return false;
  return accounts.some(
    (account) => account.id !== ignoreId && String(account.username || "").trim().toLowerCase() === needle
  );
}

export function validatePassword(password) {
  if (isBlank(password)) return "Password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

const PHILIPPINE_MOBILE_PATTERN = /^09\d{9}$/;

export function validatePhilippinePhone(phone, { required = false } = {}) {
  const trimmed = String(phone || "").trim();
  if (!trimmed) {
    return required ? "Phone number is required." : null;
  }
  if (!PHILIPPINE_MOBILE_PATTERN.test(trimmed)) {
    return "Phone number must be exactly 11 digits and begin with '09' (e.g., 09171234567).";
  }
  return null;
}

/** Create / edit account form. */
export function validateAccount(form, { accounts = [], ignoreId = null, requirePassword = true } = {}) {
  const errors = {};

  if (isBlank(form.name)) errors.name = "Full name is required.";
  
  if (isBlank(form.username)) {
    errors.username = "Username is required.";
  } else if (isUsernameTaken(form.username, accounts, ignoreId)) {
    errors.username = "That username is already used by another account.";
  }

  const phoneError = validatePhilippinePhone(form.phone);
  if (phoneError) errors.phone = phoneError;

  const emailError = validateEmailFormat(form.email);
  if (emailError) {
    errors.email = emailError;
  } else if (isEmailTaken(form.email, accounts, ignoreId)) {
    errors.email = "That email is already used by another account.";
  }

  if (requirePassword) {
    const passwordError = validatePassword(form.password);
    if (passwordError) errors.password = passwordError;
  }

  return errors;
}

/** Change / reset password form. */
export function validatePasswordChange({ currentPassword, newPassword, confirmPassword }, { requireCurrent = true } = {}) {
  const errors = {};

  if (requireCurrent && isBlank(currentPassword)) {
    errors.currentPassword = "Enter your current password.";
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    errors.newPassword = passwordError;
  } else if (requireCurrent && newPassword === currentPassword) {
    errors.newPassword = "New password must be different from the current one.";
  }

  if (newPassword !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }

  return errors;
}

/**
 * Create / edit client form.
 * Sprint AC: "System validates required fields before saving." The old form
 * had no validation at all — a completely blank client could be saved.
 */
export function validateClient(form) {
  const errors = {};

  if (isBlank(form.name)) errors.name = "Client name is required.";
  if (isBlank(form.address)) errors.address = "Address is required.";

  if (isBlank(form.phone) && isBlank(form.email)) {
    errors.phone = "Provide at least one contact method (phone or email).";
  } else if (!isBlank(form.phone)) {
    const phoneError = validatePhilippinePhone(form.phone);
    if (phoneError) errors.phone = phoneError;
  }

  if (!isBlank(form.email)) {
    const emailError = validateEmailFormat(form.email);
    if (emailError) errors.email = emailError;
  }

  if (form.classification === "OTHER" && isBlank(form.classificationOther)) {
    errors.classificationOther = "Please specify the classification.";
  }

  return errors;
}

/**
 * One email per client (migration 067): quotes, invoices and receipts are
 * sent there, so two clients sharing an address would get each other's
 * paperwork. Compared trimmed and ignoring case; a blank email is no email.
 */
export const normalEmail = (email) => String(email || "").trim().toLowerCase();

/** The other client (archived ones too) already using this email, or null. */
export function clientWithEmail(email, clients = [], ignoreId = null) {
  const needle = normalEmail(email);
  if (!needle) return null;
  return clients.find((client) => client.id !== ignoreId && normalEmail(client.email) === needle) || null;
}

/** The message shown when an email is taken. */
export function emailTakenMessage(other) {
  const who = [other.name, other.reference ? `(${other.reference})` : ""].filter(Boolean).join(" ");
  return `Already used by ${who}${other.status === "ARCHIVED" ? ", an archived client" : ""}. Each client needs their own email.`;
}

/** Emails more than one client shares (from before 067): [{ email, clients }]. */
export function sharedClientEmails(clients = []) {
  const byEmail = new Map();
  clients.forEach((client) => {
    const email = normalEmail(client.email);
    if (!email) return;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(client);
  });
  return [...byEmail.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([email, owners]) => ({ email, clients: owners }));
}

/**
 * Sprint AC: "System validates file type/size before upload."
 * Returns an error string, or null when the file is acceptable.
 */
export function validateDocument(file) {
  if (!file) return "No file selected.";

  const name = file.name.toLowerCase();
  const typeAllowed =
    ALLOWED_DOCUMENT_TYPES.includes(file.type) ||
    ALLOWED_DOCUMENT_EXTENSIONS.some((extension) => name.endsWith(extension));

  if (!typeAllowed) return "Only PDF, DOC, DOCX, JPG, and PNG files are allowed.";
  if (file.size > MAX_DOCUMENT_BYTES) return "File exceeds the 2MB upload limit.";

  return null;
}

/** Same contract as validateDocument, for before/after photos on a service report. */
export function validateAttachment(file) {
  if (!file) return "No file selected.";

  const name = file.name.toLowerCase();
  const typeAllowed =
    ALLOWED_ATTACHMENT_TYPES.includes(file.type) ||
    ALLOWED_ATTACHMENT_EXTENSIONS.some((extension) => name.endsWith(extension));

  if (!typeAllowed) return "Only JPG, PNG, and PDF files are allowed.";
  if (file.size > MAX_ATTACHMENT_BYTES) return "File exceeds the 5MB upload limit.";

  return null;
}

// ---------------------------------------------------------------------------
// Numeric and date bounds. Mirrors migration 047; see LIMITS in constants.js.
// Each returns an error string, or null when the value is acceptable.
// ---------------------------------------------------------------------------

const peso = (value) => `₱${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Optional money figure (blank is allowed): 0 to max, at most two decimals. */
export function validateMoney(value, { max = LIMITS.MAX_PRICE, label = "Price" } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${label} must be a number.`;
  if (amount < 0) return `${label} cannot be negative.`;
  if (amount > max) return `${label} cannot be more than ${peso(max)}.`;
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(6))) return `${label} can have at most two decimal places.`;
  return null;
}

/** Required quantity: greater than zero and at most max. */
export function validateQuantity(value, { max = LIMITS.MAX_MOVEMENT_QTY, label = "Quantity" } = {}) {
  const amount = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(amount) || amount <= 0) {
    return `${label} must be greater than zero.`;
  }
  if (amount > max) return `${label} cannot be more than ${max.toLocaleString()}.`;
  return null;
}

/**
 * Today's date as YYYY-MM-DD in the browser's local time zone.
 *
 * Not `new Date().toISOString().slice(0, 10)`: that is the UTC date, which in
 * the Philippines (UTC+8) is still yesterday until 8 am.
 */
export function todayISO(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** True when a YYYY-MM-DD date is after today (local). Blank is not future. */
export function isFutureDate(value, now = new Date()) {
  if (!value) return false;
  return String(value) > todayISO(now);
}

/** Error when a stock movement date is missing or in the future. */
export function validateMovementDate(value, now = new Date()) {
  if (!value) return "Choose a date.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "Choose a valid date.";
  if (isFutureDate(value, now)) return "The date cannot be in the future.";
  return null;
}

/**
 * Error when an appointment start is in the past. Allows the same five-minute
 * grace as create_appointment(), so "book it for right now" still saves.
 */
export function validateAppointmentStart(value, now = new Date()) {
  const start = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(start.getTime())) return "Choose a date and time.";
  if (start.getTime() < now.getTime() - LIMITS.PAST_BOOKING_GRACE_MS) {
    return "Appointments cannot be booked in the past.";
  }
  return null;
}

/** Error when a duration (minutes) is outside 15 minutes to 24 hours. */
export function validateDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < LIMITS.MIN_DURATION_MINUTES) {
    return `Duration must be at least ${LIMITS.MIN_DURATION_MINUTES} minutes.`;
  }
  if (value > LIMITS.MAX_DURATION_MINUTES) return "Duration cannot be more than 24 hours.";
  return null;
}
