import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as appointmentService from "../services/appointmentService";
import { useAuthContext } from "./AuthContext";

const SchedulingContext = createContext(null);

export function SchedulingProvider({ children }) {
  const { session, sessionVerified } = useAuthContext();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await appointmentService.fetchAppointments();
    if (result.error) setError(result.error);
    else setAppointments(result.appointments);
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    if (!session || !sessionVerified) {
      setAppointments([]);
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

  const updateAppointment = useCallback(async (appointment) => {
    const result = await appointmentService.updateAppointment(appointment);
    if (result.error) return result.error;
    if (!result.appointment?.status) return "Appointment update returned no saved status. Apply migration 020 and try again.";
    setAppointments((current) => current.map((entry) => entry.id === appointment.id ? { ...entry, ...result.appointment, report: entry.report, reportSubmitted: entry.reportSubmitted, stockUsed: entry.stockUsed } : entry));
    return result.appointment;
  }, []);

  const submitReport = useCallback(async (appointmentId, reportFields) => {
    const result = await appointmentService.submitReport(appointmentId, reportFields);
    if (result.error) return result.error;
    setAppointments((current) => current.map((entry) => entry.id === appointmentId ? { ...entry, report: result.report.findings, treatmentPerformed: result.report.treatment_performed, recommendations: result.report.recommendations || "", followUpDate: result.report.follow_up_date || "", reportSubmitted: true, reportSubmittedAt: result.report.submitted_at, status: "Completed" } : entry));
    return result.report;
  }, []);

  const addAttachment = useCallback(async (appointmentId, file) => {
    const result = await appointmentService.uploadAttachment(appointmentId, file);
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
    () => ({ appointments, loading, error, refresh, createAppointment, updateAppointment, submitReport, addStockUsed, addAttachment, removeAttachment, getAttachmentUrl: appointmentService.getAttachmentUrl }),
    [appointments, loading, error, refresh, createAppointment, updateAppointment, submitReport, addStockUsed, addAttachment, removeAttachment]
  );
  return <SchedulingContext.Provider value={value}>{children}</SchedulingContext.Provider>;
}

export function useScheduling() {
  const context = useContext(SchedulingContext);
  if (!context) throw new Error("useScheduling must be used inside <SchedulingProvider>.");
  return context;
}
