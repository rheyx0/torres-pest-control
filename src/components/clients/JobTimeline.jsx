// One job's story, from the client profile's Visits tab: quotation, down
// payment, booked, each status change, started, report, signed, invoiced,
// paid, and what is still to come. utils/jobStatus.js works it out.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Circle } from "lucide-react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import StatusPill from "../ui/StatusPill";
import { colors } from "../../styles/theme";
import { useScheduling } from "../../context/SchedulingContext";
import { appointmentReference } from "../../utils/scheduling";
import { jobTimeline } from "../../utils/jobStatus";

const when = (value) => new Date(value).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function JobTimeline({ visit, quote = null, invoice = null, payments = [], nameOf, onOpenReport, onClose }) {
  const navigate = useNavigate();
  const { fetchStatusHistory } = useScheduling();
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (fetchStatusHistory) {
      fetchStatusHistory(visit.id).then((result) => {
        if (!cancelled) setHistory(result?.history || []);
      });
    }
    return () => { cancelled = true; };
  }, [visit.id, fetchStatusHistory]);

  const steps = jobTimeline(visit, { quote, invoice, payments, statusHistory: history, nameOf });

  return (
    <Modal
      open
      eyebrow="Job timeline"
      title={`${appointmentReference(visit)} · ${visit.serviceType || "Visit"}`}
      size="md"
      onClose={onClose}
      footer={(
        <>
          {visit.reportSubmitted && onOpenReport && <Button onClick={() => onOpenReport(visit)}>View report</Button>}
          <Button variant="primary" onClick={() => navigate(`/scheduling?appointment=${encodeURIComponent(visit.id)}`)}>Open appointment</Button>
        </>
      )}
    >
      <div style={{ display: "grid", gap: "0.9rem" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", color: colors.body, fontSize: "0.88rem" }}>
          <StatusPill status={visit.status} />
          <span>{when(visit.scheduledAt)}</span>
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}>
          {steps.map((step, index) => (
            <li key={step.key} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: "0.6rem", paddingBottom: index === steps.length - 1 ? 0 : "0.75rem", position: "relative" }}>
              {index < steps.length - 1 && <span aria-hidden="true" style={{ position: "absolute", left: "10px", top: "20px", bottom: 0, width: "2px", background: colors.line }} />}
              <span aria-hidden="true" style={{ width: "22px", height: "22px", borderRadius: "50%", display: "grid", placeItems: "center", background: step.done ? "#e3f1e7" : "#f3eee6", color: step.done ? "#2f6b3f" : "#96897b", position: "relative" }}>
                {step.done ? <Check size={13} /> : <Circle size={9} />}
              </span>
              <span style={{ display: "grid", gap: "0.1rem" }}>
                <span style={{ color: step.done ? colors.ink : colors.muted, fontWeight: 500, fontSize: "0.9rem" }}>{step.label}</span>
                <span style={{ color: colors.muted, fontSize: "0.78rem" }}>
                  {[step.at ? when(step.at) : "Not yet", step.detail].filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}

export default JobTimeline;
