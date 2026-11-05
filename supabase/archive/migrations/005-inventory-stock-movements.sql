-- ============================================================================
-- Migration 005 — Inventory status + Stock Movement Log
-- ============================================================================
--
-- Standalone. Run after 003-inventory.sql (004 is just seed data, not
-- required).
--
-- WHAT THIS CHANGES ----------------------------------------------------------
--
-- 1. `inventory.status` — ACTIVE / DISABLED. Disabling an item takes it out
--    of day-to-day workflows (greyed out, Stock In blocked) without deleting
--    it, so past movement rows never point at a missing item.
--
-- 2. `inventory_movements` — one row per Stock In. This is now the ONLY way
--    quantity changes after an item is created (Item Profile creates items
--    at 0 stock). `stock_in()` below updates `inventory.quantity` and inserts
--    the movement row in a single transaction, so quantity can never drift
--    out of sync with the log.
--
-- Safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Status
-- ---------------------------------------------------------------------------

do $$ begin
  create type inventory_status as enum ('ACTIVE', 'DISABLED');
exception when duplicate_object then null; end $$;

alter table public.inventory
  add column if not exists status inventory_status not null default 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 2. Movement log
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.inventory(id) on delete restrict,
  amount         numeric not null check (amount > 0),
  movement_date  date not null,
  reference      text,
  actor          text,
  created_at     timestamptz not null default now()
);

-- on delete restrict: an item with movement history can't be hard-deleted
-- out from under its log. Disable it instead — see status above.

create index if not exists inventory_movements_item_id_idx
  on public.inventory_movements (item_id);
create index if not exists inventory_movements_created_at_idx
  on public.inventory_movements (created_at desc);

alter table public.inventory_movements enable row level security;

drop policy if exists "Open access" on public.inventory_movements;
create policy "Open access" on public.inventory_movements for all using (true) with check (true);

grant select, insert on public.inventory_movements to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. stock_in() — the only path that changes quantity
--
--    Runs as a single transaction: insert the movement, then bump quantity.
--    Blocks disabled items server-side too, not just in the UI.
-- ---------------------------------------------------------------------------

create or replace function public.stock_in(
  p_item_id       uuid,
  p_amount        numeric,
  p_movement_date date,
  p_reference     text,
  p_actor         text
)
returns table (
  movement_id    uuid,
  item_id        uuid,
  amount         numeric,
  movement_date  date,
  reference      text,
  actor          text,
  created_at     timestamptz,
  new_quantity   numeric
)
language plpgsql
as $$
declare
  v_status inventory_status;
  v_movement_id uuid;
  v_created_at timestamptz;
  v_new_quantity numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Stock In amount must be greater than 0';
  end if;

  select i.status into v_status from public.inventory i where i.id = p_item_id for update;

  if v_status is null then
    raise exception 'Inventory item not found';
  end if;

  if v_status = 'DISABLED' then
    raise exception 'Cannot Stock In on a disabled item';
  end if;

  -- Aliased and column-qualified: RETURNS TABLE above declares an implicit
  -- `created_at` variable in this function's scope, which collides with
  -- inventory_movements.created_at unless the column is qualified.
  insert into public.inventory_movements as m (item_id, amount, movement_date, reference, actor)
  values (p_item_id, p_amount, p_movement_date, nullif(p_reference, ''), p_actor)
  returning m.id, m.created_at into v_movement_id, v_created_at;

  update public.inventory
  set quantity = quantity + p_amount
  where id = p_item_id
  returning quantity into v_new_quantity;

  return query select v_movement_id, p_item_id, p_amount, p_movement_date, nullif(p_reference, ''), p_actor, v_created_at, v_new_quantity;
end;
$$;

grant execute on function public.stock_in(uuid, numeric, date, text, text) to anon, authenticated;

-- PostgREST caches the schema; without this a fresh column/function can
-- still read as missing from the API right after the DDL above.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
-- select column_name from information_schema.columns
--   where table_name = 'inventory' and column_name = 'status';
-- select policyname, cmd from pg_policies where tablename = 'inventory_movements';
--   -> expect 1 row
-- select stock_in('<some-item-uuid>', 5, current_date, 'PO-1001', 'Test User');
