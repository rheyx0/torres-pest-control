-- ---------------------------------------------------------------------------
-- Migration 064 - The area on a service contract.
--
-- Run after 063-contracts-and-site-monitoring.sql.
--
-- A contract for a per-sqm service (060) needs the size of the place to price
-- a visit, as a quote does: contracts.area_sqm. The app works the price per
-- visit out from it (area x rate, never below the minimum charge) and the
-- printed contract shows it. It is optional: a contract for flat-priced
-- services has none.
--
-- This is now the source of truth for save_contract (from 063, which ignores
-- the area). Re-running 063 restores that version; re-run 064 after it.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

alter table public.contracts add column if not exists area_sqm numeric;

alter table public.contracts drop constraint if exists contracts_area_check;
alter table public.contracts add constraint contracts_area_check
  check (area_sqm is null or (area_sqm > 0 and area_sqm <= 1000000));

-- save_contract: 063's, plus area_sqm.
drop function if exists public.save_contract(uuid, jsonb);

create function public.save_contract(p_contract_id uuid, p_contract jsonb)
returns public.contracts
language plpgsql security definer set search_path = public
as $$
declare
  target public.contracts;
  v_client uuid := (p_contract->>'client_id')::uuid;
  v_quote uuid := nullif(p_contract->>'quote_id', '')::uuid;
  v_services uuid[] := coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_contract->'service_ids', '[]'::jsonb))),
    '{}'::uuid[]
  );
  v_count integer := nullif(p_contract->>'visit_count', '')::integer;
  v_starts date := nullif(p_contract->>'starts_on', '')::date;
  v_ends date := nullif(p_contract->>'ends_on', '')::date;
  v_price numeric := coalesce(nullif(p_contract->>'price_per_visit', '')::numeric, 0);
  v_area numeric := nullif(p_contract->>'area_sqm', '')::numeric;
  v_names text;
begin
  perform public.assert_billing_office();

  if v_client is null or not exists (select 1 from public.clients c where c.id = v_client) then
    raise exception 'Choose the client for this contract.';
  end if;
  if nullif(trim(coalesce(p_contract->>'title', '')), '') is null then raise exception 'Give the contract a title.'; end if;
  if cardinality(v_services) = 0 then raise exception 'Choose the services the contract covers.'; end if;
  if nullif(trim(coalesce(p_contract->>'frequency', '')), '') is null then raise exception 'Choose how often the visits are.'; end if;
  if v_starts is null then raise exception 'Enter the start date.'; end if;
  if v_count is null and v_ends is null then raise exception 'Enter the number of visits or the end date.'; end if;
  if v_ends is not null and v_ends < v_starts then raise exception 'The end date is before the start date.'; end if;
  if v_area is not null and (v_area <= 0 or v_area > 1000000) then raise exception 'Enter an area between 1 and 1,000,000 sqm.'; end if;
  if v_price < 0 or v_price > 999999.99 then raise exception 'Enter a price per visit up to ₱999,999.99.'; end if;
  if v_quote is not null and not exists (select 1 from public.quotes q where q.id = v_quote and q.client_id = v_client) then
    raise exception 'That quote is for a different client.';
  end if;

  select string_agg(s.name, ', ' order by array_position(v_services, s.id)) into v_names
  from public.services s where s.id = any(v_services);

  if p_contract_id is null then
    insert into public.contracts (
      client_id, quote_id, title, service_ids, service_names, frequency, visit_count, starts_on, ends_on,
      area_sqm, price_per_visit, billing_schedule, payment_terms, inclusions, cancellation_terms, notes, created_by
    )
    values (
      v_client, v_quote, trim(p_contract->>'title'), v_services, v_names, trim(p_contract->>'frequency'), v_count, v_starts, v_ends,
      v_area, round(v_price, 2), coalesce(p_contract->>'billing_schedule', 'PER_VISIT'), coalesce(p_contract->>'payment_terms', 'DUE_ON_RECEIPT'),
      nullif(trim(coalesce(p_contract->>'inclusions', '')), ''), nullif(trim(coalesce(p_contract->>'cancellation_terms', '')), ''),
      nullif(trim(coalesce(p_contract->>'notes', '')), ''), public.current_account_id()
    )
    returning * into target;
  else
    select * into target from public.contracts c where c.id = p_contract_id for update;
    if target.id is null then raise exception 'That contract was not found.'; end if;
    if target.status <> 'DRAFT' then
      raise exception 'Contract % is %: its terms are what was signed and can no longer be changed.', target.reference, lower(target.status);
    end if;
    update public.contracts c set
      client_id = v_client, quote_id = v_quote, title = trim(p_contract->>'title'),
      service_ids = v_services, service_names = v_names, frequency = trim(p_contract->>'frequency'),
      visit_count = v_count, starts_on = v_starts, ends_on = v_ends, area_sqm = v_area, price_per_visit = round(v_price, 2),
      billing_schedule = coalesce(p_contract->>'billing_schedule', 'PER_VISIT'),
      payment_terms = coalesce(p_contract->>'payment_terms', 'DUE_ON_RECEIPT'),
      inclusions = nullif(trim(coalesce(p_contract->>'inclusions', '')), ''),
      cancellation_terms = nullif(trim(coalesce(p_contract->>'cancellation_terms', '')), ''),
      notes = nullif(trim(coalesce(p_contract->>'notes', '')), ''),
      -- A draft moved to another client can't keep the first client's file.
      signed_document_id = case when v_client = target.client_id then target.signed_document_id end,
      updated_at = now()
    where c.id = target.id
    returning * into target;
  end if;
  return target;
end;
$$;

grant execute on function public.save_contract(uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
