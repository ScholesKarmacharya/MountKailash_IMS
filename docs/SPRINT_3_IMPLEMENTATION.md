# Sprint 3: sales, payments, credit, deposits and receipts

Implemented on `sprint-3-finance`. Cloud application is pending approval of the three migrations below. Existing Sprint 0–2 accounts and operational records are retained. No Cloud business data was created during implementation.

Local foundation commit: `424a5f4`. The second local commit contains the connected finance UI, browser tests and documentation; no remote push or Cloud migration is performed by committing.

## Implemented behavior

- A new valid trip visit creates one immutable sale, item snapshots and numbered invoice in the same PostgreSQL transaction as stock and jar custody. Catalog/default or admin-approved customer prices are used; the browser cannot set prices. Numeric amounts are serialized as decimal strings; browser previews use integer minor units.
- Cash, unpaid, partial and mixed cash/Fonepay receipts, including prior-invoice allocations and separate explicit deposits. Additional receipts are allowed during assigned ACTIVE trip workflows. Walk-ins require initial full cash or pending Fonepay coverage; a rejected walk-in receipt can be replaced on its original ACTIVE trip invoice.
- Receivable entries survive session changes, inactivity and business-day changes. Optional due days and six credit-aging buckets use Nepal date labels. Old-credit recovery creates collections, never another sale.
- Pending Fonepay reserves allocation capacity but does not reduce receivables, count as verified collections or create a received deposit liability. Only an admin can explicitly reconcile it against independent merchant/bank evidence. Rejected receipts release reservations. Confirmed transaction references are unique even after reversal.
- Immutable verification events, receivable/deposit ledgers and balanced finance journal postings. Privileged corrections add debit/credit adjustments or compensating receipt reversals; they do not edit original items, prices, receipts or physical journals.
- Explicit manual deposit arrangements, receipts and cash refunds. No per-jar amount, automatic empty-return refund, jar/debt offset or credit limit is assumed. Existing jar-custody tables remain the physical source of truth.
- Admin Payments overview, receipt/invoice lists, filters by business date/customer/driver/trip/method/status, credit directory and company/tax settings. Customer pages expose billing arrangements, negotiated prices and permanent histories.
- Role-scoped invoice and payment pages, authenticated PDF downloads, print styles and private/no-store responses. Invoice/PDF amounts use stored snapshots and current recognized allocations. Company/customer receipt snapshots preserve historical details. Noto Devanagari is bundled under OFL; downloads make no external font requests.

## Confirmed provisional choices

The user explicitly selected configurable deposits and unconfigured tax. Initial company name is Mount Kailash, with blank address/phone/registration and `UNCONFIGURED` tax. No PAN/VAT identity, tax rate, carton pack size, deposit rate or due date is invented. Explicit confirmed tax is exclusive of subtotal and rounded once per invoice to two decimals; this calculation convention must be approved with the accountant before enabling it.

`MONTHLY_CREDIT` identifies a customer arrangement. Balances carry indefinitely; an admin can configure due days starting at the invoice's business date. Automatic calendar-month consolidation, penalties and limits remain unconfirmed. Deposit amounts are entered explicitly; refunds record actual admin-approved cash refunds.

Cash collection means an authorized operator recorded receipt of cash. Warehouse cash handover/shortage reconciliation remains Sprint 4. Manual Fonepay confirmation is labeled admin reconciliation, never provider verification. Automatic Fonepay is disabled: no official merchant credentials, API/signature contract or callback implementation was supplied. The server-only provider interface defines the future trust boundary and returns no configured adapter.

## Required migrations and safety review

1. `202610110006_sprint3_finance_schema.sql`: adds configuration, immutable sales/invoices/payments/allocations, verification, receivable/deposit/journal tables, constraints, indexes and RLS. Inserts only one unconfigured company-settings row.
2. `202610110007_sprint3_finance_operations.sql`: adds internal exact-money/locking/posting helpers and an authenticated, operation-allowlisted command RPC. Internal helpers have no anonymous/authenticated/service-role execute grants. Collection checks the assigned trip and its OPEN day; administrative mutations independently require active admin identity and reason.
3. `202610110008_sprint3_visit_and_reads.sql`: replaces the existing visit RPC while preserving its signature, physical stock/custody checks and retry behavior, then adds scoped finance reads. No earlier migration is edited.

The Cloud dry run identified these three files as pending. It does not execute their SQL; disposable PostgreSQL integration tests execute the complete migration chain. No reset, table drop, RLS disabling, historical deletion, credential changes or sample inventory is included.

