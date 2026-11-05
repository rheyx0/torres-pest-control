> **Archived draft (Aug 26, 2026).** Saved from an old local copy of the project. It describes the system as it was then (before Sprints 2–5) and is kept for history only; it is not the current Technical Manual.

# Torres Pest Control System — Technical Documentation

## 1. System overview

Torres Pest Control System is a client-side single-page application for managing user accounts, client profiles and client documents, and pest-control inventory. It is built with Create React App, React 19, React Router, and Supabase.

The active application is the repository root (`src/`, `public/`, `supabase/`, and `package.json`). An untracked `torres-pest-control/` directory is also present and appears to be a duplicate project tree. Do not treat it as the source of truth unless it is deliberately promoted and committed.

### Implemented modules

| Module | Capability |
| --- | --- |
| Authentication | Custom credential check through the `check_login` Supabase RPC; browser session persistence. |
| Accounts | Create, edit, activate/deactivate, reset password, and maintain the current user's profile. |
| Clients | Create, search, filter, view, and edit client profiles. |
| Documents | Upload, delete when permitted, preview, and download files stored in a private Supabase bucket. |
| Inventory | Maintain item profiles, stock in, disable/re-enable items, low-stock indication, and movement history. |
| Activity log | Browser-local event log used by the UI; it is not a shared database audit trail. |

Appointment-related files and dashboard placeholders exist, but scheduling is not registered in `App.jsx` and is not an active feature.

## 2. Running the project

### Prerequisites

