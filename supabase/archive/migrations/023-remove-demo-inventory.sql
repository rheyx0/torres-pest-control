-- Migration 023 - Remove the former demo inventory without deleting history.

alter table public.appointments
  add column if not exists pest_concern text;

notify pgrst, 'reload schema';

delete from public.inventory i
where lower(i.name) in (
  'fipronil granules',
  'residual spray concentrate',
  'fogging solution',
  'rodent bait blocks',
  'protective gloves (nitrile)',
  'pest inspection kit'
)
and not exists (
  select 1
  from public.inventory_movements movement
  where movement.item_id = i.id
);
