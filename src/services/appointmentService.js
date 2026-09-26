import { supabase } from "./supabaseClient";
import { todayISO } from "../utils/validators";

// File bytes for report attachments live here; the table holds only metadata.
// Same arrangement as client-documents — see clientService.js.
const ATTACHMENT_BUCKET = "report-attachments";
const ATTACHMENT_COLUMNS = "id, appointment_id, name, mime_type, size_bytes, storage_path, category, uploaded_at";
const SIGNED_URL_TTL_SECONDS = 60;

const APPOINTMENT_COLUMNS = "id, reference, client_id, scheduled_at, duration_minutes, pest_concern, service_type, service_location, cancellation_reason, technician_id, status, notes, created_by, service_frequency, price, service_id, started_at, plan_id, plan_position, day_done_at, quote_id, invoice_id, activity_level, open_issues, created_at, updated_at";
const REPORT_COLUMNS = "appointment_id, findings, treatment_performed, recommendations, follow_up_date, submitted_by, submitted_at, customer_name, signature_path, signed_at, completion_note, technician_signature_path, technician_signed_at";

function describeError(error) {
  if (!error) return "Unknown error";
  return [error.message || "Unknown error", error.details ? ` - ${error.details}` : "", error.hint ? ` (hint: ${error.hint})` : ""].join("");
}

