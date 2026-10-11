# Sprint 4: daily closing, reconciliation and history

Implemented on `sprint-4-daily-close`, 2026-10-12. **Cloud migrations 009–011 are pending review and approval.** Cloud versions 001–008 were confirmed applied by a read-only catalog query and CLI dry run. No existing migration was edited, operational record created in Cloud, account changed, ledger reset or table dropped.

## Implemented behavior

- Admin opens a day manually using the existing audited, retry-safe opening RPC. The single active-day constraint includes OPEN and CLOSING_REVIEW. Asia/Kathmandu determines the initial label; explicit day IDs retain all activity across midnight. There is no automatic time cutoff.
- `/admin/daily-close` loads actual trips, stock and financial journals. Every unfinished trip, including an unladen draft, is linked to its resolution screen. Submitted trips require admin reconciliation; draft cancellation remains the existing reasoned operation.
- Critical blockers include vehicle stock remaining, unresolved trip status, pending Fonepay, unposted legacy visits, invoice/item inconsistencies, invalid allocations, missing or duplicate receipt settlements, unbalanced financial postings, negative receivables/deposits, stock/custody mismatches against immutable journals, and receivable/deposit journal discrepancies. An unpaid walk-in invoice needs explicit resolution; registered customer credit can carry forward.
- Begin review takes an exclusive day lock, rechecks blockers and moves OPEN → CLOSING_REVIEW. Normal stock, trip, custody and finance postings are frozen. An admin can explicitly resume OPEN with a reason; an audit event preserves that review attempt. Starting another day during review is forbidden.
- Confirm close requires a manually entered signed net cash handover, reconciliation evidence/notes, four specific checks and an explicit close confirmation. Recorded net cash includes receipts, reversals and cash deposit refunds. A mismatch blocks closure. Controlled closing inputs preserve the draft after a failed request.
- Closing checks again under the day lock, saves exact server timestamp/admin identity, persists one complete immutable report, changes the day to CLOSED and appends request/audit records in one transaction. Same-key retries return the original day without another report; changed payloads or stale versions fail.
- Warehouse stock, customer jars, receivables and refundable deposits are never reset. A new day selects only its own sales, collections and trips, which begin at zero, while cumulative balances remain intact.
- `/admin/reports` filters Nepal business-date labels, includes OPEN/review/CLOSED sessions and sums the selected days. Individual reports include opening/closing warehouse and damaged stock, physical quantities, trip/check records, item totals by driver/vehicle/product, customer visits, receipt allocations, sales/tax, cash/confirmed Fonepay, pending Fonepay, initial credit issued, previous-day credit recovery, closing receivables, deposits/refunds/reversals, processing and audit journals. Monetary values remain decimal strings derived by PostgreSQL.
- Private PDF and UTF-8 Excel-compatible CSV exports use a common row model from the exact same report. Both single-day and date-range downloads enforce server admin permission; underlying RPCs independently enforce active admin identity. Downloads use private/no-store headers. CSV text is protected against spreadsheet formula injection; signed numeric money remains numeric. PDF fonts are bundled and verified in production route traces.
- `/admin/refilling` records completed one-for-one eligible empty→full batches and separate reasoned damage inspections. Damage transfers jars to a dedicated DAMAGE location, unavailable for loading/refilling. Every operation locks balances, prevents negative quantities, appends before/after movements and processing/audit records, and deduplicates retries. The migration creates only the location identity, with no stock.
- Earlier-day invoice corrections and receipt reversals retain existing finance RPCs and automatically link amendments to their original CLOSED day. A report detail also offers an explicitly linked warehouse stock correction posted on a new OPEN day. The original archive/PDF/CSV stays version 1; subsequent amendment records and their posting-day links are displayed separately with an amendment version count.
- Dashboard adds completed/pending daily trips, actionable closing status, correct daily finance totals, warehouse counts and recent physical/financial operations. Existing authentication and inventory workflows remain available before Sprint 4 migration application; unavailable closing schema is stated explicitly.

