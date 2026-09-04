-- ============================================================================
-- Migration 002 — Seed demo clients
-- ============================================================================
--
-- Optional. Run after 001-clients-and-documents.sql.
--
-- These are the four demo profiles that used to live in src/data/mockData.js
-- as `initialClients`. They moved here because clients are Postgres rows now,
-- so seed data belongs in the database rather than the JS bundle.
--
-- Their document lists are NOT seeded. The old mock documents all had
-- `url: "#"`, so Preview and Download were no-ops on every one of them —
-- there were never any real files behind them. Upload something through the
-- app to exercise the Storage path end to end.
--
-- Idempotent: each row is inserted only if no client with that email exists,
-- so re-running is a no-op.
-- ============================================================================

insert into clients (name, phone, email, address, source, classification, created_at, updated_at)
select v.name, v.phone, v.email, v.address, v.source, v.classification::client_classification,
       v.created_at::timestamptz, v.updated_at::timestamptz
from (values
  ('Bahay ng Baryo Homes',   '+63 917 223 4432', 'admin@bahayngbaryo.com',
   'Blk 11, Lot 5, Marfori, Davao City', 'Walk-in',  'RESIDENTIAL',
   '2026-07-08T09:00:00Z', '2026-08-18T09:00:00Z'),

  ('Golden Harvest Foods',   '+63 921 768 9920', 'ops@goldenharvestfoods.ph',
   'Puan, Davao City',                    'Referral', 'COMMERCIAL',
   '2026-06-18T13:15:00Z', '2026-08-18T13:15:00Z'),

  ('Arawan Logistics Center','+63 910 553 1133', 'warehouse@arawanlogistics.com',
   'Km. 9, Panacan, Davao City',          'Referral', 'WAREHOUSE_STORAGE',
   '2026-07-20T10:00:00Z', '2026-08-18T10:00:00Z'),

  ('Davao Garden Villas',    '+63 917 999 2255', 'manager@davaogardenvillas.com',
   'Bajada, Davao City',                  'Walk-in',  'HOSPITALITY',
   '2026-08-02T08:35:00Z', '2026-08-18T08:35:00Z')
) as v(name, phone, email, address, source, classification, created_at, updated_at)
where not exists (
  select 1 from clients c where lower(c.email) = lower(v.email)
);

-- Verify:
--   select name, classification, source from clients order by created_at;
