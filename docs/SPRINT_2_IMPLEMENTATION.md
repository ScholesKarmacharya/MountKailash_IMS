# Sprint 2: customers, vehicles, trips and deliveries

## Scope and deployment status

Application operations use the caller's verified Supabase Auth session, server permission checks and PostgreSQL RPCs. No service-role key is used by the application. Sprint 0 authentication and Sprint 1 product/warehouse operations remain intact. Sprint 2 screens query real database data; before its migrations are applied, they report the missing migration explicitly.

The three migrations below are **pending Cloud review**. No Cloud reset, user deletion, password change, sample inventory, customer or vehicle seeding is part of this implementation. The isolated browser tests provision synthetic identities and stock exclusively in an ephemeral PGlite database, never in Supabase Cloud.

## Migration review

Apply these in order, after review:

| File                                     | Changes                                                                                                                                                                                                    | Review risk                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202610110003_sprint2_master_data.sql`   | Adds profile versions, registered customers, vehicles with separate stock locations, optimistic edits and shared idempotency/audit primitives.                                                             | Adds one defaulted column to existing profiles; briefly requires an ALTER TABLE lock. Existing IDs, passwords and roles are retained.                                                                                                                                                                                                                 |
| `202610110004_sprint2_trip_journals.sql` | Adds trip states, route assignments, immutable visits/load/return/custody journals and assigned-driver RLS. Extends existing stock movements with trip references, line numbers and before/after balances. | Replaces the movement-type/direction constraints and single-row request uniqueness with per-request line uniqueness. Existing manual adjustments retain line 0 and their original constraints semantically. PostgreSQL validates existing rows; review any externally written journal rows before applying. DDL takes locks on existing stock tables. |
| `202610110005_sprint2_operations.sql`    | Adds atomic create/load/start/visit/submit/reconcile, driver profile management, custody correction, scoped workspace/customer history reads and unverified payment instructions/value snapshots.          | SECURITY DEFINER mutation functions must remain owned by the migration owner with fixed empty search paths. Internal helpers cannot be called by application roles. No inventory is populated or transferred by installing these functions.                                                                                                           |

During a quiet period, take a normal database backup/snapshot according to your Supabase plan. Preview and confirm the linked project's migration history:

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
```

After approving **exactly the three files above**, apply:

```powershell
npx.cmd --no-install supabase db push --linked
npx.cmd --no-install supabase migration list --linked
```

Do not add `--include-all`, `--include-seed`, or run `db reset`. A dry run identifies pending files; it does not execute or validate their SQL on Cloud. The isolated tests execute all migration SQL. Separate CLI migration files may commit separately: if a later migration fails, keep the successful earlier migrations and repair forward after inspection. Do not blindly reapply or manually mark migrations successful. Restart the dev server if configuration changed; no new environment variables are required.

## Features and integrity

- Admin manages registered customers, active/inactive vehicles and driver profiles. Edits require a reason and expected version. Existing Auth accounts are never deleted or recreated.
- Each live trip reserves one active driver and vehicle, including DRAFT; another trip can use a different pair simultaneously. After physical closure or unladen draft cancellation, the same pair can run another trip in the same business day.
- Admin creates a trip on an explicit OPEN business day, assigns route customers, and loads warehouse full jars/cartons. Warehouse stock moves to the vehicle atomically. Assigning a jar SKU with zero full jars permits collecting its empties on a carton-loaded trip.
- The assigned driver starts a LOADED trip, records registered or walk-in visits, and declares all vehicle return counts. Registered customers are searchable by name, shop, phone and address within the assigned route. Admin can append route customers before submission.
- Driver controls support plus/minus and direct quantity entry. Outgoing quantity is limited by the displayed vehicle balance and checked again under database locks. A review screen allows corrections before posting, followed by explicit confirmation. Reloading updated data follows a successful visit; browser unload warns about unsaved forms. Posted visits are immutable; a correction workflow for already-posted visits is not silently implemented.
- Repeated visits are separate records with per-visit exact NUMERIC price snapshots. Trip reports group physical quantities by customer; customer pages group visits by trip and retain separate visits. Jar custody tracks customer holdings separately from warehouse stock and money; audited admin opening/correction entries handle verified legacy jars.
- Submission locks further deliveries and saves driver counts without warehouse movements. Admin verifies actual counts. Unapproved mismatch records a DISCREPANCY and leaves all warehouse/vehicle stock unchanged. Explicit reasoned approval journals each shortage/surplus, then returns the actual quantities and closes the physical trip. Empty jars remain empty. There is no automatic refill.
- Closed trips, visits, loads, counts, payment instructions, stock movements, discrepancies, custody entries, operation requests and audit events remain historical. Direct application table writes are revoked; immutable journals reject updates/deletes/truncation. Actor IDs and business days are server-owned.
- Actor-scoped request keys and transaction locks prevent duplicate effects. Every mutation stores its complete relevant payload; reusing a successful key with altered details fails. Trip locks serialize state changes; inventory/custody rows are locked before mutation. Prices and actors supplied by a browser cannot override database values.
- Drivers cannot manage customers/vehicles/drivers, load warehouse stock, perform manual warehouse adjustments, approve returns or read another driver's trips. They can read related operational records through RLS, including their historical trips; current vehicle balance access requires a live assignment and its assigned products. Manual warehouse balances remain admin-only.

