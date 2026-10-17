# Integration verification — 17 October 2026

## Scope and starting state

Resumed the interrupted offline-first driver implementation. The repository has
since acquired automatic device preparation/recovery, the shared mobile driver
workspace and the combined admin trip creation/loading form. These existing
committed and uncommitted changes were preserved. Earlier reports describe
earlier revisions; the results below apply to the current working tree.

The original application required a network connection for authenticated pages
and business writes. It already had server-owned operations, append-only
inventory/finance/custody journals, checked PostgreSQL functions, RLS, approved
driver access, Paid/Credit sales, EN/NE and BS dates. Offline work extends those
operations rather than introducing another inventory or finance ledger.

## Implementation being verified

- One shared driver application provides stock, delivery, customers, pending
  jars, history, collections, instant delivery and return screens. Mobile tabs
  keep drafts mounted. Preparation and trip activation have separate states.
- Versioned Dexie/IndexedDB stores encrypted snapshots, the original operation
  envelopes, retry/receipt metadata, preparation records and preserved recovery
  archives. A successful local transaction is the acceptance boundary. A quota
  or storage failure must not report a successful save.
- The current automatic-access design stores a random installation secret and
  separate device token per user locally. AES-GCM protects the journal, but the
  automatic decryption secret is stored in the same browser profile. This is
  **not** a separate PIN or hardware protection boundary. Use device screen
  locks and controlled browser profiles; same-origin script access or a copied
  browser profile can expose locally available data. No Supabase admin password
  or service-role key is needed for offline operation.
- Server Auth, approval, assignment, device ownership, trip status and business
  day are checked again on upload. Offline authorization has a configurable
  duration, defaulting to 24 hours. A disconnected phone cannot immediately
  receive suspension; known authorization failures stop posting and preserve
  evidence. Signing out does not delete the outbox.
- Foreground/startup/reconnect/save/timer triggers run the sync controller.
  Browser Web Locks and a durable lease coordinate tabs. The server receives
  fixed UUIDs, sequence, fingerprint, original payload and occurrence time.
  Receipt lookup precedes replay, preventing a lost response from posting twice.
  Temporary failures retain retry metadata and back off.
- PostgreSQL commits the visit, stock/custody/finance effects and corresponding
  confirmation atomically. Original envelopes and audit evidence are retained.
  Customer conflicts, changed pricing and changed custody require explicit
  review; no last-write-wins financial correction is introduced.
- A sealed device manifest and server checkpoint precede ordinary warehouse
  reconciliation. Server-side zero pending is insufficient to establish that a
  phone has no unsent records. Missing-device exceptions require admin evidence
  and physical reconciliation. Daily closing retains its server-side blockers.
- The service worker caches the public application shell and selected static
  assets, not authenticated API responses or private invoices. IndexedDB owns
  business records; shell upgrades do not delete them. EN/NE and BS rendering
  stay in the existing application.

## Fixes and verification changes in this continuation

- Corrected an initial TypeScript TS2554 caused by an unused, uninitialized ref.
  Concurrent startup work subsequently introduced a properly initialized ref
  with actual uses; that work was preserved. The final checks below apply to
  the newer implementation rather than the intermediate cleanup.
- Added `whitespace-nowrap` to mobile navigation labels. At 360px, Customers
  previously wrapped its final letter. Inspected the new screenshot after the
  production-built responsive test; the label now stays on one line.
- Fixed an unchanged delivery review closing when a new REGULAR customer
  synchronized. Its local contact has no HOUSE version; PostgreSQL assigns a
  default HOUSE version and the context supplies HOUSE-product metadata. Those
  HOUSE-only fields now participate in review comparison only for HOUSE
  customers. Reproduced the failure on the previous build. The focused fixed-
  build regression passed on desktop and Pixel, including a subsequent real
  customer-price change that still invalidates review and preserves an explicitly
  entered received amount until corrected. Server validation, pricing, custody,
  stock and eligibility calculations are unchanged.
