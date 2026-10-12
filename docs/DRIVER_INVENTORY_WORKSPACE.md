# Driver inventory, sales and simple delivery rounds

Implementation and acceptance record, 2026-10-12. This extends the existing application and migrations 001–013.

## Root cause

The old home selected a non-closed trip, emphasized history, and had no cross-session refresh. There was no dedicated delivery/customer/return workspace. The connected Cloud project was inspected: its one listed trip was CLOSED with no load items. An empty driver stock screen was therefore correct for those records. Loading a new round is an admin operation; no Cloud stock or trips were fabricated to make the screen appear populated.

## Implemented behavior

- `/driver/home`: four prominent jar counters, loaded/sold/remaining cartons, visits, assigned vehicle, simple round labels, New Delivery and journal-backed day/round sales, cash, pending/reconciled Fonepay and credit issued.
- Six driver navigation actions: My Stock, New Delivery, Customers, Pending Jars, Sales History and Return to Warehouse. Touch targets, direct integer entry and fixed mobile navigation retain Mount Kailash styling.
- `/driver/delivery`: existing atomic posting logic, inline searchable/create/edit contacts, registered/repeated/walk-in visits, independent empty-only returns, resolved unit prices, payable/collected/outstanding amounts, review, confirmation and a stable retry key. Existing combinations of cash/Fonepay/credit, previous-credit collection and explicit deposits are reused.
- `/driver/customers`: active contact lookup, telephone/address/contact-person/type/delivery notes, pending-jar links and direct delivery selection. Registration/editing still requires an assigned ACTIVE round on an OPEN day. New contacts are immediately selectable without clearing quantities.
- `/driver/pending-jars`: FIFO lots, original dates, Nepal calendar age and driver/round references. Ordinary contact and pending-jar lookup work while waiting for a load; financial/customer context continues to require an eligible trip. Returns cannot silently make custody negative.
- `/driver/sales`: actual authorized invoices and receipts with existing private print/PDF routes; round history remains accessible.
- `/driver/return`: declares full jars, empties and cartons. Warehouse transfer occurs only after admin physical verification. Existing discrepancy/variance handling remains. Closed-round counters and returned stock do not pick up the next load on the same vehicle.
- Admin overview shows each listed current-day round's vehicle, stock, visits, new contacts, pending jars, sales and collections, with links to individual history and authorized operations. Pending-lot CSV/PDF rows include original dates, age and available driver/round references.
- Successful writes invalidate admin/driver layouts. Read-only workspaces refresh every 10 seconds while visible, on focus and on request. Mutable delivery drafts refresh explicitly. No logout is needed after admin loading.

Warehouse, vehicle stock, customer jar custody, financial credit and deposit liability retain separate journals and server-owned transactions. Previous-credit collections never become new sales. Fonepay remains pending until independent admin reconciliation; no provider verification was added. Refilling stays explicit and admin-only.

## Migration 014 safety review

`202610120014_driver_inventory_workspace.sql` is the only pending file reported by the linked Cloud dry run. It creates no sample business data and adds no environment variables. **Cloud application is awaiting explicit user approval:** automatic approval review rejected the push because prior approval covered 012/013, while 014 changes live schema/RLS. No migration was executed. Approval was requested for this exact file; it will not be applied until the answer arrives.

- Adds blank, bounded `contact_person`, `customer_type` and `delivery_notes` fields. Classification is informational free text and never changes credit, billing or price rules. Existing private `notes` is retained separately.
- Adds the checked `save_delivery_contact` RPC and a private shared contact implementation. Original `save_delivery_customer` signatures and canonical retry payloads remain compatible. Both implementations keep optimistic versions, duplicate checks, actor/audit events and owned ACTIVE trip/OPEN day checks.
- Adds active-account read-only `pending_jar_directory` and extends the projected contact directory to support waiting drivers. It does not expose other drivers' raw trips, invoices or finance journals.
- Tightens raw customer SELECT RLS to admin: served-customer raw rows contained private admin notes. The application already uses projected contact RPCs; clients using direct driver customer SELECT must move to the projected directory. All existing RLS remains enabled and direct writes remain denied.
- Adds optional driver/round attribution to FIFO reader results without changing ordering, signed custody entries or original timestamps.
- No Auth users, IDs, roles, inventory movements, sales, payments, financial/custody journals, historical dates or archived reports are rewritten. No tables/functions are dropped and no old migration is edited.

