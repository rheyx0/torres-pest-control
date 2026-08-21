// Role dropdown.
//
// Sprint AC: "Admin can select a role (Staff/Admin, Technician, Manager,
// Owner, System Admin)."
//
// All six sprint roles are listed. The three with no database table yet are
// rendered disabled with a note, rather than hidden — the requirement is
// visible, and choosing one cannot silently fail. They become selectable once
// the schema migration collapses admins/staff/technicians into a single
// `users` table with a `role` column.

import { IMPLEMENTED_ROLES, SPRINT_ROLES, isRoleImplemented } from "../../utils/constants";
import { humanizeEnum } from "../../utils/formatters";
import { inputStyle } from "../../styles/theme";

function UserRoleSelector({ value, onChange, name = "role", disabled = false, allowed = null }) {
  // `allowed` narrows the list further (e.g. a non-admin creating accounts).
  const selectable = allowed || IMPLEMENTED_ROLES;

  return (
    <select
      aria-label="Role"
      name={name}
      value={value}
      onChange={onChange}
      disabled={disabled}
      style={inputStyle}
    >
      {SPRINT_ROLES.map((role) => {
        const usable = isRoleImplemented(role) && selectable.includes(role);
        return (
          <option key={role} value={role} disabled={!usable}>
            {humanizeEnum(role)}
            {isRoleImplemented(role) ? "" : " — not available yet"}
          </option>
        );
      })}
    </select>
  );
}

export default UserRoleSelector;
