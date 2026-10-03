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
import { Download, MoreHorizontal, Search, X } from "lucide-react";
import Field from "../common/Field";
import EmptyState from "../common/EmptyState";
import { ACCOUNT_STATUS, SPRINT_ROLES } from "../../utils/constants";
import { validateEmailFormat, isEmailTaken, isUsernameTaken, validatePersonName, validatePhilippinePhone } from "../../utils/validators";
import { colors, inputStyle, invalidInputStyle } from "../../styles/theme";
import StatusPill, { toneFor } from "../ui/StatusPill";
import { formatLastLogin, humanizeEnum } from "../../utils/formatters";

function UserList({ users, canEdit, onEdit, onAvatarChange, onToggleStatus, onResetPassword }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedUser, setSelectedUser] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuDirection, setMenuDirection] = useState({});
  const [form, setForm] = useState({ name: "", username: "", email: "", phone: "", role: "STAFF" });
  const [errors, setErrors] = useState({});
  const [avatarUploadId, setAvatarUploadId] = useState(null);
  const [avatarHoverId, setAvatarHoverId] = useState(null);

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
    const nameError = validatePersonName(form.name, { label: "Full name" });
    if (nameError) nextErrors.name = nameError;

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

  const handleAvatarChange = async (user, event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onAvatarChange) return;
    setAvatarUploadId(user.id);
    await onAvatarChange(user.id, file);
    setAvatarUploadId(null);
  };

  return (
    <div style={{ background: "#efe9e0", borderRadius: "7.5px", border: "1px solid #efe9e0", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.85rem",
          padding: "1rem 1rem 0.75rem",
          background: "#ffffff",
          borderBottom: "1px solid #efe9e0",
          alignItems: "end",
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: "220px" }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "#50463c", marginBottom: "0.45rem" }}>
            Search
          </label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: "0.8rem", top: "50%", transform: "translateY(-50%)", color: "#96897b" }} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search users"
              style={{ ...inputStyle, paddingLeft: "2.4rem" }}
            />
          </div>
        </div>

        <div style={{ flex: "0 0 170px" }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "#50463c", marginBottom: "0.45rem" }}>
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
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 500, color: "#50463c", marginBottom: "0.45rem" }}>
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
          <table className="dt" style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
            <thead style={{ background: "#efe9e0" }}>
              <tr style={{ borderBottom: "1px solid #efe9e0" }}>
                {[
                  "User",
                  "Employee No.",
                  "Role",
                  "Status",
                  "Phone Number",
                  "Last Login",
                  "Actions",
                ].map((header) => (
                  <th
                    key={header}
                    style={{
                      textAlign: "left",
                      fontSize: "0.76rem",
                      fontWeight: 500,
                      color: "#96897b",
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
                // PENDING accounts can sign in (the first login promotes them),
                // so the menu must offer to deactivate them too. Only an
                // INACTIVE account gets "Activate".
                const isDeactivated = user.status === ACCOUNT_STATUS.INACTIVE;
                const initials = (user.name || "U")
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((segment) => segment[0])
                  .join("")
                  .toUpperCase();

                const avatarSrc = user.avatarUrl;

                return (
                  <tr key={user.id} style={{ borderBottom: "1px solid #efe9e0", background: "#fff" }}>
                    <td style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div
                          onMouseEnter={() => setAvatarHoverId(user.id)}
                          onMouseLeave={() => setAvatarHoverId(null)}
                          style={{ position: "relative", width: "2.9rem", height: "2.9rem" }}
                        >
                        <label
                          htmlFor={`user-avatar-${user.id}`}
                          title={canEdit ? "Change profile picture" : undefined}
                          style={{
                            width: "2.9rem",
                            height: "2.9rem",
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            borderRadius: "999px",
                            cursor: canEdit ? "pointer" : "default",
                            overflow: "hidden",
                            outline: "none",
                            WebkitTapHighlightColor: "transparent",
                            boxShadow: "none",
                          }}
                        >
                          <input
                            id={`user-avatar-${user.id}`}
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleAvatarChange(user, event)}
                            disabled={!canEdit || avatarUploadId === user.id}
                            style={{ display: "none" }}
                          />
                          <div
                            style={{
                              width: "2.9rem",
                              height: "2.9rem",
                              borderRadius: "999px",
                              background: avatarSrc ? "transparent" : isActive ? "#f9ecea" : "#efe9e0",
                              color: isActive ? "#9a2d24" : "#50463c",
                              fontWeight: 500,
                              display: "grid",
                              placeItems: "center",
                              fontSize: "0.82rem",
                              position: "relative",
                              overflow: "hidden",
                              boxShadow: "inset 0 0 0 1px #efe9e0",
                            }}
                          >
                            {avatarUploadId === user.id ? "..." : avatarSrc ? (
                              <img
                                src={avatarSrc}
                                alt={user.name}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                              />
                            ) : (
                              initials || "U"
                            )}
                          </div>
                        </label>
                        {avatarHoverId === user.id && (
                          <a
                            href={avatarSrc || undefined}
                            download={avatarSrc ? `${(user.name || "user").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-profile` : undefined}
                            aria-label={avatarSrc ? `Download ${user.name || "user"} profile picture` : "No profile picture available"}
                            title={avatarSrc ? "Download profile picture" : "No profile picture available"}
                            aria-disabled={!avatarSrc}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!avatarSrc) event.preventDefault();
                            }}
                            style={{
                              position: "absolute",
                              right: "-0.35rem",
                              bottom: "-0.35rem",
                              width: "1.55rem",
                              height: "1.55rem",
                              display: "grid",
                              placeItems: "center",
                              borderRadius: "999px",
                              background: avatarSrc ? colors.ink : colors.muted,
                              border: "2px solid #fff",
                              color: "#fff",
                              textDecoration: "none",
                              zIndex: 2,
                              cursor: avatarSrc ? "pointer" : "not-allowed",
                              opacity: avatarSrc ? 1 : 0.85,
                            }}
                          >
                            <Download size={12} />
                          </a>
                        )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, color: "#211b15", fontSize: "0.96rem" }}>{user.name}</div>
                          <div style={{ color: "#96897b", fontSize: "0.78rem", marginTop: "0.1rem" }}>{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Employee No." style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.82rem", fontWeight: 500, color: "#50463c", background: "#efe9e0", border: "1px solid #efe9e0", borderRadius: "3.75px", padding: "0.2rem 0.45rem", whiteSpace: "nowrap" }}>{user.reference || "—"}</span>
                    </td>

                    <td data-label="Role" style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <StatusPill tone={toneFor(user.role)} dot={false}>{humanizeEnum(user.role)}</StatusPill>
                    </td>

                    <td data-label="Status" style={{ padding: "0.95rem 1rem", verticalAlign: "middle" }}>
                      <StatusPill tone={toneFor(user.status)}>{humanizeEnum(user.status)}</StatusPill>
                    </td>

                    <td data-label="Phone" style={{ padding: "0.95rem 1rem", verticalAlign: "middle", color: "#50463c", fontSize: "0.9rem" }}>
                      {user.phone || "—"}
                    </td>

                    <td data-label="Last login" style={{ padding: "0.95rem 1rem", verticalAlign: "middle", color: "#50463c", fontSize: "0.9rem" }}>
                      {formatLastLogin(user.lastLoginAt)}
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
                            borderRadius: "3.75px",
                            border: "1px solid #efe9e0",
                            background: "#fff",
                            color: "#50463c",
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
                            border: "1px solid #efe9e0",
                            borderRadius: "3.75px",
                            boxShadow: "none",
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
                                color: "#211b15",
                                textAlign: "left",
                                padding: "0.6rem 0.7rem",
                                borderRadius: "3.75px",
                                fontWeight: 500,
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
                              color: isDeactivated ? "#4a6b4a" : "#9a2d24",
                              textAlign: "left",
                              padding: "0.6rem 0.7rem",
                              borderRadius: "3.75px",
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            {isDeactivated ? "Activate" : "Deactivate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onResetPassword?.(user)}
                            style={{
                              width: "100%",
                              border: "none",
                              background: "transparent",
                              color: "#50463c",
                              textAlign: "left",
                              padding: "0.6rem 0.7rem",
                              borderRadius: "3.75px",
                              fontWeight: 500,
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
              borderRadius: "7.5px",
              boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
              border: "1px solid #efe9e0",
              maxWidth: "32rem",
              width: "100%",
              padding: "1.5rem",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, color: "#211b15", fontSize: "1.5rem" }}>Edit User Account</h2>
              <button
                type="button"
                aria-label="Close edit user modal"
                onClick={closeEditModal}
                style={{
                  width: "2rem",
                  height: "2rem",
                  border: "1px solid #efe9e0",
                  borderRadius: "999px",
                  background: "#ffffff",
                  color: "#50463c",
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
                  color: "#50463c",
                  background: "#efe9e0",
                  border: "1px solid #efe9e0",
                  borderRadius: "3.75px",
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
                  borderRadius: "3.75px",
                  cursor: "pointer",
                  fontWeight: 500,
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
