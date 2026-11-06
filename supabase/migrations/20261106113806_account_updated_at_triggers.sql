-- The account tables keep updated_at current, as clients, inventory and
-- appointments already do. The live project had these three triggers from an
-- early hand-run script; the files never did, so a database built from the
-- files left updated_at at its first value. Same on both after this.

create or replace trigger admins_set_updated_at
  before update on public.admins
  for each row execute function public.set_updated_at();

create or replace trigger staff_set_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();

create or replace trigger technicians_set_updated_at
  before update on public.technicians
  for each row execute function public.set_updated_at();
