-- Persist supplier and expiry per stock-in movement for recent intake history.
alter table public.inventory_movements
  add column if not exists supplier text,
  add column if not exists expiry_date date;

notify pgrst, 'reload schema';
