# Products and Pricing & Free Supply UI/UX improvement

The Products page now opens with a compact catalog and Add Product action. Pricing & Free Supply retains its existing features, with clearer pricing controls, summaries above filters, readable reports and collapsed corrections. Both pages use the existing Mount Kailash teal/white styles.

## Products

- Product cards show the configured name, kind, SKU, unit, default NPR selling price, active status and Edit Product action. Jar and carton icons distinguish the two existing product kinds.
- Add and Edit use the same accessible dialog and existing product action. Dialogs support initial field focus, forward/backward Tab loops, Escape, Cancel, trigger focus restoration and vertical scrolling on phones. Closing is blocked while a save is pending.
- New product kind selection suggests `jar` or `carton`. An entered custom unit is preserved when the kind changes. Displayed prices use the actual configured unit, including legacy or custom units.
- Existing products retain their SKU, kind and inventory unit. Name, selling price and active status remain editable with an audit reason.
- SKU formatting, duplicate rejection, decimal price validation, optimistic versions, request keys, authorization and success/error messages use the existing backend workflow.
- Product creation still requires an audit reason: both the existing application parser and database API mandate it. The request allowed this existing audit requirement to take precedence over an optional creation reason.

## Pricing & Free Supply

- Existing pricing and HOUSE customer tables remain available on wider screens. Compact pricing/customer cards make their fields and management actions accessible on phones.
- Price rows show formatted NPR amounts, actual units, active/eligible badges and Edit controls. Pricing edits use the existing action in the shared dialog.
- HOUSE records preserve approval status, customer links, phone, address, supplied jars, unreturned jars and the latest BS delivery date. Add Customer retains its existing destination and permissions.
- The three existing free-supply metrics appear before the filters. The explanation explicitly identifies the amount as reference value, excluded from sales revenue and customer credit.
- Compact filters retain BS dates, customer, driver and product; Reset Filters restores the default current BS month. From/To labels remain visible.
- PDF and Excel links carry the exact canonical date bounds and record filters shown on the page. A preset export cannot drift into a different date range if the day/month changes after the page loads.
- Customer, driver, BS date and month groups use the existing calculations. Date/month labels now respond directly to language switching.
- Free history uses a table on wide screens and expandable cards when space is limited. Dates, time, driver, trip links, product, delivered quantities, returned empties and historical reference prices/values remain accessible. Expanded cards and audit records retain original transaction identifiers.
- Corrections remain at the bottom, collapsed initially and when report filters change. The existing posting workflow, required reason, original references and separately recorded audit adjustments remain intact.

## Shared components

Reused `Card`, `Button`, `Input`, `LocalizedSelect`, `T`, `Message`, `Value`, `DateValue`, `BsDatePicker`, `ProductForm` and `OperationForm`. Added small reusable `AdminDialog`/`DialogClose` and `StatusBadge` components. No new design system, decorative graphics, charts or animations were introduced.

`OperationForm` gains optional dialog actions and success actions. Existing callers retain their original submit layout, confirmation, request/version handling, driver runtime and result behavior.

## Business and data changes

No stock, sales, money, reference-value, customer jar ledger, trip, payment, correction or sync formulas were changed. No migrations or production data writes were made.

Two application safeguards support the requested presentation:

1. Product saves read the current identity after the existing permission/validation checks and reject changes to an existing SKU, kind or unit. The database already blocked kind changes but previously allowed SKU/unit edits even with history. These fields are conservatively fixed for every existing product, without adding history queries or altering the RPC. A failed identity read stops the save with a clear message.
2. Product actions also invalidate the Pricing page, so both pages refresh from the same `products.default_price` configuration. Pricing actions retain their existing layout invalidation.

Historical sale prices, reference price snapshots, invoice records, free-supply rows and stock movements are not rewritten. Deactivation continues through the existing audited API and retains history. Existing database rules still reject deliveries of inactive products.

## Files changed for this task

