// The service catalog (migration 047): what the business sells, and the
// default materials each service uses. The appointment Stock-Out tab prefills
// from those materials; nothing here deducts stock.

import { supabase } from "./supabaseClient";

const BASE_COLUMNS = "id, name, description, default_price, default_duration_minutes, sort_order, is_active, created_at, updated_at";

// Pricing (migration 060): flat or by area, the default down payment, and each
// material's billing mode. Read only once the database has the columns.
let pricingAvailable = true;
const serviceColumns = () => (pricingAvailable
  ? `${BASE_COLUMNS}, pricing_mode, area_rate, minimum_charge, deposit_percent, service_materials(item_id, default_amount, billing_mode)`
  : `${BASE_COLUMNS}, service_materials(item_id, default_amount)`);
const mentionsPricing = (error) =>
  /pricing_mode|area_rate|minimum_charge|deposit_percent|billing_mode/.test(`${error?.message || ""} ${error?.details || ""}`);

export function describeError(error) {
  if (!error) return "Unknown error";
  return [error.message || "Unknown error", error.details ? ` - ${error.details}` : "", error.hint ? ` (hint: ${error.hint})` : ""].join("");
}

// The unique index is on lower(trim(name)); Postgres reports it by index name,
// which means nothing to the person who typed the name.
function friendlyError(error) {
  const message = describeError(error);
  if (/services_name_unique_idx/i.test(message)) return "A service with that name already exists.";
  return message;
}

const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

export function mapServiceRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    description: row.description || "",
    defaultPrice: numberOrNull(row.default_price),
    defaultDurationMinutes: numberOrNull(row.default_duration_minutes),
    sortOrder: Number(row.sort_order) || 0,
    isActive: row.is_active !== false,
    // Pricing (060): see utils/pricing.js.
    pricingMode: row.pricing_mode || "FLAT",
    areaRate: numberOrNull(row.area_rate),
    minimumCharge: numberOrNull(row.minimum_charge),
    depositPercent: Number(row.deposit_percent) || 0,
    materials: (row.service_materials || []).map((material) => ({
      itemId: material.item_id,
      // The included quantity: prefills the Stock-Out, and above it an
      // EXTRA_CHARGED material is billed.
      defaultAmount: Number(material.default_amount),
      billingMode: material.billing_mode || "INCLUDED",
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toServiceRow({ name, description, defaultPrice, defaultDurationMinutes, sortOrder, isActive, pricingMode, areaRate, minimumCharge, depositPercent }) {
  const row = {};
  if (name !== undefined) row.name = String(name).trim();
  if (description !== undefined) row.description = String(description || "").trim() || null;
  if (defaultPrice !== undefined) row.default_price = numberOrNull(defaultPrice);
  if (defaultDurationMinutes !== undefined) row.default_duration_minutes = numberOrNull(defaultDurationMinutes);
  if (sortOrder !== undefined) row.sort_order = Number(sortOrder) || 0;
  if (isActive !== undefined) row.is_active = Boolean(isActive);
  if (pricingAvailable) {
    if (pricingMode !== undefined) row.pricing_mode = pricingMode === "AREA" ? "AREA" : "FLAT";
    if (areaRate !== undefined) row.area_rate = numberOrNull(areaRate);
    if (minimumCharge !== undefined) row.minimum_charge = numberOrNull(minimumCharge);
    if (depositPercent !== undefined) row.deposit_percent = Number(depositPercent) || 0;
  }
  return row;
}

/** Every service, retired ones included; callers filter for the booking form. */
export async function fetchServices() {
  const select = () => supabase
    .from("services")
    .select(serviceColumns())
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  let { data, error } = await select();
  if (error && pricingAvailable && mentionsPricing(error)) {
    pricingAvailable = false;
    ({ data, error } = await select());
  }
  if (error) return { error: describeError(error), services: [] };
  return { error: null, services: (data || []).map(mapServiceRow) };
}

export async function createService(fields) {
  const { data, error } = await supabase
    .from("services")
    .insert(toServiceRow(fields))
    .select(serviceColumns())
    .single();
  if (error) return { error: friendlyError(error) };
  return { error: null, service: mapServiceRow(data) };
}

export async function updateService(id, fields) {
  const { data, error } = await supabase
    .from("services")
    .update(toServiceRow(fields))
    .eq("id", id)
    .select(serviceColumns())
    .single();
  if (error) return { error: friendlyError(error) };
  return { error: null, service: mapServiceRow(data) };
}

/** Retire or restore. Booked appointments are untouched either way. */
export async function setServiceActive(id, isActive) {
  return updateService(id, { isActive });
}

/**
 * Permanently delete a service and its materials list. Since migration 060 a
 * service any visit has used is refused ("Retire it instead") by a trigger;
 * only one never used can go.
 */
export async function deleteService(id) {
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) return { error: describeError(error) };
  return { error: null };
}

/** Replace a service's materials list in one transaction. */
export async function saveServiceMaterials(serviceId, materials) {
  const { error } = await supabase.rpc("set_service_materials", {
    p_service_id: serviceId,
    p_materials: (materials || []).map((material) => ({
      item_id: material.itemId,
      default_amount: Number(material.defaultAmount),
      // Ignored by 047's function; read by 060's.
      billing_mode: material.billingMode === "EXTRA_CHARGED" ? "EXTRA_CHARGED" : "INCLUDED",
    })),
  });
  if (error) return { error: describeError(error) };
  return { error: null };
}
