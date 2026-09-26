-- ---------------------------------------------------------------------------
-- Migration 055 - Chemical batches, soonest expiry used first.
--
-- Run after 054-technician-stock-custody.sql.
--
-- Until now a chemical was one row with one quantity and one expiry date, and
-- every delivery OVERWROTE that date (049). 3 L expiring in March plus a new
-- 5 L expiring in December read "8 L, expires December": the March stock was
-- invisible, the expiry alert never fired for it, and nothing could say which
-- container to use first. The lot was typed by hand at the visit (036) and
-- never checked against what was delivered.
--
-- Now every chemical delivery line is a BATCH:
--
--   inventory_batches     one row per delivery line: a system reference
--                         (TPC-B-00001), the manufacturer's lot number (null
--                         when none is printed), expiry, received date, cost,
--                         and how much of it is still on the shelf.
--
--   inventory.quantity    still the shelf total. For a chemical it equals the
--                         sum of its batches; every function below moves both.
--   inventory.expiration_date
--                         no longer typed: a trigger keeps it at the SOONEST
--                         expiry among batches with stock, so the existing
--                         expiry alert warns about the batch that expires first.
--
-- Stock leaves soonest-expiry first (FEFO) on every path: a visit's materials,
-- a checkout, missing/damaged, a correction. Expired batches are skipped (and
-- refused if chosen); their leftovers are written off with reason EXPIRED. A
-- visit or a checkout may name a batch instead (the container in the
-- technician's hand); that batch is used first, the rest by expiry. A line
-- spanning two batches is written as two movements, each with its batch.
--
-- Checkouts (054) carry their batch, so a visit drawing on a technician's
-- checkout records that batch, and a return puts stock back into it.
--
-- inventory_movements.batch_id links a movement to its batch;
-- inventory_movements.batch_number (036) now holds the batch's lot number (or
-- its reference when no lot is printed), filled in by the server — the service
-- report and recall lookups keep working unchanged.
--
-- Existing chemical stock becomes one OPENING batch per item (no lot, the
-- item's current expiry), which the office can correct or split.
--
-- Equipment and materials have no batches and behave exactly as before.
--
-- 055 is now the source of truth for stock_in_batch (from 049), stock_out_manual
-- and stock_out_batch (from 054), return_checkout (from 054) and
-- stock_correction (from 021). Re-running any of those migrations restores a
-- version that ignores batches; re-run 055 after it. Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Batches.
-- ---------------------------------------------------------------------------

create sequence if not exists public.inventory_batch_reference_seq as bigint start 1;

create table if not exists public.inventory_batches (
  id                   uuid        primary key default gen_random_uuid(),
  reference            text        not null default 'TPC-B-' || lpad(nextval('public.inventory_batch_reference_seq')::text, 5, '0'),
  item_id              uuid        not null references public.inventory(id) on delete cascade,
  lot_number           text,
  expiration_date      date,
  received_date        date        not null default current_date,
  quantity_received    numeric     not null check (quantity_received >= 0),
  quantity             numeric     not null check (quantity >= 0),
  unit_cost            numeric,
  stock_in_movement_id uuid        references public.inventory_movements(id) on delete set null,
  is_opening           boolean     not null default false,
  split_from           uuid        references public.inventory_batches(id) on delete set null,
  written_off_at       timestamptz,
  created_at           timestamptz not null default now()
);

create unique index if not exists inventory_batches_reference_key on public.inventory_batches (reference);
create index if not exists inventory_batches_live_idx on public.inventory_batches (item_id, expiration_date) where quantity > 0;
create index if not exists inventory_batches_lot_idx on public.inventory_batches (lot_number) where lot_number is not null;

comment on table public.inventory_batches is
  'One row per chemical delivery line. quantity is what is still on the shelf; the item''s quantity is their sum.';
comment on column public.inventory_batches.lot_number is
  'The manufacturer''s lot number printed on the container. Null when none is printed.';
comment on column public.inventory_batches.is_opening is
  'Stock that existed before migration 055, or stock of unknown lot: no delivery behind it.';

alter table public.inventory_batches enable row level security;

drop policy if exists "Inventory batch read" on public.inventory_batches;
create policy "Inventory batch read" on public.inventory_batches
for select using (public.has_role_table_session());

grant select on public.inventory_batches to anon, authenticated;

alter table public.inventory_movements
  add column if not exists batch_id uuid references public.inventory_batches(id) on delete set null;

create index if not exists inventory_movements_batch_id_idx
  on public.inventory_movements (batch_id) where batch_id is not null;

comment on column public.inventory_movements.batch_id is
  'The chemical batch this movement took from or put into (migration 055).';

-- Expired stock is written off with its own reason.
alter table public.inventory_movements drop constraint if exists inventory_movements_stock_out_reason_check;
alter table public.inventory_movements add constraint inventory_movements_stock_out_reason_check
  check (
    stock_out_reason is null
    or (movement_type = 'OUT'
        and stock_out_reason in ('APPOINTMENT', 'TECHNICIAN_CHECKOUT', 'MISSING', 'DAMAGED', 'EXPIRED'))
  );

-- ---------------------------------------------------------------------------
-- 2. Stock with no batch behind it goes into an opening batch.
--
--    ensure_item_batches() makes a chemical's batches add up to its shelf
--    quantity: any stock no batch accounts for — everything that existed
--    before this migration, or stock written by hand-run SQL such as the demo
--    seed — goes into the item's opening batch (no lot, the item's expiry).
--    It runs here for every chemical, and again before every draw and every
--    Stock In, so a database that got out of step heals itself.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_item_batches(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  item_kind text;
  shelf numeric;
  batched numeric;
  gap numeric;
  opening uuid;
begin
  select i.type::text, i.quantity into item_kind, shelf from public.inventory i where i.id = p_item_id;
  if item_kind is distinct from 'CHEMICAL' then return; end if;

  select coalesce(sum(b.quantity), 0) into batched from public.inventory_batches b where b.item_id = p_item_id;
  gap := shelf - batched;
  if gap <= 0 then return; end if;

  select b.id into opening from public.inventory_batches b
  where b.item_id = p_item_id and b.is_opening and b.written_off_at is null
  order by b.created_at desc limit 1;

  if opening is null then
    insert into public.inventory_batches (item_id, expiration_date, received_date, quantity_received, quantity, unit_cost, is_opening)
    select i.id, i.expiration_date::date, coalesce(i.date_received::date, i.created_at::date, current_date), gap, gap, i.cost, true
    from public.inventory i where i.id = p_item_id;
  else
    update public.inventory_batches b
      set quantity = b.quantity + gap, quantity_received = b.quantity_received + gap
      where b.id = opening;
  end if;
end;
$$;

revoke all on function public.ensure_item_batches(uuid) from public, anon, authenticated;

do $$
declare chemical uuid;
begin
  for chemical in select i.id from public.inventory i where i.type = 'CHEMICAL' and i.quantity > 0 loop
    perform public.ensure_item_batches(chemical);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The item's expiry follows its batches.
-- ---------------------------------------------------------------------------

create or replace function public.sync_item_expiry()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.inventory i
    set expiration_date = (
      select min(b.expiration_date) from public.inventory_batches b
      where b.item_id = new.item_id and b.quantity > 0 and b.written_off_at is null
    )
    where i.id = new.item_id;
  return null;
end;
$$;

drop trigger if exists trg_inventory_batches_expiry on public.inventory_batches;
create trigger trg_inventory_batches_expiry
  after insert or update of quantity, expiration_date, written_off_at on public.inventory_batches
  for each row execute function public.sync_item_expiry();

-- ---------------------------------------------------------------------------
-- 4. Internal helpers. Not callable through the API.
-- ---------------------------------------------------------------------------

-- Takes p_amount of an item off its batches: p_batch_id first when given,
-- then soonest expiry first. Skips batches received after p_on and, unless
-- p_include_expired, batches expired by p_on. p_only_chosen takes from the
-- chosen batch alone and returns what it could; otherwise a shortfall raises.
-- Lowers the batches only — the caller moves inventory.quantity.
create or replace function public.take_from_batches(
  p_item_id          uuid,
  p_amount           numeric,
  p_on               date,
  p_batch_id         uuid default null,
  p_include_expired  boolean default false,
  p_only_chosen      boolean default false
)
returns table (batch_id uuid, taken numeric, lot_label text)
language plpgsql security definer set search_path = public
as $$
declare
  still numeric := p_amount;
  chosen public.inventory_batches;
  source record;
  drawn numeric;
  expired_quantity numeric;
  item_name text;
  item_unit text;
begin
  perform public.ensure_item_batches(p_item_id);

  if p_batch_id is not null then
    select * into chosen from public.inventory_batches b where b.id = p_batch_id and b.item_id = p_item_id;
    if chosen.id is null then raise exception 'That batch is not one of this item''s batches.'; end if;
    if not p_include_expired and chosen.expiration_date is not null and chosen.expiration_date < p_on then
      raise exception 'Batch % expired on %. Choose another batch.',
        coalesce(chosen.lot_number, chosen.reference), to_char(chosen.expiration_date, 'Mon DD, YYYY');
    end if;
  end if;

  for source in
    select b.id, b.quantity, coalesce(b.lot_number, b.reference) as label
    from public.inventory_batches b
    where b.item_id = p_item_id
      and b.quantity > 0
      and b.received_date <= p_on
      and (p_include_expired or b.expiration_date is null or b.expiration_date >= p_on)
      and (not p_only_chosen or b.id = p_batch_id)
    order by (b.id = p_batch_id) desc nulls last, b.expiration_date asc nulls last, b.received_date, b.created_at
    for update
  loop
    exit when still <= 0;
    drawn := least(source.quantity, still);
    update public.inventory_batches b set quantity = b.quantity - drawn where b.id = source.id;
    still := still - drawn;
    batch_id := source.id;
    taken := drawn;
    lot_label := source.label;
    return next;
  end loop;

  if still > 0 and not p_only_chosen then
    select coalesce(sum(b.quantity), 0) into expired_quantity
    from public.inventory_batches b
    where b.item_id = p_item_id and b.quantity > 0 and b.expiration_date < p_on;
    select i.name, i.unit into item_name, item_unit from public.inventory i where i.id = p_item_id;
    if expired_quantity > 0 and not p_include_expired then
      raise exception 'Not enough usable %: % % of it has expired. Write the expired batch off, or record less.',
        item_name, expired_quantity, item_unit;
    end if;
    raise exception 'Requested quantity exceeds available stock.';
  end if;
end;
$$;

revoke all on function public.take_from_batches(uuid, numeric, date, uuid, boolean, boolean) from public, anon, authenticated;

-- Where stock of unknown lot goes: the item's opening batch, made if missing.
create or replace function public.fallback_batch(p_item_id uuid, p_on date default current_date)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare found uuid;
begin
  select b.id into found from public.inventory_batches b
  where b.item_id = p_item_id and b.is_opening and b.written_off_at is null
  order by b.created_at desc limit 1;
  if found is null then
    insert into public.inventory_batches (item_id, received_date, quantity_received, quantity, is_opening)
    values (p_item_id, p_on, 0, 0, true)
    returning id into found;
  end if;
  return found;
end;
$$;

revoke all on function public.fallback_batch(uuid, date) from public, anon, authenticated;

-- One row of a visit's materials. From the shelf when p_checkout_id is null
-- (the shelf goes down), from a technician's checkout otherwise (it does not).
create or replace function public.log_visit_usage(
  p_appointment_id uuid,
  p_item_id        uuid,
  p_amount         numeric,
  p_on             date,
  p_reference      text,
  p_actor          text,
  p_actor_id       uuid,
  p_batch_id       uuid,
  p_label          text,
  p_checkout_id    uuid
)
returns table (movement_id uuid, new_quantity numeric)
language plpgsql security definer set search_path = public
as $$
declare created uuid; shelf numeric;
begin
  insert into public.inventory_movements (
    item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type,
    appointment_id, batch_number, stock_out_reason, checkout_id, batch_id
  )
  values (
    p_item_id, p_amount, case when p_checkout_id is null then -p_amount else 0 end, p_on,
    p_reference || case when p_checkout_id is null then '' else ' (from checkout)' end,
    p_actor, p_actor_id, 'OUT', p_appointment_id, p_label, 'APPOINTMENT', p_checkout_id, p_batch_id
  )
  returning id into created;

  if p_checkout_id is null then
    update public.inventory i set quantity = i.quantity - p_amount where i.id = p_item_id returning i.quantity into shelf;
  else
    select i.quantity into shelf from public.inventory i where i.id = p_item_id;
  end if;

  movement_id := created;
  new_quantity := shelf;
  return next;
end;
$$;

revoke all on function public.log_visit_usage(uuid, uuid, numeric, date, text, text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. stock_in_batch(), from 049: every chemical line is a batch.
--
--    Each p_items entry may carry lot_number and no_lot. A chemical needs its
--    expiry and its lot number, unless no_lot says none is printed. The same
--    chemical may appear twice on one delivery with different lots.
-- ---------------------------------------------------------------------------

drop function if exists public.stock_in_batch(jsonb, date, text, text, uuid);

create function public.stock_in_batch(
  p_items                    jsonb,
  p_movement_date            date,
  p_reference                text,
  p_intake_branch_or_station text,
  p_idempotency_key          uuid
)
returns table (
  movement_id     uuid,
  item_id         uuid,
  amount          numeric,
  movement_date   date,
  reference       text,
  actor           text,
  unit_cost       numeric,
  total_cost      numeric,
  created_at      timestamptz,
  new_quantity    numeric,
  expiration_date date,
  batch_id        uuid,
  batch_reference text
)
language plpgsql security definer set search_path = public
as $stock_in_batch$
declare
  entry record;
  item_status inventory_status;
  item_kind text;
  item_label text;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  created_at_value timestamptz;
  new_quantity_value numeric;
  new_expiry_value date;
  resolved_cost numeric;
  resolved_amount numeric;
  resolved_lot text;
  received_on date;
  batch_id_value uuid;
  batch_reference_value text;
  entry_key uuid;
  row_index integer := 0;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required.';
  end if;
  if nullif(trim(p_reference), '') is null then
    raise exception 'A purchase order or supplier invoice reference is required.';
  end if;
  if nullif(trim(p_intake_branch_or_station), '') is null then
    raise exception 'An intake branch or station is required.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as entries(item_id uuid, lot_number text)
    group by entries.item_id, lower(trim(coalesce(entries.lot_number, '')))
    having count(*) > 1
  ) then
    raise exception 'The same item and lot appear twice on this Stock In. Combine the duplicate lines.';
  end if;

  if p_idempotency_key is not null
     and exists (select 1 from public.inventory_movements m where m.batch_key = p_idempotency_key) then
    return query
      select m.id, m.item_id, m.amount, m.movement_date, m.reference, m.actor,
             coalesce(m.unit_cost, 0), coalesce(m.total_cost, 0), m.created_at, i.quantity,
             i.expiration_date::date, m.batch_id, b.reference
      from public.inventory_movements m
      join public.inventory i on i.id = m.item_id
      left join public.inventory_batches b on b.id = m.batch_id
      where m.batch_key = p_idempotency_key
      order by m.created_at;
    return;
  end if;

  received_on := coalesce(p_movement_date, current_date);

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  for entry in
    select entries.item_id, entries.amount, entries.unit_cost,
           entries.entered_amount, entries.entered_unit, entries.conversion_factor,
           entries.expiration_date, entries.lot_number, entries.no_lot
    from jsonb_to_recordset(p_items) as entries(
      item_id uuid, amount numeric, unit_cost numeric,
      entered_amount numeric, entered_unit text, conversion_factor numeric,
      expiration_date date, lot_number text, no_lot boolean
    )
  loop
    resolved_amount := round(entry.amount, 4);
    if resolved_amount is null or resolved_amount <= 0 then
      raise exception 'Stock In amounts must be greater than 0.';
    end if;

    select i.status, i.type::text, i.name into item_status, item_kind, item_label
    from public.inventory i where i.id = entry.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock In on a disabled item.'; end if;

    resolved_cost := coalesce(entry.unit_cost, 0);
    if resolved_cost < 0 then raise exception 'Purchase cost cannot be negative.'; end if;

    if entry.expiration_date is not null and entry.expiration_date < received_on then
      raise exception 'This delivery is already expired: the expiry date is before the delivery date.';
    end if;

    resolved_lot := nullif(trim(coalesce(entry.lot_number, '')), '');
    if item_kind = 'CHEMICAL' then
      -- Stock already on the shelf with no batch gets its opening batch first,
      -- so this delivery's batch is not mistaken for all of it.
      perform public.ensure_item_batches(entry.item_id);
      if entry.expiration_date is null then
        raise exception 'Enter the expiry date printed on the % delivery.', item_label;
      end if;
      if resolved_lot is null and not coalesce(entry.no_lot, false) then
        raise exception 'Enter the lot number printed on the % container, or tick "No lot number printed".', item_label;
      end if;
    else
      resolved_lot := null;
    end if;

    entry_key := case when row_index = 0 then p_idempotency_key else null end;
    row_index := row_index + 1;

    insert into public.inventory_movements (
      item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
      intake_branch_or_station, purchase_reference, idempotency_key, batch_key, movement_type,
      unit_cost, total_cost, entered_amount, entered_unit, conversion_factor,
      expiration_date
    )
    values (
      entry.item_id, resolved_amount, resolved_amount, received_on,
      nullif(trim(p_reference), ''), actor_name, actor_account_id,
      nullif(trim(p_intake_branch_or_station), ''), nullif(trim(p_reference), ''),
      entry_key, p_idempotency_key, 'IN',
      resolved_cost, round(resolved_cost * resolved_amount, 2),
      entry.entered_amount, nullif(trim(coalesce(entry.entered_unit, '')), ''),
      coalesce(entry.conversion_factor, 1),
      entry.expiration_date
    )
    returning id, inventory_movements.created_at into movement_id_value, created_at_value;

    batch_id_value := null;
    batch_reference_value := null;
    if item_kind = 'CHEMICAL' then
      insert into public.inventory_batches (
        item_id, lot_number, expiration_date, received_date, quantity_received, quantity, unit_cost, stock_in_movement_id
      )
      values (
        entry.item_id, resolved_lot, entry.expiration_date, received_on, resolved_amount, resolved_amount,
        resolved_cost, movement_id_value
      )
      returning id, inventory_batches.reference into batch_id_value, batch_reference_value;

      update public.inventory_movements m
        set batch_id = batch_id_value, batch_number = coalesce(resolved_lot, batch_reference_value)
        where m.id = movement_id_value;
    end if;

    -- The expiry is no longer written here: the batch trigger keeps the item
    -- at its soonest live expiry.
    update public.inventory i
    set quantity = i.quantity + resolved_amount,
        cost = case when entry.unit_cost is null then i.cost else resolved_cost end
    where i.id = entry.item_id
    returning i.quantity, i.expiration_date::date into new_quantity_value, new_expiry_value;

    return query select
      movement_id_value, entry.item_id, resolved_amount, received_on, nullif(trim(p_reference), ''), actor_name,
      resolved_cost, round(resolved_cost * resolved_amount, 2),
      created_at_value, new_quantity_value, new_expiry_value, batch_id_value, batch_reference_value;
  end loop;
end;
$stock_in_batch$;

grant execute on function public.stock_in_batch(jsonb, date, text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. stock_out_manual(), from 054: a chemical leaves by batch.
--
--    One row per batch taken from, so a checkout that spans two batches is two
--    checkouts, each holding its batch.
-- ---------------------------------------------------------------------------

drop function if exists public.stock_out_manual(uuid, numeric, date, text, uuid, text, uuid);
drop function if exists public.stock_out_manual(uuid, numeric, date, text, uuid, text, uuid, uuid);

create function public.stock_out_manual(
  p_item_id            uuid,
  p_amount             numeric,
  p_movement_date      date,
  p_reason             text,
  p_technician_id      uuid,
  p_note               text,
  p_for_appointment_id uuid default null,
  p_batch_id           uuid default null
)
returns table (
  movement_id        uuid,
  item_id            uuid,
  amount             numeric,
  movement_date      date,
  reason             text,
  technician_id      uuid,
  actor              text,
  note               text,
  new_quantity       numeric,
  for_appointment_id uuid,
  batch_id           uuid,
  batch_number       text
)
language plpgsql security definer set search_path = public
as $stock_out_manual$
declare
  item_status inventory_status;
  item_kind text;
  current_quantity numeric;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  new_quantity_value numeric;
  reason_label text;
  resolved_technician uuid;
  resolved_visit uuid;
  visit_status text;
  moved_on date;
  resolved_note text;
  portion_batches uuid[];
  portion_amounts numeric[];
  portion_labels text[];
  idx integer;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_reason not in ('TECHNICIAN_CHECKOUT', 'MISSING', 'DAMAGED') then
    raise exception 'Choose a stock-out reason.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Stock-Out quantities must be greater than zero.';
  end if;

  resolved_technician := case when p_reason = 'TECHNICIAN_CHECKOUT' then p_technician_id end;
  resolved_visit := case when p_reason = 'TECHNICIAN_CHECKOUT' then p_for_appointment_id end;
  if p_reason = 'TECHNICIAN_CHECKOUT' then
    if resolved_technician is null then
      raise exception 'Select the technician the stock was checked out to.';
    end if;
    if not exists (select 1 from public.technicians t where t.id = resolved_technician) then
      raise exception 'That technician was not found.';
    end if;
    if not public.account_is_active(resolved_technician) then
      raise exception 'That technician account is not active.';
    end if;
    if resolved_visit is not null then
      select a.status into visit_status from public.appointments a where a.id = resolved_visit;
      if visit_status is null then raise exception 'That visit was not found.'; end if;
      if visit_status in ('Completed', 'Cancelled') then
        raise exception 'That visit is already %; choose an upcoming one.', lower(visit_status);
      end if;
      if not exists (
        select 1 from public.appointment_technicians at
        where at.appointment_id = resolved_visit and at.technician_id = resolved_technician
      ) and not exists (
        select 1 from public.appointments a where a.id = resolved_visit and a.technician_id = resolved_technician
      ) then
        raise exception 'That technician is not on the visit''s crew.';
      end if;
    end if;
  end if;

  select i.status, i.type::text, i.quantity into item_status, item_kind, current_quantity
  from public.inventory i where i.id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found.'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;
  if p_amount > current_quantity then raise exception 'Requested quantity exceeds available stock.'; end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  reason_label := case p_reason
    when 'TECHNICIAN_CHECKOUT' then 'Checked out by ' ||
      coalesce((select t.name from public.technicians t where t.id = resolved_technician), 'a technician')
    when 'MISSING' then 'Missing stock'
    else 'Damaged stock'
  end;
  moved_on := coalesce(p_movement_date, current_date);
  resolved_note := nullif(trim(coalesce(p_note, '')), '');

  -- The portions this stock-out is made of: one per batch for a chemical,
  -- the whole amount for anything else.
  if item_kind = 'CHEMICAL' then
    select array_agg(taken.batch_id order by taken.ordinality),
           array_agg(taken.taken order by taken.ordinality),
           array_agg(taken.lot_label order by taken.ordinality)
      into portion_batches, portion_amounts, portion_labels
    from public.take_from_batches(p_item_id, p_amount, moved_on, p_batch_id, false, false) with ordinality as taken(batch_id, taken, lot_label, ordinality);
  else
    portion_batches := array[null::uuid];
    portion_amounts := array[p_amount];
    portion_labels := array[null::text];
  end if;

  for idx in 1..coalesce(array_length(portion_amounts, 1), 0) loop
    insert into public.inventory_movements (
      item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
      movement_type, stock_out_reason, technician_id, note, for_appointment_id, batch_id, batch_number
    )
    values (
      p_item_id, portion_amounts[idx], -portion_amounts[idx], moved_on,
      reason_label, actor_name, actor_account_id,
      'OUT', p_reason, resolved_technician, resolved_note, resolved_visit, portion_batches[idx], portion_labels[idx]
    )
    returning id into movement_id_value;

    update public.inventory i set quantity = i.quantity - portion_amounts[idx]
    where i.id = p_item_id
    returning i.quantity into new_quantity_value;

    return query select
      movement_id_value, p_item_id, portion_amounts[idx], moved_on,
      p_reason, resolved_technician, actor_name, resolved_note, new_quantity_value, resolved_visit,
      portion_batches[idx], portion_labels[idx];
  end loop;
end;
$stock_out_manual$;

grant execute on function public.stock_out_manual(uuid, numeric, date, text, uuid, text, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. stock_out_batch(), from 054: a visit's materials, by batch.
--
--    Each p_items entry may carry batch_id, the container in the technician's
--    hand. The order a line is filled in:
--      1. the chosen batch, from what the crew checked out;
--      2. the chosen batch, from the shelf;
--      3. the rest of what the crew checked out (a checkout for this visit
--         first, then soonest expiry);
--      4. the shelf, soonest expiry first.
--    Expired batches are skipped everywhere, and refused when chosen.
-- ---------------------------------------------------------------------------

drop function if exists public.stock_out_batch(uuid, jsonb, date);

create function public.stock_out_batch(
  p_appointment_id uuid,
  p_items jsonb,
  p_movement_date date
)
returns table (movement_id uuid, item_id uuid, appointment_id uuid, amount numeric, movement_date date, actor text, new_quantity numeric, batch_number text)
language plpgsql security definer set search_path = public
as $stock_out_batch$
declare
  item_row record;
  held record;
  portion record;
  logged record;
  chosen public.inventory_batches;
  item_status inventory_status;
  item_kind text;
  current_quantity numeric;
  actor_name text;
  actor_account_id uuid;
  still_needed numeric;
  drawn numeric;
  crew uuid[];
  visit_reference text;
  used_on date;
  pass integer;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.appointments a where a.id = p_appointment_id and a.status <> 'Cancelled') then raise exception 'Active appointment not found.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one stock-out item is required.'; end if;
  if exists (select entries.item_id from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric) group by entries.item_id having count(*) > 1) then raise exception 'Each inventory item can only be added once per stock-out.'; end if;

  used_on := coalesce(p_movement_date, current_date);

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  select coalesce(array_agg(at.technician_id), '{}') into crew
  from public.appointment_technicians at where at.appointment_id = p_appointment_id;
  select crew || coalesce(array_agg(a.technician_id) filter (where a.technician_id is not null), '{}') into crew
  from public.appointments a where a.id = p_appointment_id;

  select coalesce(a.reference, 'Appointment ' || a.id::text) into visit_reference
  from public.appointments a where a.id = p_appointment_id;

  for item_row in
    select entries.item_id, entries.amount, entries.batch_id
    from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric, batch_id uuid)
    order by entries.item_id
  loop
    if item_row.amount is null or item_row.amount <= 0 then raise exception 'Stock-Out quantities must be greater than zero.'; end if;

    select i.status, i.type::text, i.quantity into item_status, item_kind, current_quantity
    from public.inventory i where i.id = item_row.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;

    chosen := null;
    if item_row.batch_id is not null and item_kind = 'CHEMICAL' then
      select * into chosen from public.inventory_batches b where b.id = item_row.batch_id and b.item_id = item_row.item_id;
      if chosen.id is null then raise exception 'That batch is not one of this item''s batches.'; end if;
      if chosen.expiration_date is not null and chosen.expiration_date < used_on then
        raise exception 'Batch % expired on %. Choose another batch.',
          coalesce(chosen.lot_number, chosen.reference), to_char(chosen.expiration_date, 'Mon DD, YYYY');
      end if;
    end if;

    still_needed := item_row.amount;

    for pass in 1..2 loop
      continue when pass = 1 and chosen.id is null;

      -- What the crew checked out: pass 1 the chosen batch only, pass 2 the rest.
      for held in
        select c.id, c.batch_id as held_batch, public.checkout_remaining(c.id) as remaining,
               coalesce(b.lot_number, b.reference, c.batch_number) as label
        from public.inventory_movements c
        left join public.inventory_batches b on b.id = c.batch_id
        where c.stock_out_reason = 'TECHNICIAN_CHECKOUT'
          and c.item_id = item_row.item_id
          and c.custody_closed_at is null
          and c.technician_id = any(crew)
          and c.movement_date <= used_on
          and (b.id is null or b.expiration_date is null or b.expiration_date >= used_on)
          and ((pass = 1 and c.batch_id = chosen.id)
               or (pass = 2 and (chosen.id is null or c.batch_id is distinct from chosen.id)))
        order by (c.for_appointment_id is not distinct from p_appointment_id) desc,
                 b.expiration_date asc nulls last, c.movement_date, c.created_at
      loop
        exit when still_needed <= 0;
        continue when held.remaining <= 0;
        drawn := least(held.remaining, still_needed);
        select * into logged from public.log_visit_usage(
          p_appointment_id, item_row.item_id, drawn, used_on, visit_reference, actor_name, actor_account_id,
          held.held_batch, held.label, held.id);
        still_needed := still_needed - drawn;
        return query select logged.movement_id, item_row.item_id, p_appointment_id, drawn, used_on, actor_name, logged.new_quantity, held.label;
      end loop;

      -- Between the passes: the chosen batch on the shelf.
      if pass = 1 and still_needed > 0 then
        for portion in
          select * from public.take_from_batches(item_row.item_id, still_needed, used_on, chosen.id, false, true)
        loop
          select * into logged from public.log_visit_usage(
            p_appointment_id, item_row.item_id, portion.taken, used_on, visit_reference, actor_name, actor_account_id,
            portion.batch_id, portion.lot_label, null);
          still_needed := still_needed - portion.taken;
          return query select logged.movement_id, item_row.item_id, p_appointment_id, portion.taken, used_on, actor_name, logged.new_quantity, portion.lot_label;
        end loop;
      end if;
    end loop;

    -- The shelf, soonest expiry first.
    if still_needed > 0 then
      if item_kind = 'CHEMICAL' then
        for portion in
          select * from public.take_from_batches(item_row.item_id, still_needed, used_on, null, false, false)
        loop
          select * into logged from public.log_visit_usage(
            p_appointment_id, item_row.item_id, portion.taken, used_on, visit_reference, actor_name, actor_account_id,
            portion.batch_id, portion.lot_label, null);
          return query select logged.movement_id, item_row.item_id, p_appointment_id, portion.taken, used_on, actor_name, logged.new_quantity, portion.lot_label;
        end loop;
      else
        if still_needed > current_quantity then
          raise exception 'Requested quantity exceeds available stock.';
        end if;
        select * into logged from public.log_visit_usage(
          p_appointment_id, item_row.item_id, still_needed, used_on, visit_reference, actor_name, actor_account_id,
          null, null, null);
        return query select logged.movement_id, item_row.item_id, p_appointment_id, still_needed, used_on, actor_name, logged.new_quantity, null::text;
      end if;
    end if;
  end loop;
