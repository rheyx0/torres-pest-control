# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Internal web app for a pest-control business: role-based accounts, client profiles and documents, chemical/equipment inventory, and appointment scheduling with technician service reports. Create React App (react-scripts 5) + React 19 + react-router-dom v6, with Supabase as the entire backend (Postgres + PostgREST RPCs + Storage). There is no custom server.

## Commands

```bash
npm start                 # dev server on :3000
npm run build             # production build to build/
npm test                  # jest in watch mode
CI=true npm test          # single non-interactive run
CI=true npm test -- --testPathPattern=App          # one test file
CI=true npm test -- -t "renders the app shell"     # one test by name
```

There is no lint script; ESLint runs through `react-scripts` during `start`/`build` (config is the `eslintConfig` block in `package.json`).

`tailwind.config.js` is an empty leftover — Tailwind is not installed. Styling is inline `style={{...}}` objects sourced from `src/styles/theme.js` (`colors`, `card`, `inputStyle`, `pageShell`, `primaryButton`), plus `src/styles/globals.css`.

### Environment

`.env.local` (gitignored) must define `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_PUBLISHABLE_KEY`. Without them `isSupabaseConfigured` is false and `App.jsx` renders a setup screen instead of the router — the placeholder check rejects any value containing `your-`.

## Architecture

Layering is strict and worth preserving; each layer only talks to the one below it.

```
pages/ + components/   →  hooks/  →  context/  →  services/  →  supabase
```

- **`src/services/*`** — the only modules that import `supabase`. Each exports `mapXRow()` row→app-shape mappers, a `describeError()` that flattens `{message, details, hint}` into one string, and async functions returning `{ …data, error }` objects rather than throwing. Writes almost always go through a Postgres RPC (`create_appointment`, `submit_appointment_report`, `stock_out_batch`, `create_role_account`, `check_login`, …), not direct table writes, because the RPCs are security-definer and carry the authorization checks.
- **`src/context/*`** — one provider per domain (`Auth`, `Toast`, `Clients`, `Inventory`, `Services`, `Scheduling`, `Notifications`), nested in that order in `App.jsx`. They hold the fetched lists, expose `refresh()` plus mutators, and are the only consumers of services.
- **`src/hooks/*`** — thin wrappers (`useAuth`, `useClients`, `useInventory`, `useServices`, `useUsers`, `useLogs`) that re-export a context and add derived helpers. Components should use these, not `useXContext` directly.
- **`src/utils/constants.js`** — single source of truth for roles, statuses, allowed upload types/sizes, document and attachment categories, and `COMPANY` letterhead details. Several of these mirror SQL `check` constraints or trigger logic; changing one side requires a migration on the other (`APPOINTMENT_STATUSES` / `APPOINTMENT_STATUS_TRANSITIONS` ↔ migrations 027 and 048, `DOCUMENT_CATEGORIES` ↔ 031, `ATTACHMENT_CATEGORIES` ↔ 029, `STOCK_OUT_REASONS` ↔ 040, `SERVICE_FREQUENCIES` ↔ 041, `LIMITS` ↔ 047).
- **`src/utils/stockMovements.js`** — reads the stock-out log by reason (filter, counts, missing/damaged totals, per-item recent losses) for the Inventory history chips and item badges. Pure, unit-tested.
- **`src/utils/dispatch.js`, `clientTimeline.js`, `inventoryWatch.js`, `techDay.js`** — pure helpers behind the Today dashboard (dispatch board, Needs attention), the client profile timeline, the Inventory Watch column and the technician's phone day / visit flow. Unit-tested.
- **`src/utils/units.js`** — the gallons-to-litres conversion table behind Stock In. The app converts before calling `stock_in_batch`, which stores both the entered figure and the base-unit `amount`; nothing downstream has to know a conversion happened.

### Auth and permissions

Supabase Auth is deliberately **not** used. `check_login()` validates credentials against the app's own `public.users` table and issues a row in `sessions`; the token is kept in `localStorage` under `torres_session` and attached to every request as an `x-session-token` header — see `setSupabaseSessionToken()` in `src/services/supabaseClient.js`, which rebuilds the client whenever the session changes. `AuthContext` re-validates the token every 3 seconds so a deactivated account is kicked out almost immediately.

Authorization exists in two places and both must be updated together:

- **UI**: the role × subsystem matrix in `src/utils/permissions.js` (`can(role, subsystem, action)`), used by `RoleBasedRoute` for routes and by components to hide controls. Routes are wrapped by the local `Guarded` helper in `App.jsx` (`ProtectedRoute` → `AccountsGate` → `Layout` → optional `RoleBasedRoute`).
- **Database**: RLS policies gated on `has_role_table_session()` / `current_account_role()` (migrations 018 and 030). The matrix alone is only a UI affordance.

