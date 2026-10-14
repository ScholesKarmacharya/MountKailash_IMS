# Registered-device delivery routing fix — 13 October 2026

This historical routing approach has been replaced by [Automatic driver connectivity](AUTOMATIC_DRIVER_MODES.md). Online drivers now use the normal sales form and unlock encrypted records inline when necessary; navigation no longer redirects into a separate offline workspace.

The screenshot's error is a different failure from the earlier customer lookup defect. Customer lookup now succeeds, but the regular online delivery form attempts to save a round that has already been prepared for offline use.

## Root cause and evidence

The `driver-visit` form invokes `post_driver_delivery`, which reaches the guarded `post_trip_visit` wrapper. Migration 17's `offline_gate` rejects a driver write unless the request belongs to the registered device queue. It raises SQLSTATE **42501** with **“Use the registered offline device for this delivery round.”** This protects pending device stock and transaction order. The routing bug was that `/driver/delivery` and `/driver/return` still rendered independent online forms for those rounds.

Read-only live browser diagnostics verified the existing approved driver's active round is registered (`ACTIVE`, confirmed sequence 3, reported pending 0). Regular and approved HOUSE customer API responses both returned **HTTP 200**. The new page route reached `/offline?trip=…&view=sale&customer=…` and offered recovery instructions rather than registering a competing device in the fresh diagnostic browser. No production delivery write was issued to reproduce the gate; the rejected form submission was reproduced in the isolated database/browser fixture. Reported pending is a server checkpoint, not proof that a locked local browser has no newer pending work.

## Changes

- Read public round routing metadata with the authenticated Supabase client and existing RLS. Request only `trip_id,phase`; never retrieve device token hashes. Fail closed if the lookup fails.
- Route New Delivery and Return to Warehouse into the registered workspace before rendering a direct-write form. Unregistered rounds retain their regular online forms.
- Preserve the requested round, view and customer through the public cached offline shell, including offline reload. Never substitute another round's local vault.
- For a form opened before another tab prepared the round, provide **Continue this delivery on the registered device**. Transfer only editable customer, jar/carton quantities, Paid/Credit choice, received amount, walk-in contact and notes in memory. Unlock the existing encrypted vault, download authoritative information when online, recompute prices/eligibility/custody and require a fresh review. Nothing is saved by transferring the draft.
- Hide preparation for a round with an existing local vault. A browser without its registered copy receives English/Nepali instructions to use the original browser/device or contact the warehouse admin. Interrupted preparation can still resume with its locally encrypted preparation credentials.
- Refresh the public offline app cache during an online unlock. A cache-update failure leaves encrypted records intact and tells the driver to reconnect before relying on offline reopening.
- Correct reload synchronization recovery: an acquired exclusive browser Web Lock can replace an orphaned IndexedDB lease. A busy Web Lock never permits takeover, and browsers without Web Locks continue to respect the durable lease timeout. The browser releases locks when a context terminates; this is why acquired exclusive ownership is stronger evidence than a leftover local timeout. See the [Web Locks specification](https://w3c.github.io/web-locks/#termination-of-locks).

No database migration or changes to RLS, server device gates, immutable operation IDs, fingerprints or durable receipt checks were needed. No existing Cloud business records were edited, reset or deleted.

Changed runtime files: `src/components/driver-round-workspace.tsx`, `src/components/operation-form.tsx`, `src/components/trip-forms.tsx`, `src/components/offline/workspace.tsx`, `src/data-access/offline.ts`, `src/services/offline.ts`, `src/domain/offline/types.ts`, `src/lib/offline/sync.ts`, and the English/Nepali translation JSON files. Tests changed: `tests/helpers/operations-provider.mjs`, `tests/unit/offline-storage.test.ts`, `tests/live-diagnostics/customer-lookup.spec.ts`; added `tests/unit/offline-round-routing.test.ts` and `tests/offline-e2e/device-routing.spec.ts`. This report and the follow-up pointer in `docs/CUSTOMER_LOOKUP_SYNC_FIX.md` document the repair.

## Validation

| Check                                                                                        | Result                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Full unit/database suite                                                                     | **414 passed**, 40 files, 0 failed                                                         |
| Production offline browser suite                                                             | **14 passed**, desktop/mobile, 0 failed                                                    |
| Targeted online regular/HOUSE, rapid reselection, expired authentication and HOUSE reporting | **6 passed**, desktop/mobile, 0 failed                                                     |
| Read-only live authenticated browser diagnostic                                              | **1 passed**; regular/HOUSE lookup and registered-round metadata HTTP 200, correct routing |
| Type check and changed-file ESLint                                                           | Passed                                                                                     |
| Real-configuration and isolated-offline production builds                                    | Passed                                                                                     |

The new browser tests reproduce the rejected stale online form, preserve its values through unlock, save a Paid delivery through the queue, synchronize it automatically and confirm one visit and one payment. A Credit delivery survives an offline reload, remains local while disconnected, synchronizes once on reconnect and creates the expected credit without a payment. The return entry opens the queue's return declaration. A separate browser cannot replace the writer, with recovery instructions verified in English/Nepali. Existing HOUSE free delivery, stock/custody, new-customer mapping, invoice, incorrect payment and price-refresh cases also passed.

Earlier runs exposed the orphaned lease delay and ambiguous assertions that matched Next's route announcer as well as the product alert. Both were addressed before the passing final run. The diagnostic also needed to consume a browser fetch body before retrieving it; the revised live diagnostic passed.

## Driver instructions and limits

For a prepared round, open New Sale and unlock with the offline passphrase chosen during **Prepare this device online**. Review and save on the device; keep the workspace open and unlocked until it shows server confirmation. An already-open form can use the transfer button without discarding its draft. The rejected direct-write attempt did not save a delivery.

An offline passphrase is not the Supabase account password and is not recoverable from Supabase. Other browsers cannot unlock the original browser's local storage. Missing device records or unresolved queue conflicts require the existing warehouse-admin recovery process. Without browser Web Locks, abrupt-close recovery may wait for the temporary lease to expire. Automatic sync requires the open, unlocked workspace; unsynced records remain encrypted locally when it is closed.
