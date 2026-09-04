// Full system activity log.
//
// Sprint AC (Edit / Deactivate User Account): "Changes are logged in the
// system activity log" and "Deactivated accounts remain in records for audit
// purposes." The dashboard only ever showed the newest six entries with no
// way to see the rest — this is the full view, filterable by type.

import { useMemo, useState } from "react";
import PageHeader from "../components/common/PageHeader";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import Field from "../components/common/Field";
import useLogs from "../hooks/useLogs";
import { LOG_TYPES } from "../services/logService";
import { humanizeEnum } from "../utils/formatters";
import { card, inputStyle, pageShell } from "../styles/theme";

function ActivityLogPage() {
  const logs = useLogs();
  const [typeFilter, setTypeFilter] = useState("ALL");

  const visibleLogs = useMemo(
    () => (typeFilter === "ALL" ? logs : logs.filter((log) => log.type === typeFilter)),
    [logs, typeFilter]
  );

  return (
    <div style={pageShell}>
      <PageHeader eyebrow="Audit" title="System Activity Log" />

      <div style={{ ...card, marginBottom: "1.25rem" }}>
        <Field label="Filter by type">
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            style={{ ...inputStyle, maxWidth: "280px" }}
          >
            <option value="ALL">All activity</option>
            {Object.values(LOG_TYPES).map((type) => (
              <option key={type} value={type}>
                {humanizeEnum(type)}
              </option>
            ))}
          </select>
        </Field>
        <p style={{ margin: "0.85rem 0 0", color: "#6b7280", fontSize: "0.86rem", lineHeight: 1.6 }}>
          Note: activity is stored in this browser only. It is not yet a shared audit trail —
          teammates each see their own history until the log moves to the database.
        </p>
      </div>

      <ActivityFeed logs={visibleLogs} title={`${visibleLogs.length} entries`} />
    </div>
  );
}

export default ActivityLogPage;
