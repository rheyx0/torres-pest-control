-- ---------------------------------------------------------------------------
-- Formal names for the defense (Nov 2026). Run once in the Supabase SQL Editor.
--
-- Changes only the NAME people see. Usernames, emails of accounts and
-- passwords stay exactly as they are, so everyone signs in as before.
-- Old activity-log lines keep the old names (the log cannot be edited).
-- Running it again changes nothing.
-- ---------------------------------------------------------------------------

begin;

-- Accounts (display name only) ------------------------------------------------
update public.admins      set name = 'Dennis Torres'      where name = 'Dennis Tatsumaki1';
update public.staff       set name = 'Dennis Torres'      where name = 'Dennis Tatsumaki1 Dennis Tatsumaki1';
update public.staff       set name = 'Rhey Gamul'         where name = 'rhey gamul';
update public.staff       set name = 'Herald Bandalan'    where name = 'He Rald';
update public.staff       set name = 'Andrea Alcantara'   where name = 'a a';
update public.staff       set name = 'Grace Gonzales'     where name = 'GG gg';
update public.staff       set name = 'Julius Dimaculangan' where name = 'Judas Judas';
update public.staff       set name = 'Patricia Santos'    where name = 'pestStaff';
update public.staff       set name = 'Teresa Estrada'     where name = 'T Est';
update public.staff       set name = 'Sofia Tan'          where name = 'Test Account';
update public.staff       set name = 'Fernando Cruz'      where name = 'test four';
update public.technicians set name = 'Jeff Baluyot'       where name = 'jeff baluyot';
update public.technicians set name = 'Clizfel Testa'      where name = 'Clizfel Testaclizfel@gmail.com';
update public.technicians set name = 'Bruno Bantilan'     where name = 'Bruce Banner';
update public.technicians set name = 'Pedro Pilapil'      where name = 'Pewdi Pie';
update public.technicians set name = 'Samuel Tolentino'   where name = 'Skibidi Toilet';
update public.technicians set name = 'Teodoro Estrada'    where name = 'T Est';
update public.technicians set name = 'Tomas Aquino'       where name = 'Test Account';
update public.technicians set name = 'Ramil Tecson'       where name = 'test three tech';
update public.technicians set name = 'Paolo Esteban'      where name = 'pestTech';

-- Clients made while testing ------------------------------------------------------
update public.clients set name = 'Rosario Mendoza', email = 'rosario.mendoza@example.com',
       address = 'Blk 2 Lot 8, Catalunan Pequeño, Davao City'
 where name = '123asd';
update public.clients set name = 'Carlos Mendez', email = 'carlos.mendez@example.com',
       address = '15 Quimpo Blvd, Ecoland, Davao City'
 where name = 'Karl Hameed 60';
update public.clients set name = 'Clarissa Ocampo', email = 'clarissa.ocampo@example.com',
       address = '8 Juna Ave, Juna Subdivision, Matina, Davao City'
 where name = 'Clark Kent';

-- Service and stock item made while testing ------------------------------------------
update public.services set name = 'Residual Spray Treatment' where name = 'QA Claude Spray';
update public.services set name = 'Lawn Care Treatment'      where name = 'Toyi';
update public.inventory set name = 'Cypermethrin 5 EC'       where name = 'QA Claude Chem';

-- The service name is also copied onto visits and quotation/invoice lines.
update public.appointments      set service_type = replace(service_type, 'QA Claude Spray', 'Residual Spray Treatment') where service_type like '%QA Claude Spray%';
update public.appointments      set service_type = replace(service_type, 'Toyi', 'Lawn Care Treatment') where service_type ~ '\mToyi\M';
update public.appointment_services set service_name = 'Residual Spray Treatment' where service_name = 'QA Claude Spray';
update public.appointment_services set service_name = 'Lawn Care Treatment'      where service_name = 'Toyi';
update public.quote_lines   set description = replace(description, 'QA Claude Spray', 'Residual Spray Treatment') where description like '%QA Claude Spray%';
update public.invoice_lines set description = replace(description, 'QA Claude Spray', 'Residual Spray Treatment') where description like '%QA Claude Spray%';
update public.quote_lines   set description = replace(description, 'QA Claude Chem', 'Cypermethrin 5 EC') where description like '%QA Claude Chem%';
update public.invoice_lines set description = replace(description, 'QA Claude Chem', 'Cypermethrin 5 EC') where description like '%QA Claude Chem%';

select 'technicians' as list, string_agg(name, ', ' order by name) as names from public.technicians where status <> 'INACTIVE'
union all select 'staff', string_agg(name, ', ' order by name) from public.staff where status <> 'INACTIVE'
union all select 'admins', string_agg(name, ', ' order by name) from public.admins;

commit;