Roles are `ADMIN`, `STAFF`, `TECHNICIAN`.

### Supabase SQL

Apply `supabase/schema-v2.sql` first (idempotent, replaces the v1 `schema.sql`), then every file in `supabase/migrations/` in **numeric order** — later migrations replace earlier definitions of the same function, so order is load-bearing (e.g. 022 → 024 → 027 → 041 for `create_appointment`/`update_appointment`, where 041 is the current source of truth; 026 → 036 → 040 for `stock_out_batch`). Migrations are written to be re-runnable: they `drop` objects before recreating them. After applying SQL, reload PostgREST's schema cache if the app reports a missing RPC.

Migration 041 gives an appointment a crew (`appointment_technicians`) and keeps `appointments.technician_id` as its LEAD, synced by a trigger — so a query asking for "the technician" still answers truthfully, it just answers "who leads it". Read the crew through `crewOf()` / `isAssignedTo()` in `src/utils/scheduling.js` rather than comparing `technicianId` directly.

Note `013` exists twice (`013-audit-fixes.sql`, `013-user-profile-avatars.sql`), `039` likewise (`039-treatment-methods-admin.sql`, `039-admin-avatar-management.sql` — they create disjoint objects, so the shared number is harmless), and the header of `039-treatment-methods-admin.sql` documents a superseded `038-treatment-methods-admin.sql` draft. Read the header comment of a migration before touching it — they explain the reasoning and the ordering traps.