DDL takes a brief customer-table lock and waits behind existing transactions. Deploy during a quiet interval. The populated-upgrade integration test covers users, customers, completed trips, stock/finance/custody journals, archives, audit events and pre-upgrade retries. Remote schema/grants and preservation fingerprints must also be compared after application.

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
# Continue only when this exact reviewed file is the complete pending list:
npx.cmd --no-install supabase db push --linked --yes
```

Do not reset, repair history, disable RLS, seed inventory or recreate accounts. Run linked Cloud CLI commands sequentially; concurrent CLI queries can rotate the temporary database login password beneath each other.

## Executed validation

The new complete inventory browser scenario passed on desktop and Pixel 7 against disposable PostgreSQL, using actual application SQL, server actions and screens. Its Auth/PostgREST adapter is test-only loopback; it never reads `.env.local` or contacts Cloud.

The scenario executes: 100 jars/2 cartons loaded; inline ABC Hotel contact; 35 full/30 empty/1 carton partial sale (65 full remain, 5 pending); 20 more jars on credit (45 remain); 5-jar equal-exchange walk-in cash sale; an empty-only return of 2 (3 oldest dated jars pending); blocked over-stock input; exact duplicate retry with no extra movements; declared return of 40 full/37 empty/1 carton; admin confirmation; same-day 80-jar reload automatically visible in the still-signed-in driver home; prior-credit collection; second return; manual day close/new day; unchanged archive, 140 warehouse full/37 empty carry-forward, NPR 8,314 credit and 23 customer jars; refresh/logout/login persistence.

| Command/check                                                                         | Executed result                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test`                                                                        | **221/221 passed, 22 files**, including populated migration upgrade preservation, RLS/private helpers, exact retries, contact metadata, FIFO, stock/finance/closing, report exports and closing-review counters.                                                                         |
| `npm.cmd run typecheck`                                                               | Passed.                                                                                                                                                                                                                                                                                  |
| `npm.cmd run lint`                                                                    | Passed.                                                                                                                                                                                                                                                                                  |
| `npm.cmd run format:check`                                                            | Passed after formatting the updated browser selectors.                                                                                                                                                                                                                                   |
| `$env:VALIDATE_BUILD='1'; npm.cmd run build`                                          | Passed in isolated build output without stopping the existing Cloud development server.                                                                                                                                                                                                  |
| `npm.cmd run test:e2e`                                                                | **48/48 passed** on desktop/mobile, including all five new protected routes.                                                                                                                                                                                                             |
| `npm.cmd run test:e2e:operations -- driver-inventory.spec.ts`                         | **2/2 passed**: complete new desktop/mobile stock/sales/return/reload/close scenario.                                                                                                                                                                                                    |
| `npm.cmd run test:e2e:operations`                                                     | Initially **14/16 passed**; the legacy trip-cycle test used obsolete home button/link labels. Corrected those selectors; no backend failure.                                                                                                                                             |
| `npm.cmd run test:e2e:operations -- trip-cycle.spec.ts`                               | **2/2 passed after correction**, including the exact 100 loaded / 80 delivered / 65 empties / 20 unsold reconciliation. Together the full run and targeted rerun verify all 16 desktop/mobile scenarios; a single 16/16 invocation is not claimed.                                       |
| `npm.cmd run test:e2e:operations -- daily-close.spec.ts`                              | **2/2 passed after the final report cutoff change**, covering closing/refill, archives, exports and next-day carry-forward.                                                                                                                                                              |
| `node --env-file=.env.local scripts/verify-cloud-login.mjs http://localhost:3000`     | Both existing roles passed actual Cloud browser sign-in, correct dashboard, mobile/desktop navigation, driver admin exclusion and sign-out: four role/viewport checks.                                                                                                                   |
| `node --env-file=.env.local scripts/verify-cloud-inventory.mjs http://localhost:3000` | Cloud warehouse **125 full / 0 empty / 170 cartons**, five adjustment ledger rows with balance integrity; driver stock RPC/direct-update denial, actual desktop/mobile UI totals and refresh/logout/login persistence passed. Before/after snapshot unchanged; no business data created. |
| `npx.cmd --no-install supabase db push --linked --dry-run`                            | Only migration 014 pending; no seeds or roles. 001–013 are already applied.                                                                                                                                                                                                              |
| Linked read-only catalog/preservation query                                           | 2 Auth users, 2 profiles, 3 customers, 1 trip, 0 visits/invoices/payments, 5 stock movements and 0 finance entries. RLS enabled, direct writes denied; existing records fingerprinted before the rejected push.                                                                          |
| `npm.cmd audit --omit=dev --json`                                                     | Zero reported production vulnerabilities. Existing development dependency advisories remain outside this feature change.                                                                                                                                                                 |

