// "Technician unavailable": mark a technician out and cover their visits in
// one go (migrations 056 and 057).
//
// Pick who is out and for which days. Every visit of theirs in that window is
// listed with a suggested cover — the free technician with the lightest day —
// or, when nobody is free, the rest of the crew or Reschedule. The office can
// change any of them; a cover who would be double-booked, or is out
// themselves, is flagged before saving. Saving records the absence — nobody
// can book them on those days afterwards — and changes only these visits,
// never the rest of a plan. It works with no visits to move, too.
//
// Above the form: who is out now or soon, with "Back early" and "Cancel".
//
// Stock the technician still has checked out (migration 054) is listed as a
// reminder: only the technician holding it can use it, so it should be
// returned for the cover to take.

import { useEffect, useMemo, useState } from "react";
import { neutral, status as semantic, surface, text, weight } from "../../styles/tokens";
import { todayISO } from "../../utils/validators";
import { crewOf, appointmentReference } from "../../utils/scheduling";
import { openCheckouts } from "../../utils/custody";
import { absenceDates, currentAndUpcoming, describeOut } from "../../utils/absences";
import { COVER_ACTIONS, coverCandidates, coverChanges, coverProblems, suggestCover, visitsToCover } from "../../utils/coverage";
import { ACCOUNT_STATUS } from "../../utils/constants";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import Select from "../ui/Select";

const REASONS = ["Sick", "Family emergency", "On leave", "Other"];

const when = (value) => new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The select's value for a choice: "ASSIGN:<id>", "REMOVE" or "RESCHEDULE". */
const valueOf = (choice) => (choice?.action === COVER_ACTIONS.ASSIGN ? `ASSIGN:${choice.technicianId}` : choice?.action || "");
const choiceOf = (value) => (value.startsWith("ASSIGN:")
  ? { action: COVER_ACTIONS.ASSIGN, technicianId: value.slice("ASSIGN:".length) }
  : { action: value });

