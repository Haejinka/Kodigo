# KodiGo Maintainer Build Guideline

Living document
Updated: 2026-04-29
Purpose: keep future code changes aligned with the current KodiGo implementation.

## 1. Source of Truth

Use this order when resolving conflicts:

1. Latest applied SQL migration chain.
2. Runtime frontend implementation in `kodigo-ui/src`.
3. `KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md` for architecture and RBAC intent.
4. `README.md` and this guideline for setup and maintenance notes.
5. `supabase_schema.sql` as a baseline snapshot only.

Do not treat `supabase_schema.sql` as final RBAC or tenancy behavior without applying migrations 01 through 17.

## 2. Project Overview

KodiGo is a cloud-first POS, inventory, supplier, purchase order, and analytics system for sari-sari stores and small retail branches.

Primary goals:

- Fast POS transactions.
- Store-scoped inventory and supplier management.
- Role-based access for admin, cashier, and super_admin.
- Offline POS continuity with queue replay.
- Supplier scoring and restocking support.
- Clear audit paths for stock, sales, and operational changes.

## 3. Tech Stack

| Layer | Current technology |
| --- | --- |
| Frontend | React 19, Vite 7, TypeScript |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Routing | React Router v7 |
| State | Zustand v5 |
| Charts | Recharts v3 |
| Backend | Supabase Auth and Postgres |
| Offline | IndexedDB via `idb` |
| Hardware | Web Serial API for ESC/POS drawer command |

TanStack Query is installed but the current app primarily uses direct Supabase calls in Zustand stores and pages.

## 4. Roles and Access

| Role | Intended behavior |
| --- | --- |
| `admin` | Owns/manages assigned stores and operational data. |
| `cashier` | Uses POS for assigned store operations. |
| `super_admin` | Manages invite-code governance; not normal store CRUD in final migrations. |

If a new role is added, update all of these together:

- Database `user_role` enum and RLS policies.
- `kodigo-ui/src/types/index.ts`.
- Route guards in `kodigo-ui/src/App.tsx`.
- Navigation visibility.
- Validator checklist and RBAC guide.

## 5. Frontend Structure

```text
kodigo-ui/src/
  components/
    analytics/
    inventory/
    layout/
    pos/
    shared/
    suppliers/
  hooks/
  lib/
    hardware.ts
    offline-sync.ts
    supabase.ts
    supplier-scores.ts
    utils.ts
  pages/
  stores/
  types/
  App.tsx
  main.tsx
```

Route map:

| Route | Purpose |
| --- | --- |
| `/login` | Supabase email/password login. |
| `/register` | Invite-code based admin signup. |
| `/pos` | Full-screen POS route. |
| `/super-admin` | Invite-code governance. |
| `/dashboard` | Admin overview. |
| `/inventory` | Product and stock management. |
| `/restocking` | Restock suggestions and PO creation. |
| `/suppliers` | Supplier list and supplier detail flow. |
| `/analytics` | Revenue, profit, hourly, category, and transaction views. |
| `/rankings` | Product ranking by sales. |
| `/settings` | Store settings plus scaffolded user/security pages. |

## 6. State and Data Rules

- `authStore.ts` owns session, profile, role, assigned stores, and active store.
- `productStore.ts` owns products, categories, stock adjustments, and product mutation queueing.
- `supplierStore.ts` owns suppliers and purchase orders.
- `alertStore.ts` owns stock alerts and read state.
- `cartStore.ts` owns transient POS cart state and clears when active store changes.
- `offline-sync.ts` owns IndexedDB cache/queue behavior.

Store rules:

- POS requires a specific store and must not run against the `all` aggregation view.
- Reads may support `all` when the UI is clearly aggregating admin-visible stores.
- Writes must target a specific store.
- Prefer server-side RLS as the authority. Frontend guards are usability controls, not security boundaries.

## 7. Backend and Migration Rules

- Add schema changes as new migrations. Do not silently edit old migrations after they have been shared/applied.
- Keep migration comments short but clear about policy intent.
- When changing RLS, update `KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md` and `FOR TECHNICAL VALIDATORS.md`.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` in Vite env files or browser code.
- Prefer an Edge Function or RPC for flows that need elevated privileges or transaction semantics.
- POS sale atomicity is a known improvement area; consider a transaction RPC for sale header, sale items, and stock effects.

## 8. Design and UI Rules

- Use the existing quiet operational UI style: dense, readable, and task-oriented.
- Keep POS fast and keyboard-friendly.
- Keep destructive actions behind confirmation.
- Always provide loading, empty, and error states for data-dependent screens.
- Use the existing shared components before introducing new ones.
- Keep admin aggregation views visually distinct from specific-store operational views.

## 9. Current Scaffolds and Caveats

These areas must not be documented or presented as production-complete:

- `/settings/users`: local user list scaffolding, not Supabase Auth admin management.
- `/settings/security`: local password-change placeholder.
- Invite generation: both Edge Function and direct client insert exist; choose one production path.
- Supabase Realtime: target architecture, not uniformly wired through current dashboard/analytics pages.
- Offline conflict handling: basic queue replay, not full conflict resolution.

## 10. Validation Before Release

From `kodigo-ui/`:

```bash
npm run build
npm run lint
```

Manual validation:

- Login and redirect behavior for all roles.
- Store isolation for reads and writes.
- POS online sale, stock deduction, and receipt success flow.
- POS offline sale and replay.
- Product/supplier mutation queue replay.
- Store create/update/delete as admin.
- Super-admin invite flow and absence of operational store CRUD.

## 11. Documentation Maintenance

Update docs when changing behavior:

- Setup or environment changes: `README.md` and `kodigo-ui/README.md`.
- Feature behavior: `KODIGO_FEATURES.md`.
- RBAC, architecture, diagrams, or flow changes: `KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md`.
- Validation expectations: `FOR TECHNICAL VALIDATORS.md`.
- Historical audit follow-up: `FULL_AUDIT.md` or `KODIGO_AUDIT_ACTION_PLAN.md` only when those records change.

Avoid duplicating long explanations across files. Prefer one current source and link/point to it from shorter documents.
