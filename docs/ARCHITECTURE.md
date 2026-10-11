# Architecture

## Stack
- Next.js App Router + TypeScript with server routes/actions, Tailwind + shadcn/ui.
- Supabase PostgreSQL + Auth; all business writes through authenticated server-side services. RLS as second defense.
- SQL migrations checked into repository; `NUMERIC` monetary columns, integer product quantities.
- PDF generation server side with persisted immutable invoice/closing identifiers.
- Vitest unit/integration, Playwright E2E; GitHub Actions CI optional.

## Component boundaries
1. **Auth / RBAC:** identity, account roles, active status, permissions.
2. **Catalog / Customer:** products, customer prices, deposit policies, customer setup.
3. **Inventory:** immutable movement journal and balances per location and stock state.
4. **Trips:** loading, route visits, returns, admin reconciliation.
5. **Refill:** transfer empty warehouse jars into full warehouse jars after completion.
6. **Billing:** invoice creation, sale items, price snapshots, credit allocations, customer ledgers.
7. **Payments:** cash, pending Fonepay, verified Fonepay when available, idempotent settlement.
8. **Business-day close:** snapshot reports, validation, lock, archive.
9. **Reporting:** read-only aggregates from journal, invoices and payments.

## Location model
Use stock locations with type `WAREHOUSE | VEHICLE | CUSTOMER | DAMAGED` and stock state `FULL_JAR | EMPTY_JAR | BOTTLE_CARTON` (not every combination valid). Customer custody ledger is separately maintained for accountability. A full jar sold moves from vehicle full-stock to customer custody; an empty return reduces customer custody and increases vehicle-empty. A refill changes warehouse empty to warehouse full. Prevent negative balances in transfer service.

## Atomicity
All multi-ledger writes run within database transactions with locked balance rows or an equivalent isolation approach. Validate business day is open, user role, trip state, product quantities, customer balance and payment sum before commit. Use idempotency key per client-side operation. Never trust totals from browser.

## Clock semantics
Store UTC timestamps (`timestamptz`) plus explicit `business_day_id`; show dates in `Asia/Kathmandu`. Business day may cross midnight and is closed manually, no automatic 22:00 cutoff.

## Read / write separation
Use server actions or API endpoints to call domain services. Never expose service-role credentials to the browser. Frontend has responsive `/admin/...` and `/driver/...` route groups and a common component library.

## Migration strategy
Schema migration -> seed demo admin/driver, products, customers -> add stock transaction services -> add trip services -> add finance and close. No hard-coded credentials. Sample data strictly labeled DEMO.

## Deferred integrations
Fonepay verification requires official credentials/docs and security review. Full offline sync is deferred until network needs confirmed. Do not claim either capability is complete in MVP scaffolding.
