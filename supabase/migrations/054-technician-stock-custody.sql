-- ---------------------------------------------------------------------------
-- Migration 054 - Stock a technician is holding.
--
-- Run after 053-plan-renewal-declined.sql.
--
-- A checkout (stock_out_manual, reason TECHNICIAN_CHECKOUT, migration 040) took
-- stock off the shelf and said who took it — and nothing more. When the same
-- technician then recorded the visit's materials (stock_out_batch), the shelf
-- was charged a second time for the same container: 2 L taken on Monday for
-- Tuesday's visit came off twice. If the checkout had emptied the shelf, the
-- visit's materials were refused outright ("exceeds available stock"). And
-- what came back unused had no way back except a fake delivery.
--
-- A checkout is now CUSTODY, not consumption:
--
--   inventory.quantity        is still what is on the shelf. A checkout still
--                             lowers it; the stock is just no longer "gone".
--
--   what a technician holds   = each checkout's amount, less every row that
--                             points back at it through checkout_id: visit
--                             usage and returns. checkout_remaining() says
--                             how much of one checkout is still out.
--
--   stock_out_batch()         (visit materials) draws from what the visit's
--                             crew is holding first — a checkout made for this
--                             visit, then their oldest — and only the rest
--                             from the shelf. A row drawn from a checkout has
--                             quantity_delta 0 (the shelf does not move) and
--                             checkout_id set, so the history reads "taken
--                             Sep 25 by Juan -> used on TPC-V-00012 Sep 26".
--
--   return_checkout()         puts unused stock back on the shelf, with a
--                             reason: the visit was cancelled (naming it),
--                             leftover after the visit, not needed, or other
--                             (a note required). movement_type RETURN.
--
--   stock_out_manual()        takes an optional visit the checkout is for.
--
-- Checkouts recorded before this migration are marked custody_closed_at: their
-- visits already charged the shelf a second time, so letting a new visit draw
-- on them would hide stock that is really gone. They stay in the history as
-- they were.
--
-- 054 is now the source of truth for stock_out_batch (from 040) and
-- stock_out_manual (from 040). Re-running 040 restores the double count;
-- re-run 054 after it. Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Columns.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements
  add column if not exists checkout_id uuid references public.inventory_movements(id) on delete restrict;
alter table public.inventory_movements
  add column if not exists for_appointment_id uuid references public.appointments(id) on delete set null;
alter table public.inventory_movements
  add column if not exists return_reason text;

comment on column public.inventory_movements.checkout_id is
  'The technician checkout this row settles: visit materials drawn from it, or stock returned from it.';
comment on column public.inventory_movements.for_appointment_id is
  'On a checkout, the visit it was taken for; on a return, the visit it was taken for or the one that was cancelled.';
comment on column public.inventory_movements.return_reason is
  'Why stock came back: VISIT_CANCELLED, LEFTOVER, NOT_NEEDED or OTHER. Only on RETURN rows.';

-- Added and backfilled once, so re-running the migration never closes a
-- checkout made after it first ran.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'custody_closed_at'
  ) then
    alter table public.inventory_movements add column custody_closed_at timestamptz;
    update public.inventory_movements
      set custody_closed_at = now()
      where stock_out_reason = 'TECHNICIAN_CHECKOUT';
  end if;
end;
$$;

comment on column public.inventory_movements.custody_closed_at is
  'Set on checkouts from before migration 054: settled as they were, not drawn on by later visits.';

create index if not exists inventory_movements_checkout_id_idx
  on public.inventory_movements (checkout_id) where checkout_id is not null;
create index if not exists inventory_movements_open_checkout_idx
  on public.inventory_movements (item_id, technician_id)
  where stock_out_reason = 'TECHNICIAN_CHECKOUT' and custody_closed_at is null;

-- ---------------------------------------------------------------------------
-- 2. Rules.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('IN', 'OUT', 'CORRECTION', 'RETURN'));

-- A return names the technician it came back from, like the checkout did.
alter table public.inventory_movements drop constraint if exists inventory_movements_checkout_technician_check;
alter table public.inventory_movements add constraint inventory_movements_checkout_technician_check
  check (technician_id is null or stock_out_reason = 'TECHNICIAN_CHECKOUT' or movement_type = 'RETURN');