## Provisional assumptions and deferred decisions

These choices are explicitly provisional, not decisions replacing `OPEN_QUESTIONS.md`:

1. One MAIN warehouse/operating unit; every physical closure fully unloads the vehicle. Overnight carryover and additional operating units require a separate confirmed workflow.
2. Admin loads vehicles; drivers declare returns and admin approves. Drafts reserve assignments to prevent two pending loads for the same pair.
3. 20L jars are returnable custody units. Walk-in jar deliveries require an equal empty exchange and cannot create ongoing credit; register a customer for ongoing jars or UNPAID/PARTIAL instructions. Permanent jar sales, deposits and their prices remain unresolved.
4. Current default product prices are snapped at delivery. Customer-specific pricing, discretionary overrides, tax and invoice rules are deferred. No carton size is assumed.
5. CASH/FONEPAY/UNPAID/PARTIAL stores an **unverified driver instruction** and optional reported amount/reference. Every intent remains `PENDING_SPRINT3`. These rows are not verified payments, financial journals, receivables, provider confirmations or credit-limit approval. Physical trip CLOSED does not imply payment settlement or business-day closing. Finance dashboard metrics remain unavailable.
6. Business-day IDs govern transactions across Nepal midnight; all operations require that assigned day to remain OPEN. Daily close remains deferred and must later refuse unfinished trips.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e:operations
```

The operations Playwright config starts separate loopback servers on 17777 (test-only provider adapter backed by real PostgreSQL) and 3002 (Next with `.next-sprint2-e2e` output). It uses no Cloud credentials or Docker. Tests run serially against disposable fixtures. Auth provider behavior is stubbed; application migrations, RPCs, RLS, server actions and screens are real. This verifies physical transactions and UI, not hosted Auth/PostgREST/provider parity. Existing Cloud authentication should also be checked read-only using:

```powershell
node --env-file=.env.local scripts/verify-cloud-login.mjs http://localhost:3000
```

No real credentials are logged or stored in browser artifacts. Integration coverage includes the requested 100/80/65 cycle, carton deliveries, stock limits, retries, repeated visits, second-trip assignment, concurrent independent assignments, driver isolation, closed-day blocking, closed journal integrity, legacy custody, variance gain/loss and pending finance. PGlite uses one connection; true multi-connection race/deadlock testing remains a staging acceptance check.

### Manual Cloud browser acceptance after migration approval

1. Sign in as admin. Confirm existing warehouse balances still match the pre-migration values. Open a business day from Inventory if needed.
2. Create an actual registered customer and vehicle; review Drivers. To add a driver, create an Auth user in Supabase Dashboard → Authentication → Users with a deliverable email and a unique initial password entered there. Supply credentials through your secure staff onboarding process, then copy the existing Auth UUID into the app's driver authorization form. Do not use an ADMIN UUID or put passwords in app notes. Invitation/recovery links require an independently configured password setup callback; that callback is not implemented in this sprint.
3. If real, approved warehouse stock is insufficient, stop and obtain approval for an actual opening adjustment. **Do not populate the 100/10 test fixture in Cloud automatically.** Record reasons for authorized inventory or legacy custody corrections.
4. Create a draft with an available driver, vehicle and route customer. Load approved quantities; verify matching warehouse deductions and trip journal entries. Retry an overstock load to see rejection with no partial movements.
5. Sign in as that driver on a phone. Start the trip; select/search the customer; use plus/minus and direct entry; review and correct quantities; save a visit. Refresh updated data and repeat for the same customer. Verify separate visits, grouped totals, physical jar custody and decreasing vehicle full/carton quantities.
6. Verify more-than-available delivery is rejected, walk-in ongoing custody/credit is blocked, and Fonepay remains unverified. Submitted counts must include every assigned stock state, including zeros.
7. Submit physical return counts. Confirm warehouse stock is unchanged. Admin reviews actual counts; optionally flag a discrepancy without moving stock, then approve a documented variance and reconcile actual returns.
8. Confirm CLOSED, zero vehicle stock, warehouse actual return increments, separate full/empty states, immutable movement/return history and pending finance. Refresh and sign out/in to check persistence. Create the second trip with the same pair.
9. Sign in as another driver. The first trip detail must be inaccessible; admin routes redirect to driver home. Manual warehouse adjustment RPCs remain denied independently of the UI.

## Next sprint

Sprint 3 should establish append-only finance/receivables journals, verified cash handover, Fonepay provider confirmation, customer credit repayments, partial settlement and payment allocations, finance reconciliation, and approved deposit/tax/customer-price rules. Use the immutable visit/value snapshots and unverified intents as inputs, not posted accounting. Confirm correction/reversal policy and credit limits before posting. Add multi-session staging race tests and report pagination as operational volumes grow. A dedicated authorized refill/damage workflow and daily close must remain separate from delivery returns.

## Implementation completion report (2026-10-11)

| Command                                                                           | Result                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                           | Passed; strict TypeScript and Next route generation.                                                                                                                                            |
| `npm.cmd run lint`                                                                | Passed without warnings.                                                                                                                                                                        |
| `npm.cmd test`                                                                    | 111 passed across 12 files, including 15 Sprint 2 real PostgreSQL tests and the existing 75 Sprint 0/1 tests.                                                                                   |
| `npm.cmd run test:e2e:operations`                                                 | 2 passed: full physical cycle on desktop and Pixel 7 viewport. Provider-owned Auth/PostgREST behavior is isolated; application SQL and UI are real.                                             |
| `node --env-file=.env.local scripts/verify-cloud-login.mjs http://localhost:3000` | 4 passed: existing Cloud ADMIN/DRIVER on desktop/mobile, correct dashboard, responsive navigation, all new admin-route exclusions, and sign-out. Read-only operations apart from Auth sessions. |
| `npm.cmd run format:check`                                                        | Passed.                                                                                                                                                                                         |
| `npm.cmd run build`                                                               | Passed; all existing and new routes compile.                                                                                                                                                    |
| `supabase migration list --linked` / `supabase db push --linked --dry-run`        | Sprint 0/1 applied; exactly migrations 003–005 pending. No seeds or extra migrations. Cloud application remains pending review.                                                                 |