Review considerations: DDL briefly locks referenced tables; coordinate a quiet application window. Deploy all three in order, then verify schema/API readiness before taking new deliveries. Invoice/payment identity numbers may have gaps after failed transactions; uniqueness is enforced, gap-free fiscal numbering is not assumed. New visits, including legacy API callers, start finance posting after migration 008. Existing Sprint 2 visits/intents are preserved and are **not** automatically converted into verified payments or retrospective invoices. They are labeled legacy/unposted; reviewed historical import is a separate decision. Financial adjustments do not reverse stock/custody; operational correction needs a separate physical workflow.

Run from this root only after approval and a current Cloud backup/recovery checkpoint:

```powershell
npx.cmd --no-install supabase db push --linked --dry-run
npx.cmd --no-install supabase db push --linked
```

The second command applies pending migrations and prompts for confirmation. Do not use reset or rerun old SQL manually. Afterward compare migration history and reload the development app; if the API schema cache is temporarily stale, retry after it refreshes. No new application secrets are required.

## Manual acceptance after approved Cloud/staging migration

Use staging or separately approved real business operations. Do not invent warehouse stock, customers, trips or payments in production to exercise these steps.

1. Admin: open the business day normally; visit Payments, Customer credit and Billing settings. No finance records means accurate zero totals and empty histories. Keep tax unconfigured until confirmed details are supplied.
2. On an existing customer, save a reasoned billing arrangement/due days and optionally an approved unit price. For deposits select explicit manual receipts/refunds. Changing a price must not change previous invoice items.
3. Assign/load/start a trip through existing operations. Driver chooses customer and quantities with plus/minus controls. Check payable and previous outstanding. Review and confirm cash, unpaid or partial payment. Partial supports an additional pending Fonepay amount. Enter old-credit/deposit components separately.
4. Open the saved invoice and receipt. Compare quantities, unit price, business date, original/current total, collected, pending and outstanding. Download PDFs and use Print receipt. Refresh and sign out/in: all records persist.
5. Driver: collect more existing credit from the ACTIVE trip form or its invoice. It must not create another sale. Excess allocation, negative amount, overdelivery and reused key with changed payload must fail without partial effects.
6. Admin: open a pending Fonepay receipt. Without independent evidence leave it pending. To reconcile, choose Confirm, enter the independently matched reference and a specific evidence reason. A duplicate reference must fail. Rejection releases reserved credit; confirmation settles allocations and recognizes any deposit at the current OPEN business day.
7. Admin: record an explicit deposit refund from the customer page and download its deposit receipt. Water-sale revenue and jar custody must remain unchanged. Empty collection alone must not create a refund.
8. Admin: reverse an erroneous receipt with a reason, then apply a credit/debit invoice adjustment if needed. Existing rows remain immutable; compensating entries and current balances change. Reverse/reconcile workflows require an OPEN day.
9. Another driver must see no unrelated invoices/receipts, must receive a missing-record response for their PDF URLs, and must be redirected away from admin finance. A newly assigned driver can read only limited prior-customer credit needed to collect it, not the other driver's old trip/invoice details.
10. Submit and reconcile physical returns normally; physical closure does not erase unsettled credit, pending Fonepay or deposits. Prior-customer credit is collected on a later assigned ACTIVE trip after closure.

## Validation and remaining limits

See the final validation record below for executed commands and results. PostgreSQL tests are disposable PGlite with Auth identities stubbed; browser tests run actual application screens/actions and SQL against a test-only loopback Auth/PostgREST adapter. They do not prove real-provider callbacks, actual merchant settlement, live Cloud financial writes or multi-connection races.

Before operational sign-off: apply approved migrations, execute staging/approved Cloud finance acceptance, exercise simultaneous connections and measure growing-ledger performance. The finance workspace currently aggregates scoped histories in one RPC; pagination/reporting volume limits need staging validation. PDFs are generated privately on demand, not archived to object storage. Invoice status is current at download time.

`npm audit` reports eight advisories in existing development/lint/test dependencies (Vitest/tinypool and eslint-config-next chains). The suggested fixes require major changes or an ESLint/Next downgrade; no forced upgrade/downgrade was made. Resolve these in a separate dependency maintenance change before production tooling sign-off. Newly added PDF packages are not the reported vulnerable dependency chains.

Sprint 4: manual admin day closing/review blockers, cash handover and Fonepay settlement reconciliation, immutable day-closing snapshots/archive, stock/credit/deposit carry-forward reports and exports, and staging concurrency/UAT. Warehouse refilling/damage remains an earlier explicitly deferred workflow. Automatic Fonepay requires official merchant access and callback contract, independent of daily close.

## Final validation record (2026-10-11)

