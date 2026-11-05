# The database (Supabase)

The app's whole backend is a Supabase project: PostgreSQL, its API, and
Storage for files. This folder holds everything that defines that database.

```
supabase/
├── migrations/      what the database is, one file per change (the Supabase CLI runs these)
│   └── 20261105000000_torres_database.sql   the whole database as of Nov 5, 2026
├── seed/            demo data and one-off data scripts (never migrations)
├── functions/       the forgot-password edge function
├── local/           running the database on a plain PostgreSQL (Technical Manual §4)
├── archive/         the old schema files and migrations 001–087, history only
└── config.toml      Supabase CLI settings
```

## How it works now

The database used to be built from `schema-v2.sql` plus 87 numbered
migrations, pasted into the SQL Editor by hand, where later files replaced
earlier ones and some had to be re-run after others. Those are now in
`archive/`. **The baseline is the database those files leave, in one file**,
checked to build exactly the same tables, functions, triggers, security
rules, permissions and storage policies.

Changes are run with the **Supabase CLI**, which records which migrations a
project has had, so a file is never skipped or run twice. Nothing has to be
installed: `npx` downloads the CLI when it is first used.

## One-time setup on each computer

```
npx supabase@2 login                                   opens the browser to sign in
npx supabase@2 link --project-ref zjrqrrogxxsrreduxbpd it asks for the database password
```

The database password is in the Supabase Dashboard (Project Settings →
Database). Type it when asked; **never put it in a file or a commit**.

## Once, on the live project: mark the baseline as already applied

The live project was built from the old files, so it already has everything
in the baseline. Tell the CLI so, instead of running it:

```
npx supabase@2 migration repair --status applied 20261105000000
npm run db:status        the baseline should show as applied on Remote
```

Only one person does this, once.

## Changing the database

1. `npm run db:new -- short_name`: a new empty file in `supabase/migrations/`.
2. Write the change in it, with a comment at the top saying what it does and why.
3. Try it on your local database (`npm run db:local -- --reset` runs every
   migration) or on a test project.
4. `npm run db:push` runs every migration the live project has not had yet.
5. Commit the migration together with the app code that needs it.

Rules:

- **Never edit a migration that has been pushed.** Fix it with a new one.
- One change per file.
- Demo or test data goes in `seed/`, never in a migration.
- No passwords, keys or connection strings in any file.

## A brand-new Supabase project (testing, or a new copy)

```
npx supabase@2 link --project-ref <the new project's ref>
npm run db:push          builds the whole database from the baseline
```

It has no accounts yet. Create the first admin in the SQL Editor, with your
own username and password:

```sql
insert into public.admins (name, email, username, password_hash, status, is_primary)
values ('Administrator', 'admin@example.com', 'admin',
        extensions.crypt('choose-a-password', extensions.gen_salt('bf')), 'ACTIVE', true);
```

Demo data: run `seed/seed-demo-data.sql` in the SQL Editor (or the five files
in `seed/seed-parts/` in order, if the editor refuses the long one).

## The files in `seed/`

| File | What it does |
|---|---|
| `seed-demo-data.sql` | Clears the records and loads demo clients, stock, visits and reports. Keeps accounts. |
| `seed-parts/1…5` | The same, in five pieces small enough for the SQL Editor. |
| `seed-demo-files.mjs` | Optional: uploads placeholder PDFs and photos for the demo records. |
| `reset-test-data.sql` | Clears every job and billing record for a clean test, keeping accounts, clients, services and stock. |
| `cleanup-absurd-amounts.sql` | Clears impossible costs left by old test data (see archived migration 058). |
