# KodiGo

KodiGo is a cloud-first, multi-store point-of-sale (POS), inventory, supplier, purchasing, reporting, and operations system for sari-sari stores and small retail branches. It gives store owners and staff one browser-based workspace for checkout, stock control, supplier management, receipts, alerts, user access, and store-level reporting while Supabase enforces authentication, tenant isolation, and role-based access.

The active application is the React/Vite project in [`kodigo-ui/`](kodigo-ui/). The repository also contains the Supabase schema baseline, the complete migration history, Edge Functions, operational documentation, architecture references, and project deliverables.

## Intended Users

- Store owners and administrators managing one or more branches.
- Cashiers processing sales for an assigned store.
- Inventory staff maintaining products, stock, and inventory reports.
- System super administrators issuing one-time owner invite codes.
- Maintainers, instructors, and technical validators reviewing the capstone system.

## Major Capabilities

- Multi-store POS with barcode/search input, cart and payment flows, atomic sale processing, stock deduction, void/refund lifecycle support, and immutable receipt snapshots.
- Product inventory with base-unit and package selling options, bulk-purchase conversion, margin-assisted pricing, stock adjustments, low-stock alerts, and sales-velocity indicators.
- Supplier records, multi-store supplier links, supplier scoring, restocking suggestions, and purchase-order workflows.
- Dashboard, analytics, product rankings, notifications, sales reports, inventory reports, and Excel export.
- Store branding and BIR-oriented receipt fields, browser printing, PDF receipt generation, and optional ESC/POS cash-drawer access through the Web Serial API.
- Supabase email/password authentication, invite-based owner registration, managed staff accounts, password reset, TOTP multi-factor authentication, and database-enforced role/tenant boundaries.
- IndexedDB-backed product caching and offline queues for POS sales and selected mutations, with replay when connectivity returns.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript 5.9, Vite 7 |
| Styling and UI | Tailwind CSS 4, Radix UI primitives, Lucide React |
| Routing and state | React Router 7, Zustand 5 |
| Data and charts | Supabase JS 2, Recharts 3, TanStack Query (installed), `idb` |
| Documents and export | jsPDF, `write-excel-file` |
| Backend | Supabase Auth, Postgres, Row Level Security, Storage, and Edge Functions |
| Quality checks | TypeScript project references, ESLint, custom integration harness, GitHub Actions |
| Deployment configuration | Vercel single-page-app rewrite configuration |

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`, as required by the installed Vite version. The CI workflow uses Node.js 22.
- npm and the committed `kodigo-ui/package-lock.json` lockfile.
- A Supabase project with access to Auth, Postgres, Storage, the SQL Editor, project API settings, and Edge Functions.
- Permission to apply the repository's SQL migrations and deploy its Edge Functions.
- A modern browser. Web Serial cash-drawer support additionally requires a compatible Chromium browser, a secure context (`localhost` or HTTPS), supported hardware, and a user gesture.

## Local Setup

### 1. Install the frontend dependencies

Run these commands from the repository root:

```bash
cd kodigo-ui
npm ci
```

The root-level `package.json` is not the active application manifest. Use the scripts and lockfile inside `kodigo-ui/`.

### 2. Configure the frontend environment

Copy [`kodigo-ui/.env.example`](kodigo-ui/.env.example) to `kodigo-ui/.env.local`, then replace the placeholders with values from the Supabase project's API settings:

```dotenv
VITE_SUPABASE_URL=<your-supabase-project-url>
VITE_SUPABASE_ANON_KEY=<your-public-anon-or-publishable-key>
```

Only public browser credentials belong in `VITE_*` variables. Never put a Supabase service-role or secret key in the frontend, a committed environment file, or any browser-delivered code.

### 3. Prepare the database

This repository does not contain a pinned Supabase CLI dependency or a `supabase/config.toml`, so it does not currently provide a one-command local database bootstrap. Use an authorized Supabase project and its SQL Editor.

For a new, empty project:

1. Run [`supabase_schema.sql`](supabase_schema.sql) once as the baseline snapshot.
2. Run the root migrations in numeric order from [`migration_01_invite_codes.sql`](migration_01_invite_codes.sql) through [`migration_28_member_account_rbac_hardening.sql`](migration_28_member_account_rbac_hardening.sql). Follow any execution notes inside each file; migration 02, for example, separates the enum change from the remaining statements.
3. Run the dated migrations in [`supabase/migrations/`](supabase/migrations/) in filename order:
   - `20260803013739_fix_admin_supplier_inventory_workflows.sql`
   - `20260803022414_hide_notifications_from_super_admin.sql`
   - `20260803023252_enforce_mfa_assurance.sql`
4. Run [`migration_29_base_unit_inventory_margin_velocity.sql`](migration_29_base_unit_inventory_margin_velocity.sql).
5. Review the resulting RLS policies, functions, triggers, grants, Storage configuration, and Auth settings before using real data.

The ordered migration chain is the source of truth for the current database. `supabase_schema.sql` is only a starting snapshot; later migrations intentionally replace earlier policies and functions. Existing environments should apply only migrations that have not already been recorded as applied. Do not rerun the baseline over a populated database.

There is no general-purpose seed script. The UI creates default product categories when needed, but user accounts and production business data are not seeded. Owner registration requires an invite code, and the repository does not include an automated first-super-admin bootstrap; an authorized Supabase project operator must provision the initial administrative account according to the deployment's access policy.

### 4. Deploy the required Edge Functions

Deploy both function directories to the same Supabase project:

- [`supabase/functions/generate-invite/`](supabase/functions/generate-invite/) creates one-time registration codes for `super_admin` users.
- [`supabase/functions/admin-users/`](supabase/functions/admin-users/) performs server-side managed-user operations for store administrators.

The functions read Supabase-provided server variables including `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key in the Edge Function environment only. No repository-pinned deployment command is provided, so use the deployment method approved for the target Supabase project and verify both functions before testing invite or user-management flows.

