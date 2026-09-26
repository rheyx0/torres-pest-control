// Assigning a crew rather than a person.
//
// A <select multiple> was the obvious option and the wrong one: on a phone it
// collapses to a scroller most people cannot multi-select in at all, and on a
// desktop ctrl-clicking to keep an existing choice is a documented source of
// accidental deselection. Checkboxes make the whole roster visible, make what
// is already assigned obvious, and cost one tap each.
//
// Order carries meaning: the first person ticked leads the job, which is what
// appointments.technician_id stores and what the printed service form names.
// Ticking is therefore append-only rather than roster order, and the lead is
// labelled so nobody has to infer it.

//
// `outIds` (migration 057) is Map<id, absence> of technicians out on the day:
// they cannot be ticked, and say why. Unlike busy, this is not advisory — the
// server refuses them — but someone already on the job stays tickable so the
// visit can still be edited.

import { colors } from "../../styles/theme";
import { describeOut } from "../../utils/absences";

function TechnicianPicker({ accounts, value = [], busyIds, outIds, onChange, disabled = false }) {
  const selected = Array.isArray(value) ? value.filter(Boolean) : [];
  const busy = busyIds || new Set();
  const out = outIds || new Map();

  const toggle = (accountId) => {
    if (disabled) return;
    onChange(selected.includes(accountId)
      ? selected.filter((id) => id !== accountId)
      : [...selected, accountId]);
  };

  if (accounts.length === 0) {
    return (
      <p style={{ margin: 0, color: colors.muted, fontSize: "0.78rem" }}>
        No active technician accounts to assign.
      </p>
    );
  }

  return (
    <div role="group" aria-label="Assigned technicians" style={{ display: "grid", gap: "0.35rem" }}>
      {accounts.map((account) => {
        const checked = selected.includes(account.id);
        const position = selected.indexOf(account.id);
        // Busy is advisory, and never hides someone already on this job: the
        // appointment they clash with may be the very one being edited.
        const absence = out.get(account.id);
        const isOut = Boolean(absence) && !checked;
        const isBusy = busy.has(account.id) && !checked && !isOut;
        const locked = disabled || isOut;

        return (
          <label
            key={account.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.55rem",
              padding: "0.5rem 0.6rem",
              border: `1px solid ${checked ? "#c7bcaf" : "#efe9e0"}`,
              borderRadius: "3.75px",
              background: checked ? "#fcfaf1" : isOut ? "#f6f2ea" : "#ffffff",
              cursor: locked ? "not-allowed" : "pointer",
              opacity: locked ? 0.6 : 1,
              fontSize: "0.82rem",
              color: colors.ink,
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={locked}
              onChange={() => toggle(account.id)}
              style={{ margin: 0 }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              {account.reference ? `${account.reference} — ` : ""}
              {account.name || account.username}
              {account.status === "INACTIVE" && (
                <span style={{ color: colors.muted, fontSize: "0.72rem" }}> (inactive)</span>
              )}
              {isBusy && (
                <span style={{ color: "#b45309", fontSize: "0.72rem" }}> — already booked</span>
              )}
              {absence && (
                <span style={{ color: "#9a2d24", fontSize: "0.72rem" }}> — {describeOut(absence)}</span>
              )}
            </span>
            {position === 0 && (
              <span
                style={{
                  flex: "none",
                  background: "#eef2ec",
                  color: "#4a6b4a",
                  border: "1px solid #a7f3d0",
                  borderRadius: "999px",
                  padding: "0.1rem 0.45rem",
                  fontSize: "0.68rem",
                  fontWeight: 500,
                }}
              >
                Lead
              </span>
            )}
          </label>
        );
      })}
      <span style={{ color: colors.muted, fontSize: "0.7rem" }}>
        {selected.length === 0
          ? "Unassigned. Tick everyone going to this job — the first one ticked leads it."
          : `${selected.length} assigned. The first one ticked leads the job.`}
      </span>
    </div>
  );
}

export default TechnicianPicker;
