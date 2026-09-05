-- Migration 012: prevent future duplicate inventory identities.
-- Existing duplicate rows are left intact so this migration can be applied
-- safely. They can be reviewed and merged or renamed separately.

drop index if exists public.inventory_chemical_identity_idx;
drop index if exists public.inventory_equipment_identity_idx;
drop index if exists public.inventory_material_identity_idx;

create or replace function public.inventory_identity_key(
  p_name text,
  p_type inventory_type,
  p_unit text,
  p_chemical_type chemical_type,
  p_safety_level text,
  p_hazard_rating text,
  p_manufacturer text,
  p_model text,
  p_serial_number text,
  p_material_category material_category
)
returns text
language sql
stable
as $$
  select concat_ws('|',
    lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')),
    coalesce(p_type::text, ''),
    lower(regexp_replace(btrim(coalesce(p_unit, '')), '\s+', ' ', 'g')),
    case when p_type = 'CHEMICAL' then coalesce(p_chemical_type::text, '') else '' end,
    case when p_type = 'CHEMICAL' then lower(regexp_replace(btrim(coalesce(p_safety_level, '')), '\s+', ' ', 'g')) else '' end,
    case when p_type = 'CHEMICAL' then lower(regexp_replace(btrim(coalesce(p_hazard_rating, '')), '\s+', ' ', 'g')) else '' end,
    case when p_type = 'EQUIPMENT' then lower(regexp_replace(btrim(coalesce(p_manufacturer, '')), '\s+', ' ', 'g')) else '' end,
    case when p_type = 'EQUIPMENT' then lower(regexp_replace(btrim(coalesce(p_model, '')), '\s+', ' ', 'g')) else '' end,
    case when p_type = 'EQUIPMENT' then lower(regexp_replace(btrim(coalesce(p_serial_number, '')), '\s+', ' ', 'g')) else '' end,
    case when p_type = 'MATERIAL' then coalesce(p_material_category::text, '') else '' end
  );
$$;

create or replace function public.prevent_duplicate_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  identity_key text;
  existing_id uuid;
begin
  identity_key := public.inventory_identity_key(
    new.name, new.type, new.unit, new.chemical_type, new.safety_level,
    new.hazard_rating, new.manufacturer, new.model, new.serial_number,
    new.material_category
  );

  -- Do not block metadata-only edits to records that were already duplicated.
  if tg_op = 'UPDATE' and identity_key = public.inventory_identity_key(
    old.name, old.type, old.unit, old.chemical_type, old.safety_level,
    old.hazard_rating, old.manufacturer, old.model, old.serial_number,
    old.material_category
  ) then
    return new;
  end if;

  -- Serialize matching identities so concurrent submissions cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended(identity_key, 0));

  select id into existing_id
  from public.inventory
  where id is distinct from new.id
    and public.inventory_identity_key(
      name, type, unit, chemical_type, safety_level, hazard_rating,
      manufacturer, model, serial_number, material_category
    ) = identity_key
  limit 1;

  if existing_id is not null then
    raise exception 'This item already exists. Use Stock In to add quantity instead.'
      using errcode = '23505', detail = format('Existing inventory item: %s', existing_id);
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_prevent_duplicates on public.inventory;
create trigger inventory_prevent_duplicates
before insert or update on public.inventory
for each row execute function public.prevent_duplicate_inventory();
