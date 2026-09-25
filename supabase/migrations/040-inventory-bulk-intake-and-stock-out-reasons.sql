-- ---------------------------------------------------------------------------
-- Migration 040 - Bulk stock-in, unit conversion, and non-appointment stock-out.
--
-- Run after 039-treatment-methods-admin.sql / 039-admin-avatar-management.sql.
--
-- Four changes from the advisor review, all of them about the two ends of the
-- movement log:
--
--   1. Stock In accepted one item per submission. A delivery is a list, and
--      recording it one row at a time meant one item could land while the next
--      failed. stock_in_batch() takes the whole delivery note in a single
--      transaction: all of it lands or none of it does.
--
--   2. Supplies arrive in gallons and are tracked in litres. Staff were doing
--      the arithmetic in their heads before typing. The conversion now happens
--      in the app (UNIT_CONVERSIONS in src/utils/constants.js) and BOTH figures
--      are kept on the movement: what was written on the delivery note, and the
--      base-unit amount the stock level moved by.
--
--   3. Stock could only leave through an appointment. Stock also leaves when a
--      technician checks it out, when a count comes up short, and when a
--      container is damaged. stock_out_manual() records those with a reason,
--      the technician it went to, and a date the user can set — a stock-out
--      discovered on Friday is often a stock-out that happened on Tuesday.
--
--   4. standard_rate / rate_unit / rate_note (migration 035) are removed. The
--      client could not say what the figure was for, so it was guidance nobody
--      could source. Dropped rather than left dead: a half-understood dosage
--      shown next to a chemical at the moment of use is worse than no dosage.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. What the movement now records.
--
--    entered_amount / entered_unit / conversion_factor are the audit trail for
--    point 2: `amount` stays authoritative and is always in the item's own
--    unit, so nothing that reads the log has to know about conversion. The
--    three new columns only explain where `amount` came from.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements add column if not exists entered_amount    numeric;
alter table public.inventory_movements add column if not exists entered_unit      text;
alter table public.inventory_movements add column if not exists conversion_factor numeric;
alter table public.inventory_movements add column if not exists stock_out_reason  text;
-- Plain uuid, no foreign key: accounts live in three role tables
-- (admins / staff / technicians) since migration 011, exactly as
-- appointments.technician_id does.
alter table public.inventory_movements add column if not exists technician_id     uuid;
alter table public.inventory_movements add column if not exists note              text;
alter table public.inventory_movements add column if not exists batch_key         uuid;

comment on column public.inventory_movements.entered_amount is
  'Quantity as the user typed it, in entered_unit. Null when they typed the base unit.';
comment on column public.inventory_movements.entered_unit is
  'Unit the quantity was entered in, e.g. "gal" for an item tracked in "L".';
comment on column public.inventory_movements.conversion_factor is
  'Multiplier applied to entered_amount to reach amount. 1 when no conversion took place.';
comment on column public.inventory_movements.stock_out_reason is
  'Why stock left: APPOINTMENT, TECHNICIAN_CHECKOUT, MISSING or DAMAGED. Null on IN and CORRECTION.';
comment on column public.inventory_movements.technician_id is
  'Who the stock was checked out to. Only set for TECHNICIAN_CHECKOUT.';
-- idempotency_key is uniquely indexed (migration 008), so it can mark a
-- submission but cannot repeat across the rows of one. batch_key repeats: it
-- is what a replayed Stock In is read back by.
comment on column public.inventory_movements.batch_key is
  'Groups the rows written by one stock_in_batch() call. Shared by every row of the batch.';

create index if not exists inventory_movements_batch_key_idx
  on public.inventory_movements (batch_key)
  where batch_key is not null;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_stock_out_reason_check;
alter table public.inventory_movements
  add constraint inventory_movements_stock_out_reason_check
  check (
    stock_out_reason is null
    or (movement_type = 'OUT'
        and stock_out_reason in ('APPOINTMENT', 'TECHNICIAN_CHECKOUT', 'MISSING', 'DAMAGED'))
  );

