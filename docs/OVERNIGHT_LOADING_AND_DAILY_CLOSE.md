# Overnight loading and daily close

Implemented locally on 14 October 2026. Production Supabase was not changed or reset, and nothing was deployed.

## Root cause

Trips previously used `business_day_id` for both their original assignment/loading period and their delivery period. Creating a trip required the currently OPEN day. That assignment was immutable, and `ops_trip` required the assigned day to remain OPEN. Consequently, a trip loaded tonight could neither survive closing as a legitimate future allocation nor start against tomorrow's period.

The original `day_blockers` counted every non-CLOSED trip attached to the closing day and every vehicle with stock as unfinished business. The isolated 170-jar regression reproduces **two TRIP blockers and two VEHICLE_STOCK blockers** for the 85/65 overnight loads.

The browser test also exposed an authorization dependency: the existing business-day RLS policy showed drivers only their trip's referenced day. A prepared trip still referenced the old day, so its driver could not see the new OPEN day needed to start. The migration adds a narrow policy for approved drivers with their own prepared trip or pending authorized carryover. Stock, customer, finance and other-driver permissions remain unchanged.

## Existing logic reused

- `process_warehouse_jars` and the existing Refilling UI are unchanged. The SQL scenario calls the actual existing refill RPC to convert 170 warehouse empties into 170 eligible full jars.
- Existing `create_trip`, loading validation, warehouse availability checks, `trip_load_items`, immutable stock movements, balance locks, command idempotency and active driver/vehicle assignment constraints remain authoritative.
- Existing delivery, HOUSE approval/pricing, credit, custody, deposits, return submission and admin reconciliation functions remain in use.
- Existing daily close/review, financial reconciliation, offline-device checks, closing archive, BS calendar, EN/ने UI and encrypted IndexedDB journal remain in use.
- The existing trusted-device wrapper, PIN/passphrase unlock, acknowledgment checks, retry controller and stable transaction IDs remain in use.

## Lifecycle and date model

| Business state       | Existing trip state / metadata             | Behavior                                                                                                      |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Draft                | `DRAFT`                                    | Schedule only; no stock deduction.                                                                            |
| Prepared             | `LOADED`                                   | Admin-confirmed physical stock transfer; keeps its assignment and vehicle stock through earlier daily closes. |
| In progress          | `ACTIVE`                                   | Driver starts online when the scheduled date is eligible; no additional stock transfer.                       |
| Submitted / reviewed | `SUBMITTED`, `UNDER_REVIEW`, `DISCREPANCY` | Existing return and discrepancy handling.                                                                     |
| Confirmed            | `CLOSED`                                   | Existing admin physically verified settlement.                                                                |
| Cancelled            | `CLOSED` plus `cancelled = true`           | Draft cancellation or complete confirmed unloading, with an audit reason.                                     |
| Authorized carryover | `ACTIVE` plus `trip_carryovers`            | Paused pending settlement; same trip resumes in a later OPEN period.                                          |

`scheduled_date` is a canonical AD date displayed through the existing BS controls. `created_business_day_id` preserves the original assignment. `loading_business_day_id`, `loaded_at` and `loaded_by` identify the actual confirmed physical loading. The trip's operational `business_day_id` changes only on confirmed START or authorized CONTINUE. Existing start, visit, return and completion timestamps remain intact.

Loading belongs to the OPEN posting period at confirmation, even when that period spans midnight. Nepal calendar eligibility uses `Asia/Kathmandu`. Daily periods continue to close manually; their labels and actual timestamps are distinct. Sales, invoices and customer history retain their own original posting days. A carried trip's daily quantities are grouped by each visit's posting day rather than the trip's later day or its lifetime total. Loading is never classified as revenue.

## Night loading and tomorrow's work

1. Admin opens the existing Create Trip form and selects tomorrow's BS delivery date, driver and vehicle.
2. Draft creation changes no inventory. Admin uses the existing Confirm Warehouse Loading form after physically loading the stock.
3. Loading A = 85 and B = 65 from 170 leaves warehouse = 20. Loading is atomic, rejects over-allocation and records the original movement exactly once.
4. Daily Close lists the prepared vehicles, drivers, scheduled dates, full jars, cartons and warehouse availability separately from today's sales. Closing does not settle, unload, recreate or cancel them.
5. An authorized driver can cache the confirmed PREPARED snapshot on their trusted phone before the close and view it after offline reopening. This snapshot is read-only for deliveries.
6. Once tomorrow's OPEN period and scheduled date are eligible, the driver starts the original trip online and synchronizes its ACTIVE authorization. Deliveries can then be recorded through the same UI online or offline.
7. Selling 50 and 30 leaves each vehicle at 35 and the warehouse at 20. Original load records remain 85 and 65.
8. Drivers submit counted returns; admin physically verifies them through the existing reconciliation workflow. Returning both remaining 35s and 15/10 collected empties produces warehouse = 90 full / 25 empty. Returning empties does not refill them.

