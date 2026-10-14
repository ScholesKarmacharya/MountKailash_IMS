# Final integration verification — 13 October 2026

This report concerns the existing repository before deployment. Business writes, resets and account changes were restricted to disposable loopback PostgreSQL fixtures. No production Supabase records were modified, no production reset was run, and nothing was deployed.

This is the verification checkpoint before trusted-device PIN access. The subsequent implementation, migration 22, configuration requirements and latest executed tests are documented in [TRUSTED_DRIVER_DEVICE_ACCESS.md](TRUSTED_DRIVER_DEVICE_ACCESS.md).

## 1. Features tested

| Area                       | Executed coverage                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unified driver screens     | My Stock, New Sale, Customers, Unreturned Jars, Sales History and Return to Warehouse retain the driver URLs online and offline. Inline device unlock, navigation without repeated unlock, offline history filtering, refresh/reopening and encrypted persistence are covered. |
| Sales and inventory        | Online Paid, offline Credit, customer prices, quantities, empty returns, local stock projection, server acknowledgements and stock visibility in another admin browser.                                                                                                        |
| Synchronization            | Offline contact creation and ID linkage, interrupted uploads, a committed sale with a lost response, automatic reconnect, receipt reconciliation, original IDs, competing browsers and zero pending records only after confirmation.                                           |
| HOUSE                      | Approved free jar supplies reduce vehicle stock and create no customer credit. Mixed free jars/charged cartons, approval restrictions, reference prices, reports and historical snapshots are covered.                                                                         |
| Finance                    | Cash, Credit, partial/Fonepay admin entry, previous credit collection, invoice receipts, manual deposits, payment reconciliation and separation of jar custody from financial liabilities.                                                                                     |
| Product display            | Carton-only deliveries omit jar-return fields in forms, confirmations, history, documents and reports.                                                                                                                                                                         |
| Warehouse and day end      | Physical return declarations, admin verification, refill/damage, subsequent loading, closing blockers, cash reconciliation, immutable closing reports and next-day inventory/credit/custody carry-forward.                                                                     |
| Language and dates         | Admin English/driver Nepali defaults, switching without discarding draft values, BS display/ranges/date filtering, mobile layout, Nepali invoice text, Nepali daily-report PDF text and rendered font/line-bound checks.                                                       |
| Accounts and authorization | Pending/suspended driver restrictions, ownership of assigned trips and stock, denial of driver warehouse increases/return approval/day closure, raw-table RLS, immutable journals and server revalidation of queued operations.                                                |

The browser suites use Chromium at desktop and Pixel 7 mobile viewport sizes. Physical phones, Safari and Firefox were not tested. Fixture Auth/REST endpoints exercise the installed Supabase SDK and real application SQL/RLS in ephemeral PostgreSQL; they are not a hosted Supabase staging deployment.

## 2. Passed tests

