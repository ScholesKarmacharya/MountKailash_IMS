# Instant Delivery implementation

This is the initial implementation record. The completed driver-initiated workflow, applied cloud migrations, final tests and current limitations are documented in [the final implementation report](FINAL_INSTANT_DELIVERY_IMPLEMENTATION.md).

Implemented locally on 14 October 2026. This adds the requested one-time delivery workflow. The broader Admin/Driver redesign remains at the audit stage in `docs/UI_UX_AUDIT.md`.

## Driver workflow

`My Stock` has an **Instant Delivery** action. `/driver/instant-delivery` uses one shared component in the persistent online/offline driver dashboard.

The form asks for event/customer name, phone, location, product, delivered quantity, collected empties, Paid/Credit, actual amount received for Paid, and optional notes. It displays the existing product price and tax-inclusive payable total. Drivers review the details before confirming. Names and locations are required; a phone with 7–15 digits and ordinary phone punctuation is required when jars or credit remain outstanding. No full regular-customer registration form is required.

Each save creates a lightweight customer reference and immutable event metadata in the same transaction as the existing delivery. All stock, custody, invoices, receipts and financial entries still come from the existing business writers. Separate events may use the same phone number. Retries retain the same event/customer UUID and command key.

Event history shows the original delivery, BS date/time, product quantities and price, driver/vehicle/trip, current event-specific jar liability, customer jar ledger, original invoice payments, adjustments and existing invoice/receipt links. Outstanding jars and money are separate. Completion requires both to be settled; device-only and review records remain clearly labeled.

**Collect Empty Jars** posts the existing `RETURN_ONLY` customer visit against the active trip. It increases vehicle empty stock and allocates returns through the established FIFO ledger without creating another sale or invoice. The current trip must include the jar product. Later cash collection allocates the existing payment workflow to the original invoice; reserved/unconfirmed payment amounts remain unavailable until verified. Admin collection remains available through the existing Customer Credit page.

## Admin workflow

`Instant Deliveries` appears immediately after Trips in the sidebar. It shows seven metrics: total deliveries, today's deliveries, jars delivered, empties collected, pending jars, confirmed amounts collected and outstanding payments. Metrics follow the current filters.

Search covers event/customer name, phone and location. Filters cover Today, BS date range, driver, pending jars, pending payments and completed events. Cards show contact details, driver, vehicle, BS delivery date/time, quantities, payment status and delivery status. Opening a card loads the full authorized transaction history.

One-time references are excluded from the ordinary Admin/Driver customer-management lists. **Convert to Regular Customer** requires an admin reason and records an audit entry. It changes the same customer's one-time flag and version; its UUID, jar entries, invoices, payments and delivery history remain intact. Event cards remain available after conversion. Returns from later regular deliveries cannot overwrite the original event's FIFO attribution.

## Database and business logic

Forward-only migration: `supabase/migrations/202610140026_instant_deliveries.sql`. It depends on the preceding migrations, including the existing offline/trusted-device/carryover functions.

| Addition                               | Responsibility                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `customers.is_one_time`                | Distinguishes lightweight contacts from ordinary customer management. Existing customers default to false.                                       |
| `instant_deliveries`                   | Immutable reference and contact/event snapshots. It is not a second stock or financial ledger.                                                   |
| `post_instant_delivery`                | Atomically reuses `save_delivery_customer`, `post_driver_delivery`, `ops_retry` and `ops_finish`.                                                |
| `convert_instant_customer`             | Admin-only audited conversion preserving identity and balances.                                                                                  |
| `instant_workspace`, `instant_history` | Authorized read models built from existing visits, FIFO allocations, invoices and payment allocations. Monetary JSON values use decimal strings. |
| `offline_post` wrapper                 | Adds the INSTANT envelope kind and delegates all older kinds to the existing implementation.                                                     |

Authenticated users have SELECT only on authorized metadata, with RLS and existing `can_read_customer` checks. Only protected RPCs write it. Private helpers and the renamed internal implementations are not client-callable. Drivers cannot convert customers, post to another driver's trip, or access unrelated customer history. Failed delivery operations roll back their new contact, metadata and all business entries together.

Pending jars survive ordinary daily close and authorized overnight carryover. The event's business date is read from its immutable original visit, so resuming the same trip on a later day cannot relabel it. Collected empties affect vehicle stock until the existing confirmed warehouse reconciliation returns them physically. Refilling logic, warehouse confirmation rules and the underlying inventory/finance/custody ledgers are unchanged.

Permanent physical jar purchases continue to use the previously selected **audited admin custody exception**. No separate permanent-purchase price or transaction workflow was introduced. An authorized custody correction may resolve the liability, but is not counted as a physical empty-jar collection.