/** One absence in the "Out now and coming up" list, with Back early / Cancel. */
function AbsenceRow({ absence, name, today, onEnd }) {
  const [backOn, setBackOn] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const end = async (day) => {
    setBusy(true);
    setError("");
    const result = await onEnd(absence, day);
    setBusy(false);
    if (result === true) setEditing(false);
    else setError(typeof result === "string" ? result : "That did not save.");
  };

  return (
    <li style={{ display: "grid", gap: "6px", padding: "8px 10px", borderRadius: "6px", background: surface.sunken }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", ...text.small }}>
        <strong style={{ fontWeight: weight.medium, color: neutral.ink }}>{name}</strong>
        <span style={{ color: neutral.saddle }}>{absenceDates(absence)}{absence.reason ? ` · ${absence.reason}` : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          {absence.startsOn <= today
            ? <Button size="sm" variant="quiet" onClick={() => setEditing((open) => !open)}>Back early</Button>
            : <Button size="sm" variant="quiet" loading={busy} onClick={() => end(absence.startsOn)}>Cancel</Button>}
        </span>
      </div>
      {editing && (
        <div style={{ display: "flex", alignItems: "end", gap: "8px", flexWrap: "wrap" }}>
          <Field label="Back to work on">
            <Input type="date" aria-label={`${name} back to work on`} value={backOn} min={today} max={absence.endsOn} onChange={(event) => setBackOn(event.target.value)} />
          </Field>
          <Button size="sm" variant="primary" loading={busy} disabled={!backOn} onClick={() => end(backOn)}>Save</Button>
        </div>
      )}
      {error && <span role="alert" style={{ color: semantic.danger, ...text.caption }}>{error}</span>}
    </li>
  );
}

function TechnicianUnavailableModal({ technicians = [], appointments = [], absences = [], clients = [], movements = [], onClose, onSubmit, onEndAbsence }) {
  const today = todayISO();
  const [absentId, setAbsentId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState(REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [choices, setChoices] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const people = technicians.filter((account) => account.status !== ACCOUNT_STATUS.INACTIVE);
  const nameOf = (id) => {
    const account = technicians.find((entry) => entry.id === id);
    return account ? account.name || account.username : "Someone";
  };
  const clientName = (id) => clients.find((client) => client.id === id)?.name || "Unknown client";
  const absentName = absentId ? nameOf(absentId) : "";
  const range = to >= from ? { from, to } : null;
  const away = currentAndUpcoming(absences, today);

  const { visits, inProgress } = useMemo(
    () => (absentId && range ? visitsToCover(appointments, absentId, range.from, range.to) : { visits: [], inProgress: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, absentId, from, to]
  );
  const context = { appointments, technicians, absentId, absences, visits };

  // A fresh suggestion whenever who or when changes.
  useEffect(() => {
    setChoices(absentId ? suggestCover(visits, { appointments, technicians, absentId, absences }) : {});
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absentId, from, to]);

  const problems = coverProblems(visits, { ...context, choices });
  const stillOut = absentId ? openCheckouts(movements).filter(({ checkout }) => checkout.technicianId === absentId) : [];
  const count = (action) => visits.filter((visit) => choices[visit.id]?.action === action).length;
  const reasonText = reason === "Other" ? otherReason.trim() : reason;
  const ready = Boolean(absentId && range) && Object.keys(problems).length === 0;

  const save = async () => {
    if (!ready) return;
    if (reason === "Other" && !reasonText) {
      setError("Write the reason.");
      return;
    }
    setSaving(true);
    setError("");
    const result = await onSubmit(absentId, {
      startsOn: from,
      endsOn: to,
      reason: reasonText,
      changes: coverChanges(visits, absentId, choices),
    });
    setSaving(false);
    if (result !== true) setError(typeof result === "string" ? result : "That did not save.");
  };

  const footer = (
    <>
      <span style={{ marginRight: "auto", alignSelf: "center", color: neutral.bark, ...text.small }}>
        {visits.length > 0 && `${count(COVER_ACTIONS.ASSIGN)} covered · ${count(COVER_ACTIONS.REMOVE)} left to the crew · ${count(COVER_ACTIONS.RESCHEDULE)} to reschedule`}
      </span>
      <Button variant="quiet" onClick={onClose}>Close</Button>
      <Button variant="primary" loading={saving} disabled={!ready} onClick={save}>
        {visits.length ? `Mark out and reassign ${visits.length} visit${visits.length === 1 ? "" : "s"}` : "Mark out"}
      </Button>
    </>
  );

  return (
    <Modal title="Technician unavailable" eyebrow="Mark out and cover their visits" size="lg" onClose={onClose} footer={footer}>
      <div style={{ display: "grid", gap: "16px" }}>
        {away.length > 0 && (
          <section aria-label="Out now and coming up" style={{ display: "grid", gap: "6px" }}>
            <strong style={{ ...text.small, fontWeight: weight.medium, color: neutral.ink }}>Out now and coming up</strong>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
              {away.map((absence) => (
                <AbsenceRow key={absence.id} absence={absence} name={nameOf(absence.technicianId)} today={today} onEnd={onEndAbsence} />
              ))}
            </ul>
          </section>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
          <Field label="Who is out" required>
            <Select aria-label="Technician who is out" value={absentId} onChange={(event) => setAbsentId(event.target.value)}>
              <option value="">Choose a technician</option>
              {people.map((account) => {
                const current = away.find((absence) => absence.technicianId === account.id && absence.startsOn <= today);
                return (
                  <option key={account.id} value={account.id}>
                    {account.name || account.username}{current ? ` (${describeOut(current)})` : ""}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label="First day out" required>
            <Input type="date" aria-label="Out from" value={from} min={today} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="Last day out" required error={to < from ? "Ends before it starts." : ""}>
            <Input type="date" aria-label="Out until" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Field label="Reason">
            <Select aria-label="Reason" value={reason} onChange={(event) => setReason(event.target.value)}>
              {REASONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </Select>
          </Field>
        </div>
        {reason === "Other" && (
          <Field label="Reason" required>
            <Input aria-label="Other reason" value={otherReason} maxLength={120} onChange={(event) => setOtherReason(event.target.value)} />
          </Field>
        )}

        {absentId && range && visits.length === 0 && (
          <p style={{ margin: 0, color: neutral.bark }}>{absentName} has no visits to cover in these dates.</p>
        )}

        {visits.length > 0 && (
          <ol aria-label="Visits to cover" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
            {visits.map((visit) => {
              const choice = choices[visit.id];
              const free = coverCandidates(visit, { ...context, choices });
              const rest = crewOf(visit).filter((id) => id !== absentId);
              const problem = problems[visit.id];
              const chosenUnavailable = choice?.action === COVER_ACTIONS.ASSIGN && choice.technicianId && !free.some((account) => account.id === choice.technicianId);
              return (
                <li key={visit.id} style={{ border: `1px solid ${problem ? semantic.danger : surface.sunken}`, borderRadius: "6px", padding: "10px 12px", display: "grid", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <span>
                      <strong style={{ fontWeight: weight.medium, color: neutral.ink }}>{clientName(visit.clientId)}</strong>
                      <span style={{ color: neutral.bark, ...text.small }}> · {when(visit.scheduledAt)} · {appointmentReference(visit)}</span>
                    </span>
                    {rest.length > 0 && <span style={{ color: neutral.bark, ...text.small }}>With {rest.map(nameOf).join(", ")}</span>}
                  </div>
                  <Select
                    aria-label={`Cover for ${clientName(visit.clientId)} ${when(visit.scheduledAt)}`}
                    value={valueOf(choice)}
                    invalid={Boolean(problem)}
                    onChange={(event) => setChoices((current) => ({ ...current, [visit.id]: choiceOf(event.target.value) }))}
                  >
                    {free.length > 0 && (
                      <optgroup label="Free at this time">
                        {free.map((account) => <option key={account.id} value={`ASSIGN:${account.id}`}>Give it to {account.name || account.username}</option>)}
                      </optgroup>
                    )}
                    {chosenUnavailable && <option value={valueOf(choice)}>Give it to {nameOf(choice.technicianId)} (not available)</option>}
                    <option value={COVER_ACTIONS.REMOVE}>{rest.length ? `Leave it to ${rest.map(nameOf).join(", ")}` : "Leave it unassigned"}</option>
                    <option value={COVER_ACTIONS.RESCHEDULE}>Mark for reschedule</option>
                  </Select>
                  {free.length === 0 && !problem && <span style={{ color: neutral.bark, ...text.caption }}>Nobody else is free at this time.</span>}
                  {problem && <span role="alert" style={{ color: semantic.danger, ...text.caption, fontWeight: weight.medium }}>{problem}</span>}
                </li>
              );
            })}
          </ol>
        )}

        {inProgress.length > 0 && (
          <p style={{ margin: 0, color: neutral.bark, ...text.small }}>
            {inProgress.length} visit{inProgress.length === 1 ? " is" : "s are"} already in progress and not listed. Handle {inProgress.length === 1 ? "it" : "them"} from the visit itself.
          </p>
        )}

        {stillOut.length > 0 && (
          <div role="note" style={{ padding: "10px 12px", borderRadius: "6px", background: surface.sunken, color: neutral.saddle, ...text.small }}>
            {absentName} still has stock checked out: {stillOut.map(({ checkout, remaining }) => `${checkout.itemName} ${remaining} ${checkout.itemUnit}`).join(", ")}.
            {" "}Return it in Inventory → With technicians so whoever covers can use it.
          </div>
        )}

        {error && <p role="alert" style={{ margin: 0, color: semantic.danger, fontWeight: weight.medium }}>{error}</p>}
      </div>
    </Modal>
  );
}

export default TechnicianUnavailableModal;
