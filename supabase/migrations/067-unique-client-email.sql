-- ---------------------------------------------------------------------------
-- Migration 067 - one email per client.
--
-- Run after 066-sprint-4.sql.
--
-- Quotes, invoices, contracts and receipts are sent to a client's email
-- (Sprint 4), so two clients sharing one address would receive each other's
-- paperwork. No rule stopped it: the create and edit forms both saved a
-- client with an email another client already had.
--
--   1. Emails are compared trimmed and ignoring case ("Juan@Gmail.com " is
--      juan@gmail.com). A blank email is not an email, so any number of
--      clients may have none.
--   2. clients_email_unique() (BEFORE INSERT OR UPDATE OF email) refuses an
--      email another client already uses, archived clients included, naming
--      that client. An update that leaves the email as it was is let through,
--      so a pair of clients who already share an address can still be edited
--      until one of them is corrected.
--   3. Where no two clients share an email any more, the unique index
--      clients_email_unique_idx is created as well (it also closes the race of
--      two saves at the same instant). Where some still do, it is skipped with
--      a notice listing them; fix those (the Clients page lists them too) and
--      run this file again to add the index.
--
-- To see the clients who share an email:
--   select lower(btrim(email)) as email, string_agg(coalesce(reference, name), ', ') as clients
--   from clients where nullif(btrim(email), '') is not null
--   group by lower(btrim(email)) having count(*) > 1;
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

create or replace function clients_email_unique()
returns trigger
language plpgsql
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_other record;
begin
  -- Store what was typed without the stray spaces.
  new.email := nullif(btrim(coalesce(new.email, '')), '');

  if v_email = '' then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_email = lower(btrim(coalesce(old.email, ''))) then
    return new;
  end if;

  select id, name, reference, status into v_other
  from clients
  where id <> new.id
    and lower(btrim(email)) = v_email
  limit 1;

  if found then
    raise exception 'That email is already used by % (%)%. Each client needs their own email.',
      v_other.name,
      coalesce(v_other.reference, 'another client'),
      case when v_other.status::text = 'ARCHIVED' then ', an archived client' else '' end
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_email_unique on clients;
create trigger clients_email_unique
  before insert or update of email on clients
  for each row execute function clients_email_unique();

do $$
declare
  v_shared text;
begin
  select string_agg(format('%s (%s)', email, names), '; ')
  into v_shared
  from (
    select lower(btrim(email)) as email, string_agg(coalesce(reference, name), ', ' order by reference) as names
    from clients
    where nullif(btrim(email), '') is not null
    group by lower(btrim(email))
    having count(*) > 1
  ) shared;

  if v_shared is null then
    create unique index if not exists clients_email_unique_idx
      on clients (lower(btrim(email)))
      where nullif(btrim(email), '') is not null;
  else
    raise notice 'clients_email_unique_idx not created yet: these emails belong to more than one client: %. Give each client their own email, then run 067 again.', v_shared;
  end if;
end;
$$;
