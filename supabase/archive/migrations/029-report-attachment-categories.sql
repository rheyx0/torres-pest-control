-- ---------------------------------------------------------------------------
-- Report attachment categories
--
-- Migration 028 gave appointments their own attachments, but as one flat list:
-- nothing recorded whether a photo was taken before or after treatment, or
-- whether a PDF was a signed service form. Field staff need that distinction on
-- the service record, so the file type is now captured at upload time.
--
-- Existing rows become OTHER, which renders without a tag.
-- ---------------------------------------------------------------------------

alter table public.appointment_report_attachments
  add column if not exists category text not null default 'OTHER';

alter table public.appointment_report_attachments
  drop constraint if exists appointment_report_attachments_category_check;

alter table public.appointment_report_attachments
  add constraint appointment_report_attachments_category_check
  check (category in ('BEFORE', 'AFTER', 'INSPECTION', 'SIGNED_FORM', 'TREATMENT_PROOF', 'OTHER'));

-- No new grants or policies: insert is already granted to anon/authenticated and
-- the "Report attachment access" policy from 028 covers every column.
