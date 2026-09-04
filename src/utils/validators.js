// Form validation, extracted so the rules live in one place instead of being
// re-implemented (or skipped) inside each form.
//
// Every validator returns an errors object: {} means valid, otherwise
// { fieldName: "message" }. Callers do `if (Object.keys(errors).length)`.

import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
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

/** Create / edit account form. */
export function validateAccount(form, { accounts = [], ignoreId = null, requirePassword = true } = {}) {
  const errors = {};

  if (isBlank(form.name)) errors.name = "Full name is required.";
  
  if (isBlank(form.username)) {
    errors.username = "Username is required.";
  } else if (isUsernameTaken(form.username, accounts, ignoreId)) {
    errors.username = "That username is already used by another account.";
  }

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
