-- Migration 020 — Scheduling, service reports, and appointment stock-out.
-- Run after migrations 001-019.

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  scheduled_at timestamptz not null,
  technician_id uuid,
    status text not null default 'Pending' check (status in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'Completed', 'Cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_scheduled_at_idx on public.appointments (scheduled_at);
create index if not exists appointments_client_id_idx on public.appointments (client_id);
create index if not exists appointments_technician_id_idx on public.appointments (technician_id);
create unique index if not exists appointments_technician_slot_idx
  on public.appointments (technician_id, scheduled_at)
  where technician_id is not null and status <> 'Cancelled';

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at before update on public.appointments
for each row execute function public.set_updated_at();

create table if not exists public.appointment_reports (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  findings text not null,
  submitted_by uuid,
  submitted_at timestamptz not null default now()
);

alter table public.appointments drop constraint if exists appointments_status_check;
update public.appointments set status = 'Reschedule' where status = 'Rescheduled';
alter table public.appointments add constraint appointments_status_check
  check (status in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'Completed', 'Cancelled'));

alter table public.inventory_movements
  add column if not exists movement_type text not null default 'IN'
    check (movement_type in ('IN', 'OUT'));
alter table public.inventory_movements add column if not exists quantity_delta numeric;
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('IN', 'OUT', 'CORRECTION'));
alter table public.inventory_movements add column if not exists appointment_id uuid references public.appointments(id) on delete restrict;
create index if not exists inventory_movements_appointment_id_idx on public.inventory_movements (appointment_id);

alter table public.appointments enable row level security;
alter table public.appointment_reports enable row level security;

drop policy if exists "Scheduling access" on public.appointments;
create policy "Scheduling access" on public.appointments
for all using (public.has_role_table_session()) with check (public.has_role_table_session());

drop policy if exists "Appointment report access" on public.appointment_reports;
create policy "Appointment report access" on public.appointment_reports
for all using (public.has_role_table_session()) with check (public.has_role_table_session());

grant select, insert, update on public.appointments to anon, authenticated;
grant select, insert, update on public.appointment_reports to anon, authenticated;
grant select on public.inventory_movements to anon, authenticated;

create or replace function public.account_is_active(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.staff where id = p_account_id and status = 'ACTIVE')
      or exists (select 1 from public.technicians where id = p_account_id and status = 'ACTIVE');
$$;

grant execute on function public.account_is_active(uuid) to anon, authenticated;

create or replace function public.create_appointment(
  p_client_id uuid,
  p_scheduled_at timestamptz,
  p_technician_id uuid,
  p_notes text
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare created public.appointments;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and status = 'ACTIVE') then raise exception 'Active client not found.'; end if;
  if p_technician_id is not null and not public.account_is_active(p_technician_id) then raise exception 'Technician or Staff account is not active.'; end if;
  if p_technician_id is not null and exists (
    select 1 from public.appointments where technician_id = p_technician_id and scheduled_at = p_scheduled_at and status <> 'Cancelled'
  ) then raise exception 'That technician is already assigned at this time.'; end if;

  insert into public.appointments (client_id, scheduled_at, technician_id, notes, created_by)
  select p_client_id, p_scheduled_at, p_technician_id, nullif(trim(p_notes), ''), r.id
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  limit 1
  returning * into created;
  return created;
end;
$$;

grant execute on function public.create_appointment(uuid, timestamptz, uuid, text) to anon, authenticated;

create or replace function public.update_appointment(
  p_appointment_id uuid,
  p_scheduled_at timestamptz,
  p_technician_id uuid,
  p_status text,
  p_notes text
)
returns public.appointments
language plpgsql security definer set search_path = public
as $$
declare updated public.appointments;
declare current_status text;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
    if p_status not in ('Pending', 'Scheduled', 'Confirmed', 'Reschedule', 'Completed', 'Cancelled') then raise exception 'Invalid appointment status.'; end if;
    select status into current_status from public.appointments where id = p_appointment_id;
    if current_status is null then raise exception 'Appointment not found.'; end if;
    if exists (select 1 from public.appointments where id = p_appointment_id and scheduled_at is distinct from p_scheduled_at)
       and current_status <> 'Reschedule' then
      raise exception 'Change the status to Reschedule before moving the appointment.';
    end if;
  if p_technician_id is not null and not public.account_is_active(p_technician_id) then raise exception 'Technician or Staff account is not active.'; end if;
  if p_technician_id is not null and exists (
    select 1 from public.appointments where id <> p_appointment_id and technician_id = p_technician_id and scheduled_at = p_scheduled_at and status <> 'Cancelled'
  ) then raise exception 'That technician is already assigned at this time.'; end if;

  update public.appointments set scheduled_at = p_scheduled_at, technician_id = p_technician_id,
    status = p_status, notes = nullif(trim(p_notes), '')
  where id = p_appointment_id returning * into updated;
  if updated.id is null then raise exception 'Appointment not found.'; end if;
  return updated;
