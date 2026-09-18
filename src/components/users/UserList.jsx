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

import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Search, X } from "lucide-react";
import Field from "../common/Field";
import EmptyState from "../common/EmptyState";
import UserRoleSelector from "./UserRoleSelector";
import { ACCOUNT_STATUS, SPRINT_ROLES } from "../../utils/constants";
import { validateEmailFormat, isEmailTaken, isUsernameTaken, validatePhilippinePhone } from "../../utils/validators";
import {
  colors,
  inputStyle,
  invalidInputStyle,
  primaryButton,
  secondaryButton,
} from "../../styles/theme";

const roleBadgeColors = {
  ADMIN: { background: "#f5f3ff", color: "#6d28d9", border: "1px solid rgba(167, 139, 250, 0.5)" },
  STAFF: { background: "#eff6ff", color: "#1d4ed8", border: "1px solid rgba(147, 197, 253, 0.6)" },
  TECHNICIAN: { background: "#ecfeff", color: "#0f766e", border: "1px solid rgba(103, 232, 249, 0.7)" },
};

const statusBadgeColors = {
  ACTIVE: { background: "#ecfdf5", color: "#047857", border: "1px solid rgba(110, 231, 183, 0.6)" },
  INACTIVE: { background: "#fef2f2", color: "#b91c1c", border: "1px solid rgba(254, 202, 202, 0.8)" },
  PENDING: { background: "#fff7ed", color: "#c2410c", border: "1px solid rgba(253, 186, 116, 0.8)" },
};

function uppercaseLabel(value) {
  if (!value) return "";
  return String(value).toUpperCase();
}

