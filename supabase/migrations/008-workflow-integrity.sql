-- Migration 008 — workflow integrity guardrails
-- Run after schema-v2.sql and migrations 001-007.

-- Expose session validation through a callable wrapper; the internal lookup
-- remains protected from direct access.
-- remains protected from direct access.
create or replace function public.validate_session(session_token uuid)
returns table (
  id uuid,
  name text,
  username text,
  email text,
  phone text,
  role user_role,
  status account_status,
  is_primary boolean,
  last_login_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.name, u.username, u.email, u.phone, u.role, u.status,
         u.is_primary, u.last_login_at, u.created_at, u.updated_at
  from public.get_session_user(session_token) u;
$$;

grant execute on function public.validate_session(uuid) to anon, authenticated;

-- A role change must not leave an old permission set alive in an open session.
create or replace function public.invalidate_sessions_on_account_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role or old.password_hash is distinct from new.password_hash
     or old.status is distinct from new.status then
    delete from public.sessions where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists users_invalidate_sessions on public.users;
create trigger users_invalidate_sessions
after update on public.users
for each row execute function public.invalidate_sessions_on_account_change();

-- Client lifecycle and optimistic concurrency.
alter table public.clients add column if not exists version integer not null default 1;
alter table public.clients add column if not exists archived_at timestamptz;
alter table public.clients add column if not exists archived_by uuid references public.users(id) on delete set null;

-- Inventory accountability and conversion metadata.
alter table public.inventory add column if not exists purchase_unit text;
alter table public.inventory add column if not exists usage_unit text;
alter table public.inventory add column if not exists conversion_multiplier numeric;
alter table public.inventory add column if not exists created_by uuid references public.users(id) on delete set null;
alter table public.inventory add column if not exists intake_branch_or_station text;
alter table public.inventory drop constraint if exists inventory_conversion_positive;
alter table public.inventory add constraint inventory_conversion_positive
  check (conversion_multiplier is null or conversion_multiplier > 0);

alter table public.inventory drop constraint if exists inventory_nonnegative_values;
alter table public.inventory add constraint inventory_nonnegative_values
  check (quantity >= 0 and cost >= 0 and (reorder_level is null or reorder_level >= 0));

alter table public.inventory_movements add column if not exists actor_id uuid references public.users(id) on delete set null;
alter table public.inventory_movements add column if not exists intake_branch_or_station text;
alter table public.inventory_movements add column if not exists purchase_reference text;
alter table public.inventory_movements add column if not exists idempotency_key uuid;
create unique index if not exists inventory_movements_idempotency_idx
  on public.inventory_movements (idempotency_key)
  where idempotency_key is not null;

-- Use the new transaction contract for all future Stock In calls.
drop function if exists public.stock_in(uuid, numeric, date, text, text);
create or replace function public.stock_in(
  p_item_id uuid,
  p_amount numeric,
  p_movement_date date,
  p_reference text,
  p_actor text,
  p_idempotency_key uuid,
  p_actor_id uuid,
  p_intake_branch_or_station text
)
returns table (
  movement_id uuid,
  item_id uuid,
  amount numeric,
  movement_date date,
  reference text,
  actor text,
  created_at timestamptz,
  new_quantity numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing inventory_movements;
  item_status inventory_status;
  movement_id_value uuid;
  created_at_value timestamptz;
  new_quantity_value numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Stock In amount must be greater than 0';
  end if;
  if nullif(trim(p_reference), '') is null then
    raise exception 'A purchase order or supplier invoice reference is required';
  end if;

  if p_idempotency_key is not null then
    select * into existing from public.inventory_movements
    where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      select quantity into new_quantity_value from public.inventory where id = existing.item_id;
      return query select existing.id, existing.item_id, existing.amount,
        existing.movement_date, existing.reference, existing.actor,
        existing.created_at, new_quantity_value;
      return;
    end if;
  end if;

  select status into item_status from public.inventory where id = p_item_id for update;
  if item_status is null then raise exception 'Inventory item not found'; end if;
  if item_status = 'DISABLED' then raise exception 'Cannot Stock In on a disabled item'; end if;

  insert into public.inventory_movements
    (item_id, amount, movement_date, reference, actor, actor_id,
     intake_branch_or_station, purchase_reference, idempotency_key)
  values
    (p_item_id, p_amount, p_movement_date, nullif(trim(p_reference), ''),
     p_actor, p_actor_id, nullif(trim(p_intake_branch_or_station), ''),
     nullif(trim(p_reference), ''), p_idempotency_key)
  returning id, inventory_movements.created_at into movement_id_value, created_at_value;

  update public.inventory set quantity = quantity + p_amount where id = p_item_id
    returning quantity into new_quantity_value;

  return query select movement_id_value, p_item_id, p_amount, p_movement_date,
    nullif(trim(p_reference), ''), p_actor, created_at_value, new_quantity_value;
end;
$$;

grant execute on function public.stock_in(uuid, numeric, date, text, text, uuid, uuid, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