Migration 047 adds the service catalog (`services`, `service_materials`, `set_service_materials()`), links `appointments.service_id` (`on delete set null`), and is now the source of truth for `create_appointment` / `update_appointment` (041's signatures plus `p_service_id`, a ₱999,999.99 price cap, and refusing to book or move a visit into the past — a past visit can still be edited in place). `appointments.service_type` stays the name-as-booked snapshot, so deleting or renaming a service never rewrites history; the service's materials only PREFILL the appointment Stock-Out tab and the technician confirms them. A BEFORE INSERT trigger on `inventory_movements` refuses future-dated movements (by the Asia/Manila date), more than 100,000 units, or a unit cost over 999,999.99 — one rule for every stock path. Re-running 041 restores the unguarded appointment functions; re-run 047 after it.

Migration 048 adds the `In progress` status and `appointments.started_at`, set only by `start_visit()` when a technician starts a visit on site (their own visit, on its scheduled Manila date). It recreates `update_appointment()` from 047 with `In progress` added to its status list, so **048 is now the source of truth for `update_appointment`**: re-running 047 (or 041) restores the old list, so re-run 048 after either. The app falls back to selecting appointments without `started_at` if 048 has not been applied yet.

Migration 049 is now the source of truth for `stock_in_batch` (recreated from 040). A chemical's expiry is entered per delivery on Stock In, not on Add item: each `p_items` entry may carry `expiration_date`, which overwrites `inventory.expiration_date` (a delivery without one leaves it alone), is stored on the IN movement, and is refused if earlier than the delivery date. It is a plain overwrite, not per-lot tracking, so Edit item keeps the field for corrections. Re-running 040 restores the version that ignores the expiry; re-run 049 after it.

Migration 050 gives every appointment a `reference` (`TPC-V-00001`, from a sequence, unique; read it through `appointmentReference()` in `src/utils/scheduling.js`, which falls back to the short uuid before 050) and is now the source of truth for `submit_appointment_report`: treatment methods are retired, and the report instead records the service performed via `p_service_id`, which sets `appointments.service_id` and snapshots the service's name into `service_type`. The service is chosen in the Report tab and the technician's Visit flow, no longer in Overview. The rule "record the treatment" now accepts the visit's service or the notes. The `treatment_methods` table and column are left in place for old reports. Re-running 038 restores the methods-only version; re-run 050 after it.

Migration 051 lets a visit carry several services and is now the source of truth for `submit_appointment_report` (050's signature with `p_service_ids uuid[]` in place of `p_service_id`). `appointment_services` holds the list in order with a name snapshot; `appointments.service_id` stays the first and `service_type` becomes the names joined with ", ", so every existing reader shows the whole list unchanged. Read a visit's services through `servicesOf()` and merge their materials with `combineServices()` (both in `src/utils/scheduling.js`). Services are ticked in the Report tab and the Visit flow's Treatment step; there is no treatment-notes box any more (old notes are sent back unchanged). The app falls back to the single `service_id` if 051 has not been applied. Re-running 050 restores the single-service function; re-run 051 after it.

Migration 052 adds recurring plans and multi-day jobs, and is now the source of truth for `submit_appointment_report` (re-run 052 after re-running 050 or 051). `appointment_plans` (kind `RECURRING` | `MULTI_DAY`) groups visits through `appointments.plan_id` / `plan_position`; `day_done_at` closes a multi-day job's earlier day. Every booking with a plan — and a single visit with several services — goes through `book_appointments()`, which creates each visit with 047's `create_appointment()` so every guard still applies, in one transaction; the dates are computed in the app (`src/utils/plans.js`: `recurringDates`, `splitIntoDays`, `checkVisits`, fix suggestions) and booked exactly as shown. A multi-day job is charged once (price on Day 1), and only its last live day takes the report; signing completes every day. A trigger keeps a job's days in order. Plan edits are `update_plan_future`, `cancel_plan_remaining`, `add_plan_visit`, `finish_job_here`, `finish_job_day`. "Daily" is a frequency. Whether a report is still owed is `reportOwed()`, and whether a visit is done is `visitClosed()` (both in `src/utils/scheduling.js`), so a closed job day is never flagged. Reminders are `bookingReminders()` in `src/utils/dispatch.js` — the old per-visit re-service rule plus `plansEnding()` renewals — on one 14-day window (`RESERVICE_WINDOW_DAYS`). The UI pieces are `PlanDates` (the form's date list) and `PlanPanel` (the plan section in the appointment detail). The app loads without 052 (the plan columns and table are optional in `appointmentService.js`), but booking a plan needs it.

Migration 053 adds "Don't renew": `appointment_plans.renewal_declined_at`, written only by `set_plan_renewal(plan, renew)` (office-only, recurring plans only). While it is set `plansEnding()` skips the plan, so a contract the client isn't continuing stops asking to be renewed; the visits still booked are untouched. The button sits on the renewal row in the Schedule side panel and in `PlanPanel`, which also offers "Remind me again". The app reads plans without the column if 053 has not been applied.

Migration 046 is the current source of truth for `check_login`, `reset_password` and `request_password_reset`. Both reset paths used to write `status = 'PENDING'` unconditionally, and `check_login` admits PENDING — so changing a deactivated account's password put it back in business, which the forgot-password flow let the deactivated user do for themselves. 046 keeps INACTIVE where it finds it and issues no temporary password for an INACTIVE account. Re-running 037 or 044 restores the hole; re-run 046 after either.

On Supabase, pgcrypto lives in the `extensions` schema, while the six password functions are `security definer set search_path = public` — so `crypt()` is invisible inside them and every login fails with 42883. Migration 043 appends `extensions` to their search_path. Re-run 043 after re-running any migration that recreates an auth function (011, 013, 015, 016, 018, 019, 037), because `create or replace function` restores the narrow path.

An account's role is which of `admins` / `staff` / `technicians` its row sits in, so a role change means moving the row and keeping its id — `appointments.technician_id`, `sessions.user_id` and the rest point at that id and none of them is a foreign key. Migration 045's `move_account_role()` does that in one transaction; `update_role_account()` delegates to it when `new_role` differs. Moves into or out of ADMIN are refused (migration 015's rule), as is moving a technician who still holds live appointments.

Demo data is `supabase/seed-demo-data.sql`: it clears the records and seeds clients, inventory, appointments, reports and stock movements, and never touches accounts. It is complete on its own and seeds no files, because SQL cannot put bytes in a Storage bucket. At ~58 KB it can exceed what the Supabase SQL Editor's paste box accepts, which surfaces as "syntax error at end of input" on an empty line; `supabase/seed-parts/1..5` is the same SQL split into pasteable pieces, each guarded so running them out of order reports it rather than corrupting the data. `supabase/seed-demo-files.mjs` is an optional extra that generates and uploads placeholder PDFs/PNGs and writes the document, attachment and signature rows pointing at them; nothing depends on it. Neither lives in `migrations/` — the seed truncates, and a truncate has no business in a sequence applied to production.

Storage buckets are private; files are read through short-lived signed URLs minted at click time (`SIGNED_URL_TTL_SECONDS`), never stored. Buckets: `client-documents`, `report-attachments`, signatures, avatars.

## Dead code in the tree

`src/` contains an older, unreferenced copy of much of the app alongside the live one. Nothing in these is imported by `App.jsx` or its tree:

- `src/pages/scheduling/`, `src/pages/accounts/`, `src/pages/auth/`, `src/pages/clients/`, `src/pages/dashboard/` (the live pages are the flat `.jsx` files directly in `src/pages/`)
- `src/pages/{AppointmentDetail,AppointmentList,CreateAppointment,EditAppointment,Dashboard}.js`
- `src/components/Sidebar.js` (live one is `src/components/layout/Sidebar.jsx`)
- `src/lib/supabaseClient.js` (live one is `src/services/supabaseClient.js`)
- `src/data/mockData.js` — imported only by the dead pages and by `logService.js`
- root-level `rewrite.js`, `rewrite copy.js`, and `s` — one-off codemod scripts and a stray diff dump

Edit the live files; don't mirror changes into the copies.