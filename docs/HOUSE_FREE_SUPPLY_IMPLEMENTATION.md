# HOUSE / Free Supply completion report

Implemented and verified on 13 October 2026. The application source is ready in this workspace. Forward migrations 17–19 were reviewed with dry runs and applied to the linked Supabase Cloud project. Application hosting was not redeployed as part of this change.

## 1. Features implemented

- Admin Add/Edit Customer supports Regular Customer and HOUSE, contact person, phone, address, notes, and approval status. Admin can approve directly, leave a request pending, suspend eligibility, or restore regular status with an audit reason.
- Driver customer creation supports HOUSE requests online and offline. Requests remain pending until an admin approves them.
- Approved HOUSE customers use server-calculated free pricing only for eligible products. Fully free deliveries show Free Supply and No Payment Required, hide Paid/Credit controls, and need no payment input. Mixed deliveries charge only the paid products.
- `/admin/pricing` contains product prices and eligibility, HOUSE customer totals and history links, free quantity/value summaries, customer/driver/BS date/month groups, and audited reference-value corrections.
- Reports support Today, This BS Month, Custom BS Date Range, customer, driver, and product filters. Exports include PDF and real `.xlsx` Excel workbooks with Nepali text support.
- Customer history, driver history, invoice documents, and new daily closing reports identify free supply separately from money and credit. Existing FIFO empty-return and unreturned-jar screens remain in use.
- English/Nepali labels, existing role defaults, language switching, and the Nepal timezone/BS calendar are preserved.

## 2. Files changed

The existing offline work was retained and extended. The HOUSE additions and integration points are grouped below; pre-existing unrelated workspace changes were left in place.

| Area                                 | Files                                                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database                             | `supabase/migrations/202610130018_house_free_supply.sql`, `202610130019_house_jar_defaults.sql`; existing pending prerequisite `202610130017_driver_offline.sql` was also applied                                                                  |
| Admin page and exports               | `src/app/admin/pricing/page.tsx`, `src/app/api/free-supply/export/route.ts`, `src/services/house.ts`, `src/services/xlsx.ts`, `next.config.ts`                                                                                                     |
| HOUSE domain                         | `src/domain/house/types.ts`, `pricing.ts`, `export.ts`                                                                                                                                                                                             |
| Customer/delivery UI                 | `src/components/house-customer-fields.tsx`, `house-filters.tsx`, `master-forms.tsx`, `delivery-customers.tsx`, `trip-forms.tsx`, `navigation.tsx`                                                                                                  |
| Customer/delivery services and types | `src/app/operations-actions.ts`, `src/services/operations.ts`, `src/data-access/operations.ts`, `src/domain/operations/commands.ts`, `types.ts`, `customer-context.ts`, `src/domain/inventory/validation.ts`                                       |
| History, finance and closing         | `src/app/driver/sales/page.tsx`, `src/components/customer-report.tsx`, `invoice-detail.tsx`, `day-report.tsx`, `src/domain/finance/driver-payment.ts`, `reports.ts`, `documents.ts`, `types.ts`, `src/domain/business-days/reports.ts`, `types.ts` |
| Offline integration/review           | `src/domain/offline/types.ts`, `operations.ts`, `src/lib/offline/store.ts`, `src/components/offline/workspace.tsx`, `views.tsx`, `src/app/admin/sync/page.tsx`, `src/services/offline-admin.ts`                                                    |
| Localization                         | `src/lib/i18n/en.json`, `ne.json`                                                                                                                                                                                                                  |
| New tests                            | `tests/integration/house-db.test.ts`, `tests/unit/house.test.ts`, `tests/operations-e2e/house.spec.ts`, `tests/offline-e2e/house.spec.ts`                                                                                                          |
| Test integration                     | `tests/helpers/operations-provider.mjs`, `tests/integration/driver-approval-db.test.ts`, `offline-db.test.ts`, `tests/offline-e2e/offline.spec.ts`                                                                                                 |
| Cloud verification                   | `scripts/sql/cloud-house-preservation.sql`, `cloud-house-verification.sql`                                                                                                                                                                         |

## 3. New database fields and migrations

