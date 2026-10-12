// Office-wide numbers (migration 076): the default rates for transportation
// (per km) and labor (per technician per day). Missing before 076, when the
// rates simply start empty.

import { supabase } from "./supabaseClient";

const KEYS = { transportRatePerKm: "transport_rate_per_km", laborDailyRate: "labor_daily_rate" };

function describeError(error) {
  if (!error) return "Unknown error";
  return [error.message || "Unknown error", error.details ? ` — ${error.details}` : "", error.hint ? ` (hint: ${error.hint})` : ""].join("");
}

const toNumber = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

/** { rates: { transportRatePerKm, laborDailyRate }, available } */
export async function fetchRates() {
  const none = { rates: { transportRatePerKm: null, laborDailyRate: null }, available: false };
  if (!supabase) return none;
  let data;
  let error;
  try {
    ({ data, error } = await supabase.from("app_settings").select("key, value").in("key", Object.values(KEYS)));
  } catch (thrown) {
    return none;
  }
  if (error) return none;
  const byKey = new Map((data || []).map((row) => [row.key, toNumber(row.value)]));
  return {
    rates: { transportRatePerKm: byKey.get(KEYS.transportRatePerKm) ?? null, laborDailyRate: byKey.get(KEYS.laborDailyRate) ?? null },
    available: true,
  };
}

export async function saveRates(rates) {
  const rows = Object.entries(KEYS)
    .filter(([field]) => rates[field] !== undefined)
    .map(([field, key]) => ({ key, value: toNumber(rates[field]), updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) {
    return { error: /app_settings/.test(`${error.message} ${error.details || ""}`) ? "The default rates need migration 076." : describeError(error) };
  }
  return { error: null };
}