-- A checkout names a technician; the other reasons never do. Enforced rather
-- than left to the UI, because "who has it" is the whole point of the reason.
alter table public.inventory_movements
  drop constraint if exists inventory_movements_checkout_technician_check;
alter table public.inventory_movements
  add constraint inventory_movements_checkout_technician_check
  check (technician_id is null or stock_out_reason = 'TECHNICIAN_CHECKOUT');

create index if not exists inventory_movements_stock_out_reason_idx
  on public.inventory_movements (stock_out_reason)
  where stock_out_reason is not null;

-- The whole-number check (006, narrowed to IN by 036) is dropped in section 2,
-- but it has to go BEFORE the backfill below: it was added `not valid`, so old
-- decimal rows were never checked — until an UPDATE touches them. A database
-- still carrying 006's version refuses the backfill on the first 0.4 L
-- stock-out with 23514. Dropping it here first is harmless on every database.
alter table public.inventory_movements
  drop constraint if exists inventory_movements_amount_whole_number_check;

-- Rows written before this migration all came from an appointment.
update public.inventory_movements
set stock_out_reason = 'APPOINTMENT'
where movement_type = 'OUT' and stock_out_reason is null and appointment_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Intake amounts may now be fractional.
--
--    Migration 006 required whole numbers on the way in ("you receive 6 whole
--    tubes"), and 036 narrowed that to IN only. Conversion breaks the last of
--    it: 5 gallons into an item tracked in litres is 18.9271, and refusing that
--    would send staff back to rounding by hand — which is the habit this
--    migration exists to remove. The UI still defaults to whole numbers when
--    the delivery unit and the tracking unit are the same.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements
  drop constraint if exists inventory_movements_amount_whole_number_check;

-- ---------------------------------------------------------------------------
-- 3. stock_in_batch() - a whole delivery in one transaction.
--
--    p_items is [{item_id, amount, unit_cost, entered_amount, entered_unit,
--    conversion_factor}, ...]. `amount` is always in the item's own unit; the
--    app converts before calling, and passes the pre-conversion figures along
--    so the log can show both.
--
--    unit_cost is written straight onto the movement here. The single-item
--    stock_in() left that to a follow-up UPDATE from the browser, which is a
--    second round trip that can fail on its own and leave the cost blank.
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
  movement_id  uuid,
  item_id      uuid,
  amount       numeric,
  movement_date date,
  reference    text,
  actor        text,
  unit_cost    numeric,
  total_cost   numeric,
  created_at   timestamptz,
  new_quantity numeric
)
language plpgsql security definer set search_path = public
as $stock_in_batch$
declare
  entry record;
  item_status inventory_status;
  actor_name text;
  actor_account_id uuid;
  movement_id_value uuid;
  created_at_value timestamptz;
  new_quantity_value numeric;
  resolved_cost numeric;
  resolved_amount numeric;
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
    select 1 from jsonb_to_recordset(p_items) as entries(item_id uuid)
    group by entries.item_id having count(*) > 1
  ) then
    raise exception 'Each inventory item can only be added once per Stock In.';
  end if;

  -- Replayed submission (a double-click, a retried request): the first row of
  -- the batch carries the key, so finding it means the whole batch already
  -- landed. Returning it unchanged is what makes a retry safe.
  if p_idempotency_key is not null
     and exists (select 1 from public.inventory_movements m where m.batch_key = p_idempotency_key) then
    return query
      select m.id, m.item_id, m.amount, m.movement_date, m.reference, m.actor,
             coalesce(m.unit_cost, 0), coalesce(m.total_cost, 0), m.created_at, i.quantity
      from public.inventory_movements m
      join public.inventory i on i.id = m.item_id
      where m.batch_key = p_idempotency_key
      order by m.created_at;
    return;
  end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  for entry in
    select entries.item_id, entries.amount, entries.unit_cost,
           entries.entered_amount, entries.entered_unit, entries.conversion_factor
    from jsonb_to_recordset(p_items) as entries(
      item_id uuid, amount numeric, unit_cost numeric,
      entered_amount numeric, entered_unit text, conversion_factor numeric
    )
  loop
    resolved_amount := round(entry.amount, 4);
    if resolved_amount is null or resolved_amount <= 0 then
      raise exception 'Stock In amounts must be greater than 0.';
    end if;

    select status into item_status from public.inventory where id = entry.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock In on a disabled item.'; end if;

    resolved_cost := coalesce(entry.unit_cost, 0);
    if resolved_cost < 0 then raise exception 'Purchase cost cannot be negative.'; end if;

    -- Only the first row carries the idempotency key: the column is unique, so
    -- it can identify the batch but cannot be repeated across its rows.
    entry_key := case when row_index = 0 then p_idempotency_key else null end;
    row_index := row_index + 1;

    insert into public.inventory_movements (
      item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
      intake_branch_or_station, purchase_reference, idempotency_key, batch_key, movement_type,
      unit_cost, total_cost, entered_amount, entered_unit, conversion_factor
    )
    values (
      entry.item_id, resolved_amount, resolved_amount,
      coalesce(p_movement_date, current_date),
      nullif(trim(p_reference), ''), actor_name, actor_account_id,
      nullif(trim(p_intake_branch_or_station), ''), nullif(trim(p_reference), ''),
      entry_key, p_idempotency_key, 'IN',
      resolved_cost, round(resolved_cost * resolved_amount, 2),
      entry.entered_amount, nullif(trim(coalesce(entry.entered_unit, '')), ''),
      coalesce(entry.conversion_factor, 1)
    )
    returning id, inventory_movements.created_at into movement_id_value, created_at_value;

    update public.inventory
    set quantity = quantity + resolved_amount,
        cost = case when entry.unit_cost is null then cost else resolved_cost end
    where id = entry.item_id
    returning quantity into new_quantity_value;

    return query select
      movement_id_value, entry.item_id, resolved_amount,
      coalesce(p_movement_date, current_date), nullif(trim(p_reference), ''), actor_name,
      resolved_cost, round(resolved_cost * resolved_amount, 2),
      created_at_value, new_quantity_value;
  end loop;
