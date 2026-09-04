// Admin-initiated password reset.
//
// Sprint AC (Change / Reset Password): "User can request a password reset if
// forgotten (e.g., via email link or admin reset)."
//
// The admin-reset half of that AC. No current password is required — that is
// the point of a reset — so this is gated by the USERS/edit permission on the
// page that renders it. The email-link half needs a mail provider and is not
// implemented.

import { useState } from "react";
import Field from "../common/Field";
import { validatePasswordChange } from "../../utils/validators";
import {
  buttonWhen,
  colors,
  inputStyle,
  invalidInputStyle,
  secondaryButton,
} from "../../styles/theme";

function ResetPasswordDialog({ user, onSubmit, onClose }) {
  const [form, setForm] = useState({ newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    const nextErrors = validatePasswordChange(form, { requireCurrent: false });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = await onSubmit?.(user.id, form.newPassword);
    setSubmitting(false);

    if (result === true) {
      onClose?.();
    } else if (typeof result === "string") {
      setFormError(result);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "grid",
        placeItems: "center",
        padding: "1.5rem",
        zIndex: 1100,
      }}
    >
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          borderRadius: "20px",
          padding: "1.75rem",
          maxWidth: "440px",
          width: "100%",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.25)",
        }}
      >
        <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.25rem", color: colors.ink }}>Reset Password</h2>
        <p style={{ margin: "0 0 1.25rem", color: colors.muted, lineHeight: 1.6 }}>
          Set a new password for <strong>{user.name}</strong>. Share it with them separately — they
          can change it from Settings after signing in.
        </p>

        <div style={{ display: "grid", gap: "1rem" }}>
          <Field
            label="New Password"
            error={errors.newPassword}
            hint="At least 6 characters, including a letter and a number."
          >
            <input
              name="newPassword"
              type="text"
              value={form.newPassword}
              onChange={handleChange}
              style={errors.newPassword ? invalidInputStyle : inputStyle}
            />
          </Field>

          <Field label="Confirm New Password" error={errors.confirmPassword}>
            <input
              name="confirmPassword"
              type="text"
              value={form.confirmPassword}
              onChange={handleChange}
              style={errors.confirmPassword ? invalidInputStyle : inputStyle}
            />
          </Field>
        </div>

        {formError && (
          <div role="alert" style={{ marginTop: "1rem", color: colors.danger, fontWeight: 700, fontSize: "0.9rem" }}>
            {formError}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button type="submit" disabled={submitting} style={buttonWhen(submitting)}>
            {submitting ? "Resetting…" : "Reset Password"}
          </button>
          <button type="button" onClick={onClose} style={secondaryButton}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default ResetPasswordDialog;