| Final command                                   | Result                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run test:e2e:operations`               | **38 passed / 0 failed**, full desktop/mobile suite, 17.4 minutes.                                                                                                        |
| `npm.cmd run test:e2e:offline`                  | **22 passed / 0 failed**, full production-browser suite, 5.1 minutes.                                                                                                     |
| Independent final `npm.cmd test`                | **426 passed / 0 failed / 0 skipped**, 41 unit/integration files, 22.45 seconds with two workers.                                                                         |
| `npm.cmd run lint`, `npm.cmd run typecheck`     | Passed; lint has no remaining warnings.                                                                                                                                   |
| Normal production build with `VALIDATE_BUILD=1` | Passed in `.next-build-check`. The Nepali font is included in the daily-report route's deployment file trace. The offline suite's optimized production build also passed. |

The final runs contain **486 passing tests and no failures or skips**: 426 unit/integration tests and 60 browser tests. The complete browser suites include all files from the earlier unsuccessful online run, rather than only a targeted retry. `git diff --check` also passed.

The focused business-day/regression file has already completed with **4/4 passing** on desktop and mobile. It executes the following combined flow rather than inferring results from separate unit tests:

| Checkpoint                     | Verified result                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmed load                 | 100 full jars loaded to Driver A.                                                                                                                                                                                                                           |
| Customer A online Paid sale    | 20 delivered, 15 empties received, 80 full jars remaining; admin sees the confirmed sale; customer A owes 5 jars.                                                                                                                                           |
| Customer B offline Credit sale | 15 delivered, 10 empties received; 65 full jars and 25 empties on the device; customer B owes 5 jars.                                                                                                                                                       |
| Offline contact and reopening  | New contact persists in encrypted IndexedDB; two pending operations remain after offline refresh/unlock. The public metadata contains ciphertext, not the contact name.                                                                                     |
| Interrupted upload             | Server commits the offline sale, its response is lost, and connectivity is removed before contact upload. Reopening preserves the outbox; reconnect checks the original receipt and uploads the contact automatically. The offline delivery is posted once. |
| Confirmed totals               | Exactly two delivery visits/invoices, 35 full jars sold, 65 remaining, 25 empties received, both customer custody balances 5, and the contact linked to its original ID. Driver/admin refreshes agree; pending count is zero.                               |
| Previous credit                | NPR 50 collected from customer B without a third sale/invoice; credit decreases from NPR 2,253.75 to NPR 2,203.75. No jar deposit is created.                                                                                                               |
| Returns/refill/second round    | The driver seals the queue; admin verifies 65 full/25 empty jars. Admin refills 25 empties, loads another round with 20 jars and verifies its complete return.                                                                                              |
| Closing                        | Two completed rounds, 35 delivered, 25 empties collected, NPR 5,258.75 sales and NPR 3,055.00 net cash; custody/credit remain correct.                                                                                                                      |
| Report and carry-forward       | Actual Nepali PDF text contains the BS date, customer and NPR 5,258.75. The next business day opens with 90 full warehouse jars, NPR 2,203.75 outstanding credit and 5 jars owed by each customer. The prior archive stays unchanged.                       |

The controlled stale-response test holds an ACTIVE workspace response obtained before a warehouse-return save. A newer response must show SUBMITTED/awaiting verification before the old response is released, and the old response must not restore ACTIVE status.

## 3. Failed tests

Failures discovered during this verification are recorded here rather than counted as passing:

- Initial full online run: **36 passed / 2 failed**. The failures were the admin partial-payment/customer lookup scenario and driver return-status refresh.
- Diagnostic repetition of those files: **5 passed / 3 failed** across eight executions. Browser traces showed a customer request cancelled after approximately 2 ms and successful HTTP 200 return saves with stale UI data.
- The new tests initially exposed disappearing return confirmation and slow Nepali report export. Test authoring mistakes (GET requests have no JSON body, a refill RPC argument name, and the mandatory zero empty-jar count on the second return) were corrected without changing business validation.
- One unit/integration run overlapped a build: five database setup hooks exceeded 30 seconds, the translation scan exceeded five seconds, and 119 tests were skipped. Those skipped tests were not counted as passed; the final independent run executed and passed all 426 tests.
- An independent rerun passed 425 tests but the translation scan still exceeded its unchanged five-second limit while multiple PostgreSQL/WASM suites ran concurrently. Test workers are now capped at two to avoid resource starvation; deadlines and assertions remain unchanged.

**Final outstanding failures: none.** The complete browser suites, independent unit/integration rerun, type check, lint and normal production build passed. Earlier failed/incomplete runs remain listed above for transparency.

## 4. Bugs found and fixed

1. **Effect replay cancelled valid customer requests.** The selection hook aborted its request during immediate development effect cleanup/restart, producing a false network error and disabling review. Genuine unmount cancellation now happens after the immediate replay opportunity and invalidates obsolete request sequences. The driver IndexedDB connection follows the same lifecycle rule, preventing spurious closed-connection warnings during replay.
2. **A successful save reused a request begun before the write.** The dashboard could keep ACTIVE status or old quantities until a later timer. Connected direct saves now await a new, sequenced authoritative workspace request. An older response cannot overwrite it. Start/return acknowledgements live in the persistent dashboard because their forms can disappear when the confirmed state changes.
3. **Timeout and cancellation were treated as lost internet.** Customer request timeouts now produce TEMPORARY/503; superseded cancellation stays cancellation. The independent workspace probe also distinguishes timeout/server unavailability from a transport disconnection. Unit regressions cover both customer cases.
4. **Nepali closing PDFs exceeded the 15-second request limit.** Wrapping called Fontkit's full-string shaping for each growing text prefix. Line boundaries now use measured binary search at grapheme boundaries and one reusable segmenter. The actual archived report passed within the unchanged request limit; PDF extraction verifies BS text and money, and rendering tests verify line bounds and glyphs.
5. **Test-worker resource contention caused incomplete verification.** Concurrent PostgreSQL/WASM bootstraps could starve the translation scan and exceed setup deadlines. `vitest.config.ts` limits workers to two. No test timeout was increased and no assertion was removed.

Implementation changes in this verification:

- `src/components/delivery-customers.tsx`: request lifecycle and timeout reason.
- `src/components/driver-application.tsx`: connection lifecycle, timeout classification, authoritative refresh and persistent transition acknowledgement.
- `src/lib/customers/request.ts`: cancellation/timeout classification.
- `src/services/pdf.ts`: measured grapheme-safe wrapping performance.
- `tests/unit/customer-lookup.test.ts`: two request-error regressions.
- `tests/offline-e2e/business-day.spec.ts`: controlled stale-response regression and complete business-day test, including lost response and actual Nepali closing PDF.
- `vitest.config.ts`: bounded resource use for complete, repeatable verification.

No additional product features or alternative driver workspace were introduced.

## 5. Missing functionality / unverified scope

No requested business-day functionality is missing in the passing combined test. A freshly installed or unprepared device cannot create authorized offline stock: one-time online preparation and secure unlock are required.

Hosted staging Auth/JWT handling, deployment configuration, real-device browser storage/eviction behavior, and non-Chromium browser compatibility were not verified in this run. The separate cloud-backed Auth configuration was deliberately not used. Long-duration use beyond the configured authorization grant and physical cash/warehouse counts still require operational acceptance.

## 6. Database migrations

**No new migration is required by these fixes.** The disposable databases apply the repository's existing migrations, including offline synchronization, HOUSE policy and the customer/report RPC transaction corrections through `202610130021_house_workspace_transaction.sql`.

The deployment target must have the applicable existing migrations, grants and RLS policies. No migration was applied to production during this verification; no RLS policy was disabled.

## 7. Offline synchronization limitations

- Previously confirmed stock, cached customers and an unexpired authorization grant are required. The grant defaults to 24 hours and is configurable with `OFFLINE_AUTH_MAX_HOURS`.
- Reopening requires the offline passphrase. The decrypted key stays in memory; synchronization requires the app to be open and unlocked.
- A different browser cannot replace the registered writer. Lost browser data or a forgotten passphrase requires the existing recovery process; encrypted backups remain useful.
- Browser/OS storage eviction is outside application control. Persistent storage may be refused, and the app reports that condition.
- Changed pricing, suspended accounts/HOUSE policy, mismatched stock or other server conflicts retain evidence for review. They are not silently discarded or reported as synced.
- Collections against a still-pending invoice need its confirmed server invoice ID. Local estimates remain distinct from confirmed financial documents and balances.

## 8. Security issues

No authorization bypass was found in the executed cases. Tests use authenticated PostgreSQL roles and `auth.uid()` scopes, rather than relying solely on hidden UI controls. They deny warehouse increments, other drivers' records, return approval, day closure, raw offline token/evidence access, direct journal changes and approval/pricing changes by drivers. Pending/suspended actors and invalid queued operations are rejected server-side; HOUSE requests do not approve themselves.

These results cover the application guards and migrated SQL/RLS. They do not establish the security of an uninspected hosted Auth/deployment configuration.

## 9. Deployment blockers

**No known functional or code-test blocker remains in the tested scope.** All complete suites and build checks passed. Staging acceptance is still necessary before production release: use the intended HTTPS origin, isolated staging accounts/data, the intended Supabase Auth configuration and the actual delivery phones. Confirm migrations, service-worker reopening, storage permissions, account approval and server/admin visibility there. Those deployment-specific checks were not executed and are the remaining release gate.

No deployment, production test sale, stock adjustment, destructive reset or historical-record deletion was performed.

## 10. Readiness recommendation

**Ready to proceed to isolated staging acceptance.** The full business-day flow passed on desktop and mobile, with no inventory imbalance, lost outbox record, duplicated delivery/payment, incorrect customer custody or inconsistent credit in the executed scenarios. The final 486 tests and both build checks are green.

Approve production deployment only after the deployment-specific checks above pass. This report does not claim that a hosted production target or physical delivery phone has already been validated; no automatic deployment was performed.