### 5. Start the development server

From `kodigo-ui/`:

```bash
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

## Build, Preview, and Validation

Run all commands in this table from `kodigo-ui/`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite with host binding for local development. |
| `npm run typecheck` | Run the TypeScript project checks. |
| `npm run lint` | Run ESLint across the frontend. |
| `npm run build` | Type-check and produce the optimized Vite bundle in `dist/`. |
| `npm run preview` | Preview the built bundle locally. |
| `npm run test:integration` | Skip safely unless explicitly enabled; otherwise run the checkout, historical snapshot, stock, void, and RLS integration harness. |
| `npm run ci` | Run type-checking, linting, build, and the integration harness. |

The integration harness creates and removes Auth users, stores, products, sales, and related test records. Run it only against an isolated test or staging project:

```dotenv
RUN_INTEGRATION_TESTS=true
KODIGO_TEST_SUPABASE_URL=<test-project-url>
KODIGO_TEST_SUPABASE_ANON_KEY=<test-public-anon-or-publishable-key>
KODIGO_TEST_SUPABASE_SERVICE_ROLE_KEY=<test-service-role-key>
```

The service-role variable is for this Node-based test harness and must never use production credentials or be exposed to the browser. GitHub Actions reads the equivalent values from repository secrets.

## Roles and Access

| Role | Implemented scope |
| --- | --- |
| `admin` | Owns or manages assigned stores, staff, inventory, suppliers, purchasing, POS, analytics, reports, notifications, branding, and settings. |
| `cashier` | Processes POS transactions for assigned stores. |
| `inventory` | Manages products and stock and can access inventory-oriented reporting without sales-management access. |
| `super_admin` | Issues owner invite codes; later migrations keep this role outside normal store operations and operational notifications. |

Frontend route guards improve navigation, but Supabase RLS, functions, and RPC authorization are the security boundary. Users with a verified TOTP factor must satisfy the database's AAL2 requirement before protected operations proceed.

## Repository Structure

| Path | Purpose |
| --- | --- |
| [`kodigo-ui/`](kodigo-ui/) | Active React/Vite application, frontend package manifest, lockfile, and Vercel configuration. |
| [`kodigo-ui/src/pages/`](kodigo-ui/src/pages/) | Route-level screens for auth, POS, inventory, suppliers, reports, analytics, notifications, and settings. |
| [`kodigo-ui/src/components/`](kodigo-ui/src/components/) | Feature and shared UI components, including POS, inventory, MFA, receipts, branding, charts, and layout. |
| [`kodigo-ui/src/stores/`](kodigo-ui/src/stores/) | Zustand stores for auth, products, suppliers, cart, alerts, and theme state. |
| [`kodigo-ui/src/lib/`](kodigo-ui/src/lib/) | Supabase access, transaction/reporting logic, offline sync, receipts, branding, MFA, hardware, and utilities. |
| [`kodigo-ui/public/`](kodigo-ui/public/) | Static frontend assets. |
| [`kodigo-ui/scripts/`](kodigo-ui/scripts/) | Opt-in Supabase integration test harness. |
| [`supabase_schema.sql`](supabase_schema.sql) | Baseline database snapshot for a fresh project; not the final schema by itself. |
| [`migration_*.sql`](.) | Sequential schema, RLS, trigger, RPC, reporting, notification, RBAC, inventory, and receipt evolution. Preserve the full history. |
| [`supabase/migrations/`](supabase/migrations/) | Later timestamped workflow, notification, and MFA hardening migrations that run before root migration 29. |
| [`supabase/functions/`](supabase/functions/) | Deno Edge Functions for invite generation and managed-user administration. |
| [`docs/`](docs/) | Production operations runbook covering backup, restore, logging, deployment checks, and rollback. |
| [`deliverables/`](deliverables/) | Generated governance/manual artifacts and their visual QA renders. |
| [`scripts/`](scripts/) | Utilities used to build, render, and print the governance manual. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Node 22 CI workflow for install, type-check, lint, build, and opt-in integration tests. |

## Documentation Map and Source of Truth

Use the following order when information conflicts:

1. The latest fully applied SQL migration chain.
2. Runtime code under `kodigo-ui/src/` and `supabase/functions/`.
3. The architecture and RBAC intent in [`KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md`](KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md).
4. This README and the living maintainer guide.
5. The baseline `supabase_schema.sql` snapshot.

Supporting documentation is intentionally preserved:

- [`KODIGO_FEATURES.md`](KODIGO_FEATURES.md) — detailed feature and business-rule reference.
- [`KODIGO_GUIDELINE.md`](KODIGO_GUIDELINE.md) — living maintainer and implementation guidance.
- [`KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md`](KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md) — architecture, RBAC, data model, UML, control-flow, and data-flow reference.
- [`FOR TECHNICAL VALIDATORS.md`](FOR%20TECHNICAL%20VALIDATORS.md) — reviewer checklist and validation notes.
- [`docs/production-ops.md`](docs/production-ops.md) — backup, restore, logging, deployment, and rollback runbook.
- [`FULL_AUDIT.md`](FULL_AUDIT.md) and [`KODIGO_AUDIT_ACTION_PLAN.md`](KODIGO_AUDIT_ACTION_PLAN.md) — historical audit findings and follow-up records.
- [`KODIGO_CONCEPTUAL_FRAMEWORK_IMAGE_GUIDE.md`](KODIGO_CONCEPTUAL_FRAMEWORK_IMAGE_GUIDE.md) and [`mockups_prototypes.md`](mockups_prototypes.md) — capstone conceptual-framework and prototype capture guidance.
- [`deliverables/Kodigo_Governance_and_Full_Manual.pdf`](deliverables/Kodigo_Governance_and_Full_Manual.pdf) — compiled governance and system manual.

Some supporting documents describe an earlier migration milestone. Preserve them as architectural or historical context, but verify current behavior against all migrations through migration 29 and the active source code.

## Deployment Notes

- `kodigo-ui/vercel.json` rewrites all paths to `index.html` for client-side routing. A Vercel project should use `kodigo-ui` as its application root, run the existing build script, and publish Vite's `dist/` output.
- Configure the two public `VITE_*` variables in the frontend hosting environment.
- Apply database migrations and deploy both Edge Functions before promoting the frontend.
- Follow [`docs/production-ops.md`](docs/production-ops.md) for backups, staging validation, smoke tests, and rollback.
- Do not treat `npm run preview` as a production process manager; it is a local preview command.

## Security and GitHub Publication

Before making this repository public, remove the hard-coded Supabase project credential and plaintext test login data from the tracked diagnostic scripts at the repository root and in `kodigo-ui/test-*.mjs`. Rotate any credential that may have been exposed and remove sensitive values from Git history before publishing. These legacy diagnostic scripts are not part of the supported setup or CI workflow.

The root `.env` is ignored and currently serves only as a local configuration file. Keep `.env`, `.env.local`, service-role keys, access tokens, private certificates, and real user credentials out of Git. Preserve `.env.example` templates with placeholders.

## Contact Information

For project, instructor, maintainer, or contributor questions, contact:

- [vergaraevon@gmail.com](mailto:vergaraevon@gmail.com)
- [homerhambre@gmail.com](mailto:homerhambre@gmail.com)
- [jasa.gatdula.swu@phinmaed.com](mailto:jasa.gatdula.swu@phinmaed.com)

Repository: [github.com/Haejinka/Kodigo](https://github.com/Haejinka/Kodigo)

## License

KodiGo is proprietary software. Copying, modification, distribution, sublicensing, or commercial use requires explicit permission from the copyright holder. See [`LICENSE`](LICENSE) for the full terms.
