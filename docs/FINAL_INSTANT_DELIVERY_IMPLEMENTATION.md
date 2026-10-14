# Final Instant Delivery implementation

Completed on 14 October 2026. Migrations 26 and 27 were applied to the existing linked Supabase project. This report supersedes the initial Instant Delivery implementation report. No production sale, return, payment, trip or stock allocation was created during hosted verification.

## 1. Existing functionality reused

Instant Delivery continues through `save_delivery_customer` and `post_driver_delivery`, including their stock, FIFO custody, pricing, invoice, payment and idempotency functions. It stores a lightweight persisted customer/event reference and immutable event metadata, rather than introducing another inventory or financial ledger.

Later returns use the existing `RETURN_ONLY` visit. Later collections use the existing payment allocation engine. Warehouse receipts still require the established physical reconciliation. HOUSE privileges, refilling, trip settlement, ordinary customer sales and historical day archives retain their existing writers and rules.

The shared driver application, trip-scoped snapshots, encrypted vault, synchronization controller, service-worker shell, plus/minus controls, BS calendar, language controls and teal/white components remain in use.

## 2. Root cause of the database warning

The linked project had migrations through **25**, while Instant Delivery migration **26 was pending**.

| Before migration                                    | Observed result                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Existing admin and driver `instant_workspace` reads | HTTP **404**, **PGRST202**: RPC absent from the schema cache.                       |
| Zero-row customer-column read                       | HTTP **400**, **42703**: `is_one_time` absent.                                      |
| Existing driver's actual trip-scoped stock read     | **ACTIVE** trip, **OPEN** day, positive confirmed allocation, no pending carryover. |
| Diagnostic operations/finance snapshots             | Unchanged during both read-only diagnostic runs.                                    |

The old UI also combined `records.available` and `data.delivering` in the form condition. A missing database capability therefore showed the “start a confirmed delivery round” message even when the driver already had an eligible trip. That condition is now separated: schema failure remains explicit, an older device snapshot asks for an online refresh, and genuine trip ineligibility shows **“No active delivery trip. Please contact the warehouse.”**

Allocation eligibility now uses trip-scoped reads. The overview RPC intentionally returns no load rows; using it to decide whether stock was confirmed would falsely reject a legitimate active trip. The service tests cover this distinction.

## 3. Driver changes

- **Instant Delivery** is in the existing navigation immediately after New Sale, as well as the My Stock shortcut. The mobile navigation retains two rows with four columns; its tested touch targets are at least 44px.
- An authorized active trip on an open day with a positive confirmed allocation opens the form immediately. Quantity controls display current confirmed or locally available vehicle stock and prevent over-selling.
- The database's existing unique indexes allow only one live trip per driver/vehicle. These were preserved. A defensive chooser requires selection if an unexpected response contains multiple eligible trips; it never silently posts to another driver's trip.
- Name and location are required. Phone is collected when possible and required when reusable jars or credit remain outstanding. Notes are optional. A permanent registration form is not required.
- Assigned active jar and carton products are supported. Carton-only deliveries show the carton counter and do not invent jar obligations. Ordinary events cannot use `FREE_SUPPLY` or HOUSE zero-price privileges.
- Review shows event name, location, product, quantity, empties, remaining jars, payment type and payable amount. The save action has no individual admin approval or confirmation step.
- The same component handles online and offline entry. Long names wrap within the form and event cards without expanding phone viewports.

## 4. Admin changes

Instant Deliveries remains after Trips in the sidebar. Its summary styling follows the approved Unreturned Jars approach: white cards, readable labels and prominent teal quantities. It shows total events, today's events, jars delivered, empties collected, pending jars, confirmed amounts collected and **Outstanding Credit**. Metrics follow the current filters.

Each event card shows name, contact, location, BS date/time, driver, vehicle, trip reference, named products and quantities. A highlighted **Jars to Return** box appears at the lower left. **Jar Status** (`All Returned` / `Pending Return`) and **Payment Status** (`Paid` / `Credit Outstanding`) are explicit and independent. Overall completion still requires both obligations to be settled; device and review states take precedence over a central-completion claim.

Cards can be opened by clicking their body or the existing Open action. Search covers name, phone and location. Filters cover driver, **vehicle**, Today, BS dates, pending returns, pending payments/credit and Completed. The admin page shows real database records only; missing schema no longer produces misleading zero summaries or a “no records” empty state.

The existing audited conversion to a regular customer preserves the same UUID, ledger, invoice and payment history. Admin monitoring and existing exceptional corrections do not become an individual-sale approval workflow.

## 5. Database migrations and preservation

