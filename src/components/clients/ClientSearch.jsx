// Search box + classification filter.
//
// Sprint AC (View / Search Client Profiles): "Staff can search by name or
// filter by classification." The classification filter did not exist, and
// classification was deliberately excluded from the search string, so typing
// "COMMERCIAL" returned nothing.

import Field from "../common/Field";
import { clientClassificationOptions } from "../../utils/constants";
import { humanizeEnum } from "../../utils/formatters";
import { inputStyle } from "../../styles/theme";

function ClientSearch({ searchTerm, onSearchChange, classification, onClassificationChange }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "0.85rem",
      }}
    >
      <Field label="Search client">
        <input
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by name, phone, or email"
          style={inputStyle}
        />
      </Field>

      <Field label="Classification">
        <select
          value={classification}
          onChange={(event) => onClassificationChange(event.target.value)}
          style={inputStyle}
        >
          <option value="ALL">All classifications</option>
          {clientClassificationOptions.map((option) => (
            <option key={option} value={option}>
              {humanizeEnum(option)}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export default ClientSearch;
