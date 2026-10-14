# Admin Overview UI/UX improvement

Implemented for the Admin Overview only. The existing teal/white theme, sidebar, navbar and operational modules remain in place. No migrations, production data writes, transaction-writer changes or authorization changes were made.

## UI improvements

| Area              | Result                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business day      | Compact BS date and status, last completed data-read timestamp in Nepal time, Refresh and Review Daily Close. OPEN, Closing Review and CLOSED remain distinct. Overnight warnings remain visible. When no day is open, the last closed date is shown explicitly.                    |
| Warehouse         | Three prominent cards for available full jars, empty jars and water cartons, with Manage Inventory. The original MAIN/WAREHOUSE inventory reader and stock aggregation remain unchanged; vehicle balances are excluded.                                                             |
| Finance           | Four primary cards: Today's Sales, Confirmed Collections, New Credit Issued and Total Outstanding Credit. Five secondary figures remain in Financial breakdown.                                                                                                                     |
| Trip status       | Active Trips, Awaiting Confirmation, Prepared for Future Dates and Completed Today are separate. Today's unstarted trips have an additional loading/start indicator.                                                                                                                |
| Closing           | Every actual backend blocker is visible and links to its supplied resolution screen. Trip states and dynamic vehicle/Fonepay explanations are displayed in understandable English/Nepali.                                                                                           |
| Driver activity   | Driver, vehicle, round, status and four jar quantities are immediately visible. Cartons, customer visits, new customers, customer pending jars, finance and returned stock remain in More driver details. View Trip Details stays visible.                                          |
| Future work       | Confirmed future loads have their own section with scheduled BS dates and loaded quantities. Future drafts remain accessible in a separate expandable list. Authorized carryover information remains accessible. Future loads remain visible after the loading business day closes. |
| Activity          | Six recent entries have meaningful descriptions, relevant driver/vehicle/product context, icons, BS date/time and links. Permanent stock and financial audit records remain unchanged.                                                                                              |
| Responsive layout | Three stock cards and two-column financial summaries keep phone layouts compact. Wider layouts use four financial/status columns and two driver cards per row. Expandable sections use native keyboard-accessible details/summary controls.                                         |

## Financial values

The presentation uses the existing business-day report values; when the report is unavailable it uses the existing financeMetrics calculation. No financial formulas were changed.

| Display                      | Existing report field        |
| ---------------------------- | ---------------------------- |
| Today's Sales                | totals.sales — excluding tax |
| Confirmed Collections        | totals.collections           |
| New Credit Issued            | totals.new_credit            |
| Total Outstanding Credit     | totals.outstanding           |
| Cash Recorded                | totals.cash                  |
| Fonepay Pending              | totals.pending_fonepay       |
| Fonepay Verified             | totals.fonepay               |
| Credit Recovered             | totals.old_credit_recovered  |
| Refundable Deposit Liability | totals.deposit_liability     |

Collections retain their original meaning: recognized receipts, including previous-credit repayments and deposit receipts. They are not presented as sales. Pending Fonepay remains separate from confirmed collections. The explanatory breakdown preserves these distinctions.

When there is no open business day, daily figures display No active day rather than suggesting that the most recently closed day's sales were zero. Current outstanding credit and refundable deposit liability remain available.

## Findings resolved

- The old Pending trips card counted SUBMITTED, UNDER_REVIEW and DISCREPANCY, not ACTIVE trips. It is now Awaiting Confirmation with the same status meaning.
- The old driver-card selection included future trips attached to the loading day. Current-day activity now follows the backend report's posting-period membership, including carried trips with activity in the period.
- The physical roundStock supplied-jar count includes HOUSE free supply. The Overview now excludes free supply from quantities labeled sold and shows free jars/cartons separately in expanded details. The shared stock function and inventory/ledger behavior remain unchanged.
- Refilling has an input and output stock movement. The activity feed shows the completed operation once, while retaining both permanent audit movements. An isolated input is described as sent for refilling, not a completed refill.
- Historical pending Fonepay events no longer imply that a subsequently verified receipt is still awaiting verification.

## Verification

- 47 targeted unit checks passed across Overview presentation, localization/BS calendar, finance, inventory data and driver round calculations.
- The database-backed Overview browser scenario passed at 1280×720, 768×1024, 412×839 and 360×800.
- The scenario verifies warehouse-only stock, all nine unchanged financial values, active/submitted/completed counts, prepared future stock, blocker links, driver quantities, secondary details, manual refresh, the existing automatic refresh timer, English/Nepali, BS dates and navigation.
- It resolves Fonepay, submits and verifies actual returns, then closes the day through the existing safeguarded workflow. The future trip remains LOADED and visible afterward.
- The existing Paid/Credit regression passed on desktop and mobile, including validation, language changes, saved invoices and Overview financial totals.
- Production build, TypeScript checks, targeted ESLint, Prettier and diff whitespace checks passed.
- English and Nepali screenshots were visually inspected. Browser fixture writes were restricted to the disposable PostgreSQL provider on loopback.

The browser fixtures deliberately show 27 available warehouse full jars, separate vehicle loads, NPR 6,611.00 sales, NPR 4,357.25 confirmed collections, one active trip, one completed trip and one future prepared trip. Visible values are compared against authoritative database reads, not invented UI totals.

## Files changed for this task

| File                                        | Purpose                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| src/app/admin/dashboard/page.tsx            | Overview layout and section composition                                                          |
| src/components/admin-overview.tsx           | Compact business-day, stock, financial, status, blocker, future-trip and activity views          |
| src/components/admin-driver-activity.tsx    | Compact Overview driver cards with expandable secondary details                                  |
| src/components/operational-refresh.tsx      | Optional compact presentation and successful-read timestamp; existing refresh triggers preserved |
| src/domain/operations/admin-overview.ts     | Read-only presentation grouping and activity descriptions                                        |
| src/services/dashboard.ts                   | Return the already-read latest closed day and completed-read timestamp                           |
| src/lib/i18n/en.json                        | English labels and activity/blocker templates                                                    |
| src/lib/i18n/ne.json                        | Matching Nepali translations                                                                     |
| tests/unit/admin-overview.test.ts           | Trip, finance, free-supply and immutable activity presentation checks                            |
| tests/operations-e2e/admin-overview.spec.ts | Browser/database reconciliation, responsive layout, navigation and safe close                    |
| tests/operations-e2e/driver-payment.spec.ts | Updated Overview labels and the previously approved automatic amount default                     |
| docs/ADMIN_OVERVIEW_UI.md                   | This implementation and verification report                                                      |

## Remaining limits

No known implementation blockers remain. Viewport tests used Chromium emulation; physical phones/tablets and the production deployment were not visually tested. The complete unrelated application test suite was not rerun. Other modules' existing UI patterns remain outside this Overview-only change.
