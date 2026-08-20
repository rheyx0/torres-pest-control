# Planned Supabase structure (not yet connected)

This describes how the app *would* be wired up to Supabase once you're ready.
Right now `src/App.js` still reads/writes everything through `localStorage` —
none of this is active yet, and there's no Prisma involved — just Supabase
directly (its SQL schema + the `@supabase/supabase-js` client).

## Folder structure once connected

```
torres-pest-control-main/
├── src/                       # existing React app — mostly unchanged
│   └── lib/
│       └── supabaseClient.js  # NEW — creates the Supabase JS client (url + anon key)
├── supabase/
│   └── schema.sql             # source of truth for table structure (this file)
├── .env.local                 # NEW — REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY
```

No separate backend server is needed — Supabase provides the API directly
(auto-generated REST + the `@supabase/supabase-js` client), so `App.js`'s
handlers would call Supabase directly instead of a custom Express API.

## Auth flow

1. Supabase Auth owns login/session — `supabase.auth.signInWithPassword({ email, password })`.
   No custom password-hashing code needed on our side.
2. At account-creation time (the admin-creates-staff/technician flow), whoever
   creates the account also sets `app_metadata.role` on that Supabase Auth user
   to `"ADMIN" | "STAFF" | "TECHNICIAN"` — this is what Row-Level Security
   policies check to enforce RBAC at the database level.
3. A matching row is inserted into `admins` / `staff` / `technicians`
   (whichever table matches the role) with `auth_user_id` set to the new
   Supabase Auth user's id, holding the profile fields (name, phone, status).
4. On login, the app reads `auth.jwt()`'s role claim to know which table to
   query for the full profile.

## What changes in `App.js` when this gets wired up

- `useState(() => localStorage.getItem(...))` → `useEffect` that calls
  `supabase.from('admins').select('*')` (etc.) on mount.
- `login(username, password)` → `supabase.auth.signInWithPassword(...)`.
- `addAdmin/addStaff/addTechnician` → `supabase.from('admins').insert(...)`
  (requires being logged in as an admin — enforced by the RLS policy, not
  just hidden UI).
- The `torres_*` localStorage keys go away entirely; Supabase is the
  persistence layer.

## Not done yet, on purpose

- No `@supabase/supabase-js` package installed.
- No `.env` file with real credentials.
- No Supabase project created.
- `supabase/schema.sql` hasn't been run anywhere yet.
- `src/App.js` is untouched by this — still 100% localStorage, as requested.
