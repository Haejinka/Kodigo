# KodiGo Frontend

This is the React/Vite frontend for KodiGo. It contains the browser app, route guards, POS workflow, store/inventory/supplier screens, analytics views, Supabase client integration, and offline sync queues.

## Stack

- React 19 with Vite 7 and TypeScript
- Tailwind CSS v4 through `@tailwindcss/vite`
- React Router v7
- Zustand for app state
- Supabase JS for Auth and Postgres access
- Recharts for analytics charts
- `idb` for IndexedDB product cache and offline queues
- Lucide React and Radix primitives for UI building blocks

## Local Setup

```bash
npm install
```

Create `.env.local` in this directory:

```bash
VITE_SUPABASE_URL=<your-supabase-project-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

Run the development server:

```bash
npm run dev
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite with host binding. |
| `npm run build` | Run `tsc -b` and build the production bundle. |
| `npm run lint` | Run ESLint over the frontend source. |
| `npm run preview` | Serve the built bundle locally. |

## Source Map

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Router setup, route guards, auth initialization, and background revalidation. |
| `src/pages/` | Route-level screens. |
| `src/components/pos/` | POS search, barcode capture, cart, and payment modal components. |
| `src/stores/` | Zustand stores for auth, products, suppliers, alerts, and cart state. |
| `src/lib/supabase.ts` | Supabase browser client. |
| `src/lib/offline-sync.ts` | IndexedDB product cache, sale queue, generic mutation queue, and replay logic. |
| `src/lib/hardware.ts` | Web Serial cash-drawer helper. |
| `src/types/index.ts` | Shared domain types and stock-status helper. |

## Implementation Notes

- Auth and role resolution come from Supabase Auth plus the `profiles` table. `authStore.ts` also resolves assigned stores and the active store.
- POS sales are processed through `processSale()`: online writes go to Supabase immediately; offline or network-failed writes are queued in IndexedDB.
- Product, supplier, category, purchase order, and alert flows use Supabase-backed stores with optimistic updates in selected paths.
- The `all` store view is for admin aggregation screens only. POS and create/edit flows require a specific active store.
- User management and password update screens are still UI scaffolds and should be wired to server-side Supabase Auth admin operations before release.