end;
$$;

grant execute on function public.update_appointment(uuid, timestamptz, uuid, text, text) to anon, authenticated;

create or replace function public.submit_appointment_report(
  p_appointment_id uuid,
  p_findings text
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
 declare actor_id uuid;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Report findings are required.'; end if;
  select r.id into actor_id from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r limit 1;
  insert into public.appointment_reports (appointment_id, findings, submitted_by)
  values (p_appointment_id, trim(p_findings), actor_id)
  on conflict (appointment_id) do update set findings = excluded.findings, submitted_by = excluded.submitted_by, submitted_at = now()
  returning * into report_row;
  update public.appointments set status = 'Completed' where id = p_appointment_id;
  if report_row.appointment_id is null then raise exception 'Appointment not found.'; end if;
  return report_row;
end;
$$;

grant execute on function public.submit_appointment_report(uuid, text) to anon, authenticated;

create or replace function public.stock_out(
  p_item_id uuid,
  p_appointment_id uuid,
  p_amount numeric,
  p_movement_date date
)
returns table (
  movement_id uuid,
  item_id uuid,
  appointment_id uuid,
  amount numeric,
  movement_date date,
  actor text,
  new_quantity numeric
)
language plpgsql security definer set search_path = public
as $$
declare item_status inventory_status; current_quantity numeric; actor_name text; actor_id uuid; movement_id_value uuid; new_quantity_value numeric;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Stock Out amount must be greater than 0.'; end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and status <> 'Cancelled') then raise exception 'Active appointment not found.'; end if;
  select status, quantity into item_status, current_quantity from public.inventory where id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found.'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;
  if p_amount > current_quantity then raise exception 'Requested quantity exceeds available stock.'; end if;
  select r.id, coalesce(a.name, s.name, t.name) into actor_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id limit 1;

  insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, appointment_id)
  values (p_item_id, p_amount, -p_amount, coalesce(p_movement_date, current_date), 'Appointment ' || p_appointment_id::text, actor_name, actor_id, 'OUT', p_appointment_id)
  returning id into movement_id_value;
  update public.inventory set quantity = quantity - p_amount where id = p_item_id returning quantity into new_quantity_value;
  return query select movement_id_value, p_item_id, p_appointment_id, p_amount, coalesce(p_movement_date, current_date), actor_name, new_quantity_value;
end;
$$;

grant execute on function public.stock_out(uuid, uuid, numeric, date) to anon, authenticated;

create or replace function public.stock_out_batch(
  p_appointment_id uuid,
  p_items jsonb,
  p_movement_date date
)
returns table (
  movement_id uuid,
  item_id uuid,
  appointment_id uuid,
  amount numeric,
  movement_date date,
  actor text,
  new_quantity numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  item_row record;
  item_status inventory_status;
  current_quantity numeric;
  actor_name text;
  actor_id uuid;
  movement_id_value uuid;
  new_quantity_value numeric;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and status <> 'Cancelled') then
    raise exception 'Active appointment not found.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one stock-out item is required.';
  end if;
  if exists (
    select item_id
    from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric)
    group by item_id
    having count(*) > 1
  ) then
    raise exception 'Each inventory item can only be added once per stock-out.';
  end if;

  select r.id, coalesce(a.name, s.name, t.name) into actor_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id
  limit 1;

  for item_row in
    select item_id, amount
    from jsonb_to_recordset(p_items) as entries(item_id uuid, amount numeric)
    order by item_id
  loop
    if item_row.amount is null or item_row.amount <= 0 then raise exception 'Stock Out amount must be greater than 0.'; end if;
    select status, quantity into item_status, current_quantity
    from public.inventory where id = item_row.item_id for update;
    if item_status is null then raise exception 'Inventory item not found.'; end if;
    if item_status = 'DISABLED' then raise exception 'Cannot Stock Out a disabled item.'; end if;
    if item_row.amount > current_quantity then raise exception 'Requested quantity exceeds available stock.'; end if;

    insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type, appointment_id)
    values (item_row.item_id, item_row.amount, -item_row.amount, coalesce(p_movement_date, current_date), 'Appointment ' || p_appointment_id::text, actor_name, actor_id, 'OUT', p_appointment_id)
    returning id into movement_id_value;
    update public.inventory set quantity = quantity - item_row.amount where id = item_row.item_id returning quantity into new_quantity_value;
    return query select movement_id_value, item_row.item_id, p_appointment_id, item_row.amount, coalesce(p_movement_date, current_date), actor_name, new_quantity_value;
  end loop;