## Carryover, cancellation and closing safeguards

An active trip cannot be waived with an unexplained date change. Admin authorization requires a specific reason and appears as pending settlement in Daily Close. If its device is registered, the driver must first save and synchronize a PAUSE checkpoint containing the complete journal manifest. All prior operation IDs and fingerprints must be server-confirmed, with reported pending count zero. A missing manifest record, unresolved conflict, active writer or pending record continues to block closing.

PAUSE immediately prevents further local business writes while retaining encrypted records and assigned stock. Confirmed PAUSE sets the server round to PAUSED. Admin then records carryover, closes the old period and opens the next. The approved driver resumes the same trip and journal online; confirmed ACTIVE synchronization re-enables local deliveries. No second trip, loading movement or financial transaction is created. Old records arriving before the resume checkpoint require explicit review rather than being silently posted in the new period.

Rescheduling is limited to DRAFT/LOADED trips and makes no stock movement. Cancelling a LOADED trip requires exact counts for all assigned vehicle stock and physically confirmed unloading. A `TRIP_UNLOAD` vehicle-to-warehouse transfer preserves the original loading record; repeating the same command produces no additional transfer. The corresponding PREPARED device round is sealed. Drivers cannot schedule, load, authorize carryover or confirm their own unload/settlement.

Only future prepared allocations and correctly checkpointed authorized carryovers are excluded from trip/vehicle closing blockers. Orphan vehicle stock, current/overdue unclosed trips, stock-ledger differences, custody and financial reconciliation, registered-writer checks and unresolved offline records still block closing. Closing archives and persistent balances are retained. RLS remains enabled, and the workspace reader remains SECURITY INVOKER. Round-changing commands take the device-round lock before the trip lock, matching registration/upload order.

## Files changed for this request

Earlier online/offline changes already existed in this working tree. The main files for this request are:

- Database: `supabase/migrations/202610130023_overnight_trip_loading.sql`.
- Admin/driver UI: `src/components/trip-forms.tsx`, `trip-summary.tsx`, `trip-list.tsx`, `prepared-trips.tsx`, `day-report.tsx`, `driver-home-view.tsx`, `driver-application.tsx`; `src/app/admin/daily-close/page.tsx` and `src/app/admin/dashboard/page.tsx`.
- Shared data and commands: `src/domain/operations/{types,commands,driver-workspace}.ts`, `src/domain/business-days/types.ts`, `src/data-access/history.ts`, `src/services/driver-workspace.ts`.
- Offline journal: `src/domain/offline/{types,operations,projection,snapshot}.ts`, `src/lib/offline/{store,sync}.ts`.
- Translations: `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`.
- New regression tests: `tests/integration/overnight-trips-db.test.ts`, `tests/integration/overnight-migration-db.test.ts`, `tests/operations-e2e/overnight-loading.spec.ts`, `tests/offline-e2e/overnight-loading.spec.ts`.
- Supporting tests/fixtures: `tests/helpers/operations-provider.mjs`, `tests/integration/driver-approval-db.test.ts`, `tests/unit/{driver-workspace,localization-history,offline-storage}.test.ts`, `tests/offline-e2e/trusted-device.spec.ts`.

## Migration review

Migration 23 is forward-only and depends on the existing migrations through 22. It adds trip schedule/loading metadata, carryover audit records, the unload movement type, PREPARED/PAUSED device phases and the PAUSE operation. It wraps the existing loader/report/blocker functions and extends the authorized transition and journal entry points.

Backfill derives schedule and original assignment from existing business-day metadata. It does not change original stock, financial, visit or status fields. Historical loading metadata remains null rather than inventing timestamps or administrators, including when an older confirmed loading command is retried. The closed-trip guard is disabled only around the metadata backfill and re-enabled in the same migration transaction. Closed report JSON is not rewritten. The separate migration regression creates and closes a real trip using the pre-23 RPCs, then verifies every original trip/ledger field, its archived report, legacy load retry and the re-enabled closed-record guard after applying 23.