function UserList({ users, canEdit, onEdit, onToggleStatus, onResetPassword }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedUser, setSelectedUser] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuDirection, setMenuDirection] = useState({});
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "", role: "STAFF" });
  const [errors, setErrors] = useState({});

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return users.filter((user) => {
      if (roleFilter !== "ALL" && user.role !== roleFilter) return false;
      if (statusFilter !== "ALL" && user.status !== statusFilter) return false;
      if (!term) return true;

      const searchable = `${user.reference || ""} ${user.username || ""} ${user.name || ""} ${user.email || ""} ${user.phone || ""} ${user.role || ""} ${user.status || ""}`;
      return searchable.toLowerCase().includes(term);
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const handleMenuToggle = (event, userId) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const shouldOpenUp = bounds.bottom + 180 > window.innerHeight;
    setMenuDirection((previous) => ({ ...previous, [userId]: shouldOpenUp ? "up" : "down" }));
    setMenuOpenId((current) => (current === userId ? null : userId));
  };

  const openEditModal = (user) => {
    setMenuOpenId(null);
    setSelectedUser(user);
    setForm({
      name: user.name || "",
      username: user.username || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role || "STAFF",
    });
    setErrors({});
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setSelectedUser(null);
    setErrors({});
  };

  useEffect(() => {
    if (!isEditModalOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeEditModal();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isEditModalOpen]);

  const handleSave = async () => {
    if (!selectedUser) return;

    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Full name is required.";

    if (!form.username.trim()) {
      nextErrors.username = "Username is required.";
    } else if (isUsernameTaken(form.username, users, selectedUser.id)) {
      nextErrors.username = "That username is already used by another account.";
    }

    const emailError = validateEmailFormat(form.email);
    if (emailError) {
      nextErrors.email = emailError;
    } else if (isEmailTaken(form.email, users, selectedUser.id)) {
      nextErrors.email = "That email is already used by another account.";
    }

    const phoneError = validatePhilippinePhone(form.phone);
    if (phoneError) {
      nextErrors.phone = phoneError;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = await onEdit?.(selectedUser.id, {
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
    });

    if (result === true) {
      closeEditModal();
    }
  };

  return (
    <div style={{ background: "#f8fafc", borderRadius: "20px", border: "1px solid rgba(148, 163, 184, 0.18)", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.85rem",
          padding: "1rem 1rem 0.75rem",
          background: "#ffffff",
          borderBottom: "1px solid #e2e8f0",
          alignItems: "end",
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: "220px" }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: "0.45rem" }}>
            Search
          </label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: "0.8rem", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search users"
              style={{ ...inputStyle, paddingLeft: "2.4rem" }}
            />
          </div>
        </div>

        <div style={{ flex: "0 0 170px" }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: "0.45rem" }}>
            Role
          </label>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} style={inputStyle}>
            <option value="ALL">All roles</option>
            {SPRINT_ROLES.filter(role => role !== "ADMIN").map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: "0 0 170px" }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: "0.45rem" }}>
            Status
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
            <option value="ALL">All statuses</option>
            <option value={ACCOUNT_STATUS.ACTIVE}>Active</option>
            <option value={ACCOUNT_STATUS.INACTIVE}>Inactive</option>
          </select>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        {filteredUsers.length === 0 ? (
          <div style={{ padding: "1.5rem" }}>
            <EmptyState message="No accounts match those filters." />
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
            <thead style={{ background: "#f8fafc" }}>
              <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                {[
                  "User",
                  "Employee No.",
                  "Role",
                  "Status",
                  "Phone Number",
                  "Date Created",
                  "Last Login",
                  "Actions",
                ].map((header) => (
                  <th
                    key={header}
                    style={{
                      textAlign: "left",
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      color: "#64748b",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      padding: "0.9rem 1rem",
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isActive = user.status === ACCOUNT_STATUS.ACTIVE;
                const initials = (user.name || "U")
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((segment) => segment[0])
                  .join("")
                  .toUpperCase();

                const avatarSrc = user.avatarUrl;

                return (
                  <tr key={user.id} style={{ borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div
                          style={{
                            width: "2.9rem",
                            height: "2.9rem",
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            borderRadius: "999px",
                            cursor: "default",
                            overflow: "hidden",
                            outline: "none",
                            WebkitTapHighlightColor: "transparent",
                            boxShadow: "none",
                          }}
                        >
                          <div
                            style={{
                              width: "2.9rem",
                              height: "2.9rem",
                              borderRadius: "999px",
                              background: avatarSrc ? "transparent" : isActive ? "#fef2f2" : "#e2e8f0",
                              color: isActive ? "#991b1b" : "#475569",
                              fontWeight: 700,
                              display: "grid",
                              placeItems: "center",
                              fontSize: "0.82rem",
                              position: "relative",
                              overflow: "hidden",
                              boxShadow: "inset 0 0 0 1px rgba(148, 163, 184, 0.25)",
                            }}
                          >
                            {avatarSrc ? (
                              <img
                                src={avatarSrc}
                                alt={user.name}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                              />
                            ) : (
                              initials || "U"
                            )}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "0.96rem" }}>{user.name}</div>
                          <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.1rem" }}>{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.82rem", fontWeight: 700, color: "#475569", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "0.2rem 0.45rem", whiteSpace: "nowrap" }}>{user.reference || "—"}</span>
                    </td>

                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          borderRadius: "999px",
                          background: roleBadgeColors[user.role]?.background || "#f8fafc",
                          color: roleBadgeColors[user.role]?.color || "#475569",
                          border: roleBadgeColors[user.role]?.border || "1px solid rgba(148, 163, 184, 0.5)",
                          padding: "0.28rem 0.7rem",
                          fontSize: "0.72rem",
                          fontWeight: 500,
                          lineHeight: 1.2,
                        }}
                      >
                        {uppercaseLabel(user.role)}
                      </span>
                    </td>

                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          borderRadius: "999px",
                          background: statusBadgeColors[user.status]?.background || "#f1f5f9",
                          color: statusBadgeColors[user.status]?.color || "#475569",
                          border: statusBadgeColors[user.status]?.border || "1px solid rgba(148, 163, 184, 0.6)",
                          padding: "0.28rem 0.7rem",
                          fontSize: "0.72rem",
                          fontWeight: 500,
                          lineHeight: 1.2,
                        }}
                      >
                        <span
                          style={{
                            width: "0.375rem",
                            height: "0.375rem",
                            borderRadius: "999px",
                            display: "inline-block",
                            background: user.status === "ACTIVE" ? "#10b981" : user.status === "PENDING" ? "#f59e0b" : "#94a3b8",
                            marginRight: "0.38rem",
                          }}
                        />
                        {uppercaseLabel(user.status)}
                      </span>
                    </td>

                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle", color: "#334155", fontSize: "0.9rem" }}>
                      {user.phone || "—"}
                    </td>

                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle", color: "#475569", fontSize: "0.9rem" }}>
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
                    </td>

                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle", color: "#475569", fontSize: "0.9rem" }}>
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}
                    </td>

                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle", position: "relative" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          aria-label="User actions"
                          onClick={(event) => handleMenuToggle(event, user.id)}
                          style={{
                            width: "2rem",
                            height: "2rem",
                            borderRadius: "9px",
                            border: "1px solid #e2e8f0",
                            background: "#fff",
                            color: "#475569",
                            display: "grid",
                            placeItems: "center",
                            cursor: "pointer",
                          }}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>

                      {menuOpenId === user.id && (
                        <div
                          style={{
                            position: "absolute",
                            right: "0.8rem",
                            top: menuDirection[user.id] === "up" ? "auto" : "calc(100% - 0.2rem)",
                            bottom: menuDirection[user.id] === "up" ? "calc(100% - 0.2rem)" : "auto",
                            zIndex: 2,
                            background: "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: "12px",
                            boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
                            minWidth: "170px",
                            padding: "0.35rem",
                          }}
                        >
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(user)}
                              style={{
                                width: "100%",
                                border: "none",
                                background: "transparent",
                                color: "#0f172a",
                                textAlign: "left",
                                padding: "0.6rem 0.7rem",
                                borderRadius: "8px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Edit user
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onToggleStatus?.(user.id)}
                            style={{
                              width: "100%",
                              border: "none",
                              background: "transparent",
                              color: isActive ? "#b91c1c" : "#166534",
                              textAlign: "left",
                              padding: "0.6rem 0.7rem",
                              borderRadius: "8px",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {isActive ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onResetPassword?.(user)}
                            style={{
                              width: "100%",
                              border: "none",
                              background: "transparent",
                              color: "#475569",
                              textAlign: "left",
                              padding: "0.6rem 0.7rem",
                              borderRadius: "8px",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Reset password
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {isEditModalOpen && selectedUser && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(15, 23, 42, 0.5)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
          onClick={closeEditModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
              border: "1px solid #e2e8f0",
              maxWidth: "32rem",
              width: "100%",
              padding: "1.5rem",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, color: "#0f172a", fontSize: "1.5rem" }}>Edit User Account</h2>
              <button
                type="button"
                aria-label="Close edit user modal"
                onClick={closeEditModal}
                style={{
                  width: "2rem",
                  height: "2rem",
                  border: "1px solid #e2e8f0",
                  borderRadius: "999px",
                  background: "#ffffff",
                  color: "#475569",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <Field label="Full Name *" error={errors.name}>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
                    style={errors.name ? invalidInputStyle : inputStyle}
                  />
                </Field>
              </div>

              <Field label="Username *" error={errors.username}>
                <input
                  value={form.username}
                  onChange={(event) => setForm((previous) => ({ ...previous, username: event.target.value }))}
                  style={errors.username ? invalidInputStyle : inputStyle}
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

              <div style={{ gridColumn: "1 / -1" }}>
                <Field label="Email Address *" error={errors.email}>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
                    style={errors.email ? invalidInputStyle : inputStyle}
                  />
                </Field>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <Field label="Phone Number" error={errors.phone} hint="Philippine format">
                  <input
                    type="tel"
                    maxLength={11}
                    placeholder="09XXXXXXXXX"
                    value={form.phone}
                    onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value }))}
                    style={errors.phone ? invalidInputStyle : inputStyle}
                  />
                </Field>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button
                type="button"
                onClick={closeEditModal}
                style={{
                  padding: "0.6rem 1rem",
                  fontSize: "0.875rem",
                  color: "#334155",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                style={{
                  padding: "0.6rem 1rem",
                  fontSize: "0.875rem",
                  color: "#ffffff",
                  background: "#7f1d1d",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserList;
