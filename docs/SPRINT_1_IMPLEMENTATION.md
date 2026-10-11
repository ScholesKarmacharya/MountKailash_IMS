# Sprint 1: products and warehouse inventory

This implements the user's product/warehouse scope. Original requirement documents remain authoritative. Existing Auth users, profiles, IDs and Sprint 0 migration are preserved. No Cloud migration or operational write was performed during implementation.

## Behavior

- `/admin/products`: create and edit 20L jar and bottled-water carton products; SKU, name, unit, exact NUMERIC(14,2) default NPR price and active/inactive state. Every create/edit requires an audit reason. Product kind remains fixed; stale edits are rejected by a version check. No deletion endpoint exists. Deactivation preserves all balances and history.
- `/admin/inventory`: separate full jars, empty jars and cartons, including quantities by product. Create products first; new products start at zero. Admins post signed manual corrections with mandatory reason and optional supporting notes. A confirmation precedes posting. Existing history shows actor, business day, timestamp, delta and before/after counts, with pagination.
- `/admin/dashboard`: real warehouse quantities across all catalog products, including inactive products. Missing schema shows Unavailable, not a fabricated zero. Trips, collections and credit retain their honest future-sprint states.
- Drivers retain their working home/sign-in flow. They cannot read the global warehouse/catalog/audit data, open a day, edit products or adjust inventory. No assigned-trip model exists yet; no unassigned operational information is exposed as a substitute.

## Business day prerequisite and provisional assumptions

The confirmed rules require an OPEN business day on every inventory event. Sprint 0 provided no day-write workflow. A minimal admin-only, audited `open_inventory_business_day` action is included in the inventory screen. It uses the current Nepal calendar date as the initial label, is retry-safe, and refuses to open when an OPEN or CLOSING_REVIEW day exists. Explicit day IDs carry through midnight. An existing active day is never silently replaced. Opening never resets stock.

Closing, reconciliation, reopening, post-close correction and archived reports remain Sprint 4 work. Do not change a day to CLOSED just to bypass a validation error. A day can remain open across calendar days; the dashboard warns about that.

One MAIN warehouse remains **provisional**, matching OPEN_QUESTIONS. Stock keys include location, product and physical state so later warehouse/vehicle transfers can share the balance model. Jar products have full and empty balances; carton products only carton balances. No carton pack size, price, deposit amount, tax rate or customer price policy is assumed. Admins can adjust inactive products to correct physical counts; inactive stock is still counted.

Customer CRUD, negotiated prices, vehicles, refilling and damaged jars from the broader TASKS.md Sprint 1 backlog are not part of this request and remain open. No financial/deposit tables were introduced.

## Transaction and authorization boundary

Forms → Server Actions → authorized domain service → cookie-backed data access → PostgreSQL RPC. Layout guards are supplemented by action/service guards and database checks against the active profile. No application service-role client or client-supplied actor exists. RLS allows active admins to read only; all direct authenticated table writes are revoked. RPCs are unavailable to anonymous callers and reject drivers/disabled users.

RPCs use SECURITY DEFINER with an empty search path and fully qualified application objects. The authoritative profile is locked for the operation. Adjustments share-lock the specified OPEN day and product, then row-lock the warehouse balance. The transaction updates the balance and appends movement, adjustment, audit and request records together. Failure at any point rolls everything back. Integer underflow/overflow and product/state mismatches are checked inside PostgreSQL.

Actor/request UUID identifies an operation across product/day/stock commands. An advisory transaction lock serializes same-key retries; the stored payload must match exactly, and retries return the original result. A reused key with different fields is rejected. Different keys on the same balance serialize through the row lock. Product edits also use optimistic versions.

Stock movements, adjustments, audits and request records reject UPDATE, DELETE and TRUNCATE even through ordinary privileged SQL. Corrections append new events; administrators with schema-owner access can still alter database protections, so production backup/privilege controls remain necessary.

Forms keep the request key while retrying in the current page, disable repeated submits while pending and disable further posting after a confirmed success. Use “Start another entry” for a new operation. If a network failure leaves the result uncertain, retry the same form unchanged; avoid reloading and submitting a new correction before checking history. Full offline/persistent replay remains deferred.

## Migration approval

Pending migration: `supabase/migrations/202610110002_sprint1_inventory.sql`.

Verified remotely: Sprint 0 `202610110001` remains applied; Sprint 1 is pending. The Cloud dry run lists only the Sprint 1 file. Dry run checks the pending list, not execution of SQL against Cloud.

