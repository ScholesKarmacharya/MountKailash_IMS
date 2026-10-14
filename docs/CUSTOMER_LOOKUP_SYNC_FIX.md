# Customer lookup and synchronization repair — 2026-10-13

Customer lookup now succeeds for the existing approved driver and both regular and approved HOUSE customers. Two forward-only migrations correct function transaction metadata; neither rewrites business records, grants, RLS policies or function bodies.

## Exact failure and root cause

The failed authenticated request was:

`POST https://rbxuvflqqphdtahibzpm.supabase.co/rest/v1/rpc/delivery_customer_context`

Supabase returned **HTTP 405**, PostgreSQL **SQLSTATE 25006**, with `cannot execute SELECT FOR SHARE in a read-only transaction` for all five active customers, including the approved HOUSE customer. The driver's Auth UUID matched the active, approved profile and assigned active trip. The required customer columns, functions and migrations were present.

Migration 18 introduced a `STABLE SECURITY DEFINER` HOUSE wrapper around the existing customer reader. Its call chain is `delivery_customer_context` → `delivery_customer_context_before_house` → `delivery_customer_context_core` → locking trip/customer authorization. The existing reader takes `FOR SHARE` locks. PostgREST selects a **read-only transaction for a STABLE RPC even when the method is POST**. The outer wrapper therefore made the existing locking reader fail. [PostgREST's transaction documentation](https://postgrest.org/en/stable/references/transactions.html) explains that transaction mode.

The earlier SQL tests ran the wrapper in writable transactions and missed this difference. The browser provider now reproduces PostgREST's transaction mode from the RPC's declared volatility, so this regression is covered.

Offline reads followed a different entry point: `offline_contexts` is VOLATILE and runs in a writable transaction. The identical driver could read all five contexts through it with HTTP 200, then use the confirmed encrypted IndexedDB cache. Successful cached operation did not demonstrate that the online RPC was healthy.

The original online UI used a server action that reduced this provider error to a generic customer lookup message. The replacement customer API returned HTTP 503/`SCHEMA` while the defect was still present. Isolated browser network capture and Next server logs recorded the underlying RPC's 405/25006 for both customer types. After migration 20, both browser requests returned HTTP 200 and all five direct authenticated RPC requests returned HTTP 200.

The stricter browser tests also exposed the same mistake in the admin `house_workspace` reader, which calls the locking `ops_actor` guard. An authenticated live admin request independently reproduced HTTP 405/25006. Migration 21 corrects it; the same request now returns HTTP 200 and confirmed report rows. Other inspected read functions use guards appropriate for read-only transactions; the driver directory does not require a change.

## Database changes and verification

| Migration                                       | Reviewed change                                                                            | Deployment                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| `202610130020_customer_context_transaction.sql` | Set `delivery_customer_context(uuid,uuid)` to VOLATILE; reload PostgREST schema metadata   | Applied to the linked database |
| `202610130021_house_workspace_transaction.sql`  | Set `house_workspace(timestamptz,timestamptz,uuid,uuid,uuid)` to VOLATILE; reload metadata | Applied to the linked database |

These RPCs still require the existing authenticated authorization checks. Their owner remains `postgres`, SECURITY DEFINER is retained, authenticated execution remains permitted, and anonymous execution remains denied. RLS remains enabled for customers, pricing, custody, customer ledger, profiles, offline rounds and offline operations. The approved driver can search permitted active contacts through the restricted directory/context RPCs; private raw-table visibility remains scoped by RLS.

Read-only verification captured customer columns, migration versions 17–21, function metadata and RLS policy counts. Before/after counts and original-field fingerprints match across all 27 inspected customer, inventory, custody, billing, financial and closing tables. No seed, reset, record deletion, test sale or fake offline operation was performed in Cloud. Live checks used existing demo accounts and read existing data; write scenarios use isolated ephemeral PostgreSQL.

Repeatable diagnostics: `node --env-file=.env.local scripts/diagnose-customer-lookup.mjs`. It logs sanitized request statuses/error codes without credentials, session tokens or full customer records. Schema verification is in `scripts/sql/customer-lookup-verification.sql`. Local diagnostic evidence is under ignored `test-results/lookup-cloud-*`.

## Application changes

Customer selection calls the authenticated, uncached GET endpoint `/api/driver/customers/[id]/context?trip=…`. The server validates the current profile, driver approval, UUIDs, trip ownership and database authorization. Responses carry the verified user/trip/customer identities and private no-store headers. The proxy now refreshes Auth cookies for `/api/driver/*` as well as driver pages. A refreshable expired access token succeeds; an invalid refresh token returns 401.

Online responses and offline snapshots share `confirmedCustomerContext`. It validates customer identity, customer type/approval, prices, credit, custody and history arrays and HOUSE policy evidence. Legacy regular records normalize to REGULAR/NONE. A missing context, failed lookup or zero price cannot imply approved free supply.

Identity reads also distinguish a Supabase Auth/profile network outage or schema failure from a genuinely invalid session. Such outages no longer appear as an expired session. Offline records remain pending, and a network failure shows Offline rather than claiming server connectivity.

Customer selections cancel superseded requests and ignore stale responses. Quantities, notes and received amounts survive customer changes and retries. A failed/pending lookup blocks online saving and free eligibility until authoritative details load. Customer-specific prices, unreturned jars and credit come from the successful server response.

Errors distinguish network, authentication, authorization, missing/inactive customer, schema, temporary server failure and synchronization/business conflict. Authored messages are translated into English and Nepali; database diagnostics remain in server logs. A retry keeps the draft intact.

The unlocked offline workspace downloads authoritative contexts when an online customer is selected. It installs a complete receipt-covered snapshot instead of merging a partial context into stock/financial balances. Successful online-page lookup also signals matching unlocked offline tabs to synchronize. Cached customer records remain available offline. Unsynchronized local customers retain their temporary UUIDs and queue ordering; confirmed acknowledgments provide the server ID mapping without rewriting immutable payloads.

An unchanged refreshed snapshot preserves the offline delivery confirmation. Confirmation uses the relevant prices, HOUSE policy evidence, stock and custody rather than the download timestamp. A meaningful change invalidates the review while retaining quantities and received amount.

Every refreshed snapshot validates the driver, device, trip, confirmed sequence, complete customer contexts and server receipts. Each committed local operation must have a matching original UUID, sequence, payload fingerprint, result ID and processed time. Regressing, incomplete, duplicate or mismatched receipts reject the download atomically. Pending payloads and inventory deltas remain on the device. A malformed snapshot cannot produce “All Synced”.

The existing queue preserves operation IDs and retries with the same bytes. It checks committed receipts before reposting a lost response, serializes simultaneous tabs/controllers, uploads customer creation before dependent deliveries, and applies only acknowledged effects to confirmed balances. The server retains transactional idempotency for sales, payments and stock movements. Reconnection, focus and the periodic visible-workspace timer trigger retry; approval/price/custody conflicts retain records for admin review.

## Files changed for this repair

| Purpose                                      | Files                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forward-only database metadata               | `supabase/migrations/202610130020_customer_context_transaction.sql`, `supabase/migrations/202610130021_house_workspace_transaction.sql`                                                                                                                                                                                                                                                     |
| Shared model and error classification        | `src/domain/operations/confirmed-customer.ts`, `src/domain/operations/customer-errors.ts`, `src/data-access/operations.ts`                                                                                                                                                                                                                                                                  |
| Authenticated lookup and UI                  | `src/app/api/driver/customers/[id]/context/route.ts`, `src/lib/customers/request.ts`, `src/components/delivery-customers.tsx`, `src/components/trip-forms.tsx`, `src/proxy.ts`                                                                                                                                                                                                              |
| Safe snapshot installation and cache refresh | `src/domain/offline/snapshot.ts`, `src/lib/offline/store.ts`, `src/lib/offline/sync.ts`, `src/components/offline/workspace.tsx`, `src/services/offline.ts`, `src/data-access/offline.ts`, `src/app/api/driver/offline/route.ts`                                                                                                                                                             |
| English/Nepali errors                        | `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`                                                                                                                                                                                                                                                                                                                                              |
| Regression tests and isolated providers      | `tests/unit/customer-lookup.test.ts`, `tests/unit/offline-storage.test.ts`, `tests/integration/house-db.test.ts`, `tests/operations-e2e/customer-lookup.spec.ts`, `tests/operations-e2e/fixture-client.ts`, `tests/offline-e2e/house.spec.ts`, `tests/offline-e2e/offline.spec.ts`, `tests/helpers/operations-provider.mjs`, `playwright.offline.config.ts`, `scripts/test-offline-e2e.mjs` |
| Live read-only diagnostics                   | `scripts/diagnose-customer-lookup.mjs`, `scripts/sql/customer-lookup-verification.sql`, `playwright.lookup-live.config.ts`, `tests/live-diagnostics/customer-lookup.spec.ts`                                                                                                                                                                                                                |

Existing uncommitted HOUSE/offline implementation and other user changes were preserved.

Identity outage classification additionally changes `src/domain/auth/access-errors.ts`, `src/data-access/profiles.ts`, and `tests/unit/profile-read-errors.test.ts`. The original `tests/unit/profile-access.test.ts` is retained unchanged.

## Validation

| Check                                              | Result                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test -- --maxWorkers=2`                   | **406 passed** in 39 files; 0 failed                                                                                                                                      |
| Full operations browser suite                      | **37/38 passed initially**; the remaining mobile language-switch timing assertion passed on targeted rerun. All **38 distinct scenarios** validated across desktop/mobile |
| Mobile customer/session + trip-cycle rerun         | **3 passed**, 0 failed                                                                                                                                                    |
| Production offline browser suite                   | **8 passed**, 0 failed across desktop/mobile                                                                                                                              |
| Live authenticated browser diagnostics             | Regular and HOUSE lookup returned **HTTP 200** after the migration; pre-fix capture recorded the underlying 405/25006                                                     |
| Live direct Supabase requests                      | All **5 customer contexts**, `offline_contexts`, and the admin HOUSE report returned **HTTP 200**                                                                         |
| Type check, full ESLint, final changed-file ESLint | Passed                                                                                                                                                                    |
| Production builds                                  | Passed for real configuration and isolated offline fixture configuration                                                                                                  |
| Cloud preservation                                 | All **27** captured original-field counts/hashes unchanged; RLS retained                                                                                                  |

Tests cover regular/HOUSE lookup, rapid repeated selection, bilingual actionable errors, session refresh/expiry, identity network outages, missing or unauthorized customers, Paid/Credit, encrypted reload durability, customer-specific price refresh, immutable pending payloads, mismatched acknowledgments, lost server replies, concurrent synchronization, temporary customer IDs, exactly-once posting and admin visibility.

Failures found during investigation were addressed: the real RPC transaction defects, incomplete snapshot acknowledgments, and confirmation being dismissed by an unchanged snapshot timestamp. Early browser assertions also needed to accept the existing save-confirmation dialog and target delivery articles rather than the single household summary row. A concurrent full-unit run exhausted setup timeouts; limiting it to two workers passed all tests without weakening assertions/timeouts. The one mobile language-switch timeout in the broad browser run passed on rerun. There are no outstanding functional test failures.

The HOUSE sequence created/approved a customer in isolated PostgreSQL, loaded it online, supplied 15 jars and collected 10 empties, then prepared the device and recorded another 5/2 delivery offline. Verified final confirmed balances: **80 full jars**, **12 collected empties**, **8 customer jars**, **two deliveries**, **NPR 0 credit/payment**, and one set of effects per operation. Admin reporting displayed both confirmed deliveries. No corresponding test records were inserted into Cloud.

## Remaining offline limitations

The subsequent registered-device save-path error is fixed in [REGISTERED_DEVICE_DELIVERY_FIX.md](./REGISTERED_DEVICE_DELIVERY_FIX.md). New Delivery and Return now open the registered queue automatically; older forms can transfer their unsaved draft after the server rejects the direct-write path. The follow-up also repairs reload recovery of orphaned local synchronization leases.

- Prepare the active loaded trip online and choose a passphrase of at least eight characters before going offline. Previously synchronized customers and loaded products support offline recording; newly approved customers need a fresh online snapshot.
- Automatic synchronization runs while the offline workspace is open and unlocked. Closing the browser or locking records stops this retry loop; reopening/unlocking resumes it. The encryption key is not persisted, so a locked cache refreshes on unlock rather than accepting unauthenticated partial updates.
- A registered trip uses its single prepared device queue for both connected and disconnected recording. The existing server gate prevents independent online posting from bypassing pending device inventory. Use the prepared workspace for that trip until its queued return is acknowledged.
- Cached authorization expires after the configured period (24 hours by default). Revoked approval, changed HOUSE eligibility/prices or stock/custody conflicts require reconnection and, where appropriate, admin review; unsynced records remain retained.
- Device records depend on browser storage and the passphrase. Clearing browser data can remove unsynced records; encrypted export/recovery remains available. The passphrase cannot be recovered from Supabase because it is never stored there.

Daily closing, warehouse reconciliation, finance/payment rules, BS calendar, bilingual UI and existing reports remain covered by the regression suites.