export function mapAppointmentRow(row, report = null) {
  return {
    id: row.id,
    // "TPC-V-00042" (migration 050). Empty before 050 is applied; read it
    // through appointmentReference() in utils/scheduling.js, which falls back.
    reference: row.reference || "",
    clientId: row.client_id,
    scheduledAt: row.scheduled_at,
    durationMinutes: Number(row.duration_minutes) || 60,
    pestConcern: row.pest_concern || "",
    serviceType: row.service_type || "",
    // Link to the service profile (migration 047), used only to prefill the
    // Stock-Out tab. serviceType stays the name the visit was booked under —
    // since 051, every service's name joined, "Termite Control, Rodent Control".
    serviceId: row.service_id || "",
    // Every service on the visit, in order (migration 051). serviceId is the
    // first. Read through servicesOf() in utils/scheduling.js.
    serviceIds: Array.isArray(row.serviceIds)
      ? row.serviceIds
      : (row.service_id ? [row.service_id] : []),
    serviceLocation: row.service_location || "",
    cancellationReason: row.cancellation_reason || "",
    technicianId: row.technician_id || "",
    // The whole crew, lead first. technicianId is kept as the lead so the
    // calendar colours, the printed form and every existing query that asks
    // for "the technician" keep working — see migration 041.
    technicianIds: Array.isArray(row.technicianIds)
      ? row.technicianIds
      : (row.technician_id ? [row.technician_id] : []),
    status: row.status,
    // When a technician started the visit on site (migration 048).
    startedAt: row.started_at || "",
    // The recurring plan or multi-day job this visit belongs to (migration
    // 052). planKind / planFrequency come from the plan row; read the rest
    // through utils/plans.js (planLabel, isLastJobDay, …).
    planId: row.plan_id || "",
    quoteId: row.quote_id || "",
    invoiceId: row.invoice_id || "",
    activityLevel: row.activity_level || "",
    openIssues: row.open_issues || "",
    planPosition: row.plan_position ?? null,
    planKind: row.planKind || "",
    planFrequency: row.planFrequency || "",
    // The office chose not to renew this recurring plan (migration 053).
    planRenewalDeclinedAt: row.planRenewalDeclinedAt || "",
    // A multi-day job's day closed on site ("Day done").
    dayDoneAt: row.day_done_at || "",
    notes: row.notes || "",
    serviceFrequency: row.service_frequency || "",
    price: row.price === null || row.price === undefined ? "" : Number(row.price),
    report: report?.findings || "",
    treatmentPerformed: report?.treatment_performed || "",
    recommendations: report?.recommendations || "",
    followUpDate: report?.follow_up_date || "",
    reportSubmitted: Boolean(report),
    reportSubmittedAt: report?.submitted_at || "",
    customerName: report?.customer_name || "",
    signaturePath: report?.signature_path || "",
    signedAt: report?.signed_at || "",
    technicianSignaturePath: report?.technician_signature_path || "",
    technicianSignedAt: report?.technician_signed_at || "",
    completionNote: report?.completion_note || "",
    attachments: row.attachments || [],
    stockUsed: row.stockUsed || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Before migration 048 there is no started_at column, before 050 no
// reference, before 052 no plan columns (061-063 add quote_id, invoice_id and
// the monitoring columns the same way), and PostgREST refuses a select
// naming a column that doesn't exist. Rather than blank the whole schedule
// when the app is deployed ahead of a migration, retry without whichever
// column it named.
const OPTIONAL_COLUMNS = ["reference", "started_at", "plan_id", "plan_position", "day_done_at", "quote_id", "invoice_id", "activity_level", "open_issues"];

async function selectAppointments() {
  let columns = APPOINTMENT_COLUMNS;
  // Each retry drops one column, so this runs at most OPTIONAL_COLUMNS + 1 times.
  for (;;) {
    const selected = columns;
    const result = await supabase.from("appointments").select(selected).order("scheduled_at", { ascending: true });
    const text = result.error ? `${result.error.message || ""} ${result.error.details || ""}` : "";
    const missing = OPTIONAL_COLUMNS.find((column) => selected.includes(`${column}, `) && text.includes(column));
    if (!missing) return result;
    columns = selected.replace(`${missing}, `, "");
  }
}

// Tables added by later migrations: before the migration runs the table does
// not exist, and the app carries on without it rather than failing to load.
async function selectOptionalTable(table, columns) {
  const result = await supabase.from(table).select(columns);
  if (result.error && new RegExp(table).test(`${result.error.message || ""} ${result.error.details || ""}`)) {
    return { data: [], error: null };
  }
  return result;
}

// The services list (051); before it, each visit's single service_id stands in.
const selectAppointmentServices = () => selectOptionalTable("appointment_services", "appointment_id, position, service_id");
// Recurring plans and multi-day jobs (052). renewal_declined_at is 053's; any
// error retries without it, since the missing-column error names the table and
// selectOptionalTable alone would take that as "no plans at all".
async function selectAppointmentPlans() {
  const result = await supabase.from("appointment_plans").select("id, kind, frequency, renewal_declined_at");
  return result.error ? selectOptionalTable("appointment_plans", "id, kind, frequency") : result;
}

export async function fetchAppointments() {
  const [appointmentsResult, reportsResult, stockResult, attachmentsResult, crewResult, servicesResult, plansResult] = await Promise.all([
    selectAppointments(),
    supabase.from("appointment_reports").select(REPORT_COLUMNS),
    supabase.from("inventory_movements").select("item_id, appointment_id, amount, movement_date, batch_number, inventory(name, unit)").eq("movement_type", "OUT").not("appointment_id", "is", null),
    supabase.from("appointment_report_attachments").select(ATTACHMENT_COLUMNS).order("uploaded_at", { ascending: false }),
    supabase.from("appointment_technicians").select("appointment_id, technician_id, is_lead, assigned_at"),
    selectAppointmentServices(),
    selectAppointmentPlans(),
  ]);
  const error = appointmentsResult.error || reportsResult.error || stockResult.error || attachmentsResult.error || crewResult.error || servicesResult.error || plansResult.error;
  if (error) return { error: describeError(error), appointments: [] };
  const plans = new Map((plansResult.data || []).map((plan) => [plan.id, plan]));
  // In the order ticked. A service since deleted from the catalog has no id
  // left and is skipped; its name survives in the visit's service_type.
  const servicesByAppointment = new Map();
  [...(servicesResult.data || [])]
    .sort((a, b) => a.position - b.position)
    .forEach((row) => {
      if (!row.service_id) return;
      const entries = servicesByAppointment.get(row.appointment_id) || [];
      entries.push(row.service_id);
      servicesByAppointment.set(row.appointment_id, entries);
    });
  const reports = new Map((reportsResult.data || []).map((report) => [report.appointment_id, report]));
  const stockByAppointment = new Map();
  (stockResult.data || []).forEach((movement) => {
    const entries = stockByAppointment.get(movement.appointment_id) || [];
    // Since migration 054 one line of materials can be several rows — part
    // drawn from a technician's checkout, part from the shelf. The report
    // shows what was used, so rows of the same item, batch and day are one.
    const same = entries.find((entry) => entry.itemId === movement.item_id
      && entry.batchNumber === (movement.batch_number || "") && entry.date === movement.movement_date);
    if (same) {
      same.amount = Math.round((same.amount + Number(movement.amount)) * 1e6) / 1e6;
    } else {
      entries.push({ itemId: movement.item_id, name: movement.inventory?.name || "Inventory item", amount: Number(movement.amount), unit: movement.inventory?.unit || "", batchNumber: movement.batch_number || "", date: movement.movement_date });
    }
    stockByAppointment.set(movement.appointment_id, entries);
  });
  // Lead first, then the order they were assigned in, so the crew reads the
  // same way everywhere it is printed.
  const crewByAppointment = new Map();
  [...(crewResult.data || [])]
    .sort((a, b) => (b.is_lead ? 1 : 0) - (a.is_lead ? 1 : 0)
      || String(a.assigned_at || "").localeCompare(String(b.assigned_at || "")))
    .forEach((row) => {
      const entries = crewByAppointment.get(row.appointment_id) || [];
      entries.push(row.technician_id);
      crewByAppointment.set(row.appointment_id, entries);
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
      technicianIds: crewByAppointment.get(row.id) || (row.technician_id ? [row.technician_id] : []),
      serviceIds: servicesByAppointment.get(row.id) || (row.service_id ? [row.service_id] : []),
      planKind: plans.get(row.plan_id)?.kind || "",
      planFrequency: plans.get(row.plan_id)?.frequency || "",
      planRenewalDeclinedAt: plans.get(row.plan_id)?.renewal_declined_at || "",
    }, reports.get(row.id))),
  };
}