end;
$stock_out_batch$;

grant execute on function public.stock_out_batch(uuid, jsonb, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. return_checkout(), from 054: back into the batch it came from.
-- ---------------------------------------------------------------------------

drop function if exists public.return_checkout(uuid, numeric, text, uuid, text, date);

create function public.return_checkout(
  p_checkout_id    uuid,
  p_amount         numeric,
  p_reason         text,
  p_appointment_id uuid default null,
  p_note           text default null,
  p_movement_date  date default null
)
returns table (movement_id uuid, item_id uuid, amount numeric, movement_date date, new_quantity numeric, remaining numeric)
language plpgsql security definer set search_path = public
as $return_checkout$
declare
  checkout public.inventory_movements;
  item_kind text;
  target_batch uuid;
  target_label text;
  left_out numeric;
  visit uuid;
  visit_status text;
  visit_reference text;
  technician_name text;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  new_quantity_value numeric;
  returned_on date;
  label text;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_reason is null or p_reason not in ('VISIT_CANCELLED', 'LEFTOVER', 'NOT_NEEDED', 'OTHER') then
    raise exception 'Choose why the stock is coming back.';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a quantity greater than zero.'; end if;
  if p_reason = 'OTHER' and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Write a note saying why the stock is coming back.';
  end if;

  select * into checkout from public.inventory_movements m
  where m.id = p_checkout_id and m.stock_out_reason = 'TECHNICIAN_CHECKOUT';
  if checkout.id is null then raise exception 'That checkout was not found.'; end if;
  if checkout.custody_closed_at is not null then
    raise exception 'That checkout was settled before returns existed. Record a Stock In or correction instead.';
  end if;

  select i.type::text into item_kind from public.inventory i where i.id = checkout.item_id for update;

  left_out := public.checkout_remaining(checkout.id);
  if p_amount > left_out then
    raise exception 'Only % is still out on this checkout.', left_out;
  end if;

  returned_on := coalesce(p_movement_date, current_date);
  if returned_on < checkout.movement_date then
    raise exception 'A return cannot be dated before the checkout.';
  end if;

  visit := coalesce(p_appointment_id, checkout.for_appointment_id);
  if p_reason = 'VISIT_CANCELLED' then
    if visit is null then raise exception 'Choose the visit that was cancelled.'; end if;
    select a.status, coalesce(a.reference, 'a visit') into visit_status, visit_reference
    from public.appointments a where a.id = visit;
    if visit_status is null then raise exception 'That visit was not found.'; end if;
    if visit_status <> 'Cancelled' then
      raise exception 'That visit is not cancelled. Cancel it first, or choose another reason.';
    end if;
  end if;

  -- The batch the stock left in; a checkout from before batches goes to the
  -- item's opening batch, whose lot is unknown too.
  if item_kind = 'CHEMICAL' then
    target_batch := coalesce(checkout.batch_id, public.fallback_batch(checkout.item_id, returned_on));
    update public.inventory_batches b set quantity = b.quantity + p_amount where b.id = target_batch
      returning coalesce(b.lot_number, b.reference) into target_label;
  end if;

  select t.name into technician_name from public.technicians t where t.id = checkout.technician_id;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  label := 'Returned by ' || coalesce(technician_name, 'a technician') || ' · ' || case p_reason
    when 'VISIT_CANCELLED' then 'visit ' || visit_reference || ' cancelled'
    when 'LEFTOVER' then 'leftover after the visit'
    when 'NOT_NEEDED' then 'not needed'
    else 'other'
  end;

  insert into public.inventory_movements (
    item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
    movement_type, technician_id, note, checkout_id, for_appointment_id, return_reason, batch_id, batch_number
  )
  values (
    checkout.item_id, p_amount, p_amount, returned_on, label, actor_name, actor_account_id,
    'RETURN', checkout.technician_id, nullif(trim(coalesce(p_note, '')), ''), checkout.id, visit, p_reason,
    target_batch, target_label
  )
  returning id into movement_id_value;

  update public.inventory i set quantity = i.quantity + p_amount
  where i.id = checkout.item_id
  returning i.quantity into new_quantity_value;

  return query select movement_id_value, checkout.item_id, p_amount, returned_on, new_quantity_value, left_out - p_amount;
end;
$return_checkout$;

grant execute on function public.return_checkout(uuid, numeric, text, uuid, text, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. stock_correction(), from 021: a counted difference, by batch.
--
--    Down: from p_batch_id, else soonest expiry first — expired batches
--    included, since a count finds what is physically there. Up: into
--    p_batch_id, else the item's opening batch (lot unknown).
-- ---------------------------------------------------------------------------

drop function if exists public.stock_correction(uuid, numeric, text, date);
drop function if exists public.stock_correction(uuid, numeric, text, date, uuid);

create function public.stock_correction(
  p_item_id       uuid,
  p_delta         numeric,
  p_reason        text,
  p_movement_date date,
  p_batch_id      uuid default null
)
returns table (movement_id uuid, item_id uuid, amount numeric, movement_date date, reference text, actor text, new_quantity numeric, batch_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  item_status inventory_status;
  item_kind text;
  current_quantity numeric;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  new_quantity_value numeric;
  moved_on date;
  target_batch uuid;
  target_label text;
  portion_batches uuid[];
  portion_amounts numeric[];
  portion_labels text[];
  idx integer;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Correction amount cannot be zero.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A correction reason is required.'; end if;

  select i.status, i.type::text, i.quantity into item_status, item_kind, current_quantity
  from public.inventory i where i.id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found.'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot correct a disabled item.'; end if;
  if current_quantity + p_delta < 0 then raise exception 'Correction cannot make stock negative.'; end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id left join public.staff s on s.id = r.id left join public.technicians t on t.id = r.id limit 1;

  moved_on := coalesce(p_movement_date, current_date);

  if item_kind = 'CHEMICAL' and p_delta > 0 then
    if p_batch_id is not null
       and not exists (select 1 from public.inventory_batches b where b.id = p_batch_id and b.item_id = p_item_id) then
      raise exception 'That batch is not one of this item''s batches.';
    end if;
    target_batch := coalesce(p_batch_id, public.fallback_batch(p_item_id, moved_on));
    update public.inventory_batches b set quantity = b.quantity + p_delta, written_off_at = null
      where b.id = target_batch
      returning coalesce(b.lot_number, b.reference) into target_label;
  end if;

  -- A chemical counted down leaves by batch; anything else is one row.
  if item_kind = 'CHEMICAL' and p_delta < 0 then
    select array_agg(taken.batch_id order by taken.ordinality),
           array_agg(taken.taken order by taken.ordinality),
           array_agg(taken.lot_label order by taken.ordinality)
      into portion_batches, portion_amounts, portion_labels
    from public.take_from_batches(p_item_id, -p_delta, moved_on, p_batch_id, true, false) with ordinality as taken(batch_id, taken, lot_label, ordinality);
  else
    portion_batches := array[target_batch];
    portion_amounts := array[abs(p_delta)];
    portion_labels := array[target_label];
  end if;

  for idx in 1..coalesce(array_length(portion_amounts, 1), 0) loop
    insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, batch_id, batch_number)
    values (p_item_id, portion_amounts[idx], sign(p_delta) * portion_amounts[idx], moved_on, trim(p_reason), actor_name, actor_account_id, 'CORRECTION', portion_batches[idx], portion_labels[idx])
    returning id into movement_id_value;

    update public.inventory i set quantity = i.quantity + sign(p_delta) * portion_amounts[idx]
    where i.id = p_item_id
    returning i.quantity into new_quantity_value;

    return query select movement_id_value, p_item_id, portion_amounts[idx], moved_on, trim(p_reason), actor_name, new_quantity_value, portion_batches[idx];
  end loop;
end;
$$;

grant execute on function public.stock_correction(uuid, numeric, text, date, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Admin batch tools.
-- ---------------------------------------------------------------------------

create or replace function public.assert_inventory_admin()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if public.current_account_role() is distinct from 'ADMIN' then
    raise exception 'Only an admin can change batches.';
  end if;
end;
$$;

revoke all on function public.assert_inventory_admin() from public, anon, authenticated;

-- An expired batch's leftovers leave the shelf with reason EXPIRED.
drop function if exists public.write_off_expired_batch(uuid, text);

create function public.write_off_expired_batch(p_batch_id uuid, p_note text default null)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  target public.inventory_batches;
  actor_name text;
  actor_account_id uuid;
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform public.assert_inventory_admin();

  select * into target from public.inventory_batches b where b.id = p_batch_id for update;
  if target.id is null then raise exception 'That batch was not found.'; end if;
  perform 1 from public.inventory i where i.id = target.item_id for update;
  if target.expiration_date is null or target.expiration_date >= today then
    raise exception 'Only an expired batch can be written off. Use Stock Out for missing or damaged stock.';
  end if;
  if target.quantity <= 0 then raise exception 'That batch has nothing left on the shelf.'; end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id left join public.staff s on s.id = r.id left join public.technicians t on t.id = r.id limit 1;

  insert into public.inventory_movements (
    item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
    movement_type, stock_out_reason, note, batch_id, batch_number
  )
  values (
    target.item_id, target.quantity, -target.quantity, today,
    'Expired ' || to_char(target.expiration_date, 'Mon DD, YYYY') || ' — written off', actor_name, actor_account_id,
    'OUT', 'EXPIRED', nullif(trim(coalesce(p_note, '')), ''), target.id, coalesce(target.lot_number, target.reference)
  );

  update public.inventory i set quantity = i.quantity - target.quantity where i.id = target.item_id;
  update public.inventory_batches b set quantity = 0, written_off_at = now() where b.id = target.id;
  return target.quantity;
end;
$$;

grant execute on function public.write_off_expired_batch(uuid, text) to anon, authenticated;

-- Correct a batch's lot number or expiry (a typo on Stock In, or the real
-- details of an opening batch).
drop function if exists public.update_inventory_batch(uuid, text, date);

create function public.update_inventory_batch(p_batch_id uuid, p_lot_number text, p_expiration_date date)
returns public.inventory_batches
language plpgsql security definer set search_path = public
as $$
declare target public.inventory_batches;
begin
  perform public.assert_inventory_admin();
  select * into target from public.inventory_batches b where b.id = p_batch_id for update;
  if target.id is null then raise exception 'That batch was not found.'; end if;
  if p_expiration_date is not null and p_expiration_date < target.received_date then
    raise exception 'The expiry cannot be before the batch was received.';
  end if;

  update public.inventory_batches b
    set lot_number = nullif(trim(coalesce(p_lot_number, '')), ''),
        expiration_date = p_expiration_date
    where b.id = p_batch_id
    returning * into target;
  return target;
end;
$$;

grant execute on function public.update_inventory_batch(uuid, text, date) to anon, authenticated;

-- Move part of a batch into a new one with its own lot and expiry — how an
-- opening batch becomes the real batches on the shelf. The total is unchanged,
-- so no movement is written; split_from records where it came from.
drop function if exists public.split_inventory_batch(uuid, numeric, text, date);

create function public.split_inventory_batch(p_batch_id uuid, p_amount numeric, p_lot_number text, p_expiration_date date)
returns public.inventory_batches
language plpgsql security definer set search_path = public
as $$
declare source public.inventory_batches; created public.inventory_batches;
begin
  perform public.assert_inventory_admin();
  select * into source from public.inventory_batches b where b.id = p_batch_id for update;
  if source.id is null then raise exception 'That batch was not found.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a quantity greater than zero.'; end if;
  if p_amount >= source.quantity then
    raise exception 'Split off less than the whole batch (% left). To change the whole batch, edit it instead.', source.quantity;
  end if;
  if p_expiration_date is not null and p_expiration_date < source.received_date then
    raise exception 'The expiry cannot be before the batch was received.';
  end if;

  update public.inventory_batches b set quantity = b.quantity - p_amount where b.id = source.id;
  insert into public.inventory_batches (
    item_id, lot_number, expiration_date, received_date, quantity_received, quantity, unit_cost, is_opening, split_from
  )
  values (
    source.item_id, nullif(trim(coalesce(p_lot_number, '')), ''), p_expiration_date, source.received_date,
    p_amount, p_amount, source.unit_cost, false, source.id
  )
  returning * into created;
  return created;
end;
$$;

grant execute on function public.split_inventory_batch(uuid, numeric, text, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. The single-item stock_in() / stock_out() from before bulk Stock In
--     (005-021) move inventory.quantity without a batch. The app no longer
--     calls them; closing them keeps every path through the functions above,
--     so a chemical's batches always add up to its shelf quantity.
-- ---------------------------------------------------------------------------

do $$
declare signature text;
begin
  foreach signature in array array[
    'public.stock_out(uuid, uuid, numeric, date)',
    'public.stock_in(uuid, numeric, date, text, text)',
    'public.stock_in(uuid, numeric, date, text, text, uuid, uuid, text)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', signature);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying
--
--   Every chemical's batches add up to its shelf quantity:
--
--     select i.name, i.quantity, coalesce(sum(b.quantity), 0) as batches
--     from public.inventory i
--     left join public.inventory_batches b on b.item_id = i.id
--     where i.type = 'CHEMICAL'
--     group by i.id, i.name, i.quantity
--     having i.quantity <> coalesce(sum(b.quantity), 0);
--
--   (no rows = consistent)
-- ---------------------------------------------------------------------------
