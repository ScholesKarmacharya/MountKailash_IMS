# Admin Unreturned Jars — implementation and verification

Implemented on 2026-10-14. The page is `/admin/pending-jars`; its sidebar entry sits directly below Customers. Existing driver screens and business posting workflows are retained. Prior working-tree changes were preserved.

## Existing jar logic reused

- `jar_custody_balances`: authoritative customer/product quantities. Cards aggregate these quantities, including HOUSE customers and inactive customers with retained obligations.
- `jar_custody_entries` and `custody_event_order`: immutable activity and historical balances. History groups each visit across products, using the existing resulting-balance snapshots and posting sequence. Corrections remain distinct audited events.
- `pending_jar_rows()` and `jar_return_allocations()`: existing FIFO outstanding lots and return allocations, including synchronized offline occurrence metadata. No new allocation algorithm or jar ledger was added.
- Existing `post_driver_delivery`/`post_trip_visit`, stock movements, vehicle receipt/reconciliation, `offline_post`, durable device storage, and `adjust_customer_custody` remain responsible for all writes.

## Admin page and components

- Teal/white responsive customer cards with name, REGULAR/HOUSE status, contact details, optional last delivery, a smaller bottom-left Jars to Return box, oldest outstanding date, and last activity.
- Clicking anywhere on a card opens an inline customer history panel on the same page. Keyboard focus and accessible links are supported. Card prefetch is disabled to avoid fetching every customer's history during browsing.
- Four summary cards show total outstanding, customers with outstanding, physical returns in the current BS month, and outstanding FIFO quantities older than 30 Nepal calendar days.
- Summary totals cover all customers; card filters do not alter those totals. This prevents hiding monthly returns made by now-settled customers.
- Search by name/phone; REGULAR/HOUSE, driver, product, and balance filters; highest, oldest, and name sorting. Outstanding-only is the default. All/zero balances remain available.
- A driver filter selects customers served by that driver, retaining their full confirmed balance across every driver. A product filter scopes card quantities and oldest dates to that product.
- Full history includes delivery/return quantities, net change, product balance and total customer balance after each transaction, BS occurrence date, driver/trip, confirmation metadata, correction reasons/admin identity, FIFO lots, and allocation history. It is not truncated to the existing driver context's 50 recent entries.
- English/Nepali messages and the existing Nepal timezone/BS calendar formatting are reused.

## Backend and synchronization

Migration `202610140024_admin_unreturned_jars.sql` adds two read-only RPCs:

- `admin_jar_workspace(month_start, month_end)` returns one confirmed overview snapshot. It reads authoritative balances and aggregates ledger activity and existing FIFO output in set-based queries. The service supplies the current BS month as a half-open Nepal-timezone range.
- `admin_jar_history(customer)` returns complete ledger history and existing FIFO allocations for one customer.

Both require an active ADMIN at the SQL boundary, use an empty search path, and restrict execution to authenticated accounts. Server services also require `admin:read`. No tables, RLS policies, historical entries, stock posting functions, or refilling code are changed.

Monthly returned quantities include only negative custody entries attached to genuine customer collection visits. Negative admin corrections, including permanent ownership exceptions, are not reported as physical empty returns. Aging is strictly more than 30 Nepal local calendar days; a lot exactly 30 days old is excluded.

The established `OperationalRefresh` is mounted once. It refreshes confirmed data every 10 seconds while visible, when returning to the tab, and through a manual Refresh button. No new realtime subscription is created. Pending/failed/disputed phone operations do not appear in this page because no custody posting exists until synchronization succeeds. Existing offline idempotency and acknowledgement reconciliation remain unchanged.

Customer empty collections decrease custody and increase vehicle empties. Warehouse empties increase only through confirmed physical trip receipt. That receipt does not deduct customer custody again. Closing and starting another trip do not reset customer balances. Existing overnight/future-trip and refilling tests remain in the regression suite.

## Corrections and permanent ownership

The user explicitly selected **Keep the existing audited admin exception** for permanent jar purchases. No purchase pricing or new permanent-purchase workflow was invented.

The history panel links to the existing customer custody correction form. It requires customer, jar product, signed adjustment, verified reason, open business day, and an admin identity. The existing atomic/idempotent correction RPC records actor, time, reason and audit history, and rejects negative resulting balances.