/**
 * `technicianIds` is ordered and the first entry leads. A single `technicianId`
 * is still accepted so callers that only ever assign one person do not have to
 * wrap it in an array.
 */
function crewFrom({ technicianIds, technicianId }) {
  const crew = (Array.isArray(technicianIds) ? technicianIds : [technicianId])
    .map((id) => id || "")
    .filter(Boolean);
  // Deduplicated in order: the same person picked twice is a slip, not a
  // booking with two of them on it.
  return Array.from(new Set(crew));
}

export async function createAppointment(fields) {
  const { clientId, scheduledAt, durationMinutes, pestConcern, serviceType, serviceId, serviceLocation, notes, serviceFrequency, price } = fields;
  const crew = crewFrom(fields);
  const { data, error } = await supabase.rpc("create_appointment", {
    p_client_id: clientId,
    p_scheduled_at: new Date(scheduledAt).toISOString(),
    p_duration_minutes: Number(durationMinutes) || 60,
    p_pest_concern: pestConcern?.trim() || null,
    p_service_type: serviceType?.trim() || null,
    p_service_location: serviceLocation?.trim() || null,
    p_technician_ids: crew,
    p_notes: notes || null,
    p_service_frequency: serviceFrequency?.trim() || null,
    p_price: price === "" || price === undefined || price === null ? null : Number(price),
    p_service_id: serviceId || null,
  });
  if (error) return { error: describeError(error) };
  // The RPC returns the appointments row, which carries only the lead. The crew
  // we just sent is authoritative, so it is attached rather than re-fetched.
  return { appointment: mapAppointmentRow({ ...(Array.isArray(data) ? data[0] : data), technicianIds: crew }) };
}

export async function updateAppointment(appointment) {
  const crew = crewFrom(appointment);
  const { data, error } = await supabase.rpc("update_appointment", {
    p_appointment_id: appointment.id,
    p_scheduled_at: new Date(appointment.scheduledAt).toISOString(),
    p_duration_minutes: Number(appointment.durationMinutes) || 60,
    p_pest_concern: appointment.pestConcern?.trim() || null,
    p_service_type: appointment.serviceType?.trim() || null,
    p_service_location: appointment.serviceLocation?.trim() || null,
    p_technician_ids: crew,
    p_status: appointment.status,
    p_notes: appointment.notes || null,
    p_cancellation_reason: appointment.cancellationReason?.trim() || null,
    p_service_frequency: appointment.serviceFrequency?.trim() || null,
    p_price: appointment.price === "" || appointment.price === undefined || appointment.price === null
      ? null
      : Number(appointment.price),
    p_service_id: appointment.serviceId || null,
  });
  if (error) return { error: describeError(error) };
  return { appointment: mapAppointmentRow({ ...(Array.isArray(data) ? data[0] : data), technicianIds: crew }) };
}

// ---------------------------------------------------------------------------
// Plans (migration 052)
// ---------------------------------------------------------------------------

/**
 * Books one visit, a recurring series, or a multi-day job in one transaction
 * (book_appointments). `kind` is null for a single visit, else RECURRING or
 * MULTI_DAY; `visits` is the list the form showed — [{ scheduledAt,
 * durationMinutes }] — booked as is. Returns the new rows; the caller reloads
 * to pick up the plan they belong to.
 */
