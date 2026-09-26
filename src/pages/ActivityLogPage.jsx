// Full system activity log.
//
// Sprint 1 (Edit / Deactivate User Account): "Changes are logged in the
// system activity log" and "Deactivated accounts remain in records for audit
// purposes." Stored in the database since migration 059 — one shared,
// append-only trail — and filterable by type.

import { useMemo, useState } from "react";
import PageHeader from "../components/common/PageHeader";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import Field from "../components/common/Field";
import useLogs from "../hooks/useLogs";
import { LOG_TYPES } from "../services/logService";
import { humanizeEnum } from "../utils/formatters";
import { card, colors, inputStyle, pageShell } from "../styles/theme";

function ActivityLogPage() {
  const { logs, loading, error, shared } = useLogs();
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
        <p style={{ margin: "0.85rem 0 0", color: "#96897b", fontSize: "0.86rem", lineHeight: 1.6 }}>
          {shared
            ? "Every account's activity, newest first. Entries are recorded by the server and cannot be edited or deleted."
            : "Showing this browser's activity only: apply migration 059 to keep one shared log in the database."}
        </p>
      </div>

      {error && (
        <p role="alert" style={{ margin: "0 0 1rem", color: colors.danger, fontWeight: 500 }}>
          Couldn't load the activity log: {error}
        </p>
      )}

      <ActivityFeed logs={visibleLogs} title={loading ? "Loading…" : `${visibleLogs.length} entries`} />
    </div>
  );
}

export default ActivityLogPage;
