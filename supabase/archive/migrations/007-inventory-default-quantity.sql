-- New inventory items always begin with zero stock. Quantity is increased
-- only through stock_in(), which also records the Stock Movement History.
-- Safe to run on the existing database.

alter table public.inventory
  alter column quantity set default 0;
