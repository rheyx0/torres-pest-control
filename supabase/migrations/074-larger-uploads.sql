-- ---------------------------------------------------------------------------
-- Migration 074 - client documents and report attachments up to 10MB.
--
-- Run after 073-auto-book-follow-up.sql.
--
-- Client documents were capped at 2MB (001) and report attachments at 5MB
-- (028). A phone photo of a signed contract is often 3-5MB, so uploads were
-- refused. Storage enforces the bucket's file_size_limit itself, so the app's
-- MAX_DOCUMENT_BYTES / MAX_ATTACHMENT_BYTES (src/utils/constants.js) and these
-- limits move together. Profile pictures (avatars) keep their 2MB.
--
-- Only the size limit changes; the allowed file types stay as they are.
-- Re-running 001 or 028 puts the old limits back; re-run 074 after either.
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

update storage.buckets set file_size_limit = 10485760  -- 10MB
where id in ('client-documents', 'report-attachments');

-- Verify:
--   select id, file_size_limit from storage.buckets
--   where id in ('client-documents', 'report-attachments');   -- 10485760 each
