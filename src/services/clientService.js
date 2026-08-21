// Client profiles and their attached documents.
//
// Backed by Supabase: rows in `clients` / `client_documents`, file bytes in
// the private `client-documents` Storage bucket.
//
// Previously this was localStorage, and "uploads" were URL.createObjectURL —
// a pointer into the tab's memory that the browser revokes on reload. The
// pointer was persisted but the file was not, so every document 404'd after a
// refresh and nothing was ever visible to a teammate.
//
// Run supabase/migrations/001-clients-and-documents.sql before using this.

import { supabase } from "./supabaseClient";

const BUCKET = "client-documents";

// How long a Preview/Download link stays valid. Short on purpose — the link is
// minted when the button is clicked, not stored.
const SIGNED_URL_TTL_SECONDS = 60;

const CLIENT_COLUMNS =
  "id, name, email, phone, address, classification, classification_other, pest_concern, source, status, created_at, updated_at";

const DOCUMENT_COLUMNS = "id, client_id, name, mime_type, size_bytes, storage_path, uploaded_at";

function describeError(error) {
  if (!error) return "Unknown error";
  return [
    error.message || "Unknown error",
    error.details ? ` — ${error.details}` : "",
    error.hint ? ` (hint: ${error.hint})` : "",
  ].join("");
}

// ---------------------------------------------------------------------------
// Row <-> app shape
// ---------------------------------------------------------------------------

export function mapClientRow(row, documents = []) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    address: row.address || "",
    classification: row.classification,
    classificationOther: row.classification_other || "",
    pestConcern: row.pest_concern || "",
    source: row.source || "Walk-in",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documents,
    // No table for service history yet — it's a later sprint. Defaulted so
    // components that read it don't have to null-check.
    history: { appointments: [], services: [], transactions: [] },
  };
}

export function mapDocumentRow(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    type: row.mime_type,
    size: row.size_bytes,
    storagePath: row.storage_path,
    uploadedAt: row.uploaded_at,
  };
}

function buildClientPayload(form) {
  return {
    name: form.name?.trim(),
    email: form.email?.trim() || null,
    phone: form.phone?.trim() || null,
    address: form.address?.trim() || null,
    classification: form.classification,
    classification_other: form.classification === "OTHER" ? form.classificationOther?.trim() || null : null,
    pest_concern: form.pestConcern?.trim() || null,
    source: form.source || null,
  };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** Loads every client with its documents attached, newest first. */
export async function fetchClients() {
  const [clientsRes, documentsRes] = await Promise.all([
    supabase.from("clients").select(CLIENT_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("client_documents").select(DOCUMENT_COLUMNS).order("uploaded_at", { ascending: false }),
  ]);

  const error = clientsRes.error || documentsRes.error;
  if (error) return { error: describeError(error), clients: [] };

  // Group documents by client once, rather than filtering per client.
  const byClient = new Map();
  for (const row of documentsRes.data || []) {
    const list = byClient.get(row.client_id) || [];
    list.push(mapDocumentRow(row));
    byClient.set(row.client_id, list);
  }

  return {
    error: null,
    clients: (clientsRes.data || []).map((row) => mapClientRow(row, byClient.get(row.id) || [])),
  };
}

export async function createClient(form) {
  const { data, error } = await supabase
    .from("clients")
    .insert(buildClientPayload(form))
    .select(CLIENT_COLUMNS)
    .single();

  if (error) return { error: describeError(error) };
  return { client: mapClientRow(data) };
}

export async function updateClient(clientId, form) {
  const { data, error } = await supabase
    .from("clients")
    .update(buildClientPayload(form))
    .eq("id", clientId)
    .select(CLIENT_COLUMNS)
    .single();

  if (error) return { error: describeError(error) };
  return { client: mapClientRow(data) };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Filenames become object keys, so strip anything that would break a path. */
function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Uploads the file, then records its metadata.
 *
 * Storage first, table second: a failed upload leaves no row, so the UI never
 * lists a document whose bytes aren't there. The reverse order could strand a
 * row pointing at nothing.
 */
export async function uploadDocument(clientId, file) {
  const objectId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const storagePath = `${clientId}/${objectId}-${safeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });

  if (uploadError) return { error: describeError(uploadError) };

  const { data, error } = await supabase
    .from("client_documents")
    .insert({
      client_id: clientId,
      name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      storage_path: storagePath,
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (error) {
    // Don't leave an orphaned object behind if the metadata insert fails.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { error: describeError(error) };
  }

  return { document: mapDocumentRow(data) };
}

/** Removes the metadata row and the underlying object. */
export async function deleteDocument(document) {
  const { error } = await supabase.from("client_documents").delete().eq("id", document.id);
  if (error) return { error: describeError(error) };

  // Best-effort: if this fails the row is already gone, so the file is
  // unreachable from the UI either way. Logged rather than surfaced.
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([document.storagePath]);
  if (storageError) console.warn("Document row deleted but file remains:", storageError);

  return { ok: true };
}

/**
 * Mints a short-lived URL for viewing or downloading.
 *
 * The bucket is private, so there is no permanent URL to store — this is
 * called when the user actually clicks Preview or Download.
 *
 * @param {boolean} download true = force a save dialog, false = open inline
 */
export async function getDocumentUrl(document, { download = false } = {}) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(document.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: download ? document.name : undefined,
    });

  if (error) return { error: describeError(error) };
  return { url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Search / filter (unchanged — pure, runs on the loaded list)
// ---------------------------------------------------------------------------

/**
 * Sprint AC: "Staff can search by name or filter by classification."
 * Classification was previously excluded from the search string and had no
 * filter control at all.
 */
export function filterClients(clients, { searchTerm = "", classification = "ALL" } = {}) {
  const term = searchTerm.trim().toLowerCase();

  return clients.filter((client) => {
    if (classification !== "ALL" && client.classification !== classification) return false;
    if (!term) return true;

    // Pest concern is searchable too, so staff can pull up "all the termite
    // jobs" without a dedicated filter control.
    const searchable = [
      client.name,
      client.phone,
      client.email,
      client.address,
      client.classification,
      client.pestConcern,
    ]
      .filter(Boolean)
      .join(" ");

    return searchable.toLowerCase().includes(term);
  });
}
