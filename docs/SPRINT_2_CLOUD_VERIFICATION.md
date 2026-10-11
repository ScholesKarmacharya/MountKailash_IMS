# Sprint 2 Cloud migration verification

The migration warning was caused by unapplied schema, not incorrect environment variables or a broken authentication integration. The application API URL matched the linked Supabase Cloud project. Cloud had only migrations `202610110001` and `202610110002`; all three Sprint 2 migrations were pending. The actual authenticated `operations_workspace` request returned `PGRST202` (function not found). All four Sprint 2 pages share that RPC, and the data-access layer correctly reported the missing schema.

After review and explicit user approval, this command applied exactly:

```powershell
npx.cmd --no-install supabase db push --linked --yes
```

- `202610110003_sprint2_master_data.sql`
- `202610110004_sprint2_trip_journals.sql`
- `202610110005_sprint2_operations.sql`

Local and Cloud migration histories now match through `202610110005`. No reset, table drop, RLS disabling, seed or sample business record was used. Installing the migrations did not post stock transactions, open a day or create customer/vehicle/trip records. Driver accounts remain existing `profiles` records with role `DRIVER`; there is intentionally no separate `drivers` table.

## Database and security checks

`scripts/sql/cloud-sprint2-readonly.sql` checks schema catalogs and aggregate preservation fingerprints without reading credentials or printing business row contents. Before/after checks matched for Auth user IDs, profile identities/names/roles/active states, products, business days and inventory balance records. Counts remained: 2 Auth users, 2 profiles, 1 product, 1 business day, 2 stock movements, 2 adjustments, 4 audit events and 4 operation requests.

All 15 new Sprint 2 tables plus existing profiles were confirmed present with RLS enabled, SELECT grants and policies. Direct application-role inserts, updates, deletes and truncation remain blocked. The tables include customers, vehicles, trips, route assignments, visits/items, load items, return declarations/checks/check items/discrepancies, custody balances/entries and pending payment/value snapshots.

All 19 inspected RPCs/helpers exist and have fixed empty search paths. The 13 application RPCs permit authenticated execution and deny anonymous execution; the 6 internal `ops_*` helpers deny direct authenticated and anonymous execution. Mutation RPCs still validate active admin/assigned driver access within PostgreSQL. Read RPCs run with invoker RLS. The actual Cloud driver workspace is readable, while warehouse locations remain hidden.

## Application verification

`scripts/verify-cloud-operations.mjs` signs in privately and checks actual Cloud workspace counts against rendered directory links and empty states. It captures no browser artifacts and prints no credentials or raw provider errors. Both desktop (1280px) and phone (393px) checks passed for all four pages, including refresh and absence of the migration warning:

| Page      | Actual Cloud records | Verified behavior                                |
| --------- | -------------------- | ------------------------------------------------ |
| Customers | 0                    | Empty customer directory and create form.        |
| Vehicles  | 0                    | Empty vehicle directory and registration form.   |
| Drivers   | 1                    | Existing authorized driver appears.              |
| Trips     | 0                    | Empty trip list and real trip creation controls. |

No application workaround, fake fallback data or authentication rewrite was necessary. The fix was applying the missing database schema.

## Commands and results

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
npx.cmd --no-install supabase db query --linked --file scripts/sql/cloud-sprint2-readonly.sql
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
node --env-file=.env.local scripts/verify-cloud-operations.mjs --inspect
node --env-file=.env.local scripts/verify-cloud-operations.mjs http://localhost:3000
node --env-file=.env.local scripts/verify-cloud-login.mjs http://localhost:3000
node --env-file=.env.local scripts/verify-cloud-inventory.mjs http://localhost:3000
```

- 111 unit/integration tests passed across 12 files, including original authentication/inventory tests and real PostgreSQL trip/RLS tests.
- TypeScript, lint and formatting passed.
- All four Cloud pages passed actual-data/empty-state/refresh/responsive checks at both viewport sizes.
- Four existing Cloud login flows passed: admin/driver on desktop/mobile, correct role dashboard, new admin-route exclusions and sign-out.
- Existing Cloud inventory regression passed on both viewports: actual warehouse totals (45 full jars, 0 empty jars, 0 cartons), both adjustment entries/audit integrity, refresh and sign-out/sign-in persistence. Driver warehouse RPC and direct balance updates were denied. The inventory/business-day snapshot remained unchanged.
- Catalog security and existing-data preservation checks passed; all five migrations are applied remotely.

Refresh the four pages in your existing browser session. No environment edits or local Docker setup are needed. Create real customers and vehicles when ready; the existing driver is already authorized. End-to-end write acceptance using actual operational quantities remains a separate user-controlled activity. This verification created no Cloud business records.