## Definitions and provisional decisions

**Provisional cash handover:** admin records the day's net handover and evidence, matching recorded cash receipts less reversals/refunds. There is no assumed denomination counting, bank deposit, driver float, expense accounting or permission to silently write off a cash shortage. A genuine unexplained difference remains a blocker until the business approves its resolution policy. Legitimate receipt reversals and corrections must be recorded through existing audited operations.

**Provisional pending-payment control:** all pending Fonepay captured on the day block closing until an admin independently confirms or rejects them. Rejection retains any actual receivable; it does not invent collections or settle customer credit. Manual reconciliation is never labeled automatic gateway verification. This conservative gate can be revised after the business confirms an outstanding-payment closing policy.

Previous-day credit recovered uses the invoice's business-day ID, not the payment's `current_invoice_id` or calendar date. Repayment of an earlier invoice on the same day is still a collection but is not previous-day recovery. Invoice-level corrections affect journal sales; item breakdowns explicitly exclude these corrections rather than inventing product allocations. New credit issued is the immutable amount at issue, not the current outstanding amount.

Existing single warehouse/full vehicle unloading remain provisional. Deposits stay explicit/configurable with manual refunds; tax remains unconfigured unless existing confirmed settings say otherwise. No carton pack, deposit amount, price override or credit limit is invented.

An externally CLOSED day predating Sprint 4 has no original close snapshot or recorded cash review. It is labeled **legacy reconstructed**, using timestamped journals; the interface never presents it as a completed Sprint 4 archive. Cloud currently has one existing active day and no trips/invoices/payments. Existing Sprint 2 visits without finance posting are preserved and surfaced for review, never silently backfilled or cleared.

## Migration review and Cloud application

Apply only after approving these exact files:

| File                                          | Changes and safety review                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202610110009_sprint4_closing_schema.sql`     | Adds immutable closing, amendment and warehouse processing tables with RLS; adds a zero-stock damaged-location identity. Extends stock movement types/directions and adds a nullable processing FK plus a consistency constraint. Retains all old movement types. Protects CLOSED day metadata from update/delete and all days from truncate. DDL briefly locks and validates the existing stock table; review externally written rows and any conflicting object/location names. |
| `202610110010_sprint4_reports.sql`            | Adds private calculation/checklist helpers and authenticated admin history/report readers. No business data is populated. SECURITY DEFINER functions use an empty search path, independent active-profile checks and explicit grants; internal helpers are not callable by application/service roles. Review calculations and query cost on staging volumes.                                                                                                                      |
| `202610110011_sprint4_closing_operations.sql` | Adds atomic review/resume/close, linked stock corrections and warehouse processing RPCs. Adds finance correction-link triggers. Normal application writes already acquire a shared OPEN-day lock; close/review acquires an exclusive lock and reads without locking trip/customer rows, preserving lock order. Installing these functions never closes the active day or posts stock/money.                                                                                       |

The installed CLI dry run listed exactly these three migrations, without seeds or roles. The complete SQL was executed in disposable PostgreSQL tests. A CLI dry run checks history; it does not execute the new SQL in Cloud. Different migration files may commit separately, so a later failure must be inspected and fixed forward rather than resetting/replaying history.

Migration 009 also revokes the legacy service-role permission to write `business_days` directly. Day changes must use the validated lifecycle RPCs with an active admin identity; existing profile/Auth provisioning is unaffected. Existing external scripts that bypassed day RPCs must be updated before application. Reports distinguish net sales from invoice sales including tax, and exports retain the frozen company identity for each selected day.

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
```

After approval, during an appropriate operational window with the normal backup process available:

```powershell
npx.cmd --no-install supabase db push --linked
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db query --linked --file scripts/sql/cloud-sprint4-readonly.sql --output json
```

Do not add seed/include-all options, repair migration history, reset Cloud, disable RLS or rerun individual applied SQL files. No Docker, new dependencies, environment changes or credentials are required. The read-only SQL checks catalogs, grants, migration versions and preservation fingerprints; stock hashes exclude the new nullable `processing_id` schema field so existing historical values remain comparable.