| File                                           | Purpose                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/app/admin/products/page.tsx`              | Catalog composition                                                                                 |
| `src/components/product-catalog.tsx`           | Compact product cards and Add/Edit actions                                                          |
| `src/components/admin-dialog.tsx`              | Shared dialog, focus management and close controls                                                  |
| `src/components/ui/status-badge.tsx`           | Shared status indicators                                                                            |
| `src/components/inventory-forms.tsx`           | Existing product form presentation, suggested units, fixed identity and feedback                    |
| `src/data-access/inventory.ts`                 | Current product identity read                                                                       |
| `src/services/inventory.ts`                    | Authorized identity validation before the existing RPC                                              |
| `src/app/admin/inventory/actions.ts`           | Pricing-page invalidation                                                                           |
| `src/app/admin/pricing/page.tsx`               | Existing section organization, summary/filter order, exports and collapsed audits                   |
| `src/components/product-pricing-list.tsx`      | Existing pricing table plus narrow-screen cards                                                     |
| `src/components/product-pricing-editor.tsx`    | Existing pricing action inside the shared dialog                                                    |
| `src/components/house-customer-cards.tsx`      | Narrow-screen HOUSE customer records                                                                |
| `src/components/house-filters.tsx`             | Compact labeled filters, reset and export controls                                                  |
| `src/components/free-supply-reports.tsx`       | Existing group calculations and responsive history presentation                                     |
| `src/components/operation-form.tsx`            | Optional dialog footer/success actions and pending state                                            |
| `src/lib/i18n/en.json`, `src/lib/i18n/ne.json` | New and updated labels                                                                              |
| `tests/unit/inventory-service.test.ts`         | Permission order, forged identity changes, audited edits, custom creation units and lookup failures |
| `tests/operations-e2e/product-catalog.spec.ts` | Real catalog/pricing workflows and preservation checks                                              |
| `tests/operations-e2e/house.spec.ts`           | Responsive customer-link assertion for the existing HOUSE scenario                                  |
| `docs/PRODUCTS_PRICING_UI.md`                  | Completion report                                                                                   |

## Verification

- Full unit/database integration suite: **587 tests passed across 59 files** (`npm.cmd test`). This includes inventory, sales, HOUSE, finance, refilling, daily close, offline sync, Instant Delivery and notification coverage.
- New browser scenarios: **10 passed**, two scenarios each at **1280×720 desktop, 1024×768 laptop, 768×1024 tablet, 412×839 mobile and 360×800 narrow mobile**. Tests used Chromium and the disposable PostgreSQL provider on loopback, with real authorized RPCs and actions.
- Existing driver browser regressions: **10 passed** on desktop and mobile, covering Paid/Credit, approved HOUSE delivery, free jars with charged cartons, carton-only sales and mixed jar/carton deliveries, including invoices, balances and report/export checks.
- Localization and product-service checks were also rerun: **22 passed**.
- TypeScript, targeted ESLint, Prettier, tracked diff whitespace checks and the final production build passed.

| Requested check            | Evidence                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Product list loads      | Cards compared with authoritative fixture records                                                                                       |
| 2. Add opens/closes        | Initial focus, Tab/Shift+Tab, Escape, Cancel and focus restoration                                                                      |
| 3. Creation works          | New product saved through the actual existing action/RPC                                                                                |
| 4. Editing works           | Name, price and inactive status saved and reread                                                                                        |
| 5. Duplicate SKU rejected  | Duplicate produces an error and cannot replace an existing product                                                                      |
| 6. Kinds correct           | Jar/carton labels and existing enums asserted                                                                                           |
| 7. Units correct           | Kind suggestions, custom-unit preservation and configured price units asserted                                                          |
| 8. Existing records intact | Existing balances, visits, items and movements compared before/after changes; new products only receive the API's existing zero balance |
| 9. Prices match            | Pricing edit reflected in Products; product edit reflected in Pricing                                                                   |
| 10. Eligibility intact     | Approved HOUSE jar eligibility retained after pricing edits                                                                             |
| 11. HOUSE customers load   | Correct customer links, details and balances displayed                                                                                  |
| 12. Summary unchanged      | Original 17 jars/0 cartons/NPR 2,554.25 and filtered 15/NPR 2,253.75 asserted                                                           |
| 13. Filters work           | Actual BS calendar selection, customer/driver/product filters and reset                                                                 |
| 14. Downloads work         | Linked filtered PDF parsed and Excel workbook checked against the selected customer/value/transaction                                   |
| 15. History accurate       | Historical BS time, product price, trip link and returned empties asserted                                                              |
| 16. Snapshots preserved    | Historical NPR 150.25 reference price remains after future pricing changes; invoices and sale items unchanged                           |
| 17. Corrections work       | Required explanation blocks empty submission; separate -NPR 5 correction retains original rows and visit reference                      |
| 18. Languages work         | EN/NE switching, localized BS date/time, dialogs and screenshots                                                                        |
| 19. Responsive layout      | Five actual emulated viewport sizes, no page/dialog horizontal overflow and visual inspection                                           |
| 20. Calculations preserved | Full inventory/sales integration suite plus driver browser regressions                                                                  |

Development checks initially caught a missing translation, a dialog Tab escape and ambiguous select labels; these were corrected. Test assertions were also corrected to respect the fixture's actual legacy unit, the existing new-product zero balance and the full labeled price preview.

## Limits and remaining issues

Viewport checks are browser emulation, not physical device, Safari or assistive-technology certification. Long records can still scroll inside bounded desktop tables; the page itself does not scroll horizontally at the tested sizes. Mandatory audit reasons and fixed existing identifiers are intentional protections. No unresolved issue in this scope is currently known.

The Admin sidebar/navbar and other dashboards retain their existing appearance. Earlier workspace changes were preserved. Nothing was deployed or committed as part of this task.