| Migration                                             | Result                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202610140026_instant_deliveries.sql`                 | Adds `customers.is_one_time`, immutable event metadata, protected posting/conversion/read RPCs and the INSTANT offline envelope.                                            |
| `202610140027_instant_delivery_collection_access.sql` | Aligns event reads with authorized active collection, adds vehicle identity/document-access metadata and refreshes the schema cache. It changes no stock or payment writer. |

The dry run listed exactly these two pending migrations. Both were then applied successfully through the existing linked CLI. Remote and local histories now match through **27**. The authenticated Instant Delivery reader and customer-column checks return **HTTP 200** for both existing diagnostic accounts.

Before/after SQL fingerprints matched for **all 642 original records across 50 public tables**, with **zero mismatches**. The comparison excludes only the newly added `customers.is_one_time` property; all pre-existing customer fields and all other original row fields are included. The new event metadata table is separate from this original-record comparison.

The preservation diagnostic writes only a session-local temporary table, uses a repeatable-read snapshot, and rolls back its entire diagnostic transaction. It emits counts and hashes, never customer fields, receipt contents, passwords or device secrets. Fifteen post-migration checks passed for schema, RLS, helper permissions, immutable metadata, offline kind and the existing trip-exclusivity indexes. No reset, RLS disable, stock correction, financial rewrite or archive rewrite occurred.

Reproducible diagnostics: `scripts/diagnose-instant-delivery.mjs`, `scripts/sql/cloud-instant-preservation.sql`, and `scripts/sql/cloud-instant-verification.sql`.

## 6. Stock movement integration

The required 100 → 80 full jars and +15 vehicle empties scenario uses the existing authoritative movements. The one-time customer owes five jars through the same custody ledger used by Admin/Driver Unreturned Jars. Instant Delivery and Unreturned Jars are views of that balance, not independent balances.

An authorized custody exception is labeled **Resolved by Adjustment**, rather than falsely claiming that physically unreturned jars were all returned. Its actual physical-return quantity remains separate.

Daily close retains unresolved liabilities. Later return increases the collecting vehicle's empty stock. Warehouse empties remain unchanged until the existing physical warehouse receipt is reconciled. Collected empties do not become full jars automatically.

Unmatched excess empties are rejected for existing authorized custody/reconciliation handling; the event workflow cannot silently create negative balances. Permanent physical jar purchases remain the previously selected **audited admin custody exception**, separate from the ordinary returnable-jar delivery and physical-return totals.

## 7. Later returns and payments

An approved driver with an eligible active trip can search and open an active one-time reference for later collection, including an event originally delivered by another driver. Historical access for drivers who already served the customer remains available. Unrelated drivers without the required active collection scope remain denied.

The new reader requires existing operational authorization and either historical customer access or an active open-day trip with confirmed allocation and no unresolved carryover. Raw customer, invoice, payment and stock RLS were not broadened. Before existing document permission is established, an authorized collecting driver can view the event history but does not receive unusable invoice/receipt links. The existing return/payment writer records the new trip/customer association when collection is posted.

The later return records its actual occurrence date, responsible collecting driver and collecting trip. It creates no second sale, invoice or payment. Admin Unreturned Jars and Instant Delivery both reach zero using the same FIFO allocations. Original event references and dates remain intact across daily close and overnight carryover.

Later credit collection allocates money to the original invoice. It changes collections and outstanding credit, without becoming a new sale. Reserved/unverified amounts remain unavailable under the existing payment rules. Payment and jar settlement remain independent.

## 8. Offline synchronization

Offline entry uses a previously prepared/unlocked device with its confirmed active trip and stock. A single encrypted INSTANT operation preserves the stable event/customer UUID, quantities, prices, payment and occurrence time. Local projections update stock and liability, while the event remains **Saved on Device** until acknowledgement and a refreshed server snapshot.

Later empty collections remain DELIVERY/RETURN_ONLY operations. The shared runtime now also sends the existing event's credit-collection form through the existing **PAYMENT** vault path when a device is prepared. This fixes the prior form's online-only fallback without creating another financial engine. Both return and payment operations survive reload/PIN unlock and use their original sequence, operation ID and fingerprint on retry.

The server retains authentication, driver, device token, active phase, sequence, clock, carryover, cached-price and total checks. A conflict preserves the original operation as Needs Review and rolls back its business subtransaction. Genuine sync exceptions can require existing admin review; ordinary instant sales do not require individual approval.

Existing vaults remain readable. A legacy snapshot must refresh online before advertising the new database capability. Offline history explicitly identifies cached history and device records; its existing context cache retains up to 50 custody rows, with complete authorized history available online.

## 9. Files changed for the final workflow

| Area                               | Files                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared driver/admin UI             | `src/components/instant-delivery.tsx`, `src/components/navigation.tsx`, `src/components/driver-application.tsx`                                                                 |
| Eligibility and independent status | `src/domain/instant.ts`, `src/services/driver-workspace.ts`, `src/app/api/driver/workspace/route.ts`                                                                            |
| Capability and local projections   | `src/data-access/instant.ts`, `src/domain/offline/instant.ts`                                                                                                                   |
| Database                           | New migration 27; the existing pending migration 26 was applied without replacing its posting engine.                                                                           |
| EN/NE                              | `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`                                                                                                                                  |
| Diagnostics                        | `scripts/diagnose-instant-delivery.mjs`, both new cloud SQL checks, `tests/live-diagnostics/instant-delivery.spec.ts`                                                           |
| Tests                              | `tests/unit/instant-eligibility.test.ts`, `tests/unit/instant-trip-service.test.ts`, expanded `tests/integration/instant-db.test.ts`, online/offline `instant-delivery.spec.ts` |
| Documentation                      | This report; the initial implementation report now links here.                                                                                                                  |

The existing Instant Delivery routes, one-time customer filtering, customer conversion, sales/return/payment commands, warehouse reconciliation and refilling modules were reused.

## 10. Tests passed and failed

| Final verification                                           | Result                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full unit/integration suite                                  | **560 passed, 58 files**.                                                                                                                                                                                   |
| Instant Delivery database suite                              | **22 passed**, included above. All migrations applied to disposable PostgreSQL/PGlite.                                                                                                                      |
| Isolated online browser suite                                | **10 passed**: jar Paid/Credit flow, later collections, admin filters/conversion, carton-only order, no active trip, explicit schema-failure state, defensive trip selection, desktop/mobile.               |
| Isolated production-build offline browser suite              | **4 passed**: event/return durability, reload/PIN unlock, once-only synchronization, offline old-credit collection, desktop/mobile.                                                                         |
| Hosted business-read browser checks                          | **2 passed**: the existing driver opens the form with confirmed active stock; admin opens real records and vehicle filter. No business form submitted. Language-preference writes were intercepted locally. |
| Hosted schema/security SQL checks                            | **15 passed**.                                                                                                                                                                                              |
| Hosted preservation                                          | **642 original records / 50 tables unchanged**.                                                                                                                                                             |
| TypeScript, production build, targeted ESLint and formatting | Passed.                                                                                                                                                                                                     |
| Final failed checks                                          | **None**.                                                                                                                                                                                                   |

The UAT includes next-day Driver B collection, online and offline replay, matching Instant/Unreturned balances, physical warehouse timing, no second sale/payment, no eligible trip, insufficient stock, Credit/later collection and exclusion of HOUSE privileges.

Initial development checks caught an overly broad lookup condition for an unrelated driver without an active trip; the reader now requires active confirmed collection scope, and its denial test passes. A fixture-only attempt to rename Driver B through raw authenticated profile writes was rejected and corrected using the disposable test database's fixture owner; production permissions were not weakened. Initial diagnostic-only admin-approval and read-only temporary-table assumptions were corrected to match the existing role rule and a rolled-back temporary diagnostic transaction. None of these failed checks posted business effects to the hosted database.

A synthetic trip-choice check caught reuse of an in-flight snapshot after changing the selected trip. Query changes now force a fresh authorized read while retaining drafts; both desktop and phone choice checks pass.

Actual emulated viewports tested: **1280 × 720**, **412 × 839**, and **360 × 800**. New form/cards and EN/NE views were checked for horizontal overflow, and the hosted phone navigation was measured for 44px touch targets. These are browser-emulated sizes, not physical-phone certification.

## 11. Remaining limitations

- The database correction is installed. Application changes are in this workspace and verified with the linked backend; an external production-hosting deployment was not performed.
- Physical Android/iOS testing remains an operator UAT step. Hosted verification deliberately did not manufacture production deliveries or allocations; transactional UAT ran against isolated data.
- The current local `.env.local` lacks the existing server-only `OFFLINE_DEVICE_RECOVERY_KEY` required for **new PIN device preparation/recovery**. A configured runtime must provide its correct persistent key. This task did not invent or rotate recovery keys; prepared encrypted vaults, the existing passphrase path and normal synchronization retain their established behavior. Offline PIN scenarios used the explicitly configured isolated test runtime.
- The existing single-live-trip indexes remain authoritative. Multiple-choice behavior is defensive service/UI support, tested with synthetic service responses rather than weakening those indexes to create production duplicates.
- Early diagnostic cleanup used the SDK's global sign-out default for the two demo accounts. It was corrected to `scope: "local"` and verified. Existing sessions for those demo accounts may require a fresh sign-in; this affected Auth sessions, not the preserved business records.
- Offline history retains the existing cache limit. The broader dashboard audit's navigation/connection-panel redesign remains outside this targeted Instant Delivery work.
