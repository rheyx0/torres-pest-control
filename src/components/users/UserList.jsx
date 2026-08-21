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
import { formatLastLogin } from "../../utils/formatters";
import { validateEmailFormat, isEmailTaken } from "../../utils/validators";
import {
  badge,
  colors,
  dangerButton,
  inputStyle,
  invalidInputStyle,
  primaryButton,
  secondaryButton,
  successButton,
} from "../../styles/theme";

function UserList({ users, canEdit, onEdit, onToggleStatus, onResetPassword }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [errors, setErrors] = useState({});

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      if (roleFilter !== "ALL" && user.role !== roleFilter) return false;
      if (statusFilter !== "ALL" && user.status !== statusFilter) return false;
      if (!term) return true;

      const searchable = `${user.name || ""} ${user.email || ""} ${user.role || ""} ${user.status || ""}`;
      return searchable.toLowerCase().includes(term);
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const startEdit = (user) => {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email });
    setErrors({});
  };

  const handleSave = async (user) => {
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Name is required.";

    const emailError = validateEmailFormat(form.email);
    if (emailError) {
      nextErrors.email = emailError;
    } else if (isEmailTaken(form.email, users, user.id)) {
      nextErrors.email = "That email is already used by another account.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = await onEdit?.(user.id, { name: form.name.trim(), email: form.email.trim() });
    if (result === true) setEditingId(null);
  };

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #fffdfd 100%)",
        border: `1px solid ${colors.softLine}`,
        borderRadius: "20px",
        padding: "1.25rem",
        boxShadow: "0 18px 32px rgba(15, 23, 42, 0.06)",
      }}
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
            placeholder="Name, email, role, or status"
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
                  border: "1px solid #efefef",
                  borderRadius: "12px",
                  padding: "1rem",
                  display: "grid",
                  gap: "0.75rem",
                  opacity: isActive ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1.05rem", color: colors.body }}>{user.name}</div>
                    <div style={{ color: colors.muted, marginTop: "0.15rem" }}>{user.email}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <span style={badge}>{user.role}</span>
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
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                      <Field label="Name" error={errors.name}>
                        <input
                          value={form.name}
                          onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
                          style={errors.name ? invalidInputStyle : inputStyle}
                        />
                      </Field>
                      <Field label="Email" error={errors.email}>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
                          style={errors.email ? invalidInputStyle : inputStyle}
                        />
                      </Field>
                    </div>
                    <p style={{ margin: 0, color: colors.muted, fontSize: "0.84rem", lineHeight: 1.5 }}>
                      Role can't be changed here — each role is stored in its own table. To move
                      someone, deactivate this account and create a new one.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                      <button type="button" onClick={() => handleSave(user)} style={primaryButton}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} style={secondaryButton}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
                    <InfoRow label="Username" value={user.username} />
                    <InfoRow label="Last Login" value={formatLastLogin(user.lastLoginAt)} />
                  </div>
                )}

                {canEdit && !isEditing && (
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
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