export async function bookAppointments({ kind = null, visits, clientId, pestConcern, serviceIds = [], serviceLocation, technicianIds = [], notes, serviceFrequency, price, skipSundays = true }) {
  const crew = crewFrom({ technicianIds });
  const { data, error } = await supabase.rpc("book_appointments", {
    p_kind: kind,
    p_visits: visits.map((visit) => ({
      scheduled_at: new Date(visit.scheduledAt).toISOString(),
      duration_minutes: Number(visit.durationMinutes),
    })),
    p_client_id: clientId,
    p_pest_concern: pestConcern?.trim() || null,
    p_service_ids: serviceIds.length ? serviceIds : null,
    p_service_location: serviceLocation?.trim() || null,
    p_technician_ids: crew,
    p_notes: notes || null,
    p_service_frequency: serviceFrequency?.trim() || null,
    p_price: price === "" || price === undefined || price === null ? null : Number(price),
    p_skip_sundays: skipSundays,
  });
  if (error) return { error: describeError(error) };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return { appointments: rows.map((row) => mapAppointmentRow({ ...row, technicianIds: crew, serviceIds })) };
}

/** Runs a plan RPC that answers with a count or a row; `{ error }` or `{ ok, data }`. */
async function planCall(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) return { error: describeError(error) };
  return { ok: true, data };
}

/** A multi-day job's day closed on site ("Day done"). */
export const finishJobDay = (appointmentId) => planCall("finish_job_day", { p_appointment_id: appointmentId });

/** Ends a multi-day job on this day; the days after it are cancelled. */
export const finishJobHere = (appointmentId) => planCall("finish_job_here", { p_appointment_id: appointmentId });

/** Cancels every visit of the plan still to come. */
export const cancelPlanRemaining = (planId) => planCall("cancel_plan_remaining", { p_plan_id: planId });

// ---------------------------------------------------------------------------
// Technicians who are out (migration 057)
// ---------------------------------------------------------------------------

const mapAbsenceRow = (row) => ({
  id: row.id,
  technicianId: row.technician_id,
  startsOn: String(row.starts_on).slice(0, 10),
  endsOn: String(row.ends_on).slice(0, 10),
  reason: row.reason || "",
});

/** Every recorded absence. Before migration 057 there is no table, and none. */
export async function fetchAbsences() {
  const { data, error } = await supabase.from("technician_absences").select("id, technician_id, starts_on, ends_on, reason").order("starts_on");
  if (error && /technician_absences/.test(`${error.message || ""} ${error.details || ""}`)) return { absences: [] };
  if (error) return { error: describeError(error), absences: [] };
  return { absences: (data || []).map(mapAbsenceRow) };
}

/**
 * Marks a technician out from `startsOn` to `endsOn` and, in the same
 * transaction, reassigns their visits in those days (`changes`, as
 * reassign_visits takes them — see utils/coverage.js).
 */
export const markTechnicianOut = (technicianId, { startsOn, endsOn, reason, changes = [] }) => planCall("mark_technician_out", {
  p_technician_id: technicianId,
  p_starts_on: startsOn,
  p_ends_on: endsOn,
  p_reason: reason?.trim() || null,
  p_changes: changes,
});

/** Back to work on `backOn`: the absence ends the day before (or is removed). */
export const endAbsence = (absenceId, backOn) => planCall("end_absence", { p_absence_id: absenceId, p_back_on: backOn });

/**
 * Cover for a technician who cannot work (migration 056): one change per
 * visit — { appointment_id, action: ASSIGN | REMOVE | RESCHEDULE,
 * technician_ids: the crew after } — in one transaction. See utils/coverage.js.
 */
export const reassignVisits = (absentTechnicianId, changes, reason) => planCall("reassign_visits", {
  p_absent_technician_id: absentTechnicianId,
  p_changes: changes,
  p_reason: reason?.trim() || null,
});

/** "Don't renew" (renew = false) or undo it (true); a recurring plan only (migration 053). */
export const setPlanRenewal = (planId, renew) => planCall("set_plan_renewal", { p_plan_id: planId, p_renew: renew });

/** One more day after the plan's last live one. */
export const addPlanVisit = (planId, { scheduledAt, durationMinutes }) => planCall("add_plan_visit", {
  p_plan_id: planId,
  p_scheduled_at: new Date(scheduledAt).toISOString(),
  p_duration_minutes: Number(durationMinutes),
});

