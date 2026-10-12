# English/Nepali and Bikram Sambat calendar implementation

Implementation and verification date: 2026-10-12. This implements the client's bilingual/BS request on the existing application. It supersedes earlier Gregorian **display** guidance; canonical database dates, inventory/finance rules, manual business-day sessions and authorization remain unchanged.

## Architecture and preferences

- `src/lib/i18n/en.json` and `ne.json` have 1,267 matching reusable message keys. `messages.ts` supplies explicit message lookup/interpolation; components use `T`, `Message`, `Value`, `DateValue` and `useLocale`. Business-entered customer/product names, addresses, phone numbers, references, notes and reasons stay unchanged.
- The protected shell supplies a user-specific `LocaleProvider`. EN/ने changes context without navigating, refreshing or remounting forms. Request keys, numeric input values, selections and unsaved deliveries survive switching. Failed preference saves display an honest retry message.
- `/api/preferences` requires the active caller's server permission, validates same-origin requests and accepts only `en`/`ne`. It updates **only that user's** Supabase Auth `user_metadata.locale`; arbitrary IDs/roles supplied in the body are ignored. Metadata never grants permissions. Existing `profiles.role`, server guards and RLS remain authoritative.
- Missing/invalid preferences default to English for admins and Nepali for drivers. The public `mk-locale` cookie supports anonymous sign-in display; authenticated Auth metadata takes precedence. Preferences survive logout, login, refresh and navigation and are independent between users.
- The existing Noto Sans Devanagari font is also loaded locally in the web shell. Nepali text has increased line height; the language selector and calendar controls have accessible names and at least 44px touch targets. Existing plus/minus controls and numeric keyboards remain available. Decimal text fields normalize Nepali digits to canonical ASCII before validation; number inputs retain reliable browser numeric entry.

## Calendar choice, accuracy and storage