- Fixed registered-customer invoice detail receipts taking the legacy direct
  server action after an offline writer was registered. Invoice detail pages
  now receive the existing driver runtime; receipts retain their invoice
  allocation and use the same durable PAYMENT queue and checked server gateway
  as collections. The explicit Continue action reloads server-rendered details.
  A new production browser regression passed on desktop and Pixel: offline cash
  receipt, reconnect, one confirmed payment, refresh, another Fonepay receipt
  remaining PENDING, and unchanged inventory/sale counts. Receipt submission stays disabled until automatic preparation is READY;
  entering amounts during preparation preserves the draft. No SQL or payment
  calculation was changed. Admin forms retain their existing server actions.
- Updated operations browser tests for the current mobile contract: Start Trip,
  More navigation/sign-out, optional customer details, local-save acceptance,
  collections, collapsed history and Review Return/Confirm Return. Accounting,
  payment, FIFO, authorization, PDF and warehouse persistence assertions remain.
  Retried delivery tests replay the **original encrypted journal envelope**
  through the checked gateway, keeping keys/tokens inside the fixture browser.
- Made the customer lookup failure tests explicitly delay preparation. They
  exercise online lookup without a cached context; the offline suites separately
  exercise prepared customer selection. This avoids a preparation timing race
  that incorrectly expected HTTP failures to block a valid cached selection.
- Added a production operations runner to freeze the application during tests.
  Added separate driver verification output/ports so another editor's build
  cannot remove the build under test. A dev/HMR run encountered a Router
  initialization error and repeated restarts; production regression is recorded
  separately, without suppressing browser errors.

The main offline implementation and migration design are described in
[OFFLINE_FIRST_IMPLEMENTATION.md](../OFFLINE_FIRST_IMPLEMENTATION.md),
[automatic driver modes](AUTOMATIC_DRIVER_MODES.md) and
[offline device recovery](../OFFLINE_DEVICE_RECOVERY.md). The newer trip
selection/startup work being verified concurrently is described in
[DRIVER_CURRENT_TRIP_FIX.md](../DRIVER_CURRENT_TRIP_FIX.md).

## Commands and current results

| Command                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm.cmd test -- --maxWorkers=1`                                                                         | Latest rerun: **685 passed**, 68 files; no failures or skips, 109.68 seconds. Includes new selector/storage tests plus isolated SQL/RLS, journals, sync, recovery, migration preservation and trip loading. Earlier baseline: 680 passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm.cmd run typecheck`                                                                                  | Initially failed with TS2554; latest typecheck and production builds pass after the receipt integration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm.cmd run lint`                                                                                       | Latest run passed without warnings after the invoice receipt readiness guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm.cmd run test:e2e:offline -- --reporter=line`                                                        | **74 passed**, desktop/Pixel, 9.2 minutes. Production build frozen before the subsequent concurrent startup changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npx.cmd --no-install playwright test --config=playwright.driver-verification.config.ts --reporter=line` | Final fixed-build driver sweep: **20 passed**, desktop/Pixel, 3.6 minutes. Includes new-customer review and real price changes, current-trip selection, readiness, invoice receipts, offline/mobile workflows and responsive checks. Earlier sweeps: 12, 16 and 18 passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm.cmd run test:e2e:operations -- --reporter=line`                                                     | Initial 90-scenario dev run interrupted after stale-UI failures and concurrent HMR restarts. A 12-scenario correction run completed **2 passed / 10 failed**; the failed test assumptions were corrected for the production rerun.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm.cmd run test:e2e:operations:production -- --reporter=line`                                          | Initial production run exposed stale expectations and the invoice-receipt integration error; interrupted after desktop diagnostics. Full fixed-build run completed **76 passed / 14 failed**, 14.1 minutes. First affected-file rerun: **19 passed / 7 failed** (13.5 minutes). Remaining failures were missing server-acknowledgment waits and the nondeterministic simultaneous-customer setup. Final inventory/FIFO/trip subset: **8 passed / 2 failed**, 5.2 minutes; FIFO conflict review, overnight loading and 100/80/65 reconciliation passed on both projects. The remaining inventory failures exposed the regular-customer review race and an obsolete final balance label. After corrections, the complete inventory/carry-forward flow passed **2/2**, 1.4 minutes. Every original failed operations scenario has subsequently passed. These are overlapping reruns, not additional unique scenarios. |
| `npx.cmd --no-install supabase migration list --linked`                                                  | Read-only Cloud history: migrations 001–030 applied; 031 pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npx.cmd --no-install supabase db push --linked --dry-run`                                               | Read-only plan lists only `202610160031_trip_create_and_load.sql`; no seeds or roles. No SQL applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The driver production build was produced by `npm.cmd run test:e2e:driver-verification -- customer-review.spec.ts --reporter=line`; subsequent focused tests and the final 20-case command above reused that fixed output. The final complete inventory rerun used `npm.cmd run test:e2e:operations:production -- driver-inventory.spec.ts --reporter=line`. The 10-case FIFO/overnight/trip rerun used `npx.cmd --no-install playwright test --config=playwright.operations-production.config.ts driver-inventory.spec.ts overnight-loading.spec.ts pending-jars.spec.ts trip-cycle.spec.ts --reporter=line`.

