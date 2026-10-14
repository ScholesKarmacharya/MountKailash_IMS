# Automatic driver connectivity — 13 October 2026

The subsequent complete business-day verification and final regression results are in [FINAL_INTEGRATION_REPORT.md](FINAL_INTEGRATION_REPORT.md). The validation figures below record the earlier implementation checkpoint.

For the later trusted-device PIN setup, recovery, revocation and session changes, see [TRUSTED_DRIVER_DEVICE_ACCESS.md](TRUSTED_DRIVER_DEVICE_ACCESS.md).

New Sale remains at `/driver/delivery`. The same driver layout owns My Stock, New Sale, Customers, Unreturned Jars, Sales History and Return to Warehouse. Navigation between these screens keeps the decrypted key in memory and works without a server-rendered navigation request.

## Root cause

The previous routing fix deliberately sent every registered delivery round to `/offline?trip=…&view=sale`, regardless of connectivity. This avoided the database guard but forced online drivers into a separate workspace and passphrase screen.

That guard remains necessary: migration 17's `offline_gate` rejects independent writes to registered rounds with SQLSTATE **42501**, “Use the registered offline device for this delivery round.” An independent `post_driver_delivery` / `post_trip_visit` write cannot account for stock already consumed by unsynchronized device operations. Removing the gate would permit inconsistent inventory and competing writers.

The implementation now joins the regular driver form to the registered encrypted outbox. Connected saves write durably to IndexedDB first, upload immediately through authenticated `/api/driver/offline` commands, and display “Saved to Supabase.” only after a matching durable receipt. Disconnected saves display “Saved on Device”. Both paths retain the same operation UUID, sequence, immutable payload and fingerprint. Unprepared, unregistered online rounds retain their authenticated direct Supabase save, including the original idempotency key.

The earlier online customer error had a separate database cause. The authenticated request `POST https://rbxuvflqqphdtahibzpm.supabase.co/rest/v1/rpc/delivery_customer_context` returned **HTTP 405 / SQLSTATE 25006**, `cannot execute SELECT FOR SHARE in a read-only transaction`. The STABLE HOUSE wrapper caused PostgREST to choose a read-only transaction around an existing locking authorization query. The application customer API exposed this as **HTTP 503 / SCHEMA**. Offline contexts used a writable VOLATILE entry point, so cached lookups worked. Existing forward migrations 20 and 21 fix the context/report transaction metadata. This connectivity change introduces no migration and does not alter RLS.

Testing a second round after offline reopening exposed another cause of lost confirmation: the original server action revalidated the entire driver layout. Next.js returned a replacement server tree alongside the successful action, replacing the cached public shell and clearing the confirmation. `driverOperationAction` uses the same authenticated command handlers and database idempotency keys without rebuilding that layout. The persistent dashboard refreshes authoritative data itself; existing admin and account actions retain their layout refresh.

## Data and security

- Authoritative online reads use authenticated `/api/driver/workspace` and the existing customer context API. A customer API error does not set the connection mode. Independent server checks distinguish a transport failure, server outage, expired authentication, authorization failure and schema failure.
- Online customer refresh installs a complete receipt-covered snapshot. Local stock, customer custody, pending credit and newly created contacts are projected into the same model used by the normal form. An incoming snapshot never deletes or rewrites unsynchronized operations.
- Changes to confirmed prices, HOUSE policy, custody or stock invalidate the review while retaining entered quantities, payment values and notes. The submitted reviewed total must match the authorized cached total. Failed lookup never grants free supply.
- FIFO synchronization checks committed receipts before uploading. Lost responses, reloads, retries and multiple tabs retain existing Web Locks, durable leases and original IDs. Duplicate local operation IDs are rejected inside the encrypted transaction.
- The public service-worker shell contains no customer or financial data. Only public HTML and static assets are cached. An offline refresh retains the driver URL and restores its authorized encrypted vault after inline unlock.
- AES-GCM encryption, PBKDF2 passphrase derivation, authorization expiry, confirmed stock requirements, server validation, RLS, queue conflicts, encrypted backups and return sealing remain enforced. Drivers cannot add warehouse stock; physical returns still require warehouse verification.
- A fully acknowledged, sealed round releases its in-memory key when the next confirmed load becomes active. Its encrypted records remain in IndexedDB. Other pending rounds are counted and can be selected for unlock; their transactions are never silently replaced by the current round.
- Language selection is retained in the encrypted records and restored on offline reopening. Customer filtering, BS history filters, approval/account screens and delivery-round history remain available. Active round history links enter the unified sales and return screens.

## Device access

On My Stock, choose **Set up offline access** while online after starting a confirmed loaded round. Create a passphrase of at least eight characters. Existing records use **Device access** to unlock inline. This passphrase is separate from the Supabase password.

Opening New Sale online shows the regular sales form without redirecting or demanding a passphrase on navigation. If the registered encrypted device is locked, the first save requests inline unlock and preserves the draft. Business changes during unlock require another review. The key remains in memory across the six screens; a refresh or reopening requires unlock again.

## Changed files

