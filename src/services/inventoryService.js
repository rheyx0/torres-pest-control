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
import { todayISO } from "../utils/validators";

export const INVENTORY_STATUS = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
};

const COLUMNS = `
  id, name, type, quantity, unit, cost, supplier, storage_location, reorder_level, status,
  purchase_unit, usage_unit, conversion_multiplier, created_by, intake_branch_or_station,
  created_at, updated_at,
  chemical_type, expiration_date, safety_level, hazard_rating, date_received,
  serial_number, condition, last_maintenance_date, next_maintenance_date, manufacturer, model,
  material_category, description
`;

const MOVEMENT_COLUMNS = `
  id, item_id, amount, quantity_delta, movement_date, reference, actor, intake_branch_or_station, movement_type, appointment_id, unit_cost, total_cost, created_at,
  entered_amount, entered_unit, conversion_factor, stock_out_reason, technician_id, note, batch_number,
  inventory ( name, unit, cost )
`;

// Columns later migrations add: checkout custody (054) and the chemical batch
// (055). Each is dropped from the select if the database does not have it yet,
// so the history still loads ahead of a migration.
const CUSTODY_COLUMNS = ["checkout_id", "for_appointment_id", "return_reason", "custody_closed_at"];
const OPTIONAL_MOVEMENT_COLUMNS = [...CUSTODY_COLUMNS, "batch_id"];

