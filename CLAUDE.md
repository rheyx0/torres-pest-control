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
- **`src/context/*`** — one provider per domain (`Auth`, `Clients`, `Inventory`, `Scheduling`, `Notifications`, `Toast`), nested in that order in `App.jsx`. They hold the fetched lists, expose `refresh()` plus mutators, and are the only consumers of services.
- **`src/hooks/*`** — thin wrappers (`useAuth`, `useClients`, `useInventory`, `useUsers`, `useTreatmentMethods`, `useLogs`) that re-export a context and add derived helpers. Components should use these, not `useXContext` directly.
- **`src/utils/constants.js`** — single source of truth for roles, statuses, allowed upload types/sizes, document and attachment categories, and `COMPANY` letterhead details. Several of these mirror SQL `check` constraints or trigger logic; changing one side requires a migration on the other (`APPOINTMENT_STATUS_TRANSITIONS` ↔ migration 027, `DOCUMENT_CATEGORIES` ↔ 031, `ATTACHMENT_CATEGORIES` ↔ 029, `STOCK_OUT_REASONS` ↔ 040, `SERVICE_FREQUENCIES` ↔ 041).
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

On Supabase, pgcrypto lives in the `extensions` schema, while the six password functions are `security definer set search_path = public` — so `crypt()` is invisible inside them and every login fails with 42883. Migration 043 appends `extensions` to their search_path. Re-run 043 after re-running any migration that recreates an auth function (011, 013, 015, 016, 018, 019, 037), because `create or replace function` restores the narrow path.

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