- Dashboard and routing: `src/components/driver-application.tsx`, `driver-runtime-context.ts`, `driver-home-view.tsx`, `driver-sales-view.tsx`, `trip-list.tsx`, `app-shell.tsx`, `navigation.tsx`, `driver-round-workspace.tsx`; the six `src/app/driver/*/page.tsx` entry pages, `src/app/offline/page.tsx`, `src/app/manifest.ts`.
- Forms and views: `src/app/operations-actions.ts`, `delivery-customers.tsx`, `trip-forms.tsx`, `trip-summary.tsx`, `operation-form.tsx`, `operational-refresh.tsx`, `driver-stock.tsx`, `localization.tsx`, `offline/workspace.tsx`, `offline/collection.tsx`, `offline/views.tsx`.
- API and local data: `src/app/api/driver/workspace/route.ts`, `src/app/api/driver/offline/route.ts`, `src/data-access/offline.ts`, `src/lib/offline/server-response.ts`, `src/lib/offline/store.ts`, `src/domain/offline/connectivity.ts`, `src/domain/offline/projection.ts`, `src/domain/operations/customer-errors.ts`.
- English/Nepali dictionaries, updated offline/live browser tests, new unified-mode browser tests, connectivity and encrypted-storage unit tests. The obsolete redirect test was replaced by unified-interface coverage.

No Cloud stock, sales, customer records or migrations were reset or deleted. Transaction scenarios run against disposable loopback databases; live diagnostics use existing authenticated records without posting deliveries.

## Validation

| Check                                                                                                                                                | Result                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test`                                                                                                                                       | **424 passed**, 41 unit/integration files. Includes real PostgreSQL authorization, idempotency, HOUSE, finance, inventory and encrypted IndexedDB tests.                                                                                                                                                                                                |
| `npm.cmd run test:e2e:offline`                                                                                                                       | **18 passed**, desktop and mobile, against the production build and disposable loopback database.                                                                                                                                                                                                                                                       |
| Final targeted online rerun: `npm.cmd run test:e2e:operations -- customer-lookup.spec.ts finance.spec.ts trip-cycle.spec.ts driver-workflow.spec.ts` | **10 passed**, desktop and mobile. Covers all six unsuccessful cases from the earlier full regression run, plus expired-token checks.                                                                                                                                                                                                                   |
| Earlier complete online regression run                                                                                                               | **32 passed / 6 failed** out of 38. Failures involved an unsettled language preference before navigation, outdated success-label assertions, missing return-status text, and a sign-in timeout while builds were running. The affected files passed the final 10-test rerun. The complete 38-test suite was not repeated after the final action change. |
| Live browser diagnostic: `node --env-file=.env.local node_modules/@playwright/test/cli.js test --config=playwright.lookup-live.config.ts`            | **1 passed**. Existing regular and approved HOUSE customer API requests returned **200**, registered-round metadata returned **200**, and New Sale remained at `/driver/delivery` with no passphrase on navigation. No live delivery was posted.                                                                                                        |
| `npm.cmd run lint`, `npm.cmd run typecheck`, normal production build with `VALIDATE_BUILD=1`                                                         | Passed. Production build uses a separate output directory.                                                                                                                                                                                                                                                                                              |

The required 100-jar scenario passed on desktop and mobile: online sale 20 → server-confirmed 80 remaining; offline sale 15 → durable local 65; offline refresh/unlock → still 65; reconnect → exactly two confirmed sales, 35 sold / 65 remaining on a separate admin browser, zero pending records. Tests assert sales, payments and inventory effects from actual server records.

Additional passing scenarios cover approved HOUSE free supply with no credit, regular Paid/Credit, temporary customer IDs, online pricing changes preserving entered quantities, review invalidation, English/Nepali, FIFO empty returns, sealed physical returns, a subsequent loaded round, lost acknowledgements, and a competing browser receiving **403 / AUTHORIZATION** without replacing the registered writer. Customer API 401/403/schema failures retain the draft and do not masquerade as offline connectivity.

Development failures discovered while implementing these changes were corrected and covered by the final targeted runs: replayed Dexie effect setup, ignored customer filters, language restoration, missing return status, and layout replacement after a confirmed save. No known failing required scenario remains.

## Remaining limits

Offline work requires a previously prepared, confirmed stock snapshot and an unexpired authorization grant (24 hours by default, configurable with `OFFLINE_AUTH_MAX_HOURS`). A different browser cannot replace the registered writer or decrypt its records. A forgotten passphrase cannot be recovered from Supabase.

Automatic synchronization requires the application to be open and the encrypted device unlocked. Closed applications retain their encrypted pending operations; they do not upload with a persisted plaintext key. Browser data removal can erase local records, so encrypted export and prompt synchronization remain useful.

Financial totals and invoice/receipt links refer to confirmed server records. Unconfirmed transactions and estimated customer balances remain visible separately. Credit from a still-pending invoice cannot be allocated to a collection until the server supplies its authoritative invoice ID. Conflicts are retained for explicit warehouse review rather than silently dropped or overwritten.
