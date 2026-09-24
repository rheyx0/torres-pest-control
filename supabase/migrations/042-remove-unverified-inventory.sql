-- Remove inventory records without an approved service branch.
-- Preserve any item referenced by movement history so historical records remain intact.

delete from public.inventory item
where item.intake_branch_or_station is null
   or item.intake_branch_or_station not in (
     'Davao Main Service Branch',
     'Samal Service Branch',
     'Digos Service Branch',
     'Dumaguete Service Branch',
     'Panglao Service Branch',
     'Cebu Service Branch'
   )
and not exists (
  select 1
  from public.inventory_movements movement
  where movement.item_id = item.id
);
