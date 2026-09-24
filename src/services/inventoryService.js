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

export const INVENTORY_STATUS = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
};

const COLUMNS = `
  id, name, type, quantity, unit, cost, supplier, storage_location, reorder_level, status,
  purchase_unit, usage_unit, conversion_multiplier, created_by, intake_branch_or_station,
  created_at, updated_at,
  chemical_type, expiration_date, safety_level, hazard_rating, date_received,
  standard_rate, rate_unit, rate_note,
  serial_number, condition, last_maintenance_date, next_maintenance_date, manufacturer, model,
  material_category, description
`;

const MOVEMENT_COLUMNS = `
  id, item_id, amount, quantity_delta, movement_date, reference, actor, intake_branch_or_station, supplier, expiry_date, movement_type, appointment_id, unit_cost, total_cost, created_at,
  inventory ( name, unit, cost, supplier )
`;

const LEGACY_MOVEMENT_COLUMNS = `
  id, item_id, amount, quantity_delta, movement_date, reference, actor, intake_branch_or_station, movement_type, appointment_id, unit_cost, total_cost, created_at,
  inventory ( name, unit, cost, supplier )
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
    supplier: row.supplier || row.inventory?.supplier || "",
    storageLocation: row.storage_location || "",
    reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level),
    status: row.status || INVENTORY_STATUS.ACTIVE,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    chemicalType: row.chemical_type,
    standardRate: row.standard_rate === null || row.standard_rate === undefined ? "" : Number(row.standard_rate),
    rateUnit: row.rate_unit || "",
    rateNote: row.rate_note || "",
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
    payload.expiration_date = nullIfBlank(item.expirationDate);
    payload.safety_level = nullIfBlank(item.safetyLevel);
    payload.hazard_rating = nullIfBlank(item.hazardRating);
    payload.date_received = nullIfBlank(item.dateReceived);
    // Advisory dosage shown to the technician at stock-out; never enforced.
    payload.standard_rate = item.standardRate === null || item.standardRate === "" || item.standardRate === undefined
      ? null
      : Number(item.standardRate);
    payload.rate_unit = nullIfBlank(item.rateUnit);
    payload.rate_note = nullIfBlank(item.rateNote);
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

export async function removeUnverifiedInventory() {
  const { data: rows, error: fetchError } = await supabase
    .from("inventory")
    .select("id, intake_branch_or_station");

  if (fetchError) return { error: describeError(fetchError) };

  const approvedBranches = new Set([
    "Davao Main Service Branch",
    "Samal Service Branch",
    "Digos Service Branch",
    "Dumaguete Service Branch",
    "Panglao Service Branch",
    "Cebu Service Branch",
  ]);
  const invalidIds = (rows || [])
    .filter((row) => !approvedBranches.has(row.intake_branch_or_station))
    .map((row) => row.id);

  for (const itemId of invalidIds) {
    const { error } = await supabase.from("inventory").delete().eq("id", itemId);
    if (error) return { error: describeError(error) };
  }

  return { error: null };
}

export async function restoreDemoInventory() {
  const rows = [
    { name: "Fipronil Granules", type: "CHEMICAL", quantity: 12, unit: "kg", cost: 850, supplier: "Syngenta Philippines", intake_branch_or_station: "Davao Main Service Branch", reorder_level: 20, chemical_type: "INSECTICIDE", expiration_date: "2027-06-15", safety_level: "High", hazard_rating: "Toxic - Handle with care", date_received: "2026-01-10" },
    { name: "Residual Spray Concentrate", type: "CHEMICAL", quantity: 8, unit: "L", cost: 1200, supplier: "BASF Philippines", intake_branch_or_station: "Davao Main Service Branch", reorder_level: 10, chemical_type: "INSECTICIDE", expiration_date: "2027-03-20", safety_level: "Medium", hazard_rating: "Use in well-ventilated areas", date_received: "2026-02-05" },
    { name: "Fogging Solution", type: "CHEMICAL", quantity: 9, unit: "L", cost: 2500, supplier: "Bayer CropScience", intake_branch_or_station: "Davao Main Service Branch", reorder_level: 15, chemical_type: "FUMIGANT", expiration_date: "2026-12-31", safety_level: "High", hazard_rating: "Hazardous - Requires certification", date_received: "2026-05-10" },
    { name: "Rodent Bait Blocks", type: "MATERIAL", quantity: 5, unit: "pack", cost: 450, supplier: "Rentokil Philippines", intake_branch_or_station: "Davao Main Service Branch", storage_location: "Main Warehouse - Shelf C2", reorder_level: 8, material_category: "SUPPLIES", description: "Pre-packaged rodent poison blocks - 25 blocks per pack" },
    { name: "Protective Gloves (Nitrile)", type: "EQUIPMENT", quantity: 18, unit: "box", cost: 280, supplier: "Safety First Equipment Co.", intake_branch_or_station: "Davao Main Service Branch", storage_location: "Main Office - Supply Closet", reorder_level: 12, serial_number: "GLV-NIR-2026-001", condition: "ACTIVE", last_maintenance_date: "2026-08-01", manufacturer: "Hartalega Holdings", model: "Heavy Duty Nitrile 100/box" },
    { name: "Pest Inspection Kit", type: "EQUIPMENT", quantity: 4, unit: "set", cost: 3500, supplier: "Industrial Equipment Solutions", intake_branch_or_station: "Davao Main Service Branch", storage_location: "Main Office - Equipment Room", reorder_level: 6, serial_number: "INSP-KIT-2026-001", condition: "ACTIVE", last_maintenance_date: "2026-08-10", next_maintenance_date: "2026-11-10", manufacturer: "Flexi-Coil", model: "Professional Pest Detection Set" },
  ];

  const { data: existingRows, error: existingError } = await supabase.from("inventory").select("name");
  if (existingError) return { error: describeError(existingError), inventory: [] };

  const existingNames = new Set((existingRows || []).map((row) => row.name.toLowerCase()));
  const missingRows = rows.filter((row) => !existingNames.has(row.name.toLowerCase()));
  if (missingRows.length === 0) return fetchInventory();

  const { data, error } = await supabase.from("inventory").insert(missingRows).select(COLUMNS);
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
  if (error) {
    if (error.code === "23503" || error.message?.includes("inventory_movements")) {
      return { error: "This item has movement history and cannot be deleted. Disable it instead to preserve the audit trail." };
    }
    return { error: describeError(error) };
  }
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
 * The only way quantity can change post-creation. Runs server-side as one
 * transaction (see stock_in() in 005-inventory-stock-movements.sql) so the
 * movement row and the quantity bump can't get out of sync, and so a
 * disabled item is rejected even if the UI's guard is somehow bypassed.
 */
export async function stockIn(
  itemId,
  { amount, date, reference, actor, actorId, intakeBranchOrStation, idempotencyKey, unitCost, supplier, expiryDate }
) {
  const numericCost = unitCost !== undefined && unitCost !== null && unitCost !== "" ? Number(unitCost) : null;

  const callStockIn = (referenceValue) => supabase.rpc("stock_in", {
    p_item_id: itemId,
    p_amount: Number(amount),
    p_movement_date: date,
    p_reference: referenceValue,
    p_actor: actor || null,
    p_idempotency_key: idempotencyKey || null,
    p_actor_id: actorId || null,
    p_intake_branch_or_station: nullIfBlank(intakeBranchOrStation),
  });

  let { data, error } = await callStockIn(nullIfBlank(reference));
  if (error && !nullIfBlank(reference) && error.message?.toLowerCase().includes("purchase order or supplier invoice reference is required")) {
    // Older deployed functions still enforce a reference; keep blank input usable until migration 022 is applied.
    ({ data, error } = await callStockIn("N/A"));
  }

  if (error) return { error: describeError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { error: "Stock In did not return a result." };
  const calculatedTotal = numericCost !== null ? Number(amount) * numericCost : 0;

  // Update item catalog cost if a unitCost was explicitly entered
  const itemUpdates = {};
  if (numericCost !== null && !isNaN(numericCost) && numericCost >= 0) itemUpdates.cost = numericCost;
  if (nullIfBlank(supplier)) itemUpdates.supplier = nullIfBlank(supplier);
  if (Object.keys(itemUpdates).length > 0) {
    await supabase.from("inventory").update(itemUpdates).eq("id", itemId);
  }
  const { error: metadataError } = await supabase.from("inventory_movements").update({
    ...(numericCost !== null && !isNaN(numericCost) && numericCost >= 0 ? { unit_cost: numericCost, total_cost: calculatedTotal } : {}),
    supplier: nullIfBlank(supplier),
    expiry_date: expiryDate || null,
  }).eq("id", row.movement_id);
  if (metadataError && /supplier|expiry_date|column/i.test(metadataError.message || "")) {
    return { error: "Stock In was recorded, but supplier history needs migration 041 applied before per-intake suppliers can be saved." };
  }

  return {
    movement: {
      id: row.movement_id,
      itemId: row.item_id,
      amount: Number(row.amount),
      movementDate: row.movement_date,
      reference: row.reference || reference || "",
      actor: row.actor || actor || "",
      intakeBranchOrStation: intakeBranchOrStation || "",
      supplier: supplier || "",
      expiryDate: expiryDate || null,
      unitCost: numericCost || 0,
      totalCost: calculatedTotal,
      createdAt: row.created_at,
    },
    newQuantity: Number(row.new_quantity),
  };
}

export async function stockCorrection(itemId, delta, reason, date = new Date().toISOString().slice(0, 10)) {
  const { data, error } = await supabase.rpc("stock_correction", {
    p_item_id: itemId,
    p_delta: Number(delta),
    p_reason: reason,
    p_movement_date: date,
  });
  if (error) return { error: describeError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  return { movement: row, newQuantity: Number(row?.new_quantity) };
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
    quantityDelta: row.quantity_delta === null || row.quantity_delta === undefined ? (row.movement_type === "OUT" ? -Number(row.amount) : Number(row.amount)) : Number(row.quantity_delta),
    appointmentId: row.appointment_id || null,
    actor: row.actor || "—",
    unitCost,
    totalCost,
    createdAt: row.created_at,
    itemName: row.inventory?.name || "Unknown item",
    itemUnit: row.inventory?.unit || "",
    supplier: row.supplier || "",
    expiryDate: row.expiry_date || null,
  };
}

export async function fetchMovements() {
  let { data, error } = await supabase
    .from("inventory_movements")
    .select(MOVEMENT_COLUMNS)
    .order("created_at", { ascending: false });

  // Keep existing movement history visible until migration 041 adds intake metadata.
  if (error && /supplier|expiry_date|column/i.test(error.message || "")) {
    ({ data, error } = await supabase
      .from("inventory_movements")
      .select(LEGACY_MOVEMENT_COLUMNS)
      .order("created_at", { ascending: false }));
  }

  if (error) return { error: describeError(error), movements: [] };
  return { error: null, movements: (data || []).map(mapMovementRow) };
}

/** Drives the low-stock badge. */
export function isLowStock(item) {
  if (item?.reorderLevel === undefined || item?.reorderLevel === null) return false;
  return Number(item.quantity) <= Number(item.reorderLevel);
}
