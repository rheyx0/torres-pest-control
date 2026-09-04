// Self-service password change.
//
// Sprint story "Change / Reset Password" previously had no code at all. ACs:
//   - "User can change password while logged in by entering current and new
//     password"      -> verified via authService.verifyPassword
//   - "System validates new password meets minimum security requirements"
//                    -> validators.validatePasswordChange
//   - "Confirmation is shown once password is successfully updated"
//                    -> the toast raised by the caller
//   - "User can request a password reset if forgotten"
//                    -> the admin-reset half lives in ResetPasswordDialog;
//                       the email-link half needs a mail provider and is not
//                       implemented.

import { useState } from "react";
import Field from "../common/Field";
import { validatePasswordChange } from "../../utils/validators";
import { buttonWhen, card, colors, inputStyle, invalidInputStyle } from "../../styles/theme";

const EMPTY_FORM = { currentPassword: "", newPassword: "", confirmPassword: "" };

function ChangePassword({ onSubmit }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    const nextErrors = validatePasswordChange(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = await onSubmit?.(form.currentPassword, form.newPassword);
    setSubmitting(false);

    if (result === true) {
      setForm(EMPTY_FORM);
    } else if (typeof result === "string") {
      setFormError(result);
    }
  };

  const styleFor = (field) => (errors[field] ? invalidInputStyle : inputStyle);

  return (
    <form onSubmit={handleSubmit} style={card}>
      <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.15rem", color: colors.ink }}>Change Password</h2>
      <p style={{ margin: "0 0 1.5rem", color: colors.muted, lineHeight: 1.6 }}>
        Enter your current password, then choose a new one. If you've forgotten your current
        password, ask an administrator to reset it for you.
      </p>

      <div style={{ display: "grid", gap: "1rem", maxWidth: "460px" }}>
        <Field label="Current Password" error={errors.currentPassword}>
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={handleChange}
            style={styleFor("currentPassword")}
          />
        </Field>

        <Field
          label="New Password"
          error={errors.newPassword}
          hint="At least 6 characters, including a letter and a number."
        >
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={handleChange}
            style={styleFor("newPassword")}
          />
        </Field>

        <Field label="Confirm New Password" error={errors.confirmPassword}>
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={handleChange}
            style={styleFor("confirmPassword")}
          />
        </Field>
      </div>

      {formError && (
        <div role="alert" style={{ marginTop: "1rem", color: colors.danger, fontWeight: 700, fontSize: "0.9rem" }}>
          {formError}
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <button type="submit" disabled={submitting} style={buttonWhen(submitting)}>
          {submitting ? "Updating…" : "Update Password"}
        </button>
      </div>
    </form>
  );
}

export default ChangePassword;