The exact runtime dependency is `@inicrea/bikram-sambat-core@0.1.3`, a data-backed converter with no runtime dependencies. Supported BS dates are **1975 Baisakh 1 through 2100 Chaitra 30**, corresponding to canonical **1918-04-13 through 2044-04-12**. Its documented table is generated from the Yorion 0.4.0 conversion engine; upstream describes core and exhaustive reference-engine testing. See the [primary repository](https://github.com/Inicrea-Technologies-Pvt-Ltd/bikram-sambat) and [core documentation](https://github.com/Inicrea-Technologies-Pvt-Ltd/bikram-sambat/blob/main/packages/core/README.md).

Our tests verify the client-specified AD 2026-10-12 ↔ BS 2083-06-26 anchor, leap-day/month/year boundaries, actual year-specific month lengths and all **46,022 supported days** in both directions with continuous weekday alignment. This establishes the tested reference and internal consistency; it is not an independent official Panchang certification for every future day. Unsupported dates display an explicit unavailable message instead of inventing a conversion.

`src/domain/localization/calendar.ts` is the shared conversion/range utility. Both English and Nepali display **BS** dates; the supplied twelve English/Nepali month spellings are used exactly. Today's date is derived dynamically in `Asia/Kathmandu`, never from a hardcoded example. Nepal timestamps include localized clock numerals.

PostgreSQL `date` and `timestamptz` remain the source of truth. Hidden inputs, links and query parameters contain canonical dates. Timestamp filters use inclusive start and exclusive end, including historical Nepal timezone offsets and the 1986 midnight gap. For example, Ashwin 2083 covers canonical dates 2026-09-17 through 2026-10-17, with UTC boundaries `2026-09-16T18:15:00Z` and `2026-10-17T18:15:00Z`.

The original business day remains the transaction's operational session even when it stays open past midnight. Locale/calendar changes do not open, close, move or rewrite a transaction, custody record, journal, archive or timestamp.

**No SQL migration, new environment variable, RLS change or historical data conversion is required.** Existing migrations 001–014 are untouched. No Supabase reset or business seed was performed.

## Screen and filter coverage

| Area        | Localized screens and behavior                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared      | Sign-in, navigation, role shells, accessible skip link, buttons, confirmations, success/error/validation messages, status enums, loading and empty states, refresh controls and print controls                                                                  |
| Admin       | Dashboard, products, inventory/adjustments/movement journal, refilling/damage, trips/detail/load/physical approval, customers/detail, vehicles/detail, drivers/detail, payments/receipts/invoices, credit, billing, daily close and daily history/report detail |
| Driver      | My Stock/home, New Delivery and registered/walk-in/return-only visits, customer lookup/create/contact edits, Pending Jars, Sales History, Return to Warehouse, trip detail, invoice and receipt detail                                                          |
| Calendar    | Reusable BS year/month/day picker with real month lengths, weekday alignment, previous/next month, Today, minimum/maximum bounds, clear where optional, Escape/outside dismissal and focus restoration                                                          |
| Date ranges | Today, Yesterday, This BS Month, Previous BS Month, This BS Year and Custom BS Date Range                                                                                                                                                                       |

BS range pickers are connected to daily history/reports, trip history, stock movement/adjustment history, refilling/damage history, payment and invoice search, driver sales/collection history, pending jars, customer financial history and credit statements. The currently active operational forms and balances remain available independently of a history filter.

- Stock/adjustment histories filter real PostgreSQL timestamps and use server authorization; trip history queries original business-day dates. New data access paginates results under the caller's existing RLS.
- Payment/invoice operational filters use original business-day dates; driver transaction history and monthly credit use actual journal timestamps. The difference is deliberate for an overnight business session. Customer payment/deposit histories use actual timestamps.
- Pending filters apply to **original** custody/delivery dates. FIFO allocation, partial return history, age and cumulative jar balances retain their original records. Jar custody never becomes financial credit.
- Monthly credit statement selectors convert an actual BS month to canonical boundaries. Opening balance includes previous journal entries, period rows exclude the following month, and closing uses signed exact decimal money. Custom ranges work without resetting the form.

## Documents and exports

Invoice, cash/Fonepay receipt, deposit receipt, daily report, multi-day report and credit statement labels follow the authenticated user's preference. Dates are BS in both modes. Historical receipt business dates are read from their actual business-day record rather than falling back to an opaque UUID.

The existing embedded Unicode PDF fonts and measured wrapping/pagination are retained. A test rendered an actual Nepali PDF through PDF.js into `test-results/localization/nepali-pdf-preview.png`; the preview was visually inspected for shaped Devanagari, long-address wrapping and margins. The desktop/mobile browser tests downloaded and parsed an actual invoice PDF with the exact NPR 5,258.75 total.

Excel-compatible UTF-8 CSV exports have localized human labels and BS dates, with **ASCII exact quantities/amounts** and machine-readable `CanonicalBusinessDate` or `CanonicalTimestamp` columns. Signed numeric credit amounts remain numeric, including negative payments; text cells retain spreadsheet-formula escaping. PDF and CSV use the same underlying totals. This extends the existing CSV export rather than introducing a separate `.xlsx` workbook implementation. Technical JSON archives retain canonical audit data.

## Verification and fixes

| Executed command/check                                                      | Result                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm.cmd run typecheck`                                                     | Passed                                                                                                                                                       |
| `npm.cmd run lint`                                                          | Passed; no errors or warnings                                                                                                                                |
| `npm.cmd test`                                                              | 248 checks passed in 27 files, including unchanged inventory/finance/idempotency/RLS/closing regressions                                                     |
| `npm.cmd test -- tests/unit/localization.test.ts`                           | 11 passed after adding PDF/CSV credit-total and numeric export checks                                                                                        |
| `npm.cmd run test:e2e`                                                      | 48 desktop/mobile configuration and unauthenticated protected-route checks passed                                                                            |
| `$env:AUTH_E2E_BASE_URL='http://localhost:3000'; npm.cmd run test:e2e:auth` | 4 actual Supabase Cloud admin/driver login, redirect, exclusion and sign-out tests passed                                                                    |
| `npm.cmd run test:e2e:operations -- localization.spec.ts`                   | 4 desktop/mobile bilingual workflows passed, including a real Nepali delivery/return/admin approval and database journal assertions on disposable PostgreSQL |
| `npm.cmd run test:e2e:operations`                                           | All 20 desktop/mobile operations scenarios passed (6.1 minutes), including inventory, sales, credit, FIFO, closing and bilingual workflows                   |
| `$env:VALIDATE_BUILD='1'; npm.cmd run build`                                | Production build passed in isolated `.next-build-check`; existing port 3000 server preserved                                                                 |
| `npm.cmd run format:check`                                                  | Passed; all matched files use Prettier style                                                                                                                 |

New coverage also verifies server preference authorization/CSRF/failure behavior, date-filter query bounds/pagination, exact monthly opening/closing credit, PostgreSQL timestamp boundaries and agreement with historical Nepal timezone offsets. Existing PostgreSQL tests continue exercising manual close across midnight, stock/jar/credit/deposit carry-forward, immutable snapshots and duplicate posting protection.

Actual browser checks covered all 13 admin sections and six driver workspace sections at desktop 1280px and mobile 393px. Business workspace/finance hashes before and after Cloud checks matched. Actual Cloud preferences were saved at their **current effective values** (admin English, driver Nepali) and verified after reload and logout/login. These were the only display-preference writes; passwords, profile IDs/roles and business records were preserved. No production delivery, payment, stock adjustment or closing fixture was created. Monthly credit CSV/PDF endpoint checks use existing customers and do not create financial records.

Issues discovered and fixed during testing/review:

- Corrected a web-font relative path and same-origin comparison when Next's internal URL uses `localhost` but the browser uses `127.0.0.1`.
- Synchronized the root accessibility provider with the protected user's locale and waited for the protected shell in browser tests.
- Translated global success feedback, stock/activity counters, movement/payment/status labels, confirmation text and form validity messages; localized clock numerals and region/navigation names.
- Preserved historical receipt business dates and original pending dates; kept cumulative balances independent of history filters.
- Prevented the calendar's right-hand popup from causing mobile overflow; moved focus into the opened calendar and disabled Today outside the allowed bounds.
- Updated old closing tests to select the real BS picker instead of filling a removed native AD date input. Tests assert persisted return/approval status and the global success toast because completed forms unmount after refreshed state.
- Kept negative credit CSV amounts numeric and tested identical totals across languages/exports.

Initial browser failures were corrected and rerun; they are not counted as passes. Full operational write flows run only against disposable PGlite PostgreSQL with the existing migration SQL and a test-only Auth/PostgREST adapter. Hosted Cloud checks are read-only except the explicitly described display preferences. These tests do not establish multi-connection hosted race acceptance.

## Files changed

- Infrastructure: `package.json`, `package-lock.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/i18n/*`, `src/domain/localization/*`, `src/components/localization.tsx`, `bs-date-picker.tsx`, `localized-document.tsx`, and `src/app/api/preferences/route.ts`.
- Actual history/credit queries: `src/data-access/history.ts`, `finance.ts`, `inventory.ts`, `business-days.ts`; `src/services/history.ts`, `inventory.ts`; `src/domain/finance/statement.ts`, `statement-document.ts`; `src/app/api/customer-statements/[id]/route.ts`; `src/components/credit-statement.tsx`.
- UI: existing admin/driver pages and shared shell/navigation, directory, stock, customer, delivery, trip, finance, invoice, receipt, pending, closing/report, empty/loading/error and input/button components. Existing routes are retained.
- Documents: `src/domain/finance/documents.ts`, `src/domain/business-days/reports.ts`, shared Nepal date formatting, private invoice/payment/deposit/business-day PDF/CSV routes.
- QA: new localization/preference/history/PDF unit tests, PostgreSQL boundary integration test, bilingual Playwright workflows; existing Auth/operations tests and loopback provider updated for role defaults and BS pickers; `scripts/verify-cloud-localization.mjs`.
- Documentation: this report, README and TASKS. Detailed file inventory is available through `git show --stat` / `git diff --stat`; no existing project or specification file was removed.

## Manual verification and remaining acceptance

1. At `http://localhost:3000`, sign in using an existing account and saved private password. Admin defaults to EN; driver defaults to ने unless that user chose another preference. Switch, navigate, refresh, logout/login and verify independent preferences in another browser/user session.
2. In a **disposable test/staging** driver trip, enter a customer, full/empty/carton quantities and payment/reference. Switch EN/ने before saving: URL, values, request key and customer must remain. Review and save entirely in Nepali; verify invoice/collection totals and original pending dates. Return the vehicle stock and have an admin verify it in Nepali.
3. Open a report range picker. Select BS 2083 → Ashwin/असोज → 26/२६. Its canonical query value must be 2026-10-12 while its visible date remains BS in both languages. Check previous/next months, differing month lengths, Today, minimum/maximum limits, custom range and presets on a phone.
4. Test the first/last instant of a BS month and the following month on staging. Compare monthly credit opening/rows/closing with signed journal entries; payments of prior credit must reduce receivables without creating new sales. Keep jar/deposit balances separate.
5. Inspect pending-jar originals/ages/partial FIFO returns across two trips and a later business day. A later return must never replace the original outstanding date.
6. Download invoice, payment/deposit receipt, daily report and credit statement PDF/CSV in each locale. Inspect real names/addresses, Devanagari shaping, long lines, BS dates and matching amounts. Import CSV as UTF-8, checking canonical date columns and negative numeric amounts.
7. On staging, keep a business day open across Nepal midnight, post permitted transactions, then close it manually as admin. Verify preserved operational day/date, exact timestamps, archives and all carry-forward balances. Drivers must remain unable to close, adjust warehouse stock, approve another driver or read admin finance exports.

No known business screen is intentionally left English-only or AD-primary after this implementation. Branding, user-entered content, technical IDs/codes, canonical query parameters and audit JSON stay unchanged by design. Native browser/OS interface text can follow device language. Native numeric inputs may show ASCII digits to preserve reliable entry. Human Nepali terminology review and staff acceptance remain necessary; automated key coverage cannot certify natural language quality.

Remaining release checks: hosted staging write acceptance with approved test data, independent-connection concurrency/races, production-volume history/report performance, backup/restore, HTTPS reverse-proxy preference-origin validation and operational training. The calendar table's documented end is 2044-04-12; future extensions need a reviewed reference-data/library update. Configurable deposits, unconfigured tax and manual Fonepay verification retain their previously approved rules. No automatic provider verification was introduced.

## Repeat checks safely

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e
npm.cmd run test:e2e:operations
$env:AUTH_E2E_BASE_URL='http://localhost:3000'
npm.cmd run test:e2e:auth
node --env-file=.env.local scripts/verify-cloud-localization.mjs http://localhost:3000
```

The last command is read-only for business data **and preferences**. Its optional `--save-current-preference` flag saves only the existing demo accounts' current effective language, verifying the real preference API across reload/login. Use that flag only when a display-preference write is intended. It never prints passwords/tokens, captures Cloud screenshots/traces or creates business records. `--mobile` and `--driver` narrow the checks. Keep `.env.local` ignored and never reset Cloud to run these checks.

<details>
<summary>Detailed changed-file inventory (110 files)</summary>

```text
README.md
docs/BILINGUAL_BS_CALENDAR.md
docs/TASKS.md
next.config.ts
package-lock.json
package.json
scripts/verify-cloud-localization.mjs
src/app/admin/billing/page.tsx
src/app/admin/credit/page.tsx
src/app/admin/customers/[id]/page.tsx
src/app/admin/customers/page.tsx
src/app/admin/daily-close/page.tsx
src/app/admin/dashboard/page.tsx
src/app/admin/drivers/[id]/page.tsx
src/app/admin/drivers/page.tsx
src/app/admin/inventory/page.tsx
src/app/admin/payments/page.tsx
src/app/admin/products/page.tsx
src/app/admin/refilling/page.tsx
src/app/admin/reports/[id]/page.tsx
src/app/admin/reports/page.tsx
src/app/admin/trips/page.tsx
src/app/admin/vehicles/[id]/page.tsx
src/app/admin/vehicles/page.tsx
src/app/api/business-days/[id]/[format]/route.ts
src/app/api/business-days/export/route.ts
src/app/api/customer-statements/[id]/route.ts
src/app/api/deposits/[id]/pdf/route.ts
src/app/api/invoices/[id]/pdf/route.ts
src/app/api/payments/[id]/pdf/route.ts
src/app/api/preferences/route.ts
src/app/driver/customers/page.tsx
src/app/driver/home/page.tsx
src/app/driver/pending-jars/page.tsx
src/app/driver/sales/page.tsx
src/app/error.tsx
src/app/globals.css
src/app/layout.tsx
src/app/loading.tsx
src/app/not-found.tsx
src/app/sign-in/page.tsx
src/app/sign-in/sign-in-form.tsx
src/components/admin-driver-activity.tsx
src/components/app-shell.tsx
src/components/bs-date-picker.tsx
src/components/credit-statement.tsx
src/components/customer-finance.tsx
src/components/customer-report.tsx
src/components/day-forms.tsx
src/components/day-report.tsx
src/components/delivery-customers.tsx
src/components/directory.tsx
src/components/driver-customers.tsx
src/components/driver-round-workspace.tsx
src/components/driver-stock.tsx
src/components/empty-state.tsx
src/components/finance-admin-forms.tsx
src/components/finance-overview.tsx
src/components/finance-payment.tsx
src/components/inventory-forms.tsx
src/components/invoice-detail.tsx
src/components/localization.tsx
src/components/localized-document.tsx
src/components/master-forms.tsx
src/components/navigation.tsx
src/components/operation-feedback.tsx
src/components/operation-form.tsx
src/components/operational-refresh.tsx
src/components/operations-layout.tsx
src/components/payment-detail.tsx
src/components/pending-jars.tsx
src/components/print-button.tsx
src/components/trip-forms.tsx
src/components/trip-summary.tsx
src/components/ui/button.tsx
src/components/ui/input.tsx
src/components/warehouse-stock.tsx
src/data-access/business-days.ts
src/data-access/finance.ts
src/data-access/history.ts
src/data-access/inventory.ts
src/domain/business-days/reports.ts
src/domain/business-days/time.ts
src/domain/finance/documents.ts
src/domain/finance/statement-document.ts
src/domain/finance/statement.ts
src/domain/localization/calendar.ts
src/domain/localization/format.ts
src/domain/localization/locale.ts
src/lib/i18n/en.json
src/lib/i18n/messages.ts
src/lib/i18n/ne.json
src/lib/i18n/server.ts
src/services/history.ts
src/services/inventory.ts
tests/auth-e2e/auth.spec.ts
tests/helpers/operations-provider.mjs
tests/integration/localization-db.test.ts
tests/operations-e2e/daily-close.spec.ts
tests/operations-e2e/driver-inventory.spec.ts
tests/operations-e2e/driver-workflow.spec.ts
tests/operations-e2e/finance.spec.ts
tests/operations-e2e/localization.spec.ts
tests/operations-e2e/pending-jars.spec.ts
tests/operations-e2e/stock-refresh.spec.ts
tests/operations-e2e/trip-cycle.spec.ts
tests/unit/locale-preferences.test.ts
tests/unit/localization-history.test.ts
tests/unit/localization.test.ts
tests/unit/localized-pdf.test.ts
```

</details>