## Executed validation

| Command/check                                                                            | Result                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm.cmd run typecheck`                                                                  | Passed strict TypeScript and route generation.                                                                                                               |
| `npm.cmd run lint`                                                                       | Passed without errors/warnings.                                                                                                                              |
| `npm.cmd test`                                                                           | 188 passed across 18 files: existing authentication/domain guards, 17 inventory + 25 trip + 22 finance + 27 closing PostgreSQL integration tests.            |
| `npm.cmd run test:e2e:operations`                                                        | 8 passed: actual desktop/mobile closing, finance, physical trip and stale-stock workflows against disposable PostgreSQL and the test-only loopback provider. |
| `npm.cmd run test:e2e:operations -- daily-close.spec.ts`                                 | 2 passed: final desktop/mobile closing regression, including single-day and date-range PDF/CSV exports.                                                      |
| `npm.cmd run test:e2e`                                                                   | 38 passed: unconfigured sign-in and unauthenticated route guards, including daily close/history/refilling and PDF/CSV/range exports.                         |
| `$env:AUTH_E2E_BASE_URL='http://localhost:3000'; npm.cmd run test:e2e:auth`              | 4 passed: real existing Cloud admin/driver sign-in, role redirects, responsive shell, admin exclusion and sign-out. No business writes.                      |
| `$env:VALIDATE_BUILD='1'; npm.cmd run build`                                             | Passed in separate `.next-build-check`; both new report export routes include the bundled font. Existing localhost:3000 server reused/preserved.             |
| `npx.cmd --no-install supabase db push --linked --dry-run`                               | Exactly 009–011 pending; no SQL applied.                                                                                                                     |
| `supabase db query --linked --file scripts/sql/cloud-sprint4-readonly.sql --output json` | Existing versions 001–008, RLS and restricted writes confirmed; current Auth IDs/profile and stock/finance preservation fingerprints inspected.              |

The closing browser flow actually exercised trip blockers, admin refilling/damage, freezing review, rejected net cash, preserved retry input, successful close, single/range PDF/CSV responses, date-filter empty states, new-day opening and carry-forward, archive persistence after refresh/sign-out/sign-in, and driver denial of pages/exports. It did not post any Cloud business records.

The existing Customers, Vehicles, Drivers and Trips pages also passed the read-only Cloud browser regression on desktop/mobile. Before/after Cloud fingerprints matched for Auth IDs, profiles, business days, warehouse balances, stock movements and finance journal. Final Cloud counts were two users/profiles, one business day/customer/vehicle/driver, two stock balances/movements, and no trips/invoices/payments. No sample records were inserted.

Failures during implementation included incorrect finance RPC arguments in new fixtures, assertions expecting a form after successful revalidation had removed it, and locator ambiguity with Next's route announcer. These test issues were corrected. Actual fixes include closing draft preservation after rejected handover, strict PostgreSQL JSON-boolean confirmation validation, and previous-day credit classification. No failing check is accepted as a pass.

## Manual acceptance after migration approval

1. Sign in as the existing warehouse admin at http://localhost:3000. Confirm existing warehouse quantities, users, customer identities and prior journals. Open Daily close and Daily history; the migration warnings should disappear after all three migrations are applied.
2. Reuse the current OPEN day. Create only genuine approved operational trips, or use an approved staging dataset. An unfinished trip must appear as a linked blocker. Complete driver visits and return declaration; admin checks actual full/empty/carton counts and records any explicit authorized discrepancy before approval. An unladen draft may be cancelled with a reason.
3. Record actual completed refills from eligible empties. Verify paired EMPTY decrease/FULL increase and audit history. Record damaged full/empty jars separately, checking their damaged-location balance and unavailable warehouse quantity. Excess quantities must fail atomically.
4. Review Payments. Leave Fonepay pending until independent evidence is available; pending is excluded from collections and blocks closing. Confirm/reject through the existing reasoned admin reconciliation. Check credits, cash, deposits/refunds and invoice corrections against their actual journals.
5. Begin closing review. Try a normal inventory/trip/payment write: it must fail while review is active. To resolve an issue, explicitly Resume operations with a reason, make the authorized correction and begin review again.
6. Enter actual net cash receipts less reversals/refunds. Enter a mismatched amount first only in staging: close must fail with unchanged day/report and retained draft. Check all confirmations, record evidence/notes and explicitly confirm Close Day. The day becomes CLOSED with exact actor/time and one archive. Replaying the same request cannot create another archive.
7. Open the closed report in Daily history. Compare physical counts, sales, confirmed collections, outstanding credit, deposit liability, opening/closing stock and trip checks with the ledger. Download PDF and CSV; date-range exports must match the selected day snapshots. Old-credit recovery is a collection on its posting day, never another sale.
8. Open the next day manually. Daily sales/collections/trips must be zero; closing stock, customer jars, credit and deposits must be unchanged. Refresh and sign out/in; the prior archive must retain its exact snapshot.
9. If a genuine prior-day correction is required, post the reasoned invoice adjustment/receipt reversal on the new OPEN day, or use the old report's linked stock correction. Verify a new amendment and posting-day journal, with unchanged original archive. Never reopen a CLOSED day to edit history.
10. Sign in as driver. Admin pages/exports must be denied independently of navigation. Driver retains only assigned operational access and cannot open/close/reconcile/adjust warehouse stock.

## Remaining acceptance and Sprint 5

- **Cloud Sprint 4 writes have not been executed:** migration approval/application and hosted-provider operational acceptance remain required. Local tests use real PostgreSQL application SQL but a test-only Auth/PostgREST adapter. No gateway verification or merchant settlement is simulated.
- **True multi-connection races remain staging acceptance:** PGlite has one connection. Exercise simultaneous close versus visit/submit/payment/reconciliation, duplicate close keys, last-stock loading and refill versus loading. Reviewed row/advisory locking and retry/rollback tests do not replace this run. A failed close must release all locks with no snapshot; a winning review/close must make a waiting writer reject the non-OPEN day.
- Confirm the detailed cash handover/shortage and pending-payment closing policies with warehouse staff/accountant before operational sign-off. No arbitrary cash writeoff or expense ledger is invented.
- Load-test long date ranges, large daily archives and existing scoped finance workspaces; reporting pagination/storage/archival performance needs production-volume validation. Generated PDFs are private on-demand documents, not copies archived in object storage.
- Approve any legacy finance reconciliation/backfill separately. Complete backups/restore drills, staff training, dependency security maintenance and deployment review before production sign-off. Existing deposit/tax/provider/offline decisions remain as documented in OPEN_QUESTIONS.

## Files changed

Database: three migrations above; `scripts/sql/cloud-sprint4-readonly.sql`.

Domain/server: `src/domain/business-days/{types,commands,reports}.ts`, `src/data-access/day-reports.ts`, `src/services/business-days.ts`, `src/services/dashboard.ts`, `src/domain/finance/reports.ts`, `src/app/operations-actions.ts`.

Screens/UI: `src/app/admin/daily-close/page.tsx`, `src/app/admin/reports/{page,[id]/page}.tsx`, `src/app/admin/refilling/page.tsx`, `src/app/admin/dashboard/page.tsx`, `src/app/admin/inventory/page.tsx`, `src/app/api/business-days/[id]/[format]/route.ts`, `src/app/api/business-days/export/route.ts`, `src/components/{day-forms,day-report,navigation,app-shell,inventory-forms}.tsx`.

Tests/tooling/docs: `tests/integration/business-days-db.test.ts`, `tests/integration/finance-db.test.ts`, `tests/unit/business-days{,-service}.test.ts`, `tests/operations-e2e/daily-close.spec.ts`, `tests/helpers/operations-provider.mjs`, `tests/e2e/scaffold.spec.ts`, `next.config.ts`, `README.md`, this report. No `.env` file, existing migration, account setup script or dependency was changed.