end;
$$;

grant execute on function public.stock_out_batch(uuid, jsonb, date) to anon, authenticated;

create or replace function public.stock_correction(
  p_item_id uuid,
  p_delta numeric,
  p_reason text,
  p_movement_date date
)
returns table (
  movement_id uuid,
  item_id uuid,
  amount numeric,
  movement_date date,
  reference text,
  actor text,
  new_quantity numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  item_status inventory_status;
  current_quantity numeric;
  actor_name text;
  actor_id uuid;
  movement_id_value uuid;
  new_quantity_value numeric;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Correction amount cannot be zero.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A correction reason is required.'; end if;
  select status, quantity into item_status, current_quantity from public.inventory where id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found.'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot correct a disabled item.'; end if;
  if current_quantity + p_delta < 0 then raise exception 'Correction cannot make stock negative.'; end if;
  select r.id, coalesce(a.name, s.name, t.name) into actor_id, actor_name
  from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r
  left join public.admins a on a.id = r.id
  left join public.staff s on s.id = r.id
  left join public.technicians t on t.id = r.id limit 1;
  insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, movement_type)
  values (p_item_id, abs(p_delta), p_delta, coalesce(p_movement_date, current_date), trim(p_reason), actor_name, actor_id, 'CORRECTION')
  returning id into movement_id_value;
  update public.inventory set quantity = quantity + p_delta where id = p_item_id returning quantity into new_quantity_value;
  return query select movement_id_value, p_item_id, abs(p_delta), coalesce(p_movement_date, current_date), trim(p_reason), actor_name, new_quantity_value;
end;
$$;

grant execute on function public.stock_correction(uuid, numeric, text, date) to anon, authenticated;

-- Recreate Stock In with the new movement type explicitly set.
create or replace function public.stock_in(
  p_item_id uuid, p_amount numeric, p_movement_date date, p_reference text,
  p_actor text, p_idempotency_key uuid, p_actor_id uuid, p_intake_branch_or_station text
)
returns table (movement_id uuid, item_id uuid, amount numeric, movement_date date, reference text, actor text, created_at timestamptz, new_quantity numeric)
language plpgsql security definer set search_path = public
as $$
declare existing inventory_movements; item_status inventory_status; movement_id_value uuid; created_at_value timestamptz; new_quantity_value numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Stock In amount must be greater than 0'; end if;
  if nullif(trim(p_reference), '') is null then raise exception 'A purchase order or supplier invoice reference is required'; end if;
  if p_idempotency_key is not null then
    select * into existing from public.inventory_movements where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      select quantity into new_quantity_value from public.inventory where id = existing.item_id;
      return query select existing.id, existing.item_id, existing.amount, existing.movement_date, existing.reference, existing.actor, existing.created_at, new_quantity_value; return;
    end if;
  end if;
  select status into item_status from public.inventory where id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot Stock In on a disabled item'; end if;
  insert into public.inventory_movements (item_id, amount, quantity_delta, movement_date, reference, actor, actor_id, intake_branch_or_station, purchase_reference, idempotency_key, movement_type)
  values (p_item_id, p_amount, p_amount, p_movement_date, nullif(trim(p_reference), ''), p_actor, p_actor_id, nullif(trim(p_intake_branch_or_station), ''), nullif(trim(p_reference), ''), p_idempotency_key, 'IN')
  returning id, inventory_movements.created_at into movement_id_value, created_at_value;
  update public.inventory set quantity = quantity + p_amount where id = p_item_id returning quantity into new_quantity_value;
  return query select movement_id_value, p_item_id, p_amount, p_movement_date, nullif(trim(p_reference), ''), p_actor, created_at_value, new_quantity_value;
end;
$$;

grant execute on function public.stock_in(uuid, numeric, date, text, text, uuid, uuid, text) to anon, authenticated;
notify pgrst, 'reload schema';
