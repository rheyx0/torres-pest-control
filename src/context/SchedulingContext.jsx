import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as appointmentService from "../services/appointmentService";
import { useAuthContext } from "./AuthContext";

const SchedulingContext = createContext(null);

// Fields that belong to the report, the stock-out or the attachments rather
// than to the appointment row itself. update_appointment knows nothing about
// them, so they must never be overwritten from its response.
const REPORT_OWNED = [
  "report", "treatmentPerformed", "recommendations", "followUpDate",
  "reportSubmitted", "reportSubmittedAt", "customerName", "signaturePath",
  "signedAt", "technicianSignaturePath", "technicianSignedAt",
  "completionNote", "stockUsed", "attachments",
];

export function SchedulingProvider({ children }) {
  const { session, sessionVerified } = useAuthContext();
  const [appointments, setAppointments] = useState([]);
  // Technicians who are out (migration 057): nobody can be booked on those days.
  const [absences, setAbsences] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const [result, away] = await Promise.all([appointmentService.fetchAppointments(), appointmentService.fetchAbsences()]);
    if (result.error) setError(result.error);
    else setAppointments(result.appointments);
    if (!away.error) setAbsences(away.absences);
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    if (!session || !sessionVerified) {
      setAppointments([]);
      setAbsences([]);
      setError("");
      return;
    }
    refresh();
  }, [session, sessionVerified, refresh]);

  const createAppointment = useCallback(async (fields) => {
    const result = await appointmentService.createAppointment(fields);
    if (result.error) return result.error;
    setAppointments((current) => [...current, result.appointment].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)));
    return result.appointment;
  }, []);

  // One visit with several services, a recurring series, or a multi-day job
  // (book_appointments, migration 052). A plan touches several rows and their
  // plan record, so the list is reloaded rather than patched. Returns the
  // first visit booked, or the error message.
  const bookAppointments = useCallback(async (booking) => {
    const result = await appointmentService.bookAppointments(booking);
    if (result.error) return result.error;
    await refresh();
    return result.appointments[0] || null;
  }, [refresh]);

  // Plan changes from the appointment panel and the visit flow. Each can move,
  // cancel or add several visits, so they reload too. Returns true or the error.
  const runPlanAction = useCallback(async (call) => {
    const result = await call();
    if (result.error) return result.error;
    await refresh();
    return true;
  }, [refresh]);
  const planActions = useMemo(() => ({
    finishJobDay: (appointmentId) => runPlanAction(() => appointmentService.finishJobDay(appointmentId)),
    finishJobHere: (appointmentId) => runPlanAction(() => appointmentService.finishJobHere(appointmentId)),
    cancelPlanRemaining: (planId) => runPlanAction(() => appointmentService.cancelPlanRemaining(planId)),
    setPlanRenewal: (planId, renew) => runPlanAction(() => appointmentService.setPlanRenewal(planId, renew)),
    // Not plan changes, but the same shape: several visits at once, then reload.
    reassignVisits: (absentId, changes, reason) => runPlanAction(() => appointmentService.reassignVisits(absentId, changes, reason)),
    markTechnicianOut: (technicianId, absence) => runPlanAction(() => appointmentService.markTechnicianOut(technicianId, absence)),
    endAbsence: (absenceId, backOn) => runPlanAction(() => appointmentService.endAbsence(absenceId, backOn)),
    addPlanVisit: (planId, visit) => runPlanAction(() => appointmentService.addPlanVisit(planId, visit)),
    updatePlanFuture: (planId, fromId, changes) => runPlanAction(() => appointmentService.updatePlanFuture(planId, fromId, changes)),
  }), [runPlanAction]);

  // update_appointment returns the appointment row alone, so mapAppointmentRow
  // builds it with report = null and every report-derived field comes back
  // blank. Spreading that over local state wiped the treatment, follow-up,
  // signature and attachments — the report looked half-erased until a refresh.
  // Only appointment-owned fields are merged; everything the report owns is
  // kept from the entry we already have.
  const updateAppointment = useCallback(async (appointment) => {
    const result = await appointmentService.updateAppointment(appointment);
    if (result.error) return result.error;
    if (!result.appointment?.status) return "Appointment update returned no saved status. Apply migration 020 and try again.";

    const appointmentFields = { ...result.appointment };
    REPORT_OWNED.forEach((field) => delete appointmentFields[field]);

    setAppointments((current) => current.map((entry) => entry.id === appointment.id
      ? { ...entry, ...appointmentFields }
      : entry));
    return result.appointment;
  }, []);

  const submitReport = useCallback(async (appointmentId, reportFields) => {
    const result = await appointmentService.submitReport(appointmentId, reportFields);
    if (result.error) return result.error;
    // Completion is now conditional on the server: a signature or a written
    // override completes the visit, an unsigned report is only a draft. So the
    // status is derived from what came back, not assumed to be "Completed".
    const confirmed = Boolean(result.report.signature_path || result.report.completion_note);
    setAppointments((current) => current.map((entry) => entry.id === appointmentId ? {
      ...entry,
      report: result.report.findings,
      treatmentPerformed: result.report.treatment_performed || "",
      recommendations: result.report.recommendations || "",
      followUpDate: result.report.follow_up_date || "",
      reportSubmitted: true,
      reportSubmittedAt: result.report.submitted_at,
      customerName: result.report.customer_name || "",
      signaturePath: result.report.signature_path || "",
      signedAt: result.report.signed_at || "",
      technicianSignaturePath: result.report.technician_signature_path || "",
      technicianSignedAt: result.report.technician_signed_at || "",
      completionNote: result.report.completion_note || "",
      status: confirmed ? "Completed" : entry.status,
      // The services ticked on the report (migration 051). The server keeps the
      // first as service_id and the names joined as service_type — the same
      // joined names passed here.
      ...(reportFields.serviceIds?.length
        ? { serviceIds: reportFields.serviceIds, serviceId: reportFields.serviceIds[0], serviceType: reportFields.serviceType || entry.serviceType }
        : {}),
    } : entry));
    return result.report;
  }, []);

  // A technician starting a visit on site: status In progress, started_at set.
  const startVisit = useCallback(async (appointmentId) => {
    const result = await appointmentService.startVisit(appointmentId);
    if (result.error) return result.error;
    setAppointments((current) => current.map((entry) => entry.id === appointmentId
      ? { ...entry, status: result.status, startedAt: result.startedAt }
      : entry));
    return true;
  }, []);

  const addAttachment = useCallback(async (appointmentId, file, category) => {
    const result = await appointmentService.uploadAttachment(appointmentId, file, category);
    if (result.error) return result.error;
    setAppointments((current) => current.map((entry) => entry.id === appointmentId
      ? { ...entry, attachments: [result.attachment, ...(entry.attachments || [])] }
      : entry));
    return true;
  }, []);

  const removeAttachment = useCallback(async (attachment) => {
    const result = await appointmentService.deleteAttachment(attachment);
    if (result.error) return result.error;
    setAppointments((current) => current.map((entry) => entry.id === attachment.appointmentId
      ? { ...entry, attachments: (entry.attachments || []).filter((item) => item.id !== attachment.id) }
      : entry));
    return true;
  }, []);

  const addStockUsed = useCallback((appointmentId, entry) => {
    setAppointments((current) => current.map((appointment) => appointment.id === appointmentId
      ? { ...appointment, stockUsed: [...(appointment.stockUsed || []), entry] }
      : appointment));
  }, []);

  const value = useMemo(
    () => ({ appointments, absences, loading, error, refresh, createAppointment, bookAppointments, planActions, updateAppointment, startVisit, submitReport, addStockUsed, addAttachment, removeAttachment, getAttachmentUrl: appointmentService.getAttachmentUrl, uploadSignature: appointmentService.uploadSignature, getSignatureUrl: appointmentService.getSignatureUrl }),
    [appointments, absences, loading, error, refresh, createAppointment, bookAppointments, planActions, updateAppointment, startVisit, submitReport, addStockUsed, addAttachment, removeAttachment]
  );
  return <SchedulingContext.Provider value={value}>{children}</SchedulingContext.Provider>;
}

export function useScheduling() {
  const context = useContext(SchedulingContext);
  if (!context) throw new Error("useScheduling must be used inside <SchedulingProvider>.");
  return context;
}