const BATCH_COLUMNS = `
  id, reference, item_id, lot_number, expiration_date, received_date, quantity_received, quantity,
  unit_cost, is_opening, split_from, written_off_at, created_at
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
    purchaseUnit: row.purchase_unit || row.unit,
    usageUnit: row.usage_unit || row.unit,
    conversionMultiplier: row.conversion_multiplier === null ? 1 : Number(row.conversion_multiplier),
    cost: Number(row.cost),
    supplier: row.supplier || "",
    storageLocation: row.storage_location || "",
    reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level),
    status: row.status || INVENTORY_STATUS.ACTIVE,
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
    createdBy: row.created_by,
    intakeBranchOrStation: row.intake_branch_or_station || "",
  };
}

/** Empty strings must become null — Postgres enums and timestamps reject "". */
const nullIfBlank = (value) =>
  value === undefined || value === null || value === "" ? null : value;

const normalizeIdentityValue = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function hasDuplicateInventoryItem(item, inventory) {
  const matches = (existing, field) => normalizeIdentityValue(existing[field]) === normalizeIdentityValue(item[field]);
  const sharedMatch = (existing) =>
    matches(existing, "name") && matches(existing, "type") && matches(existing, "unit");

  return (inventory || []).some((existing) => {
    if (!sharedMatch(existing) || existing.id === item.id) return false;
    if (item.type === "CHEMICAL") {
      return matches(existing, "chemicalType") && matches(existing, "safetyLevel") && matches(existing, "hazardRating");
    }
    if (item.type === "EQUIPMENT") {
      return matches(existing, "manufacturer") && matches(existing, "model") && matches(existing, "serialNumber");
    }
    return matches(existing, "materialCategory");
  });
}

// Quantity is intentionally absent here. It's no longer settable through
// the Item Profile form — new items start at 0 (the column default), and
// after that the only path that can change it is stock_in() below. That
// keeps quantity impossible to desync from the movement log: there's no
// form field left that could set it directly.
function buildPayload(item) {
  const payload = {
    name: item.name?.trim(),
    type: item.type,
    unit: item.unit,
    cost: Number(item.cost) || 0,
    supplier: nullIfBlank(item.supplier),
    storage_location: nullIfBlank(item.storageLocation),
    reorder_level: item.reorderLevel === null || item.reorderLevel === "" ? null : Number(item.reorderLevel),
    intake_branch_or_station: nullIfBlank(item.intakeBranchOrStation),
  };

  // Only send the block that matches the type, so switching type doesn't leave
  // stale values from another sub-type behind.
  if (item.type === "CHEMICAL") {
    payload.chemical_type = nullIfBlank(item.chemicalType);
    // No expiration_date: since migration 055 it is the soonest expiry among
    // the item's batches, kept by a trigger. Writing it here would be undone.
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

export async function createItem(item, actorId, inventory) {
  const { data: currentRows, error: inventoryError } = await supabase
    .from("inventory")
    .select(COLUMNS);

  if (inventoryError) return { error: describeError(inventoryError) };

  const currentInventory = (currentRows || []).map(mapInventoryRow);
  if (hasDuplicateInventoryItem(item, currentInventory) || hasDuplicateInventoryItem(item, inventory)) {
    return { error: "This item already exists. Use Stock In to add quantity instead." };
  }

  const { data, error } = await supabase
    .from("inventory")
    // Quantity starts at zero by design. It is never supplied by the form;
    // Stock In is the only user-facing operation that can increase it.
    .insert({ ...buildPayload(item), quantity: 0, created_by: actorId || null })
    .select(COLUMNS)
    .single();

  if (error) return { error: describeError(error) };
  return { item: mapInventoryRow(data) };
}

export async function updateItem(itemId, item, inventory) {
  const { data: currentRows, error: inventoryError } = await supabase
    .from("inventory")
    .select(COLUMNS);

  if (inventoryError) return { error: describeError(inventoryError) };

  const currentInventory = (currentRows || []).map(mapInventoryRow);
  if (hasDuplicateInventoryItem({ ...item, id: itemId }, currentInventory) || hasDuplicateInventoryItem({ ...item, id: itemId }, inventory)) {
    return { error: "Another item with the same identity already exists." };
  }

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

/**
 * Edit only ever pre-fills and writes Name / Type / Unit — that's the only
 * data it's designed to change. A dedicated payload (rather than reusing
 * buildPayload with a half-filled `item`) so it never touches Supplier,
 * Reorder Level, or the type-specific columns it doesn't show.
 */
export async function updateItemBasics(itemId, { name, type, unit }) {
  const { data, error } = await supabase
    .from("inventory")
    .update({ name: name?.trim(), type, unit })
    .eq("id", itemId)
    .select(COLUMNS)
    .single();

  if (error) return { error: describeError(error) };
  return { item: mapInventoryRow(data) };
}

export async function setItemStatus(itemId, status) {
  const { data, error } = await supabase
    .from("inventory")
    .update({ status })
    .eq("id", itemId)
    .select(COLUMNS)
    .single();

  if (error) return { error: describeError(error) };
  return { item: mapInventoryRow(data) };
}

/**
 * A whole delivery in one server-side transaction (stock_in_batch(), migration
 * 040). Either every line lands or none does, so a delivery note and the stock
 * levels can never end up half-agreeing.
 *
 * `entries` carry `amount` already converted into the item's own unit — see
 * utils/units.js. The pre-conversion figures ride along so the movement log can
 * show what was actually written on the note. A chemical line may carry
 * `expirationDate`, the date printed on this delivery, which replaces the
 * item's expiry (migration 049).
 */
export async function stockInBatch(entries, { date, reference, intakeBranchOrStation, idempotencyKey }) {
  const { data, error } = await supabase.rpc("stock_in_batch", {
    p_items: entries.map((entry) => ({
      item_id: entry.itemId,
      amount: Number(entry.amount),
      unit_cost: entry.unitCost === "" || entry.unitCost === undefined || entry.unitCost === null
        ? null
        : Number(entry.unitCost),
      entered_amount: entry.enteredAmount === "" || entry.enteredAmount === undefined || entry.enteredAmount === null
        ? null
        : Number(entry.enteredAmount),
      entered_unit: entry.enteredUnit || null,
      conversion_factor: entry.conversionFactor === undefined || entry.conversionFactor === null
        ? 1
        : Number(entry.conversionFactor),
      // The expiry and lot printed on this delivery: a chemical line becomes
      // its own batch (migration 055). `noLot` when no lot is printed.
      expiration_date: nullIfBlank(entry.expirationDate),
      lot_number: nullIfBlank(entry.lotNumber),
      no_lot: Boolean(entry.noLot),
    })),
    p_movement_date: date,
    p_reference: nullIfBlank(reference),
    p_intake_branch_or_station: nullIfBlank(intakeBranchOrStation),
    p_idempotency_key: idempotencyKey || null,
  });

  if (error) return { error: describeError(error) };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return { error: "Stock In did not return a saved movement." };

  return {
    movements: rows.map((row) => ({
      id: row.movement_id,
      itemId: row.item_id,
      amount: Number(row.amount),
      quantityDelta: Number(row.amount),
      movementDate: row.movement_date,
      reference: row.reference || reference || "",
      actor: row.actor || "",
      movementType: "IN",
      intakeBranchOrStation: intakeBranchOrStation || "",
      unitCost: Number(row.unit_cost) || 0,
      totalCost: Number(row.total_cost) || 0,
      createdAt: row.created_at,
      newQuantity: Number(row.new_quantity),
      // Absent (undefined) before migration 049, so the caller keeps the old date.
      expirationDate: row.expiration_date,
      batchId: row.batch_id || "",
    })),
  };
}

/**
 * Stock leaving for a reason that is not an appointment: checked out to a
 * technician, missing at count, or damaged. The date is the caller's, not the
 * server's — a shortfall found today is often a shortfall from last week.
 *
 * A chemical leaves by batch, soonest expiry first or `batchId` first
 * (migration 055), so one stock-out can come back as several rows.
 */
export async function stockOutManual(itemId, { amount, date, reason, technicianId, note, forAppointmentId, batchId }) {
  const checkout = reason === "TECHNICIAN_CHECKOUT";
  const { data, error } = await supabase.rpc("stock_out_manual", {
    p_item_id: itemId,
    p_amount: Number(amount),
    p_movement_date: date,
    p_reason: reason,
    p_technician_id: checkout ? technicianId || null : null,
    p_note: nullIfBlank(note),
    // The visit a checkout is for (054) and a chosen batch (055). Sent only
    // when set, so a stock-out still records on a database without them.
    ...(checkout && forAppointmentId ? { p_for_appointment_id: forAppointmentId } : {}),
    ...(batchId ? { p_batch_id: batchId } : {}),
  });

  if (error) return { error: describeError(error) };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return { error: "Stock Out did not return a saved movement." };
  return { rows, newQuantity: Number(rows[rows.length - 1].new_quantity) };
}

/**
 * Checked-out stock coming back to the shelf (return_checkout, migration 054).
 * `reason` is one of RETURN_REASONS; a cancelled visit names `appointmentId`,
 * "OTHER" needs a note.
 */
export async function returnCheckout(checkoutId, { amount, reason, appointmentId, note, date }) {
  const { data, error } = await supabase.rpc("return_checkout", {
    p_checkout_id: checkoutId,
    p_amount: Number(amount),
    p_reason: reason,
    p_appointment_id: appointmentId || null,
    p_note: nullIfBlank(note),
    p_movement_date: date || null,
  });
  if (error) return { error: describeError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { error: "The return did not come back from the server." };
  return { newQuantity: Number(row.new_quantity), remaining: Number(row.remaining) };
}

/**
 * A counted difference. For a chemical it lands on `batchId` when given —
 * otherwise down comes off the soonest expiry, up goes into the opening batch
 * (migration 055) — so one correction can come back as several rows.
 */
export async function stockCorrection(itemId, delta, reason, { date = todayISO(), batchId } = {}) {
  const { data, error } = await supabase.rpc("stock_correction", {
    p_item_id: itemId,
    p_delta: Number(delta),
    p_reason: reason,
    p_movement_date: date,
    ...(batchId ? { p_batch_id: batchId } : {}),
  });
  if (error) return { error: describeError(error) };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return { error: "The correction did not return a saved movement." };
  return { rows, newQuantity: Number(rows[rows.length - 1].new_quantity) };
}

function mapMovementRow(row) {
  const amount = Number(row.amount) || 0;
  const unitCost = Number(row.unit_cost) || Number(row.inventory?.cost) || 0;
  const totalCost = Number(row.total_cost) || (amount * unitCost);

  return {
    id: row.id,
    itemId: row.item_id,
    amount,
    movementDate: row.movement_date,
    reference: row.reference || row.purchase_reference || "—",
    intakeBranchOrStation: row.intake_branch_or_station || "—",
    movementType: row.movement_type || "IN",
    enteredAmount: row.entered_amount === null || row.entered_amount === undefined ? null : Number(row.entered_amount),
    enteredUnit: row.entered_unit || "",
    conversionFactor: row.conversion_factor === null || row.conversion_factor === undefined ? 1 : Number(row.conversion_factor),
    stockOutReason: row.stock_out_reason || "",
    technicianId: row.technician_id || "",
    note: row.note || "",
    quantityDelta: row.quantity_delta === null || row.quantity_delta === undefined ? (row.movement_type === "OUT" ? -Number(row.amount) : Number(row.amount)) : Number(row.quantity_delta),
    appointmentId: row.appointment_id || null,
    // Custody (migration 054): the checkout this row settles, the visit a
    // checkout was for, why a return came back, and pre-054 checkouts.
    // The chemical batch it moved (migration 055) and its lot as recorded.
    batchId: row.batch_id || "",
    batchNumber: row.batch_number || "",
    checkoutId: row.checkout_id || "",
    forAppointmentId: row.for_appointment_id || "",
    returnReason: row.return_reason || "",
    custodyClosedAt: row.custody_closed_at || "",
    actor: row.actor || "—",
    unitCost,
    totalCost,
    createdAt: row.created_at,
    itemName: row.inventory?.name || "Unknown item",
    itemUnit: row.inventory?.unit || "",
  };
}

export async function fetchMovements() {
  let optional = [...OPTIONAL_MOVEMENT_COLUMNS];
  let result;
  // Each retry drops the column the error named, so this runs at most
  // OPTIONAL_MOVEMENT_COLUMNS + 1 times.
  for (;;) {
    const columns = optional.length ? `${optional.join(", ")}, ${MOVEMENT_COLUMNS}` : MOVEMENT_COLUMNS;
    result = await supabase.from("inventory_movements").select(columns).order("created_at", { ascending: false });
    const text = result.error ? `${result.error.message || ""} ${result.error.details || ""}` : "";
    const missing = optional.find((column) => text.includes(column));
    if (!missing) break;
    optional = optional.filter((column) => column !== missing);
  }

  if (result.error) return { error: describeError(result.error), movements: [] };
  const movements = (result.data || []).map(mapMovementRow);
  // Without 054 nothing links a visit's usage to a checkout, so every checkout
  // is settled as it was — the same thing 054 does to them when it runs.
  const beforeCustody = !optional.includes("checkout_id");
  return { error: null, movements: beforeCustody ? movements.map((movement) => ({ ...movement, custodyClosedAt: "before-054" })) : movements };
}

// ---------------------------------------------------------------------------
// Chemical batches (migration 055)
// ---------------------------------------------------------------------------

export function mapBatchRow(row) {
  return {
    id: row.id,
    reference: row.reference,
    itemId: row.item_id,
    lotNumber: row.lot_number || "",
    expirationDate: row.expiration_date ? String(row.expiration_date).slice(0, 10) : "",
    receivedDate: row.received_date ? String(row.received_date).slice(0, 10) : "",
    quantityReceived: Number(row.quantity_received) || 0,
    quantity: Number(row.quantity) || 0,
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
    isOpening: Boolean(row.is_opening),
    splitFrom: row.split_from || "",
    writtenOffAt: row.written_off_at || "",
    createdAt: row.created_at,
  };
}

/** Every batch. Before migration 055 there is no table, and no batches. */
export async function fetchBatches() {
  const { data, error } = await supabase.from("inventory_batches").select(BATCH_COLUMNS).order("created_at", { ascending: true });
  if (error && /inventory_batches/.test(`${error.message || ""} ${error.details || ""}`)) return { error: null, batches: [] };
  if (error) return { error: describeError(error), batches: [] };
  return { error: null, batches: (data || []).map(mapBatchRow) };
}

/** An expired batch's leftovers off the shelf, reason EXPIRED. Admin only. */
export async function writeOffBatch(batchId, note) {
  const { data, error } = await supabase.rpc("write_off_expired_batch", { p_batch_id: batchId, p_note: nullIfBlank(note) });
  if (error) return { error: describeError(error) };
  return { amount: Number(data) || 0 };
}

/** Correct a batch's lot number or expiry. Admin only. */
export async function updateBatch(batchId, { lotNumber, expirationDate }) {
  const { data, error } = await supabase.rpc("update_inventory_batch", {
    p_batch_id: batchId,
    p_lot_number: nullIfBlank(lotNumber),
    p_expiration_date: nullIfBlank(expirationDate),
  });
  if (error) return { error: describeError(error) };
  return { batch: mapBatchRow(Array.isArray(data) ? data[0] : data) };
}

/** Move part of a batch into a new one with its own lot and expiry. Admin only. */
export async function splitBatch(batchId, { amount, lotNumber, expirationDate }) {
  const { data, error } = await supabase.rpc("split_inventory_batch", {
    p_batch_id: batchId,
    p_amount: Number(amount),
    p_lot_number: nullIfBlank(lotNumber),
    p_expiration_date: nullIfBlank(expirationDate),
  });
  if (error) return { error: describeError(error) };
  return { batch: mapBatchRow(Array.isArray(data) ? data[0] : data) };
}

/** Drives the low-stock badge. */
export function isLowStock(item) {
  if (item?.reorderLevel === undefined || item?.reorderLevel === null) return false;
  return Number(item.quantity) <= Number(item.reorderLevel);
}
