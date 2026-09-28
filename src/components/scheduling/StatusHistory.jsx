// A visit's status history (Sprint 4, migration 066): every status it took,
// when, and who set it, oldest first. Recorded by a database trigger, so it
// covers every way a status changes. Reloads when the visit's status does.

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { colors } from "../../styles/theme";
import StatusPill from "../ui/StatusPill";
import { useScheduling } from "../../context/SchedulingContext";

const when = (value) => new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function StatusHistory({ appointment }) {
  const { fetchStatusHistory } = useScheduling();
  const [state, setState] = useState({ history: [], available: true, loading: true, error: "" });

  useEffect(() => {
    if (!fetchStatusHistory) return undefined;
    let cancelled = false;
    fetchStatusHistory(appointment.id).then((result) => {
      if (!cancelled) setState({ ...result, loading: false });
    });
    return () => { cancelled = true; };
  }, [appointment.id, appointment.status, fetchStatusHistory]);

  if (!state.available) return null;

  return (
    <section aria-label="Status history" style={{ display: "grid", gap: "0.4rem" }}>
      <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.95rem", color: colors.ink }}>
        <History size={15} aria-hidden="true" style={{ color: colors.brand }} /> Status history
      </h3>
      {state.error && <p role="alert" style={{ margin: 0, color: colors.danger, fontSize: "0.85rem" }}>{state.error}</p>}
      {!state.loading && !state.error && state.history.length === 0 && (
        <p style={{ margin: 0, color: colors.muted, fontSize: "0.85rem" }}>No changes recorded yet. Changes made from now on appear here.</p>
      )}
      {state.history.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {state.history.map((entry) => (
            <li key={entry.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.35rem 0", borderTop: `1px solid ${colors.line}`, fontSize: "0.84rem" }}>
              <span style={{ color: colors.muted, minWidth: "9.5rem", fontVariantNumeric: "tabular-nums" }}>{when(entry.changedAt)}</span>
              {entry.fromStatus ? <><StatusPill status={entry.fromStatus} /> <span aria-hidden="true" style={{ color: colors.muted }}>→</span></> : <span style={{ color: colors.muted }}>Booked as</span>}
              <StatusPill status={entry.toStatus} />
              <span style={{ marginLeft: "auto", color: colors.body }}>{entry.changedByName || "System"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default StatusHistory;
