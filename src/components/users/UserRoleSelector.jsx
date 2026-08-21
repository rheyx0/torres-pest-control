// Role dropdown.
//
import { SPRINT_ROLES } from "../../utils/constants";
import { humanizeEnum } from "../../utils/formatters";
import { inputStyle } from "../../styles/theme";

function UserRoleSelector({ value, onChange, name = "role", disabled = false, allowed = null }) {
  // `allowed` narrows the list further (e.g. a non-admin creating accounts).
  const selectable = allowed || SPRINT_ROLES;

  return (
    <select
      aria-label="Role"
      name={name}
      value={value}
      onChange={onChange}
      disabled={disabled}
      style={inputStyle}
    >
      {SPRINT_ROLES.map((role) => (
        <option key={role} value={role} disabled={!selectable.includes(role)}>
          {humanizeEnum(role)}
        </option>
      ))}
    </select>
  );
}

export default UserRoleSelector;
