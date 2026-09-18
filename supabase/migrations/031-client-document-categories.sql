-- ---------------------------------------------------------------------------
-- Migration 031 - Client document categories.
--
-- Run after 030-technician-schedule-scope.sql.
--
-- Mirrors what migration 029 did for report attachments, on the other side of
-- the split: client_documents holds the paperwork that belongs to the CLIENT
-- rather than to one visit — IDs, contracts, property documents, permits — and
-- until now they were one undifferentiated list of filenames.
--
-- Existing rows become OTHER, which renders in the catch-all section.
-- ---------------------------------------------------------------------------

alter table public.client_documents
  add column if not exists category text not null default 'OTHER';

alter table public.client_documents
  drop constraint if exists client_documents_category_check;

alter table public.client_documents
  add constraint client_documents_category_check
  check (category in ('CLIENT_ID', 'CONTRACT', 'PROPERTY', 'PERMIT', 'OTHER'));

-- No new grants or policies: insert is already granted to anon/authenticated
-- and the policy from migration 001 covers every column on the table.