An existing driver collection-display defect was corrected in `roundFinance`: the driver RPC intentionally withholds the accounting journal. When that journal is absent, display totals now use its already-authorized invoices, invoice adjustments and immutable payment verification events. Confirmations and reversals follow their actual posting days. Old-credit collections increase collections without becoming new sales. No finance writer or access rule was changed.

## Offline behavior

Offline entry requires the existing prepared, unlocked trusted device and active confirmed delivery round. The same form saves a single INSTANT operation containing the stable one-time reference into the existing AES-GCM encrypted IndexedDB vault. The established local stock, custody, finance projections and operation manifests include this kind.

Older vaults remain readable. Instant Delivery entry becomes available after refreshing an authorized snapshot that confirms the new database capability.

Until server acknowledgement and refreshed snapshot, the event is **Saved on Device**, including a fully paid event with no remaining jars. Local payment rows have no central receipt link. Offline reopening uses the existing service-worker shell and PIN unlock; it recovers the contact, quantities, liability and pending queue. A later return can be queued after the original event and reuses that same customer ID.

Synchronization validates the existing device token, driver, trip phase, sequence, payload fingerprint, operation ID, clock window and carryover guards. Cached prices and total must match authoritative server values. A conflict becomes **Needs Review** and preserves the original operation while rolling back its business subtransaction; the existing sync-review and notification machinery applies. Retrying the same confirmed envelope cannot create another contact, sale, stock deduction, return or payment.

Online history fetches the full authorized ledger. Offline history uses the established cached customer context and device operations, and explicitly asks users to reconnect for complete history. The existing context retains up to 50 custody-history rows; this feature does not enlarge that cache or replace its access policy. Customer references converted by an admin reconcile on the next snapshot.

## Main files

| Area                 | Files                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared UI            | `src/components/instant-delivery.tsx`, `driver-application.tsx`, `driver-home-view.tsx`, `driver-runtime-context.ts`, `navigation.tsx`                                           |
| Routes/read services | `src/app/admin/instant-deliveries/`, `src/app/driver/instant-delivery/`, `src/app/api/instant-deliveries/[id]/route.ts`, `src/data-access/instant.ts`, `src/services/instant.ts` |
| Domain/projections   | `src/domain/instant.ts`, `src/domain/offline/instant.ts`, offline `types.ts`, `operations.ts`, `projection.ts`, `src/lib/offline/store.ts`                                       |
| Existing integration | Operation command parsing, driver workspace/snapshot API, offline views, regular customer list filtering, `src/domain/operations/driver-workspace.ts`                            |
| Localization         | `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`; existing BS calendar, timezone and language controls                                                                             |
| Tests                | `tests/integration/instant-db.test.ts`, offline-storage and driver-workspace unit tests, online/offline `instant-delivery.spec.ts` browser tests                                 |

## Verification

- Full unit/integration suite: **542 tests passed across 56 files**. This includes 15 database cases applying every migration to disposable PostgreSQL (PGlite).
- Database coverage includes 20/20 Paid, 20/15 then later five-jar return across daily close, old-credit collection on a later day, overnight carryover date preservation, conversion, FIFO after conversion, audited custody exceptions, retries, rollback, over-returns, warehouse isolation, permissions, offline replay and price-conflict review.
- Encrypted storage tests cover atomic one-time contact/delivery persistence, a later return without a second sale, recovery after reopening, and rejection before persistence when identification is missing.
- Driver money-display tests cover journal-withheld totals, invoice corrections, later-day collection, payment verification/reversal days and unrelated trips.
- Static translation coverage, standalone TypeScript checking, targeted ESLint and Prettier checks passed. The production build passed.
- **Four browser cases passed** using a disposable loopback provider and separate authenticated driver/admin contexts. They cover online Paid and Credit creation, later return, old-credit collection, admin metrics/search/status filters, invoice/receipt links, conversion, EN/NE and offline reload/PIN unlock/single synchronization. The online phone case also checks a long event name through save and continuation; form and card text wrap without expanding the viewport.
- Actual emulated viewports include desktop **1280 × 720**, Pixel 7 **412 × 839**, and a separate **360 × 800** layout check. Screenshots are inspected for the new form, cards and history; tested driver layouts have no horizontal overflow. These are browser-emulated sizes, not physical-phone verification.

## Deployment status

No hosted Supabase migration, deployment or production transaction was performed. Apply migration 26 through the project's normal forward-only migration process after confirming migrations 1–25 are present, then deploy the matching application build. Existing installations need the new schema before Instant Delivery is enabled; other workspace screens tolerate a missing Instant Delivery RPC.

Hosted multi-device UAT and physical Android/iOS testing remain deployment checks. The broader audit's existing admin mobile navigation and connection-panel issues were not redesigned as part of this feature.