Changed files are grouped by their purpose:

- Database: the three reviewed migrations listed above.
- Domain and server: `src/domain/auth/roles.ts`, `src/domain/operations/{types,commands}.ts`, `src/data-access/operations.ts`, `src/services/{operations,dashboard}.ts`, `src/app/operations-actions.ts`.
- Admin routes: `src/app/admin/{customers,drivers,vehicles,trips}/page.tsx`, each corresponding `[id]/page.tsx`, and `src/app/admin/dashboard/page.tsx`.
- Driver routes: `src/app/driver/home/page.tsx`, `src/app/driver/trips/[id]/page.tsx`.
- UI: `src/components/{app-shell,navigation,operation-form,operation-feedback,operations-layout,master-forms,directory,customer-report,trip-forms,trip-summary}.tsx`.
- Verification: `tests/integration/operations-db.test.ts`, `tests/unit/{operations,operations-service}.test.ts`, `tests/operations-e2e/trip-cycle.spec.ts`, `tests/helpers/operations-provider.mjs`, `tests/auth-e2e/auth.spec.ts`, `scripts/verify-cloud-login.mjs`, `playwright.operations.config.ts`.
- Tooling and documentation: `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `next.config.ts`, `tsconfig.json`, `package.json`, `README.md`, this report. The separate test build directory is ignored; no new dependency or environment variable is required for the application.

Remaining deployment dependencies are migration review/application, Cloud PostgREST/schema verification afterward, and manual acceptance using approved real stock. True multi-connection race tests belong on staging. No Cloud operational data was created, historical data removed, or existing account password/role changed during implementation.
