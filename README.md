# KodiGo

KodiGo is a cloud-first Point-of-Sale (POS), inventory, supplier, and analytics system for high-volume sari-sari stores and small retail branches. The active application lives in `kodigo-ui/` and uses Supabase for authentication, tenancy, operational data, and row-level security.

## Current Status

- Frontend: React 19, Vite 7, TypeScript, Tailwind CSS v4, Zustand, Recharts, Radix primitives, and Supabase JS.
- Backend: Supabase Postgres/Auth with SQL migrations at the repository root. `supabase_schema.sql` is a baseline snapshot; the ordered `migration_01_*.sql` through `migration_17_*.sql` files contain the current policy and schema deltas.
- Persistence: Product, supplier, purchase order, alert, sale, store, and auth flows are wired to Supabase in the current UI.
- Offline support: POS sales and selected product/supplier/category/store mutations use IndexedDB queues in `kodigo-ui/src/lib/offline-sync.ts` and replay when the browser returns online.
- Hardware: `kodigo-ui/src/lib/hardware.ts` sends an ESC/POS cash-drawer command through the Web Serial API when the browser and device permit it.
- Remaining scaffolds: Admin user management and password-change screens still use local placeholder behavior. Treat them as UI scaffolds until Supabase Auth admin/Edge Function support is added.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `kodigo-ui/` | React/Vite frontend application. |
| `kodigo-ui/src/stores/` | Zustand stores for auth, products, suppliers, cart, and alerts. |
| `kodigo-ui/src/lib/supabase.ts` | Browser Supabase client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. |
| `kodigo-ui/src/lib/offline-sync.ts` | IndexedDB product cache, offline sale queue, and generic mutation queue. |
| `supabase/functions/generate-invite/` | Deno Edge Function for server-side invite-code generation. The current UI also supports direct client insert under RLS. |
| `supabase_schema.sql` | Baseline schema snapshot. Do not read it as the final state without applying migrations. |
| `migration_*.sql` | Ordered Supabase schema, trigger, RLS, and bug-fix migrations. |
| `KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md` | Current architecture/RBAC guide and diagram reference. |
| `FOR TECHNICAL VALIDATORS.md` | Validation checklist for reviewers and testers. |

## Setup

1. Install frontend dependencies:

   ```bash
   cd kodigo-ui
   npm install
   ```

2. Create `kodigo-ui/.env.local`:

   ```bash
   VITE_SUPABASE_URL=<your-supabase-project-url>
   VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
   ```

3. Prepare the database:

   - Start from `supabase_schema.sql` only for a clean baseline.
   - Apply root migrations in numeric order from `migration_01_invite_codes.sql` through `migration_17_add_suppliers_updated_at.sql`.
   - Confirm the final migration state before validating RLS; later migrations intentionally override earlier policies.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

## Scripts

Run from `kodigo-ui/`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check and create a production build. |
| `npm run lint` | Run ESLint. |
| `npm run preview` | Preview the production build locally. |

## Roles and Routes

| Role | Runtime Scope |
| --- | --- |
| `admin` | Store owner/operator. Can manage assigned stores, inventory, suppliers, purchase orders, analytics, and settings. |
| `cashier` | POS-focused role for assigned store operations. |
| `super_admin` | System invite governance. Redirected to `/super-admin`; final migrations keep this role out of normal store CRUD. |

Important route behavior:

- `/login` and `/register` are public.
- `/pos` requires an authenticated user and a specific active store, not the `all` store view.
- Admin pages use `AppShell` and are guarded by `RequireAdmin`.
- `/super-admin` is guarded by `RequireSuperAdmin`.

## Operational Notes

- Keep service-role keys out of all frontend environments. Only Edge Functions or other server-side contexts may use `SUPABASE_SERVICE_ROLE_KEY`.
- The migration chain is authoritative for tenancy and RBAC. When a policy looks wrong in `supabase_schema.sql`, check the latest migration first.
- POS sale insertion currently writes the sale header and line items in separate Supabase calls; migration 09 adds stock deduction after `sale_items` inserts.
- Offline replay distinguishes network failures from database/RLS errors. Database rejections are surfaced instead of queued.
- Web Serial cash-drawer support requires a secure context (`localhost` or HTTPS), a compatible browser, and a user gesture.

## Documentation Map

- Use `KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md` for the current architecture, RBAC, UML/CFD/DFD, and risk overview.
- Use `KODIGO_FEATURES.md` for product capabilities and business rules.
- Use `FOR TECHNICAL VALIDATORS.md` for manual validation steps.
- `FULL_AUDIT.md` and `KODIGO_AUDIT_ACTION_PLAN.md` are retained as historical audit follow-up records; they now summarize what was fixed and what remains.