/**
 * Changes every visit from `fromAppointmentId` on. Pass only what changes:
 * `startTime` ("HH:MM", recurring plans only), `technicianIds`, `serviceIds`.
 */
export const updatePlanFuture = (planId, fromAppointmentId, { startTime = null, technicianIds = null, serviceIds = null } = {}) => planCall("update_plan_future", {
  p_plan_id: planId,
  p_from_appointment_id: fromAppointmentId,
  p_start_time: startTime || null,
  p_technician_ids: technicianIds ? crewFrom({ technicianIds }) : null,
  p_service_ids: serviceIds && serviceIds.length ? serviceIds : null,
});

/**
 * Uploads the customer's signature and returns its object key.
 *
 * Deliberately no appointment_report_attachments row: that table has no UPDATE
 * grant and technicians cannot delete, so a mis-signed signature filed there
 * could never be replaced. The key lives on appointment_reports instead, which
 * the report upsert can overwrite.
 */
export async function uploadSignature(appointmentId, file, kind = "customer") {
  const objectId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const prefix = kind === "technician" ? "technician-signature" : "signature";
  const storagePath = `${appointmentId}/${prefix}-${objectId}.png`;

  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, file, { contentType: "image/png", upsert: false });
  if (error) return { error: describeError(error) };

  return { storagePath };
}

/** Short-lived link for a stored signature, same contract as getAttachmentUrl. */
export async function getSignatureUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) return { error: describeError(error) };
  return { url: data.signedUrl };
}

/** Mark a visit In progress (migration 048's start_visit). */
export async function startVisit(appointmentId) {
  const { data, error } = await supabase.rpc("start_visit", { p_appointment_id: appointmentId });
  if (error) return { error: describeError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  return { status: row?.status || "In progress", startedAt: row?.started_at || new Date().toISOString() };
}

/**
 * `serviceIds` are the services performed, ticked on the report (migration
 * 051): the RPC replaces the visit's list and snapshots the names onto the
 * appointment. Omitted, the visit's services are left alone — and the
 * parameter is not sent at all, so a report that doesn't change them still
 * files before 051 is applied.
 */
export async function submitReport(appointmentId, { findings, treatmentPerformed, recommendations, followUpDate, customerName, signaturePath, completionNote, technicianSignaturePath, serviceIds, activityLevel, openIssues }) {
  // Site monitoring (063) first, through its own RPC so the report function
  // stays 052's. Before 063 the function doesn't exist; the report still saves.
  if (activityLevel !== undefined || openIssues !== undefined) {
    const monitoring = await supabase.rpc("record_site_monitoring", {
      p_appointment_id: appointmentId,
      p_activity_level: activityLevel || null,
      p_open_issues: openIssues || null,
    });
    if (monitoring.error && !/record_site_monitoring|schema cache|does not exist/i.test(`${monitoring.error.message || ""} ${monitoring.error.details || ""}`)) {
      return { error: describeError(monitoring.error) };
    }
  }
  const { data, error } = await supabase.rpc("submit_appointment_report", {
    p_appointment_id: appointmentId,
    p_findings: findings,
    p_treatment_performed: treatmentPerformed,
    p_recommendations: recommendations || null,
    p_follow_up_date: followUpDate || null,
    p_customer_name: customerName || null,
    p_signature_path: signaturePath || null,
    p_completion_note: completionNote || null,
    p_technician_signature_path: technicianSignaturePath || null,
    ...(serviceIds?.length ? { p_service_ids: serviceIds } : {}),
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
    category: row.category || "OTHER",
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
export async function uploadAttachment(appointmentId, file, category = "OTHER") {
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
      category,
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

// `date` is the business day the materials were used. The default is the
// local date, not toISOString()'s UTC one, which in the Philippines is still
// yesterday until 8 am.
export async function stockOutBatch(appointmentId, items, date = todayISO()) {
  const { data, error } = await supabase.rpc("stock_out_batch", {
    p_appointment_id: appointmentId,
    // `batchId` is the container in the technician's hand (migration 055); the
    // server fills in each row's batch and lot, soonest expiry first otherwise.
    p_items: items.map((item) => ({ item_id: item.itemId, amount: Number(item.amount), batch_id: item.batchId || null })),
    p_movement_date: date,
  });
  if (error) return { error: describeError(error) };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return { movements: rows };
}
