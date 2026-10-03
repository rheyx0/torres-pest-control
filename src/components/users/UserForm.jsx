// Create-account form.
//
// Adds what the old form was missing:
//   - pre-save uniqueness check across ALL roles (the DB only enforces
//     uniqueness per table, so the same email could exist three times)
//   - per-field validation messages
//   - a success confirmation, via the toast the caller raises
//
// Sprint ACs covered: "Admin can input name, email, username, and initial
// password/role" and "System validates that email/username is unique before
// saving."

import { useState } from "react";
import { Link } from "react-router-dom";
import Field from "../common/Field";
import UserRoleSelector from "./UserRoleSelector";
import { ROLES } from "../../utils/constants";
import { validateAccount, validatePersonName } from "../../utils/validators";
import { buttonWhen, card, colors, inputStyle, invalidInputStyle } from "../../styles/theme";

const EMPTY_FORM = { firstName: "", lastName: "", username: "", phone: "", email: "", password: "", role: ROLES.STAFF };

function UserForm({ accounts = [], onSubmit, submitting = false }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    // Phone is digits-only — strip anything else as the user types instead
    // of waiting for submit-time validation to reject it.
    const nextValue = name === "phone" ? value.replace(/\D/g, "") : value;
    setForm((previous) => ({ ...previous, [name]: nextValue }));
    // Clear the message for a field as soon as it's edited.
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    const fullName = `${form.firstName?.trim() || ""} ${form.lastName?.trim() || ""}`.trim();
    const validationPayload = { ...form, name: fullName };
    const nextErrors = validateAccount(validationPayload, { accounts });
    
    const firstNameError = validatePersonName(form.firstName, { label: "First name" });
    if (firstNameError) nextErrors.firstName = firstNameError;
    const lastNameError = validatePersonName(form.lastName, { label: "Last name" });
    if (lastNameError) nextErrors.lastName = lastNameError;
    delete nextErrors.name;

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = await onSubmit?.(form.role, {
      name: fullName,
      username: form.username.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      password: form.password,
    });

    if (result === true) {
      setForm(EMPTY_FORM);
    } else if (typeof result === "string") {
      setFormError(result);
    }
  };

  const styleFor = (field) => (errors[field] ? invalidInputStyle : inputStyle);

  return (
    <form onSubmit={handleSubmit} style={card}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <Field label="First Name" error={errors.firstName}>
            <input
              aria-label="First Name"
              name="firstName"
              value={form.firstName}
              onChange={handleFieldChange}
              style={styleFor("firstName")}
            />
          </Field>
          <Field label="Last Name" error={errors.lastName}>
            <input
              aria-label="Last Name"
              name="lastName"
              value={form.lastName}
              onChange={handleFieldChange}
              style={styleFor("lastName")}
            />
          </Field>
        </div>

        <Field label="Username" error={errors.username}>
          <input
            aria-label="Username"
            name="username"
            value={form.username}
            onChange={handleFieldChange}
            style={styleFor("username")}
          />
        </Field>

        <Field label="Phone" error={errors.phone} hint="Philippine standard format (11 digits, starts with 09)">
          <input
            aria-label="Phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={11}
            placeholder="09XXXXXXXXX"
            value={form.phone}
            onChange={handleFieldChange}
            style={styleFor("phone")}
          />
        </Field>

        <Field label="Email" error={errors.email} hint="Also used as the username to sign in.">
          <input
            aria-label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleFieldChange}
            style={styleFor("email")}
          />
        </Field>

        <Field
          label="Temporary Password"
          error={errors.password}
          hint="At least 6 characters, including a letter and a number."
        >
          <input
            aria-label="Temporary Password"
            name="password"
            type="text"
            value={form.password}
            onChange={handleFieldChange}
            style={styleFor("password")}
          />
        </Field>

        <Field label="Role">
          <UserRoleSelector 
            value={form.role} 
            onChange={handleFieldChange} 
            allowed={["STAFF", "TECHNICIAN"]}
          />
        </Field>
      </div>

      {formError && (
        <div role="alert" style={{ marginTop: "1rem", color: colors.danger, fontWeight: 500, fontSize: "0.9rem" }}>
          {formError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          marginTop: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <button type="submit" disabled={submitting} style={buttonWhen(submitting)}>
          {submitting ? "Creating…" : "Create Account"}
        </button>
        <Link to="/users" style={{ color: colors.brandInk, textDecoration: "none", fontWeight: 500 }}>
          Back to User Accounts
        </Link>
      </div>
    </form>
  );
}

export default UserForm;
