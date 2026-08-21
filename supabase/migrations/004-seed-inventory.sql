-- ============================================================================
-- Migration 004 — Seed inventory
-- ============================================================================
--
-- Optional. Run after 003-inventory.sql.
--
-- These 6 items are the demo stock that used to live in
-- src/data/mockData.js as `initialInventory`. They moved here because
-- inventory is a Postgres table now, so its seed data belongs in SQL.
--
-- Generated from the original array rather than retyped, so quantities,
-- costs, and expiry dates match exactly what the app used to display.
--
-- Idempotent: each item is inserted only if no item with that name exists.
-- ============================================================================

insert into public.inventory (name, type, quantity, unit, cost, supplier, storage_location, reorder_level, created_at, updated_at, chemical_type, expiration_date, safety_level, hazard_rating, date_received, serial_number, condition, last_maintenance_date, next_maintenance_date, manufacturer, model, material_category, description)
select v.name, v.type::inventory_type, v.quantity::numeric, v.unit, v.cost::numeric, v.supplier, v.storage_location, v.reorder_level::numeric, v.created_at::timestamptz, v.updated_at::timestamptz, v.chemical_type::chemical_type, v.expiration_date::timestamptz, v.safety_level, v.hazard_rating, v.date_received::timestamptz, v.serial_number, v.condition::equipment_condition, v.last_maintenance_date::timestamptz, v.next_maintenance_date::timestamptz, v.manufacturer, v.model, v.material_category::material_category, v.description
from (values
  ('Fipronil Granules', 'CHEMICAL', 12, 'kg', 850, 'Syngenta Philippines', null, 20, '2026-01-10T08:00:00.000Z', '2026-08-18T08:00:00.000Z', 'INSECTICIDE', '2027-06-15T00:00:00.000Z', 'High', 'Toxic - Handle with care', '2026-01-10T00:00:00.000Z', null, null, null, null, null, null, null, null),
  ('Residual Spray Concentrate', 'CHEMICAL', 8, 'L', 1200, 'BASF Philippines', null, 10, '2026-02-05T08:00:00.000Z', '2026-08-18T08:00:00.000Z', 'INSECTICIDE', '2027-03-20T00:00:00.000Z', 'Medium', 'Use in well-ventilated areas', '2026-02-05T00:00:00.000Z', null, null, null, null, null, null, null, null),
  ('Fogging Solution', 'CHEMICAL', 9, 'L', 2500, 'Bayer CropScience', null, 15, '2026-05-10T08:00:00.000Z', '2026-08-18T08:00:00.000Z', 'FUMIGANT', '2026-12-31T00:00:00.000Z', 'High', 'Hazardous - Requires certification', '2026-05-10T00:00:00.000Z', null, null, null, null, null, null, null, null),
  ('Rodent Bait Blocks', 'MATERIAL', 5, 'pack', 450, 'Rentokil Philippines', 'Main Warehouse - Shelf C2', 8, '2026-03-15T08:00:00.000Z', '2026-08-18T08:00:00.000Z', null, null, null, null, null, null, null, null, null, null, null, 'SUPPLIES', 'Pre-packaged rodent poison blocks - 25 blocks per pack'),
  ('Protective Gloves (Nitrile)', 'EQUIPMENT', 18, 'box', 280, 'Safety First Equipment Co.', 'Main Office - Supply Closet', 12, '2026-01-20T08:00:00.000Z', '2026-08-18T08:00:00.000Z', null, null, null, null, null, 'GLV-NIR-2026-001', 'ACTIVE', '2026-08-01T00:00:00.000Z', null, 'Hartalega Holdings', 'Heavy Duty Nitrile 100/box', null, null),
  ('Pest Inspection Kit', 'EQUIPMENT', 4, 'set', 3500, 'Industrial Equipment Solutions', 'Main Office - Equipment Room', 6, '2026-04-12T08:00:00.000Z', '2026-08-18T08:00:00.000Z', null, null, null, null, null, 'INSP-KIT-2026-001', 'ACTIVE', '2026-08-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z', 'Flexi-Coil', 'Professional Pest Detection Set', null, null)
) as v(name, type, quantity, unit, cost, supplier, storage_location, reorder_level, created_at, updated_at, chemical_type, expiration_date, safety_level, hazard_rating, date_received, serial_number, condition, last_maintenance_date, next_maintenance_date, manufacturer, model, material_category, description)
where not exists (
  select 1 from public.inventory i where lower(i.name) = lower(v.name)
);

-- Verify:
--   select name, type, quantity, unit from inventory order by type, name;