Review this additive migration and your Cloud backup/restore readiness before applying:

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
# After approval, and only if the dry run lists the expected reviewed migration:
npx.cmd --no-install supabase db push --linked
```

It creates schema objects, one zero-stock warehouse identity and tightly scoped RPCs/policies. It does not create demo balances, modify existing profiles, reset data or rewrite Sprint 0 history. Risks: matching pre-existing object names can conflict; new SECURITY DEFINER write functions require review; a single MAIN warehouse and single active day are provisional constraints. Do not rerun raw SQL, repair migration history, reset Cloud or disable RLS to bypass an error. Read the SQL error and prepare an additive fix if needed.

No new environment variables or secret keys are required. Continue using the saved `.env.local` Cloud URL/public key and existing demo account passwords privately.

## Acceptance steps after migration approval

1. Run `npm.cmd run dev` if the server is not already running. Sign in as the existing admin, visit Products and create one 20L jar and one carton using actual SKU/name/unit/price. Both start at zero. Edit the price/name/unit/status with a reason; expand the product again to confirm persistence. Product kind stays fixed. Duplicate SKU, negative price and excessive decimal precision must fail.
2. Visit Inventory. Open a business day only if none is active. Record approved opening counts for each of FULL_JAR, EMPTY_JAR and BOTTLE_CARTON with a reason. Confirm the dialog. Check the product row, dashboard total and before/after history agree after each adjustment. Do not post invented demo quantities into an operational Cloud database.
3. Decrease a count by an allowed quantity; check the new balance/history. Try to decrease by more than the available quantity: the UI must show insufficient stock, with unchanged balance and no new event. Blank reasons, zero/fractional/negative quantity and mismatched product/state must be rejected.
4. Deactivate a stocked product. It remains in stock totals and history, and admins can correct its physical count. Reactivate it using another audited catalog change.
5. Sign out and sign in as the existing driver. Direct `/admin/products` and `/admin/inventory` navigation must redirect to driver home. Database/API attempts to read global warehouse data return no rows; adjustment/product/day RPC attempts fail with no write. Disabled accounts also fail.
6. On staging, repeat an identical RPC with the same request key: same ID, one movement, one balance change. Reuse that key with altered fields: rejected. Two separate sessions decreasing the last available stock must produce one eligible commit and one shortfall. Never race-test synthetic adjustments on operational Cloud stock.
7. Inspect desktop/mobile layouts, labels, pending/error/success states and unsaved-edit notices. Refresh after a confirmed success to confirm persistence. Uncertain network results should retry the unchanged form, then be checked against history.

## Automated validation

Executed on 2026-10-11: strict type-check, lint, formatting and production build passed; Vitest passed 75 tests across nine files, including 17 actual PostgreSQL integration tests. Existing Cloud browser verification passed for admin and driver on desktop/mobile, including the new protected screens and sign-out. Migration history and Cloud dry run passed and showed only Sprint 1 pending.

Not yet executed: applying the Cloud migration, live product/stock write acceptance, Supabase pgTAP against staging, and simultaneous separate-session race tests. These require the reviewed migration on an approved environment. No simulated browser writes are claimed as Cloud acceptance.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run format:check
npm.cmd run build
node --env-file=.env.local scripts/verify-cloud-login.mjs http://localhost:3000
```

The isolated integration suite executes both migrations unmodified in embedded PostgreSQL, checks the RLS/grants/RPCs, negative stock, exact prices, stale product versions, retries, payload conflicts, actor/state/day checks, overflow, immutability and rollback after an injected audit failure. Provider-owned `auth.users`/`auth.uid()` are test stubs. PGlite has one database session; true multi-connection lock races require staging acceptance.

Supabase pgTAP tests are also provided at `supabase/tests/sprint1.test.sql`; they roll back fixtures and require a disposable database with no active operational day. Cloud is not reset or seeded to run them. Browser Cloud verification is read-only apart from authentication: existing logins, dashboards, protected new screens, mobile sizing and sign-out. Live product/stock write acceptance awaits migration approval.

## Next work

Finish the remaining requested backlog only after explicit scope selection: customer identities/negotiated prices, vehicles, dedicated refill/damage transactions. Sprint 2 then adds trips, atomic warehouse-to-vehicle loading, assigned-driver reads, repeated visits and admin-confirmed returns. Normal workflow movements must never be substituted with manual corrections.
