-- ---------------------------------------------------------------------------
-- Migration 056 - Cover for a technician who cannot work.
--
-- Run after 055-chemical-batches.sql.
--
-- A technician calls in sick with five visits booked. Until now each visit was
-- opened and its crew edited one at a time, trying names until one did not
-- clash, and a visit in a recurring plan could only be changed with "Change
-- future visits", which also moved every later visit.
--
-- reassign_visits() takes the office's decision for each of the absent
-- technician's visits in one transaction:
--
--   ASSIGN      the crew becomes p_technician_ids (the cover plus whoever was
--               already with them). Every one of them must be free — the same
--               check as booking (assert_technicians_available, 041).
--   REMOVE      the absent technician leaves the crew; the rest carry on, or
--               the visit is left unassigned if there is no one else.
--   RESCHEDULE  as REMOVE, and the visit goes to Reschedule, so it shows in
--               the Schedule page's Unscheduled list to be moved.
--
-- Only the visits named are touched — never the rest of a plan. Each gets a
-- line in its notes saying who was covered and why, and every technician
-- newly on a visit gets a notification.
--
-- The visits are handled in order, so two of them given to the same person at
-- overlapping times are caught: the second sees the first already booked.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

drop function if exists public.reassign_visits(uuid, jsonb, text);

create function public.reassign_visits(
  p_absent_technician_id uuid,
  p_changes jsonb,
  p_reason text default null
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  change record;
  visit public.appointments;
  old_crew uuid[];
  new_crew uuid[];
  absent_name text;
  client_name text;
  note_line text;
  changed integer := 0;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if public.current_account_role() not in ('ADMIN', 'STAFF') then
    raise exception 'Only the office can reassign visits.';
  end if;
  if p_absent_technician_id is null then raise exception 'Choose the technician who is unavailable.'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'There are no visits to reassign.';
  end if;

  select t.name into absent_name from public.technicians t where t.id = p_absent_technician_id;
  if absent_name is null then raise exception 'That technician was not found.'; end if;

  for change in
    select entries.appointment_id, upper(entries.action) as action, entries.technician_ids
    from jsonb_to_recordset(p_changes) as entries(appointment_id uuid, action text, technician_ids uuid[])
  loop
    if change.action not in ('ASSIGN', 'REMOVE', 'RESCHEDULE') then
      raise exception 'Choose what happens to every visit.';
    end if;

    select * into visit from public.appointments a where a.id = change.appointment_id for update;
    if visit.id is null then raise exception 'One of those visits no longer exists. Reload and try again.'; end if;
    if visit.status not in ('Pending', 'Confirmed', 'Reschedule') then
      raise exception 'Visit % is already %; it cannot be reassigned here.', coalesce(visit.reference, visit.id::text), lower(visit.status);
    end if;

    select coalesce(array_agg(at.technician_id order by at.is_lead desc, at.assigned_at), '{}') into old_crew
    from public.appointment_technicians at where at.appointment_id = visit.id;
    if cardinality(old_crew) = 0 and visit.technician_id is not null then old_crew := array[visit.technician_id]; end if;
    if not (p_absent_technician_id = any(old_crew)) then
      raise exception '% is no longer on visit %. Reload and try again.', absent_name, coalesce(visit.reference, visit.id::text);
    end if;

    -- The crew as given, lead first; a name given twice counts once.
    new_crew := array(
      select ids.id
      from unnest(coalesce(change.technician_ids, '{}')) with ordinality as ids(id, ord)
      where ids.id is not null
      group by ids.id
      order by min(ids.ord)
    );

    if p_absent_technician_id = any(new_crew) then
      raise exception '% cannot cover their own visit.', absent_name;
    end if;
    if change.action = 'ASSIGN' and cardinality(new_crew) = 0 then
      raise exception 'Choose who covers visit %.', coalesce(visit.reference, visit.id::text);
    end if;
    if change.action <> 'ASSIGN' and exists (select 1 from unnest(new_crew) as n(id) where not (n.id = any(old_crew))) then
      raise exception 'Only an assigned visit can take someone new.';
    end if;

    perform public.assert_technicians_available(visit.id, new_crew, visit.scheduled_at, visit.duration_minutes);
    perform public.set_appointment_technicians(visit.id, case when cardinality(new_crew) = 0 then null else new_crew end);

    note_line := to_char(now() at time zone 'Asia/Manila', 'Mon DD') || ': ' || absent_name || ' unavailable'
      || coalesce(' (' || nullif(trim(coalesce(p_reason, '')), '') || ')', '') || ' — '
      || case change.action
           when 'ASSIGN' then 'covered by ' || coalesce((
             select string_agg(t.name, ', ') from public.technicians t
             where t.id = any(new_crew) and not (t.id = any(old_crew))), 'the crew')
           when 'REMOVE' then case when cardinality(new_crew) = 0 then 'left unassigned' else 'the rest of the crew carries on' end
           else 'marked for reschedule'
         end || '.';

    update public.appointments a
      set notes = concat_ws(E'\n', nullif(trim(coalesce(a.notes, '')), ''), note_line),
          status = case when change.action = 'RESCHEDULE' then 'Reschedule' else a.status end
      where a.id = visit.id;

    select c.name into client_name from public.clients c where c.id = visit.client_id;
    insert into public.notifications (recipient_id, appointment_id, message)
    select n.id, visit.id,
           'You are covering ' || absent_name || '''s visit for ' || coalesce(client_name, 'a client') || ' on '
           || to_char(visit.scheduled_at at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM') || '.'
    from unnest(new_crew) as n(id)
    where not (n.id = any(old_crew));

    changed := changed + 1;
  end loop;

  return changed;
end;
$$;

grant execute on function public.reassign_visits(uuid, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
