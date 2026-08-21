// Inventory items — chemicals, equipment, and materials.
//
// Backed by the Supabase `inventory` table. It was previously localStorage,
// not by design but by accident: the table existed since v1, but v1 enabled
// RLS on it without writing a policy, so every request was denied and the app
// fell back to the browser. Items added in the UI never reached Postgres.
//
// Run supabase/migrations/003-inventory.sql before using this.
//
// One table holds three sub-types. `type` selects which block of columns
// applies; the rest stay null.

import { supabase } from "./supabaseClient";

const COLUMNS = `
  id, name, type, quantity, unit, cost, supplier, storage_location, reorder_level,
  created_at, updated_at,
  chemical_type, expiration_date, safety_level, hazard_rating, date_received,
  serial_number, condition, last_maintenance_date, next_maintenance_date, manufacturer, model,
  material_category, description
`;

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
//
// The UI uses camelCase throughout; the table uses snake_case.
// ---------------------------------------------------------------------------

export function mapInventoryRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    quantity: Number(row.quantity),
    unit: row.unit,
    cost: Number(row.cost),
    supplier: row.supplier || "",
    storageLocation: row.storage_location || "",
    reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level),
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    chemicalType: row.chemical_type,
    expirationDate: row.expiration_date,
    safetyLevel: row.safety_level,
    hazardRating: row.hazard_rating,
    dateReceived: row.date_received,

    serialNumber: row.serial_number,
    condition: row.condition,
    lastMaintenanceDate: row.last_maintenance_date,
    nextMaintenanceDate: row.next_maintenance_date,
    manufacturer: row.manufacturer,
    model: row.model,

    materialCategory: row.material_category,
    description: row.description,
  };
}

/** Empty strings must become null — Postgres enums and timestamps reject "". */
const nullIfBlank = (value) =>
  value === undefined || value === null || value === "" ? null : value;

function buildPayload(item) {
  const payload = {
    name: item.name?.trim(),
    type: item.type,
    quantity: Number(item.quantity) || 0,
    unit: item.unit,
    cost: Number(item.cost) || 0,
    supplier: nullIfBlank(item.supplier),
    storage_location: nullIfBlank(item.storageLocation),
    reorder_level: item.reorderLevel === null || item.reorderLevel === "" ? null : Number(item.reorderLevel),
  };

  // Only send the block that matches the type, so switching type doesn't leave
  // stale values from another sub-type behind.
  if (item.type === "CHEMICAL") {
    payload.chemical_type = nullIfBlank(item.chemicalType);
    payload.expiration_date = nullIfBlank(item.expirationDate);
    payload.safety_level = nullIfBlank(item.safetyLevel);
    payload.hazard_rating = nullIfBlank(item.hazardRating);
    payload.date_received = nullIfBlank(item.dateReceived);
  } else if (item.type === "EQUIPMENT") {
    payload.serial_number = nullIfBlank(item.serialNumber);
    payload.condition = nullIfBlank(item.condition);
    payload.last_maintenance_date = nullIfBlank(item.lastMaintenanceDate);
    payload.next_maintenance_date = nullIfBlank(item.nextMaintenanceDate);
    payload.manufacturer = nullIfBlank(item.manufacturer);
    payload.model = nullIfBlank(item.model);
  } else if (item.type === "MATERIAL") {
    payload.material_category = nullIfBlank(item.materialCategory);
    payload.description = nullIfBlank(item.description);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function fetchInventory() {
  const { data, error } = await supabase
    .from("inventory")
    .select(COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return { error: describeError(error), inventory: [] };
  return { error: null, inventory: (data || []).map(mapInventoryRow) };
}

export async function createItem(item) {
  const { data, error } = await supabase
    .from("inventory")
    .insert(buildPayload(item))
    .select(COLUMNS)
    .single();

  if (error) return { error: describeError(error) };
  return { item: mapInventoryRow(data) };
}

export async function updateItem(itemId, item) {
  const { data, error } = await supabase
    .from("inventory")
    .update(buildPayload(item))
    .eq("id", itemId)
    .select(COLUMNS)
    .single();

  if (error) return { error: describeError(error) };
  return { item: mapInventoryRow(data) };
}

export async function deleteItem(itemId) {
  const { error } = await supabase.from("inventory").delete().eq("id", itemId);
  if (error) return { error: describeError(error) };
  return { ok: true };
}

/** Drives the low-stock badge. */
export function isLowStock(item) {
  if (item?.reorderLevel === undefined || item?.reorderLevel === null) return false;
  return Number(item.quantity) <= Number(item.reorderLevel);
}