The browser suites use disposable PostgreSQL/PGlite providers on loopback ports
17778, 17777 and 17779. They do not use the Cloud project's business data. The
driver verification build has its own `.next-driver-verification` output.
Physical phones, Safari and hosted
production write flows are not being claimed as tested.

## Files changed for this verification

Existing offline implementation surfaces verified and preserved include
`src/domain/offline/` (envelopes, projections and conflict validation),
`src/lib/offline/store.ts` and `device.ts` (versioned encrypted storage/access),
`src/lib/offline/sync.ts` (receipts, retries and coordination),
`src/services/offline.ts`, `src/services/offline-admin.ts`,
`src/data-access/offline.ts` and `src/app/api/driver/offline/route.ts`
(authenticated server gateway), plus the PWA shell/registration and
`src/components/offline/` recovery and driver forms. The server ultimately posts
through the existing stock, custody and finance transactions.

- Driver label fix: `src/components/driver-mobile-layout.tsx`.
- Invoice receipt integration: `src/components/driver-application.tsx`,
  `src/components/finance-payment.tsx` and
  `tests/offline-e2e/invoice-receipt.spec.ts` (**2 passed**, latest receipt-only rerun 1.9 minutes).
- Customer review comparison: `src/components/trip-forms.tsx` and
  `tests/offline-e2e/customer-review.spec.ts` (**2 passed**, 18.4 seconds).
- Isolated runners: `scripts/test-driver-verification.mjs`,
  `scripts/test-operations-production.mjs`,
  `playwright.driver-verification.config.ts`,
  `playwright.operations-production.config.ts`, `package.json`, `next.config.ts`,
  generated-type includes and build-output ignores.
- Fixture isolation: `tests/helpers/operations-provider.mjs`,
  `tests/operations-e2e/fixture-client.ts` and the current-trip fixture reset URL.
- Updated regression scenarios under `tests/operations-e2e/`; README and this
  report. Existing uncommitted driver/admin implementation files belong to the
  concurrent tasks and were preserved. No mixed-work commit or push was made.
- No SQL migration was created or applied by this verification. Migration 017
  supplies the original offline schema; 031 is the preexisting pending admin
  loading change reviewed below. Environment files and credentials were not
  changed.

## Cloud migration safety

The original offline migrations are already applied. The only pending file is
`supabase/migrations/202610160031_trip_create_and_load.sql`, belonging to the
new admin workflow. It adds bounded proposed-load metadata to trips and checked
functions for saving draft quantities and atomically creating/confirming a load.
It composes the existing schedule/load writers, keeps helper execution private
and grants only the checked entry points to authenticated callers. Those entry
points require an active admin in SQL.

It does not reset the database, remove accounts, seed stock, delete history,
disable RLS, rewrite confirmed load journals or change historical invoice
amounts. Draft proposals do not move stock. A confirmed creation uses the
existing row locks, nonnegative balance checks, journal and payload-checked
idempotency. SQL tests cover failure after an actual movement and prove the
entire parent operation rolls back.

Applying DDL still changes the live schema and briefly needs table/function
locks. Schedule it away from active writes and confirm backup readiness. A
Cloud application has **not** been authorized or executed in this continuation.
After explicit approval, repeat the read-only dry run and confirm it still
lists exactly this file before using:

```powershell
npx.cmd --no-install supabase db push --linked --yes
```