- Node.js with npm
- A Supabase project configured with the SQL described in [Database setup](#8-database-setup)

### Environment variables

Create `.env.local` in the repository root. CRA only exposes variables prefixed with `REACT_APP_`.

```dotenv
REACT_APP_SUPABASE_URL=https://your-project-id.supabase.co
REACT_APP_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`src/services/supabaseClient.js` rejects missing or placeholder values and `App.jsx` shows an actionable setup screen instead of rendering a broken application. Never commit `.env` or `.env.local`.

### Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the development server at `http://localhost:3000`. |
| `npm test` | Launch the CRA/Jest test runner. |
| `npm run build` | Produce an optimized production bundle in `build/`. |

## 3. Architecture and request flow

```text
index.jsx
  → App.jsx (router and providers)
    → AuthProvider → ToastProvider → ClientsProvider → InventoryProvider
      → guarded page route → page/component → hook/context → service
        → Supabase PostgREST, RPC, or Storage
```

- **Pages** (`src/pages/`) are route-level views and coordinate forms, navigation, and toast messages.
- **Components** (`src/components/`) are reusable UI pieces. Layout, auth, client, user, dashboard, settings, and common components are separated by domain.
- **Contexts** own loaded state and mutation orchestration. They patch local state after successful server writes and write UI activity-log entries.
- **Hooks** are intentionally thin domain-facing interfaces over contexts.
- **Services** isolate Supabase queries, row-to-JavaScript mapping, payload construction, and error formatting.
- **Utilities** centralize permissions, validation, formatting, and shared constants.

## 4. Routing and access control

`src/App.jsx` is the route registry and provider composition point. `Guarded()` composes three protections:

1. `ProtectedRoute` redirects unsigned-in users to `/login` and retains the intended path.
2. `AccountsGate` waits until account data resolves the stored session to a full user.
3. `RoleBasedRoute` checks the permission matrix when a subsystem/action is supplied.

| Path | Page | Required access |
| --- | --- | --- |
| `/login` | `LoginPage` | Public |
| `/` | `DashboardPage` | Signed in |
| `/account` | `UserAccountPage` | Signed in |
| `/settings` | `SettingsPage` | `settings:view` |
| `/users`, `/users/new` | Account pages | `users:view` / `users:create` |
| `/clients`, `/clients/new`, `/clients/:id` | Client pages | `clients:view` / `clients:create` |
| `/inventory` | `InventoryPage` | `inventory:view` |

`src/utils/permissions.js` contains the canonical role/subsystem/action matrix. The sidebar derives visible navigation from the same `can()` function, preventing navigation and route behavior from drifting.

**Security boundary:** these checks are client-side controls. The currently active migration policies grant broad browser access to clients, documents, and inventory. They are not sufficient authorization against direct API calls; enforce role-aware rules/RPCs before production deployment.

## 5. Important source files and functions

### Application entry, authentication, and accounts

| File | Key responsibilities / functions |
| --- | --- |
| `src/index.jsx` | CRA entry point; mounts `App` in React `StrictMode`. |
| `src/App.jsx` | Registers routes, providers, configuration fallback, and `Guarded()`. |
| `src/services/supabaseClient.js` | Creates the guarded Supabase client and exports `isSupabaseConfigured`. Use this client in application services. |
| `src/services/authService.js` | `login()`, `verifyPassword()`, `loadSession()`, and `saveSession()`. Calls `check_login` with the newer RPC signature first, then falls back to the legacy signature. |
| `src/context/AuthContext.jsx` | Source of account/session state. `refreshAccounts`, `createAccount`, `updateAccount`, `toggleAccountStatus`, `changeOwnPassword`, and `resetAccountPassword` are the account mutation API. |
| `src/services/userService.js` | Maps user rows and performs account queries/writes. It prefers the v2 `users` table for reads, then falls back to legacy `admins`, `staff`, and `technicians` tables if necessary. |
| `src/components/auth/ProtectedRoute.jsx` | Sign-in route guard. |
| `src/components/auth/RoleBasedRoute.jsx` | Route-level permission enforcement. |
| `src/components/auth/AccountsGate.jsx` | Prevents pages rendering while the current user profile is unresolved. |
| `src/hooks/useAuth.js`, `src/hooks/useUsers.js` | Stable, small interfaces for auth and account consumers. |

Account role changes are deliberately refused by `userService.updateAccount()` while legacy per-role tables are in use, because moving a user between tables would create a new ID and can break audit references.

### Clients and documents

| File | Key responsibilities / functions |
| --- | --- |
| `src/context/ClientsContext.jsx` | Loads clients after sign-in and exposes `addClient`, `updateClient`, `addDocument`, `removeDocument`, and `getClient`. Performs permission checks before writes. |
| `src/services/clientService.js` | Data mapping plus `fetchClients`, `createClient`, `updateClient`, `uploadDocument`, `deleteDocument`, `getDocumentUrl`, and pure `filterClients`. |
| `src/pages/ClientsPage.jsx` | Search/filter list page. |
| `src/pages/CreateClientPage.jsx` | Creates a profile and navigates to its detail route. |
| `src/pages/ClientDetailPage.jsx` | Resolves `:id`, supports profile edits and document actions. |
| `src/components/clients/ClientForm.jsx` | Client form and validation integration. |
| `src/components/clients/ClientDocuments.jsx` | Document upload/preview/download/remove controls. |

Document bytes are uploaded first to the private `client-documents` Storage bucket; their metadata is inserted into `client_documents` second. If metadata insertion fails, the service attempts to remove the uploaded object. `getDocumentUrl()` creates a signed URL that expires after 60 seconds.

### Inventory

| File | Key responsibilities / functions |
| --- | --- |
| `src/context/InventoryContext.jsx` | Inventory state plus `addItem`, `updateItem`, `updateItemBasics`, `setItemStatus`, `stockIn`, and `refreshMovements`. |
| `src/services/inventoryService.js` | Inventory row/payload mapping; CRUD functions; `stockIn()` RPC wrapper; `fetchMovements()`; `isLowStock()`. |
| `src/pages/InventoryPage.jsx` | Inventory screen, item detail/edit dialogs, stock-in dialog, and movement-history tab. It is intentionally large and a strong candidate for future component extraction. |
| `supabase/migrations/005-inventory-stock-movements.sql` | Implements `inventory_movements` and atomic `stock_in()`. |

Quantity starts at zero. After creation, the supported path to alter quantity is `stockIn()`, which calls the database RPC. The RPC locks the item, rejects disabled/missing items or non-positive values, inserts a movement, increments the quantity, and returns both results atomically.

### Shared UI and utilities

| File/folder | Purpose |
| --- | --- |
| `src/context/ToastContext.jsx` and `src/components/common/Toast.jsx` | App-wide success/error toast queue and rendering. |
| `src/services/logService.js` and `src/hooks/useLogs.js` | Local-storage activity log with in-memory subscribers. Treat as non-authoritative. |
| `src/utils/validators.js` | Account, password, client, email, and document validation; document limits are enforced here and configured in constants. |
| `src/utils/constants.js` | Roles, statuses, classifications, allowed file types, 2 MB document limit, password length, and storage keys. |
| `src/utils/formatters.js` | Presentation-only formatting helpers. |
| `src/styles/theme.js`, `src/styles/globals.css` | Shared inline-style tokens and global/layout CSS. |
| `src/components/layout/` | `Layout`, `Navbar`, and permission-driven `Sidebar`. |

## 6. Data model

The current client code primarily targets the legacy account tables plus the migrations below.

| Entity | Storage | Important relationships |
| --- | --- | --- |
| Accounts | `admins`, `staff`, `technicians` (legacy); `users` in v2 | Role is inferred from table in legacy mode. |
| Clients | `clients` | Has many `client_documents`. |
| Client documents | `client_documents` + Storage `client-documents` bucket | Metadata points to the object key; client deletion cascades metadata. |
| Inventory | `inventory` | Has many `inventory_movements`. |
| Stock movements | `inventory_movements` | `item_id` uses `ON DELETE RESTRICT`, preserving history. |
| Sessions/logs | `sessions`, `system_logs` in v2 | The current browser application still stores session and UI logs in `localStorage`. |

### Database setup

For the currently implemented browser application, apply migrations in numeric order:

1. `001-clients-and-documents.sql`
2. `002-seed-clients.sql` — optional seed data
3. `003-inventory.sql`
4. `004-seed-inventory.sql` — optional seed data
5. `005-inventory-stock-movements.sql`
6. `006-inventory-whole-number-stock-in.sql`
7. `007-inventory-default-quantity.sql`

`supabase/schema.sql` is the legacy base schema for the three account tables and legacy `check_login(login_email, login_password)`. `supabase/schema-v2.sql` is a planned/alternative unified-user schema with sessions, password hashing, server-side user RPCs, and a newer `check_login(login_identifier, login_password)` signature. Do not apply both blindly to a populated environment: review and migrate data deliberately. The app's login service can call either `check_login` signature, but account writes currently still target legacy role tables.

## 7. Dependencies and plugins

There are no project-specific CRA build plugins configured in `package.json`, and no installed Codex/plugin integration is required by the application.

| Dependency | Purpose |
| --- | --- |
| `react`, `react-dom` | Component UI and DOM rendering. |
| `react-router-dom` | Browser routing, redirects, navigation, and route parameters. |
| `@supabase/supabase-js` | PostgREST table access, RPC calls, and Storage operations. |
| `lucide-react` | Sidebar and dashboard icon components. |
| `react-scripts` | Create React App development server, production build, Jest integration, and lint setup. |
| `@testing-library/*`, `web-vitals` | Testing utilities and optional performance measurement support. |

## 8. Development conventions and known limitations

- Keep new server access in `src/services/`; pages should not issue raw Supabase queries.
- Keep cross-page state/mutators in the appropriate context and expose them through a hook.
- Return `true`/data on successful context mutations and a human-readable string on failure; existing pages rely on that contract for toasts.
- Add every new protected feature to `SUBSYSTEMS`, the permission matrix, `App.jsx`, and sidebar navigation together.
- Reuse `validators.js` and `constants.js` rather than duplicating business rules in form components.
- `src/lib/supabaseClient.js` is an older unguarded duplicate client. New code should import `src/services/supabaseClient.js` instead.
- Legacy/duplicate page and appointment files remain in the tree. Confirm a file is imported from `App.jsx` before investing implementation effort there.
- Local storage sessions only contain an ID and role and are not server-verified on every request; system logs are also local. Migrate to Supabase Auth or the v2 server-managed session design before production.
- Open RLS policies and client-accessible database patterns must be replaced with role-aware database authorization before exposing sensitive data or allowing production use.

## 9. Verification checklist

After code or schema changes:

1. Run `npm run build`.
2. Confirm the configured Supabase project has the required tables, policies, Storage bucket, and `stock_in` RPC.
3. Test each role's navigation and direct route access.
4. Test client upload, signed preview/download, and delete permissions.
5. Test an inventory Stock In and confirm both quantity and movement history update.
6. Confirm unauthorized direct database writes are rejected once production RLS/RPC authorization is introduced.