end;
$stock_in_batch$;

grant execute on function public.stock_in_batch(jsonb, date, text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. stock_out_manual() - stock leaving outside an appointment.
--
--    Deliberately a separate function from stock_out_batch(): that one hangs
--    every row off an appointment and refuses to run without one. The reasons
--    here have no appointment by definition.
-- ---------------------------------------------------------------------------

drop function if exists public.stock_out_manual(uuid, numeric, date, text, uuid, text);

create function public.stock_out_manual(
  p_item_id       uuid,
  p_amount        numeric,
  p_movement_date date,
  p_reason        text,
  p_technician_id uuid,
  p_note          text
)
returns table (
  movement_id   uuid,
  item_id       uuid,
  amount        numeric,
  movement_date date,
  reason        text,
  technician_id uuid,
  actor         text,
  note          text,
  new_quantity  numeric
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
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_reason not in ('TECHNICIAN_CHECKOUT', 'MISSING', 'DAMAGED') then
    raise exception 'Choose a stock-out reason.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Stock-Out quantities must be greater than zero.';
  end if;

  resolved_technician := case when p_reason = 'TECHNICIAN_CHECKOUT' then p_technician_id end;
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

  -- `reference` is what the existing history table prints, so the reason is
  -- written there too rather than only in a column the old view cannot see.
  reason_label := case p_reason
    when 'TECHNICIAN_CHECKOUT' then 'Checked out by ' ||
      coalesce((select t.name from public.technicians t where t.id = resolved_technician), 'a technician')
    when 'MISSING' then 'Missing stock'
    else 'Damaged stock'
  end;

  insert into public.inventory_movements (
    item_id, amount, quantity_delta, movement_date, reference, actor, actor_id,
    movement_type, stock_out_reason, technician_id, note
  )
  values (
    p_item_id, p_amount, -p_amount, coalesce(p_movement_date, current_date),
    reason_label, actor_name, actor_account_id,
    'OUT', p_reason, resolved_technician, nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into movement_id_value;

  update public.inventory set quantity = quantity - p_amount
  where id = p_item_id
  returning quantity into new_quantity_value;

  return query select
    movement_id_value, p_item_id, p_amount, coalesce(p_movement_date, current_date),
    p_reason, resolved_technician, actor_name,
    nullif(trim(coalesce(p_note, '')), ''), new_quantity_value;
end;
$stock_out_manual$;

grant execute on function public.stock_out_manual(uuid, numeric, date, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Appointment stock-out tags its own reason.
--
--    Same signature and same behaviour as the migration 036 definition; the
--    only change is that the row it writes now says APPOINTMENT rather than
--    leaving the reason blank, so the three reasons and the appointment case
--    can be told apart in one query.
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
declare item_row record; item_status inventory_status; current_quantity numeric; actor_name text; actor_account_id uuid; movement_id_value uuid; new_quantity_value numeric;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and status <> 'Cancelled') then raise exception 'Active appointment not found.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one stock-out item is required.'; end if;
  if exists (select entries.item_id from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric) group by entries.item_id having count(*) > 1) then raise exception 'Each inventory item can only be added once per stock-out.'; end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_account_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  for item_row in
    select entries.item_id, entries.amount, entries.batch_number
    from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric, batch_number text)
    order by entries.item_id
  loop
    if item_row.amount is null or item_row.amount <= 0 then raise exception 'Stock-Out quantities must be greater than zero.'; end if;

    select status, quantity into item_status, current_quantity from public.inventory where id = item_row.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;
    if item_row.amount > current_quantity then raise exception 'Requested quantity exceeds available stock.'; end if;

    insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, appointment_id, batch_number, stock_out_reason)
    values (
      item_row.item_id, item_row.amount, -item_row.amount,
      coalesce(p_movement_date, current_date),
      'Appointment ' || p_appointment_id::text,
      actor_name, actor_account_id, 'OUT', p_appointment_id,
      nullif(trim(coalesce(item_row.batch_number, '')), ''),
      'APPOINTMENT'
    )
    returning id into movement_id_value;

    update public.inventory set quantity = quantity - item_row.amount where id = item_row.item_id returning quantity into new_quantity_value;

    return query select
      movement_id_value, item_row.item_id, p_appointment_id, item_row.amount,
      coalesce(p_movement_date, current_date), actor_name, new_quantity_value,
      nullif(trim(coalesce(item_row.batch_number, '')), '');
  end loop;
end;
$stock_out_batch$;

grant execute on function public.stock_out_batch(uuid, jsonb, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Application rates removed.
--
--    Reversing migration 035 section 2. Dropping the columns takes the data
--    with them, which is the intent: the figures were entered against a field
--    nobody could define, so keeping them would preserve guesswork.
-- ---------------------------------------------------------------------------

alter table public.inventory drop constraint if exists inventory_standard_rate_check;
alter table public.inventory drop column if exists standard_rate;
alter table public.inventory drop column if exists rate_unit;
alter table public.inventory drop column if exists rate_note;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify
--
--   select column_name from information_schema.columns
--     where table_name = 'inventory_movements'
--       and column_name in ('entered_amount', 'entered_unit', 'conversion_factor',
--                           'stock_out_reason', 'technician_id', 'note');
--     -> expect 6 rows
--
--   select column_name from information_schema.columns
--     where table_name = 'inventory' and column_name like 'rate%';
--     -> expect 0 rows
--
--   Stock leaving to a technician:
--     select * from public.stock_out_manual(
--       '<item-uuid>', 2, current_date - 3, 'TECHNICIAN_CHECKOUT', '<technician-uuid>', null);
-- ---------------------------------------------------------------------------
