// Account list with search, role filter, and status filter.
//
// Sprint ACs covered:
//   - "List displays name, role, status (active/inactive), and last login"
//     — last login renders as "Never" until the schema gains a last_login_at
//       column; the column is already mapped in userService.mapAccountRow.
//   - "Admin can search/filter the list by role or status" — status was
//     previously not searchable at all, and there was no role filter.
//
// The inline role dropdown from the old edit form is gone: role changes are
// rejected by the service (a role is a different table), so offering the
// control would be lying. ResetPasswordDialog covers the admin reset path.

import { useMemo, useState } from "react";
import Field from "../common/Field";
import InfoRow from "../common/InfoRow";
import EmptyState from "../common/EmptyState";
import { ACCOUNT_STATUS, SPRINT_ROLES } from "../../utils/constants";
import { validateEmailFormat, isEmailTaken, isUsernameTaken, validatePhilippinePhone } from "../../utils/validators";
import {
  badge,
  colors,
  dangerButton,
  inputStyle,
  invalidInputStyle,
  primaryButton,
  secondaryButton,
  successButton,
  card,
} from "../../styles/theme";

const roleBadgeColors = {
  ADMIN: { background: "#fef2f2", color: "#b91c1c" },
  STAFF: { background: "#fefce8", color: "#a16207" },
  TECHNICIAN: { background: "#eff6ff", color: "#1d4ed8" },
};

function UserList({ users, canEdit, onEdit, onToggleStatus, onResetPassword }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "", role: "STAFF" });
  const [errors, setErrors] = useState({});

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      if (roleFilter !== "ALL" && user.role !== roleFilter) return false;
      if (statusFilter !== "ALL" && user.status !== statusFilter) return false;
      if (!term) return true;

      const searchable = `${user.username || ""} ${user.name || ""} ${user.email || ""} ${user.phone || ""} ${user.role || ""} ${user.status || ""}`;
      return searchable.toLowerCase().includes(term);
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const startEdit = (user) => {
    setEditingId(user.id);
    setForm({
      name: user.name || "",
      username: user.username || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role || "STAFF",
    });
    setErrors({});
  };

  const handleSave = async (user) => {
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Name is required.";
    if (!form.name.trim()) nextErrors.name = "Full name is required.";

    if (!form.username.trim()) {
      nextErrors.username = "Username is required.";
    } else if (isUsernameTaken(form.username, users, user.id)) {
      nextErrors.username = "That username is already used by another account.";
    }

    const emailError = validateEmailFormat(form.email);
    if (emailError) {
      nextErrors.email = emailError;
    } else if (isEmailTaken(form.email, users, user.id)) {
      nextErrors.email = "That email is already used by another account.";
    }

    const phoneError = validatePhilippinePhone(form.phone);
    if (phoneError) {
      nextErrors.phone = phoneError;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = await onEdit?.(user.id, {
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
    });
    if (result === true) setEditingId(null);
  };

  return (
    <div
      style={{ ...card, padding: "1.25rem" }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.85rem",
          marginBottom: "1.25rem",
        }}
      >
        <Field label="Search">
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Username, name, email, phone, role…"
            style={inputStyle}
          />
        </Field>

        <Field label="Role">
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} style={inputStyle}>
            <option value="ALL">All roles</option>
            {SPRINT_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
            <option value="ALL">All statuses</option>
            <option value={ACCOUNT_STATUS.ACTIVE}>Active</option>
            <option value={ACCOUNT_STATUS.INACTIVE}>Inactive</option>
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {filteredUsers.length === 0 ? (
          <EmptyState message="No accounts match those filters." />
        ) : (
          filteredUsers.map((user) => {
            const isEditing = editingId === user.id;
            const isActive = user.status === ACCOUNT_STATUS.ACTIVE;

            return (
              <div
                key={user.id}
                style={{
                  border: `1px solid ${colors.softLine}`,
                  background: "rgba(255, 255, 255, 0.78)",
                  borderRadius: "12px",
                  padding: "1rem 1.25rem",
                  display: "grid",
                  gap: "0.75rem",
                  opacity: isActive ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1.05rem", color: colors.body }}>{user.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, fontSize: "1.15rem", color: colors.brandInk }}>
                        {user.username || user.email}
                      </span>
                    </div>
                    <div style={{ color: colors.muted, marginTop: "0.15rem" }}>{user.email}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <span style={{ ...badge, ...(roleBadgeColors[user.role] || {}) }}>{user.role}</span>
                    <span
                      style={{
                        ...badge,
                        background: isActive ? "#ecfdf5" : "#f1f5f9",
                        color: isActive ? "#047857" : "#475569",
                      }}
                    >
                      {user.status}
                    </span>
                  </div>
                </div>

                {isEditing ? (
                  <div style={{ display: "grid", gap: "0.85rem", marginTop: "0.5rem", padding: "1rem", background: "#fdf8f8", borderRadius: "10px", border: `1px solid ${colors.brandLight}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", alignItems: "start" }}>
                      <Field label="Full Name *" error={errors.name}>
                        <input
                          value={form.name}
                          onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
                          style={errors.name ? invalidInputStyle : inputStyle}
                        />
                      </Field>
                      <Field label="Username *" error={errors.username}>
                        <input
                          value={form.username}
                          onChange={(event) => setForm((previous) => ({ ...previous, username: event.target.value }))}
                          style={errors.username ? invalidInputStyle : inputStyle}
                        />
                      </Field>
                      <Field label="Email Address *" error={errors.email}>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
                          style={errors.email ? invalidInputStyle : inputStyle}
                        />
                      </Field>
                      <Field label="Phone Number" error={errors.phone} hint="Philippine standard (11 digits, starts with 09)">
                        <input
                          type="tel"
                          maxLength={11}
                          placeholder="09XXXXXXXXX"
                          value={form.phone}
                          onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value }))}
                          style={errors.phone ? invalidInputStyle : inputStyle}
                        />
                      </Field>
                      <Field label="Role *">
                        <select
                          value={form.role}
                          onChange={(event) => setForm((previous) => ({ ...previous, role: event.target.value }))}
                          style={inputStyle}
                        >
                          {SPRINT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                      </Field>
                    </div>
                    <p style={{ margin: 0, color: colors.muted, fontSize: "0.84rem", lineHeight: 1.5 }}>
                      Updating fields will immediately take effect. Changing a role updates employee permissions and requires them to re-authenticate.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                      <button type="button" onClick={() => handleSave(user)} style={primaryButton}>
                        Save Changes
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} style={secondaryButton}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.75rem", padding: "0.5rem 0", borderTop: `1px solid ${colors.softLine}` }}>
                    <InfoRow tone="brand" label="Full Name" value={user.name} />
                    <InfoRow tone="brand" label="Email" value={user.email} />
                    <InfoRow tone="brand" label="Phone Number" value={user.phone} />
                    <InfoRow tone="brand" label="Account Created" value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"} />
                    <InfoRow tone="brand" label="Last Login" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"} />
                  </div>
                )}

                {canEdit && !isEditing && (
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", paddingTop: "0.25rem" }}>
                    <button type="button" onClick={() => startEdit(user)} style={secondaryButton}>
                      Edit User
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleStatus?.(user.id)}
                      style={isActive ? dangerButton : successButton}
                    >
                      {isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button type="button" onClick={() => onResetPassword?.(user)} style={secondaryButton}>
                      Reset Password
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default UserList;