Initial new browser failures were selectors and missing public RPC names in the test-only adapter, corrected to real application labels/functions. Two concurrent Vitest runs hit the existing five-second PDF timeout during font embedding/parsing. That single CPU-heavy test now has a bounded 30-second timeout; all PDF content/multipage assertions remain, and the final full unit/database run passed. Transient canceled-request stream warnings from the Next development server did not fail browser assertions.

Additional real fixes: private admin notes are isolated from raw driver customer reads in 014; completed rounds never read a later vehicle load; totals remain visible during CLOSING_REVIEW while delivery posting stays locked; archived pending age uses the closing cutoff in both the UI and exports; automatic refresh always resumes after an operation settles, including a failed request.

Migration 014 and the six-page Cloud contact/pending acceptance remain **pending approval/application**. The extended `scripts/verify-cloud-operations.mjs` is ready to check the connected six driver pages, active customer lookup/private-note isolation and admin directories after application. Cloud write acceptance has not been executed. The local development server remains available at `http://localhost:3000`.

After the rejected push and Cloud browser verification, a fresh read-only query confirmed all Auth ID/profile/customer/day/trip/stock/finance fingerprints and business row counts match the pre-attempt snapshot. Remote history still ends at 013, extended contact columns remain absent, RLS is enabled and direct customer writes are denied. No schema or historical business data was changed in Cloud.

## Manual acceptance

Use approved staging inventory or genuine daily operations in Cloud. Do not create production fixtures for this checklist.

1. Admin opens a business day, creates a driver/vehicle round and confirms a 100-full-jar load plus optional cartons. Driver stays signed in; within 10 seconds My Stock shows Ready to Start and the actual load. Start delivering.
2. Use New Delivery: create/select ABC Hotel, check default/customer prices and contact details, deliver 35/collect 30. Check 65 remaining/35 sold/30 empties/5 pending with the original date in both driver and admin views.
3. Sell 20 to another customer, then perform a permitted walk-in equal exchange. Check actual cash, pending Fonepay, credit and any explicit deposit separately. Pending Fonepay must not increase verified totals.
4. Revisit ABC Hotel for an empty-only collection of 2. Verify 3 oldest jars remain, no new invoice, and the original date is unchanged. Try an excess delivery/empty return and confirm rejection without any ledger change. Repeating the same request must have one result.
5. Return to Warehouse: check physical full/empty/carton counts and submit. Warehouse totals remain unchanged until admin verifies. Inspect immutable movements, actor identities and discrepancy handling.
6. Admin confirms return, then loads another 80 jars in the same business day. Driver sees fresh counters automatically; original round history, pending jars and credit remain intact. No daily close is needed between rounds.
7. Collect previous credit without a sale; verify collections increase and sales do not. Check invoice/receipt print and PDF downloads.
8. Finalize returns, review/close the day as admin and open the next day. Check zero new daily sales/counters, carried warehouse/customer/credit/deposit balances and unchanged archived reports/exports.
9. Refresh and sign out/in on mobile. Search active customers while waiting. Confirm driver cannot load stock, change another driver's trip, approve returns, edit private admin notes/prices/ledgers or close the day.