Do not use reset, migration-history repair or an unrelated pending migration to
work around a mismatch. The new combined admin actions require migration 031;
their disposable-database test results do not mean those actions work in Cloud
before it is applied.

## Recovery and backup procedure

1. Keep the affected phone/browser profile intact. Do not clear site data,
   uninstall the application or replace a key that protects pending records.
2. Restore connectivity and sign into the same approved account. Let receipt
   lookup recover an ambiguous commit; do not re-enter the sale as a new one.
3. Review retained failures in Admin → Driver sync. Match a duplicate contact or
   authorize an eligible original retry with a reason. Preserve changed-price,
   custody, closed-day and rejected evidence for an explicit correction decision.
4. For a lost or unreadable writer, use the existing admin offline-access reset
   with a documented reason. The reset fences the previous writer and authorizes
   one replacement; it cannot recover operations never received from a destroyed
   phone. Recovered old-phone evidence must not be silently posted into a closed
   day. Reconcile physical stock and actual collections separately.
5. For hosted disaster recovery, the owner must verify the project's actual
   backup/PITR entitlement and latest recovery point. Supabase's
   [backup guide](https://supabase.com/docs/guides/platform/backups) describes
   available backups and logical exports. Keep exports encrypted outside the
   repository. No backup was exported or paid integration enabled here.
6. Perform a restore drill into a **separate, explicitly approved project** using
   [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).
   Compare account IDs/roles, migrations, journal totals, invoice and custody
   balances, closing archives and RLS. Check deployment/Auth settings separately
   before directing an isolated staging app at the restored project. Do not
   restore over the active production database as a test.

## Manual acceptance and release limits

- Legacy walk-in invoice receipts still use their existing online action.
  They cannot bypass the registered-writer fence. Recovery of a historical
  partial walk-in invoice on a registered trip needs the authorized admin
  receipt path while the trip remains eligible; the offline collection payload supports registered customers.
  New walk-in sales remain Paid with an exact total. This continuation does not
  introduce a new walk-in credit or invoice-receipt SQL protocol.

- On approved staging, open a day, load 100 jars, sign in and wait for Offline
  ready. Start the trip online; disconnect only after activation.
- Sell 35 and collect 30, create a customer, make a Credit sale and collect
  existing credit. Refresh/reopen offline; compare stock, pending records and
  original BS dates before and after reconnect. Verify each server record once
  from an independent admin session. Fonepay must remain pending until a real
  authorized reconciliation.
- Separately test 100 loaded / 80 sold / 65 empties, sealed submission and admin
  physical confirmation of 20 full / 65 empty. Try to close without a checkpoint
  and try another driver's trip and admin stock controls as a driver.
- Test the actual Android installation and iPhone Safari installation, keyboard,
  storage refusal, restart, OS eviction and upgrade while operations are pending.
  Browser emulation does not establish these physical-device behaviors.
- Repeat overlapping stock/load/post/close races on an approved multi-connection
  PostgreSQL staging target. The PGlite adapter serializes database requests;
  two browser sessions do not prove production lock-race behavior.
- Confirm high-volume/long-duration queue performance, recovery ownership policy
  and backup restore readiness before production sign-off. Locally retained
  records cannot survive browser deletion or physical device destruction by
  guarantee. No automatic Fonepay provider verification has been added.

Local implementation verification is complete. Every identified failing operations scenario was corrected and subsequently executed successfully. The original full operations execution remains recorded as 76/90 passed; subsequent targeted executions overlap and are not a claim of a new single-run 90/90 result. The final 20-case driver sweep ran against the completed client fixes. A fixture initialization attempt exceeded its former 15-second setup deadline; isolated schema setup now allows 60 seconds, and the receipt checks subsequently passed on both projects. Application validation and UI timeouts were not relaxed.

Production sign-off is **pending**: the new combined admin trip form requires approval/application of migration 031, and hosted staging acceptance, physical Android/iOS checks, multi-connection race testing and a separate-project backup restore drill remain outstanding. No known failure remains in the automated cases verified above; the legacy walk-in receipt limitation and offline storage/revocation limits remain explicit.
No Cloud migration, deployment, production fixture, account deletion or
historical-data removal has been performed.