| Table                       | Additions                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`                 | `supply_type` (`REGULAR`/`HOUSE`), `house_status` (`NONE`/`PENDING`/`APPROVED`/`SUSPENDED`), `house_version`                                                            |
| `products`                  | `house_eligible`, `reference_price` as exact `numeric(14,2)`, `house_version`                                                                                           |
| `visit_items`               | `supply_classification` (`SALE`/`FREE_SUPPLY`/`RETURN_ONLY`), `reference_price_snapshot`, generated `free_value_snapshot`; free items must have zero charged unit price |
| `sales`                     | `supply_classification` (`SALE`/`FREE_SUPPLY`/`MIXED`)                                                                                                                  |
| `sale_items`                | Item-level `supply_classification`, `reference_price_snapshot`                                                                                                          |
| `delivery_payment_intents`  | Allows explicit `FREE_SUPPLY` selection                                                                                                                                 |
| `driver_offline_operations` | `resolution_house`, restricted to an audited admin authorization of one original queued delivery                                                                        |
| `free_supply_adjustments`   | New immutable table: original visit, signed reference-value adjustment, reason, posting business day, actor and timestamp                                               |

Migration 17 supplies the existing offline device/queue/review foundation and original offline occurrence timestamps. Migration 18 adds HOUSE approval, product policy, snapshots, secure RPCs, reports and offline conflict handling. Migration 19 maps the default by the documented `FULL_JAR` product kind so generic jar names/SKUs work; it preserves explicit admin HOUSE pricing choices. Applied migration files were not rewritten.

Existing customers remain regular. Existing historical deliveries retain their original financial meaning; no historical transaction is guessed to have been free. Archived closing JSON remains unchanged.

## 4. Pricing configuration

Use **Admin → Pricing & Free Supply** to set default selling price, HOUSE eligibility and free-supply reference price. A reason and current product version are required. Existing customer-specific price editing remains linked from this page and applies to chargeable products.

The application specification defines `FULL_JAR` as the refillable 20L jar. Such products default to eligible; bottled-water cartons default to ineligible. Admin can change either setting. New jar products receive the same default even when the name contains no capacity.

At handoff the existing Cloud jar's selling/reference price is NPR 50.00 and it is eligible. The existing carton remains ineligible, with selling/reference price NPR 185.00. These original selling prices were preserved. Reference prices initially copy the current default selling prices and subsequently change independently. Customer discounts do not alter the product reference price.

Each free item stores its original reference price and value. Subsequent price/approval changes never rewrite these snapshots. Reference-value corrections are separate immutable records on their posting date, with reasons; they do not change physical quantities, money or original invoices. Existing audited stock/custody correction workflows handle physical discrepancies.

## 5. HOUSE approval flow and security

1. Admin creates/edits a customer and chooses HOUSE plus Pending, Approved or Suspended. The server records the change and reason.
2. Drivers can request HOUSE status and edit permitted contact details. They cannot approve requests, promote a regular customer to approved HOUSE, or remove HOUSE privileges.
3. Only active, approved HOUSE customers receive eligible free items. Pending/suspended customers use ordinary chargeable delivery rules.
4. Admin can manage eligibility/reference pricing and post reference-value corrections. Raw authenticated table writes are denied; RLS and server authorization enforce this independently of the UI.

The new admin RPCs explicitly validate an active administrator. Anonymous execution is revoked. Posting helpers, historical readers and snapshot-override helpers are private. Existing immutable stock, financial and audit journals remain protected; new free adjustments and offline review evidence are also immutable.

## 6. Inventory, custody and financial handling

The delivery follows the existing atomic stock-movement and custody transaction. It consumes vehicle full jars/cartons, adds collected empties to vehicle stock, checks available stock, and uses the existing FIFO return allocation. HOUSE customers can return empties without receiving water; return-only visits create no new sale, invoice, payment or free value.

The verified example uses 100 loaded jars, 15 supplied, 10 returned, and a NPR 50 reference price:

| Result                              | Value         |
| ----------------------------------- | ------------- |
| Vehicle full jars remaining         | 85            |
| Vehicle empties                     | 10            |
| Additional unreturned customer jars | 5             |
| Charged / collected / new credit    | NPR 0.00 each |
| Free reference value                | NPR 750.00    |

A fully free delivery has a zero-value document for traceability with Free Supply status. It creates no customer debt, financial journal amount, money receipt, new credit, or automatic refundable deposit. Separate collections remain separate transactions. Free reference value is not sales revenue, customer debt, or an accounting loss.

Mixed deliveries retain free/paid classifications per item. Charged totals, tax, payment validation and credit follow the existing rules for the paid items only. New daily reports and closing archives show paid sales, credit, confirmed collections, free jar/carton quantities, free reference value, and reference adjustments separately. Older closing archives continue to render without invented HOUSE totals.

## 7. Offline synchronization compatibility

The confirmed customer snapshot includes approval version and product eligibility/reference-price versions. Only confirmed approved HOUSE customers qualify offline; local HOUSE requests cannot grant themselves approval.

Free deliveries save encrypted records durably in IndexedDB with stable operation IDs, original occurrence time, cached policy evidence and stock/custody changes. They survive reload/unlock, upload automatically after connectivity returns, and reuse the existing sequence/idempotency checks so retries create one confirmed delivery and one stock-movement set.

If approval, eligibility or reference pricing changes while offline, synchronization retains the original payload in `NEEDS_REVIEW`. No automatic conversion to paid supply occurs and the server does not post inventory/finance effects for the disputed attempt. Admin review offers retry, rejection, and **Authorize original free supply**, with a required reason. The latter authorizes only that queued transaction and its original reference snapshot; it does not restore global customer/product privileges. Normal stock/custody and paid-item validations still apply. Rejected records remain available for review.

## 8. Validation and Cloud preservation

| Check                                       | Final result                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd test`                              | 37 files, **369 tests passed**, 0 failed                                                                                          |
| HOUSE database suite                        | **21 passed**, including generic-product defaults and preservation of explicit admin choices                                      |
| HOUSE + existing Paid/Credit browser checks | **6 passed** across desktop and mobile                                                                                            |
| Full offline browser suite                  | **6 passed** across desktop and mobile; includes automatic HOUSE sync after reconnect, reload durability and duplicate prevention |
| `npm.cmd run typecheck`                     | Passed                                                                                                                            |
| `npm.cmd run lint`                          | Passed                                                                                                                            |
| Production build                            | Passed with the real application configuration; offline fixture production build also passed                                      |