alter table public.inventory_movements drop constraint if exists inventory_movements_return_reason_check;
alter table public.inventory_movements add constraint inventory_movements_return_reason_check
  check (
    (movement_type = 'RETURN' and return_reason in ('VISIT_CANCELLED', 'LEFTOVER', 'NOT_NEEDED', 'OTHER') and checkout_id is not null)
    or (movement_type <> 'RETURN' and return_reason is null)
  );

alter table public.inventory_movements drop constraint if exists inventory_movements_checkout_link_check;
alter table public.inventory_movements add constraint inventory_movements_checkout_link_check
  check (checkout_id is null or stock_out_reason = 'APPOINTMENT' or movement_type = 'RETURN');

alter table public.inventory_movements drop constraint if exists inventory_movements_for_appointment_check;
alter table public.inventory_movements add constraint inventory_movements_for_appointment_check
  check (for_appointment_id is null or stock_out_reason = 'TECHNICIAN_CHECKOUT' or movement_type = 'RETURN');

-- ---------------------------------------------------------------------------
-- 3. How much of a checkout is still out.
-- ---------------------------------------------------------------------------

create or replace function public.checkout_remaining(p_checkout_id uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when c.custody_closed_at is not null then 0
              else c.amount - coalesce((select sum(m.amount) from public.inventory_movements m where m.checkout_id = c.id), 0)
         end
  from public.inventory_movements c
  where c.id = p_checkout_id and c.stock_out_reason = 'TECHNICIAN_CHECKOUT';
$$;

grant execute on function public.checkout_remaining(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. stock_out_manual(), from 040, with the visit a checkout is for.
-- ---------------------------------------------------------------------------

drop function if exists public.stock_out_manual(uuid, numeric, date, text, uuid, text);
drop function if exists public.stock_out_manual(uuid, numeric, date, text, uuid, text, uuid);

create function public.stock_out_manual(
  p_item_id            uuid,
  p_amount             numeric,
  p_movement_date      date,
  p_reason             text,
  p_technician_id      uuid,
  p_note               text,
  p_for_appointment_id uuid default null
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
  for_appointment_id uuid
)
language plpgsql security definer set search_path = public
as $stock_out_manual$
declare
  item_status inventory_status;
  current_quantity numeric;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  new_quantity_value numeric;
  reason_label text;
  resolved_technician uuid;
  resolved_visit uuid;
  visit_status text;
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
      select status into visit_status from public.appointments where id = resolved_visit;
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

  select status, quantity into item_status, current_quantity
  from public.inventory where id = p_item_id for update;
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

  insert into public.inventory_movements (
    item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
    movement_type, stock_out_reason, technician_id, note, for_appointment_id
  )
  values (
    p_item_id, p_amount, -p_amount, coalesce(p_movement_date, current_date),
    reason_label, actor_name, actor_account_id,
    'OUT', p_reason, resolved_technician, nullif(trim(coalesce(p_note, '')), ''), resolved_visit
  )
  returning id into movement_id_value;

  update public.inventory set quantity = quantity - p_amount
  where id = p_item_id
  returning quantity into new_quantity_value;

  return query select
    movement_id_value, p_item_id, p_amount, coalesce(p_movement_date, current_date),
    p_reason, resolved_technician, actor_name,
    nullif(trim(coalesce(p_note, '')), ''), new_quantity_value, resolved_visit;
end;
$stock_out_manual$;

grant execute on function public.stock_out_manual(uuid, numeric, date, text, uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. stock_out_batch(), from 040: the crew's checkouts first, then the shelf.
--
--    Same signature and result columns. One item can now come back as several
--    rows (part from a checkout, part from the shelf); new_quantity on the
--    item's LAST row is the shelf after the whole line.
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
  item_status inventory_status;
  current_quantity numeric;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  new_quantity_value numeric;
  still_needed numeric;
  drawn numeric;
  crew uuid[];
  visit_reference text;
  batch_value text;
  used_on date;
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

  -- The visit's crew (041), or its lead alone on a database without crews.
  select coalesce(array_agg(at.technician_id), '{}') into crew
  from public.appointment_technicians at where at.appointment_id = p_appointment_id;
  select crew || coalesce(array_agg(a.technician_id) filter (where a.technician_id is not null), '{}') into crew
  from public.appointments a where a.id = p_appointment_id;

  select coalesce(a.reference, 'Appointment ' || a.id::text) into visit_reference
  from public.appointments a where a.id = p_appointment_id;

  for item_row in
    select entries.item_id, entries.amount, entries.batch_number
    from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric, batch_number text)
    order by entries.item_id
  loop
    if item_row.amount is null or item_row.amount <= 0 then raise exception 'Stock-Out quantities must be greater than zero.'; end if;

    select i.status, i.quantity into item_status, current_quantity from public.inventory i where i.id = item_row.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;

    batch_value := nullif(trim(coalesce(item_row.batch_number, '')), '');
    still_needed := item_row.amount;
    new_quantity_value := current_quantity;

    -- What the crew is holding of this item: a checkout taken for this visit
    -- first, then the oldest. The item row is locked above, so two visits
    -- cannot draw the same checkout at once.
    for held in
      select c.id, public.checkout_remaining(c.id) as remaining
      from public.inventory_movements c
      where c.stock_out_reason = 'TECHNICIAN_CHECKOUT'
        and c.item_id = item_row.item_id
        and c.custody_closed_at is null
        and c.technician_id = any(crew)
        and c.movement_date <= used_on
      order by (c.for_appointment_id is not distinct from p_appointment_id) desc, c.movement_date, c.created_at
    loop
      exit when still_needed <= 0;
      continue when held.remaining <= 0;
      drawn := least(held.remaining, still_needed);

      insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, appointment_id, batch_number, stock_out_reason, checkout_id)
      values (item_row.item_id, drawn, 0, used_on, visit_reference || ' (from checkout)', actor_name, actor_account_id, 'OUT', p_appointment_id, batch_value, 'APPOINTMENT', held.id)
      returning id into movement_id_value;

      still_needed := still_needed - drawn;
      return query select movement_id_value, item_row.item_id, p_appointment_id, drawn, used_on, actor_name, new_quantity_value, batch_value;
    end loop;

    if still_needed > 0 then
      if still_needed > current_quantity then
        raise exception 'Requested quantity exceeds available stock.';
      end if;

      insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, appointment_id, batch_number, stock_out_reason)
      values (item_row.item_id, still_needed, -still_needed, used_on, visit_reference, actor_name, actor_account_id, 'OUT', p_appointment_id, batch_value, 'APPOINTMENT')
      returning id into movement_id_value;

      update public.inventory i set quantity = i.quantity - still_needed where i.id = item_row.item_id returning i.quantity into new_quantity_value;
      return query select movement_id_value, item_row.item_id, p_appointment_id, still_needed, used_on, actor_name, new_quantity_value, batch_value;
    end if;
  end loop;