Migrations 22 and 23 were subsequently applied to the currently linked hosted Supabase database on 14 October 2026 with explicit user approval to resolve the trip-creation schema mismatch. All 530 original records across 47 tables retained their fingerprints, and authenticated API, metadata and security checks passed. See [the hosted trip correction report](TRIP_CREATION_SCHEMA_ERROR.md) for exact before/after responses and read-only browser verification. No application deployment was performed. The trusted-device configuration from the previous work, including the server-only recovery key, still applies.

## Tests executed

| Executed command                                                                                        | Result                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test`                                                                                          | **467 passed**, 46 files, exit 0; final source included the legacy loading retry fix.                                                                   |
| Focused overnight SQL / migration tests                                                                 | **13 passed** after the final loading metadata fix; the earlier approval/overnight review also passed all 21 tests.                                     |
| `npm.cmd run test:e2e:operations`                                                                       | **40 passed**, desktop and Pixel 7 emulation, exit 0 (10.2 minutes).                                                                                    |
| `npm.cmd run test:e2e:offline`                                                                          | **44 passed / 2 failed** in the first complete 46-case run. Both failures were the same incorrect synchronization-label selector.                       |
| `npm.cmd run test:e2e:offline -- tests/offline-e2e/trusted-device.spec.ts --grep "one-time activation"` | **2 passed** after correcting that selector, desktop and mobile. All 46 distinct offline cases have consequently passed, across the full run and rerun. |
| `npm.cmd run test:e2e:offline -- tests/offline-e2e/overnight-loading.spec.ts`                           | **2 passed**, desktop and mobile, against the final migration/loading metadata fix.                                                                     |
| `npm.cmd run lint`                                                                                      | Passed, exit 0, including the final UI changes.                                                                                                         |
| `npm.cmd run typecheck`                                                                                 | Passed, exit 0; final production builds also passed TypeScript verification.                                                                            |
| `VALIDATE_BUILD=1 npm.cmd run build`                                                                    | Optimized production build passed, exit 0, using the separate `.next-build-check` output directory. The offline browser builds passed as well.          |
| Prettier checks for touched files and `git -c core.safecrlf=false diff --check`                         | Passed.                                                                                                                                                 |

No unresolved automated test failures remain. Negative authorization, clock, over-allocation, mismatch and incomplete-checkpoint tests passed by verifying rejection and preservation of records, not by treating failed operations as successes.

The new isolated scenarios cover the original 170-jar refill, 85/65 preparation, close and next-day start, 50/30 deliveries, exact loading history, physical returns, future drafts loaded later, early-start rejection, atomic over-allocation rejection, conflicting assignments, rescheduling, exact/idempotent unloading cancellation, registered/unregistered carryover, incomplete PAUSE rejection, other-driver restrictions and retained stock-ledger closing blockers.

Desktop and Pixel 7 emulation exercise the actual app and IndexedDB: prepared stock cached before closing, offline PIN reopening with read-only stock, next-day online activation, offline sale, offline reload, reconnection, response loss after the server commits, acknowledgment reconciliation without duplication, registered carryover through another close, period-specific report totals and unchanged prior archives.

Issues found and corrected during implementation included the missing next-day RLS metadata visibility, the unload movement direction/type constraints, counting a closed trip again in a second same-date period, a disappearing START form hiding its success acknowledgment, and a browser assertion that searched for a separate synchronization label although the UI renders the label and date together. Final review also corrected legacy load retries potentially attributing old stock to the retrying admin and restricted the replacement loading RPC's execute grant to authenticated users. These failures are not described as passed until retested.

## Remaining limits and readiness

- Business workflow tests use disposable PGlite databases and loopback API fixtures. Subsequent hosted checks verified migration history, PostgREST schema reload, existing admin authentication, read-only browser rendering, metadata preservation and restricted permissions. Hosted business writes, Auth refresh/revocation, PostgreSQL concurrent-writer load, real phones and a real overnight wall-clock transition remain staging checks.
- Fixture-only date advancement simulates tomorrow's OPEN period; it does not modify the production clock or expose a date-change app endpoint.
- Prepared stock can be viewed offline, but START and CONTINUE require an authenticated online confirmation and synchronized ACTIVE snapshot. An offline phone cannot invent a new period or assignment.
- Conflict records stay on the device and require admin review. Authorization expiry and device revocation retain saved records but prevent further unauthorized changes. Browser storage deletion/loss remains outside the journal's durability guarantee.
- A reason alone cannot authorize registered-device carryover when the phone has not confirmed its complete pause checkpoint. This is an intentional closing safeguard.

Recommendation: complete migration review and staging verification before deployment. Local implementation and regression results do not establish production readiness by themselves.