A confirmed permanent ownership exception uses that existing admin adjustment to release the return obligation after verifying the affected jars. The original delivery remains in history. The release is a correction, not a physical return and not a new payment/deposit posting. A return exceeding recorded custody continues to require authorized review; it is rejected atomically by the existing delivery workflow.

## Files changed for this task

New application files:

- `src/app/admin/pending-jars/page.tsx`
- `src/components/admin-jar-cards.tsx`
- `src/components/customer-jar-history.tsx`
- `src/domain/operations/admin-jars.ts`
- `src/data-access/admin-jars.ts`
- `src/services/admin-jars.ts`

Existing files updated:

- `src/components/navigation.tsx`: sidebar entry.
- `src/components/master-forms.tsx`: anchor on the existing custody correction panel.
- `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`: messages for this feature.
- `tests/helpers/operations-provider.mjs`: allow the new RPCs in the disposable loopback fixture.

Migration, tests and report:

- `supabase/migrations/202610140024_admin_unreturned_jars.sql`
- `tests/integration/admin-jars-db.test.ts`
- `tests/unit/admin-jars.test.ts`
- `tests/unit/admin-jars-service.test.ts`
- `tests/unit/admin-jars-data.test.ts`
- `tests/operations-e2e/admin-jars.spec.ts`
- `docs/ADMIN_UNRETURNED_JARS.md`

## Isolated verification

All database tests use disposable PGlite PostgreSQL instances with the real application migrations/RPCs/RLS. Browser tests use the loopback test provider; they do not read cloud credentials or modify production data.

| Requested case | Verified result                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A              | Opening 10, delivered 8, returned 5 → 13                                                                                                                                                  |
| B              | Next business day/trip: delivered 5, returned 10 → 8                                                                                                                                      |
| C              | Next business day/trip: return-only 3 → 5                                                                                                                                                 |
| D              | Confirm physical receipt and close day → balance remains 5                                                                                                                                |
| E              | Replay identical offline operation → one visit, one vehicle movement set, one custody posting set; confirmed admin quantity 3. A disputed operation remains absent from confirmed totals. |
| F              | Approved HOUSE 10/7 → 3 outstanding, zero free-supply invoice subtotal, no credit                                                                                                         |
| G              | Collection 5 → vehicle empties 5, warehouse empties 0. Admin receipt → vehicle 0, warehouse 5, identical custody history.                                                                 |
| H              | Multiple visits in one trip → one combined customer card, all visits retained                                                                                                             |
| I              | User-approved existing permanent-jar exception → audited liability release, zero outstanding, original delivery retained, zero physical-return count                                      |

Additional coverage checks authorization, excessive-return rollback, BS month bounds, 30-day FIFO aging, corrections excluded from monthly physical returns, zero filters, driver/product filters, multi-product historical totals, history beyond 50 visits, and desktop/mobile localization and confirmed refresh.

Final validation results:

- `npx.cmd vitest run`: **51 files, 492 tests passed; 0 failed**.
- Playwright admin-jar scenario: **2 passed; 0 failed**, desktop Chromium and Pixel 7 viewport. Checked live confirmed refresh, filters, history, English/Nepali, sidebar placement and horizontal overflow. Rendered desktop/mobile screenshots were visually inspected.
- `npm.cmd run typecheck`: passed.
- Production build with `VALIDATE_BUILD=1`: passed; `/admin/pending-jars` is a dynamic authenticated route.
- ESLint for all new application/test files: passed.
- Prettier checks for the new application/test files and this report: passed.

On this Windows environment, Playwright's automatic child-web-server shutdown stalled after the cases passed. A clean browser verification run used the same project settings with fixture servers managed explicitly; it exited successfully with `2 passed`. The temporary verification config was removed and the fixture servers were stopped. No application workaround was introduced.

## Deployment/review

Apply migration 24 through the normal reviewed deployment process after migrations 1–23. The migration was exercised locally and has not been applied to hosted Supabase by this task. If it is missing, the admin page shows a migration-required message instead of fabricated zero totals. No Supabase reset, RLS disable, historical deletion, or production-data test was performed.