Coverage includes approval/restrictions, the 15/10 example, zero credit/payment effects, mixed paid/free products, carton opt-in, immutable price snapshots, return-only FIFO allocation, stale offline approval/product conflicts, one-delivery admin authorization, closing archives, BS timezone/filter boundaries, bilingual reports, and real XLSX output with user text protected from formula injection.

Browser assertions initially failed because exact text selectors did not match combined status text or matched duplicate messages. They were corrected to use the visible status/region. An existing offline database test also assumed a closing review could proceed with an offline blocker; it now asserts the existing blocker. All final checks pass.

Read-only before/after verification compares original field counts and fingerprints in 27 customer, inventory, custody, billing, financial and closing tables, including all 3 closing archives. Additive HOUSE/offline fields are excluded from that comparison. All original counts and fingerprints match. Live checks confirm RLS remains enabled, raw authenticated writes are denied, private RPCs are inaccessible, admin RPCs validate authorization, all 5 existing customers remain regular, and no test/free deliveries, offline operations or correction records were inserted in Cloud.

## 9. Remaining business configuration

The subsequent online customer lookup investigation and transaction-setting corrections are documented in [CUSTOMER_LOOKUP_SYNC_FIX.md](CUSTOMER_LOOKUP_SYNC_FIX.md), including migrations 20–21 and updated validation results.

No implementation decision is blocking use. Admin still chooses which actual households to approve, whether to make cartons free, and any reference prices that differ from current selling prices. No household was automatically approved. Any separate deposit arrangement must use the existing explicit deposit workflow.

Open **Admin → Customers** to approve the intended households, then **Admin → Pricing & Free Supply** to review eligibility/reference prices. Prepare or refresh a driver's confirmed offline device snapshot online before using newly approved customers offline.
