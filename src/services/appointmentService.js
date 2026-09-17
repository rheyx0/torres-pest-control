import { supabase } from "./supabaseClient";

// File bytes for report attachments live here; the table holds only metadata.
// Same arrangement as client-documents — see clientService.js.
const ATTACHMENT_BUCKET = "report-attachments";
const ATTACHMENT_COLUMNS = "id, appointment_id, name, mime_type, size_bytes, storage_path, uploaded_at";
const SIGNED_URL_TTL_SECONDS = 60;

const APPOINTMENT_COLUMNS = "id, client_id, scheduled_at, duration_minutes, pest_concern, service_type, service_location, cancellation_reason, technician_id, status, notes, created_by, created_at, updated_at";
const REPORT_COLUMNS = "appointment_id, findings, treatment_performed, recommendations, follow_up_date, submitted_by, submitted_at";

function describeError(error) {
  if (!error) return "Unknown error";
  return [error.message || "Unknown error", error.details ? ` - ${error.details}` : "", error.hint ? ` (hint: ${error.hint})` : ""].join("");
}

export function mapAppointmentRow(row, report = null) {
  return {
    id: row.id,
    clientId: row.client_id,
    scheduledAt: row.scheduled_at,
    durationMinutes: Number(row.duration_minutes) || 60,
    pestConcern: row.pest_concern || "",
    serviceType: row.service_type || "",
    serviceLocation: row.service_location || "",
    cancellationReason: row.cancellation_reason || "",
    technicianId: row.technician_id || "",
    status: row.status,
    notes: row.notes || "",
    report: report?.findings || "",
    treatmentPerformed: report?.treatment_performed || "",
    recommendations: report?.recommendations || "",
    followUpDate: report?.follow_up_date || "",
    reportSubmitted: Boolean(report),
    reportSubmittedAt: report?.submitted_at || "",
    attachments: row.attachments || [],
    stockUsed: row.stockUsed || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchAppointments() {
  const [appointmentsResult, reportsResult, stockResult, attachmentsResult] = await Promise.all([
    supabase.from("appointments").select(APPOINTMENT_COLUMNS).order("scheduled_at", { ascending: true }),
    supabase.from("appointment_reports").select(REPORT_COLUMNS),
    supabase.from("inventory_movements").select("item_id, appointment_id, amount, movement_date, inventory(name, unit)").eq("movement_type", "OUT").not("appointment_id", "is", null),
    supabase.from("appointment_report_attachments").select(ATTACHMENT_COLUMNS).order("uploaded_at", { ascending: false }),
  ]);
  const error = appointmentsResult.error || reportsResult.error || stockResult.error || attachmentsResult.error;
  if (error) return { error: describeError(error), appointments: [] };
  const reports = new Map((reportsResult.data || []).map((report) => [report.appointment_id, report]));
  const stockByAppointment = new Map();
  (stockResult.data || []).forEach((movement) => {
    const entries = stockByAppointment.get(movement.appointment_id) || [];
    entries.push({ itemId: movement.item_id, name: movement.inventory?.name || "Inventory item", amount: Number(movement.amount), unit: movement.inventory?.unit || "", date: movement.movement_date });
    stockByAppointment.set(movement.appointment_id, entries);
  });
  const attachmentsByAppointment = new Map();
  (attachmentsResult.data || []).forEach((row) => {
    const entries = attachmentsByAppointment.get(row.appointment_id) || [];
    entries.push(mapAttachmentRow(row));
    attachmentsByAppointment.set(row.appointment_id, entries);
  });
  return {
    error: null,
    appointments: (appointmentsResult.data || []).map((row) => mapAppointmentRow({
      ...row,
      stockUsed: stockByAppointment.get(row.id) || [],
      attachments: attachmentsByAppointment.get(row.id) || [],
    }, reports.get(row.id))),
  };
}

export async function createAppointment({ clientId, scheduledAt, durationMinutes, pestConcern, serviceType, serviceLocation, technicianId, notes }) {
  const { data, error } = await supabase.rpc("create_appointment", {
    p_client_id: clientId,
    p_scheduled_at: new Date(scheduledAt).toISOString(),
    p_duration_minutes: Number(durationMinutes) || 60,
    p_pest_concern: pestConcern?.trim() || null,
    p_service_type: serviceType?.trim() || null,
    p_service_location: serviceLocation?.trim() || null,
    p_technician_id: technicianId || null,
    p_notes: notes || null,
  });
  if (error) return { error: describeError(error) };
  return { appointment: mapAppointmentRow(Array.isArray(data) ? data[0] : data) };
}

export async function updateAppointment(appointment) {
  const { data, error } = await supabase.rpc("update_appointment", {
    p_appointment_id: appointment.id,
    p_scheduled_at: new Date(appointment.scheduledAt).toISOString(),
    p_duration_minutes: Number(appointment.durationMinutes) || 60,
    p_pest_concern: appointment.pestConcern?.trim() || null,
    p_service_type: appointment.serviceType?.trim() || null,
    p_service_location: appointment.serviceLocation?.trim() || null,
    p_technician_id: appointment.technicianId || null,
    p_status: appointment.status,
    p_notes: appointment.notes || null,
    p_cancellation_reason: appointment.cancellationReason?.trim() || null,
  });
  if (error) return { error: describeError(error) };
  return { appointment: mapAppointmentRow(Array.isArray(data) ? data[0] : data) };
}

export async function submitReport(appointmentId, { findings, treatmentPerformed, recommendations, followUpDate }) {
  const { data, error } = await supabase.rpc("submit_appointment_report", {
    p_appointment_id: appointmentId,
    p_findings: findings,
    p_treatment_performed: treatmentPerformed,
    p_recommendations: recommendations || null,
    p_follow_up_date: followUpDate || null,
  });
  if (error) return { error: describeError(error) };
  return { report: Array.isArray(data) ? data[0] : data };
}

// ---------------------------------------------------------------------------
// Report attachments (before/after photos, signed documents)
// ---------------------------------------------------------------------------

export function mapAttachmentRow(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    name: row.name,
    type: row.mime_type,
    size: row.size_bytes,
    storagePath: row.storage_path,
    uploadedAt: row.uploaded_at,
  };
}

/** Filenames become object keys, so strip anything that would break a path. */
function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Bytes first, metadata row second — a failed upload leaves no row, so the UI
 * never lists an attachment whose file isn't there.
 */
export async function uploadAttachment(appointmentId, file) {
  const objectId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storagePath = `${appointmentId}/${objectId}-${safeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) return { error: describeError(uploadError) };

  const { data, error } = await supabase
    .from("appointment_report_attachments")
    .insert({
      appointment_id: appointmentId,
      name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      storage_path: storagePath,
    })
    .select(ATTACHMENT_COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
    return { error: describeError(error) };
  }
  return { attachment: mapAttachmentRow(data) };
}

export async function deleteAttachment(attachment) {
  const { error } = await supabase.from("appointment_report_attachments").delete().eq("id", attachment.id);
  if (error) return { error: describeError(error) };

  const { error: storageError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.storagePath]);
  if (storageError) console.warn("Attachment row deleted but file remains:", storageError);
  return { ok: true };
}

/** The bucket is private, so links are minted on click and expire quickly. */
export async function getAttachmentUrl(attachment, { download = false } = {}) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: download ? attachment.name : undefined,
    });
  if (error) return { error: describeError(error) };
  return { url: data.signedUrl };
}

export async function stockOut(itemId, appointmentId, amount, date = new Date().toISOString().slice(0, 10)) {
  const { data, error } = await supabase.rpc("stock_out", {
    p_item_id: itemId,
    p_appointment_id: appointmentId,
    p_amount: Number(amount),
    p_movement_date: date,
  });
  if (error) return { error: describeError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  return { movement: row, newQuantity: Number(row?.new_quantity) };
}

export async function stockOutBatch(appointmentId, items, date = new Date().toISOString().slice(0, 10)) {
  const { data, error } = await supabase.rpc("stock_out_batch", {
    p_appointment_id: appointmentId,
    p_items: items.map((item) => ({ item_id: item.itemId, amount: Number(item.amount) })),
    p_movement_date: date,
  });
  if (error) return { error: describeError(error) };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return { movements: rows };
}