## Remaining limitations and decisions

Hosted staging write acceptance, independent-connection PostgreSQL contention testing, production-volume performance, restore rehearsal and warehouse staff sign-off remain required for deployment. The disposable provider serializes transactions, so overlapping-driver tests do not prove multi-connection races. Admin round summaries currently read each listed round separately; volume testing is needed. History retains the existing recent-closed-trip window.

Online-first operation, anonymous ongoing jar custody, exact deposit/refund/offset rules, tax/PAN/VAT, credit limits and end-of-round cash/provider settlement remain provisional as documented in `OPEN_QUESTIONS.md`. Tax remains unconfigured until confirmed. Existing development dependency advisories and Cloud public-signup/deployment hardening remain tracked separately. The request's section titled “Warehouse Admin” lists driver restrictions; the consistent admin-authorized loading/reconciliation/closing model is preserved.

## Changed files

**Application and domain**

- `src/app/admin/customers/[id]/page.tsx`
- `src/app/admin/dashboard/page.tsx`
- `src/app/driver/home/page.tsx`
- `src/components/app-shell.tsx`
- `src/components/day-report.tsx`
- `src/components/delivery-customers.tsx`
- `src/components/navigation.tsx`
- `src/components/operation-form.tsx`
- `src/components/pending-jars.tsx`
- `src/components/trip-forms.tsx`
- `src/components/trip-summary.tsx`
- `src/data-access/pending-jars.ts`
- `src/domain/business-days/reports.ts`
- `src/domain/operations/commands.ts`
- `src/domain/operations/pending-jars.ts`
- `src/domain/operations/types.ts`
- `src/services/operations.ts`
- `src/services/pending-jars.ts`
- `src/app/driver/customers/page.tsx`
- `src/app/driver/delivery/page.tsx`
- `src/app/driver/pending-jars/page.tsx`
- `src/app/driver/return/page.tsx`
- `src/app/driver/sales/page.tsx`
- `src/components/admin-driver-activity.tsx`
- `src/components/driver-customers.tsx`
- `src/components/driver-round-workspace.tsx`
- `src/components/driver-stock.tsx`
- `src/components/operational-refresh.tsx`
- `src/domain/operations/driver-workspace.ts`
- `src/domain/operations/pending-age.ts`
- `src/services/driver-workspace.ts`

**Migration and Cloud verification**

- `supabase/migrations/202610120014_driver_inventory_workspace.sql`

**Verification scripts**

- `scripts/sql/cloud-driver-workflow-readonly.sql`
- `scripts/verify-cloud-operations.mjs`

**Tests**

- `tests/e2e/scaffold.spec.ts`
- `tests/helpers/operations-provider.mjs`
- `tests/integration/driver-workflow-db.test.ts`
- `tests/integration/finance-db.test.ts`
- `tests/operations-e2e/driver-workflow.spec.ts`
- `tests/operations-e2e/finance.spec.ts`
- `tests/operations-e2e/fixture-client.ts`
- `tests/operations-e2e/pending-jars.spec.ts`
- `tests/operations-e2e/trip-cycle.spec.ts`
- `tests/unit/business-days.test.ts`
- `tests/unit/pending-jars-service.test.ts`
- `tests/operations-e2e/driver-inventory.spec.ts`
- `tests/unit/driver-workspace-service.test.ts`
- `tests/unit/driver-workspace.test.ts`

**Documentation**

- `docs/ARCHITECTURE.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATABASE.md`
- `docs/DESIGN.md`
- `docs/SECURITY.md`
- `docs/TASKS.md`
- `docs/TEST_PLAN.md`
- `docs/DRIVER_INVENTORY_WORKSPACE.md`

- `README.md`