| Command / check                                                     | Result                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                             | Passed strict TypeScript and route generation                                                                       |
| `npm.cmd run lint`                                                  | Passed after correcting source warnings and excluding isolated generated outputs                                    |
| `npm.cmd test`                                                      | 153 passed: unit/server authorization, 17 inventory + 25 trip + 22 finance PostgreSQL tests                         |
| `npm.cmd run test:e2e:operations`                                   | 6 passed: desktop/mobile finance, trip cycle and stale-stock refresh using disposable SQL                           |
| `npm.cmd run test:e2e:operations -- finance.spec.ts`                | 2 passed: additional invoice receipt plus invoice/payment/deposit PDF downloads on desktop/mobile                   |
| `AUTH_E2E_BASE_URL=http://localhost:3000 npm.cmd run test:e2e:auth` | 4 passed against Cloud: desktop/mobile admin and driver sign-in, role exclusion and sign-out                        |
| `npm.cmd run test:e2e`                                              | 26 passed on isolated unconfigured server, including protected finance/PDF endpoints                                |
| `VALIDATE_BUILD=1 npm.cmd run build`                                | Passed, using `.next-build-check` so existing development output stays intact; PDF font included in route trace     |
| `node --env-file=.env.local scripts/verify-cloud-operations.mjs`    | Four Cloud admin pages passed row counts, empty states and refresh at 1280px and 393px; driver workspace RLS passed |
| `npx.cmd --no-install supabase db push --linked --dry-run`          | Only migrations 006?008 pending; no SQL applied                                                                     |

During development, failed checks exposed a Nepali font-shaping runtime requirement, dropdown label ambiguity, generated-output lint scanning, and test synchronization/payload issues. These were fixed. Walk-in Fonepay rejection now has a same-trip replacement collection path. No remaining failing implementation check is knowingly accepted.

## Files changed

- `.gitignore`
- `README.md`
- `assets/fonts/NotoSansDevanagari.ttf`
- `assets/fonts/OFL.txt`
- `assets/fonts/README.md`
- `docs/SPRINT_3_IMPLEMENTATION.md`
- `eslint.config.mjs`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `playwright.auth.config.ts`
- `playwright.config.ts`
- `src/app/admin/billing/page.tsx`
- `src/app/admin/credit/page.tsx`
- `src/app/admin/customers/[id]/page.tsx`
- `src/app/admin/dashboard/page.tsx`
- `src/app/admin/invoices/[id]/page.tsx`
- `src/app/admin/payments/[id]/page.tsx`
- `src/app/admin/payments/page.tsx`
- `src/app/api/deposits/[id]/pdf/route.ts`
- `src/app/api/invoices/[id]/pdf/route.ts`
- `src/app/api/payments/[id]/pdf/route.ts`
- `src/app/driver/invoices/[id]/page.tsx`
- `src/app/driver/payments/[id]/page.tsx`
- `src/app/globals.css`
- `src/app/operations-actions.ts`
- `src/components/customer-finance.tsx`
- `src/components/finance-admin-forms.tsx`
- `src/components/finance-overview.tsx`
- `src/components/finance-payment.tsx`
- `src/components/invoice-detail.tsx`
- `src/components/navigation.tsx`
- `src/components/payment-detail.tsx`
- `src/components/print-button.tsx`
- `src/components/trip-forms.tsx`
- `src/components/trip-summary.tsx`
- `src/data-access/finance.ts`
- `src/data-access/operations.ts`
- `src/domain/auth/roles.ts`
- `src/domain/finance/aging.ts`
- `src/domain/finance/commands.ts`
- `src/domain/finance/documents.ts`
- `src/domain/finance/money.ts`
- `src/domain/finance/payment-plan.ts`
- `src/domain/finance/reports.ts`
- `src/domain/finance/types.ts`
- `src/domain/operations/commands.ts`
- `src/services/dashboard.ts`
- `src/services/finance.ts`
- `src/services/payment-provider.ts`
- `src/services/pdf.ts`
- `supabase/migrations/202610110006_sprint3_finance_schema.sql`
- `supabase/migrations/202610110007_sprint3_finance_operations.sql`
- `supabase/migrations/202610110008_sprint3_visit_and_reads.sql`
- `tests/auth-e2e/auth.spec.ts`
- `tests/e2e/scaffold.spec.ts`
- `tests/helpers/operations-provider.mjs`
- `tests/integration/finance-db.test.ts`
- `tests/operations-e2e/finance.spec.ts`
- `tests/operations-e2e/trip-cycle.spec.ts`
- `tests/unit/finance-service.test.ts`
- `tests/unit/finance.test.ts`
- `tsconfig.json`
