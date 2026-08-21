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
import { validateAccount } from "../../utils/validators";
import { buttonWhen, card, colors, inputStyle, invalidInputStyle } from "../../styles/theme";

const EMPTY_FORM = { name: "", phone: "", email: "", password: "", role: ROLES.STAFF };

function UserForm({ accounts = [], onSubmit, submitting = false }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    // Clear the message for a field as soon as it's edited.
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    const nextErrors = validateAccount(form, { accounts });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = await onSubmit?.(form.role, {
      name: form.name.trim(),
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
      <div
        style={{
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: "16px",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          color: "#166534",
          fontSize: "0.9rem",
          lineHeight: 1.6,
        }}
      >
        This creates their login and profile in one step. Pick a temporary password and share it with
        them separately — they can log in with it right away, then change it from Settings.
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        <Field label="Full Name" error={errors.name}>
          <input
            aria-label="Full Name"
            name="name"
            value={form.name}
            onChange={handleFieldChange}
            style={styleFor("name")}
          />
        </Field>

        <Field label="Phone">
          <input
            aria-label="Phone"
            name="phone"
            value={form.phone}
            onChange={handleFieldChange}
            style={inputStyle}
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
          <UserRoleSelector value={form.role} onChange={handleFieldChange} />
        </Field>
      </div>

      {formError && (
        <div role="alert" style={{ marginTop: "1rem", color: colors.danger, fontWeight: 700, fontSize: "0.9rem" }}>
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
        <Link to="/users" style={{ color: colors.brandInk, textDecoration: "none", fontWeight: 700 }}>
          Back to User Accounts
        </Link>
      </div>
    </form>
  );
}

export default UserForm;
