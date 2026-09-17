// In-app notifications.
//
// Rows are written server-side by submit_appointment_report (migration 028) and
// scoped to the signed-in account by RLS, so a fetch here returns only the
// current user's notifications. INSERT is deliberately not granted to the
// browser — the client can read and mark read, nothing else.

import { supabase } from "./supabaseClient";

const COLUMNS = "id, appointment_id, message, created_at, read_at";

function describeError(error) {
  if (!error) return "Unknown error";
  return [error.message || "Unknown error", error.details ? ` - ${error.details}` : "", error.hint ? ` (hint: ${error.hint})` : ""].join("");
}

export function mapNotificationRow(row) {
  return {
    id: row.id,
    appointmentId: row.appointment_id || "",
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at || null,
  };
}

export async function fetchNotifications(limit = 30) {
  const { data, error } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { error: describeError(error), notifications: [] };
  return { error: null, notifications: (data || []).map(mapNotificationRow) };
}

export async function markAllRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return { error: describeError(error) };
  return { ok: true };
}
