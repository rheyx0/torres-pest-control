-- Migration 025 - Complete inspection and treatment reports.

alter table public.appointment_reports
  add column if not exists treatment_performed text;

alter table public.appointment_reports
  add column if not exists recommendations text;

alter table public.appointment_reports
  add column if not exists follow_up_date date;

drop function if exists public.submit_appointment_report(uuid, text);

create or replace function public.submit_appointment_report(
  p_appointment_id uuid,
  p_findings text,
  p_treatment_performed text,
  p_recommendations text,
  p_follow_up_date date
)
returns public.appointment_reports
language plpgsql security definer set search_path = public
as $$
declare report_row public.appointment_reports;
declare actor_id uuid;
begin
  if not public.has_role_table_session() then raise exception 'Not signed in.'; end if;
  if nullif(trim(p_findings), '') is null then raise exception 'Inspection findings are required.'; end if;
  if nullif(trim(p_treatment_performed), '') is null then raise exception 'Treatment performed is required.'; end if;
  select r.id into actor_id from public.role_account_for_session(nullif(current_setting('request.headers', true)::json->>'x-session-token', '')::uuid) r limit 1;
  insert into public.appointment_reports (appointment_id, findings, treatment_performed, recommendations, follow_up_date, submitted_by)
  values (p_appointment_id, trim(p_findings), trim(p_treatment_performed), nullif(trim(p_recommendations), ''), p_follow_up_date, actor_id)
  on conflict (appointment_id) do update set findings = excluded.findings, treatment_performed = excluded.treatment_performed,
    recommendations = excluded.recommendations, follow_up_date = excluded.follow_up_date, submitted_by = excluded.submitted_by, submitted_at = now()
  returning * into report_row;
  update public.appointments set status = 'Completed' where id = p_appointment_id;
  return report_row;
end;
$$;

grant execute on function public.submit_appointment_report(uuid, text, text, text, date) to anon, authenticated;
notify pgrst, 'reload schema';