end;
$stock_out_batch$;

grant execute on function public.stock_out_batch(uuid, jsonb, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. return_checkout(): unused stock back on the shelf, with a reason.
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

  -- Locks the item, which also serialises against a visit drawing the same checkout.
  perform 1 from public.inventory i where i.id = checkout.item_id for update;

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
    movement_type, technician_id, note, checkout_id, for_appointment_id, return_reason
  )
  values (
    checkout.item_id, p_amount, p_amount, returned_on, label, actor_name, actor_account_id,
    'RETURN', checkout.technician_id, nullif(trim(coalesce(p_note, '')), ''), checkout.id, visit, p_reason
  )
  returning id into movement_id_value;

  update public.inventory i set quantity = i.quantity + p_amount
  where i.id = checkout.item_id
  returning i.quantity into new_quantity_value;

  return query select movement_id_value, checkout.item_id, p_amount, returned_on, new_quantity_value, left_out - p_amount;
end;
$return_checkout$;

grant execute on function public.return_checkout(uuid, numeric, text, uuid, text, date) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verifying: every open checkout and what is still out on it.
--
--   select c.movement_date, i.name, t.name as technician, c.amount,
--          public.checkout_remaining(c.id) as still_out
--   from public.inventory_movements c
--   join public.inventory i on i.id = c.item_id
--   left join public.technicians t on t.id = c.technician_id
--   where c.stock_out_reason = 'TECHNICIAN_CHECKOUT' and c.custody_closed_at is null
--   order by c.movement_date;
-- ---------------------------------------------------------------------------
