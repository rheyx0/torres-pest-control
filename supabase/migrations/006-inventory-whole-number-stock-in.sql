-- Stock In quantities are counts, so each movement must be a positive whole number.
-- `not valid` preserves any pre-existing decimal history while enforcing the rule
-- for all future inserts.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_amount_whole_number_check;

alter table public.inventory_movements
  add constraint inventory_movements_amount_whole_number_check
  check (amount = trunc(amount)) not valid;
