# Simplified driver delivery payments

Implementation and acceptance record, 2026-10-12.

## Behavior

Driver New Delivery and the delivery form on driver trip detail use two large selectable buttons: **Paid / भुक्तानी भयो** and **Credit / उधारो**, grouped under **Payment Status / भुक्तानी स्थिति**. Paid shows one required decimal input, **Total Amount Received (NPR) / प्राप्त भएको जम्मा रकम (NPR)**. It does not default a blank input to the invoice amount. Credit hides the input and posts zero collection; a registered customer is mandatory. Switching status or language preserves the quantity and amount drafts, but an old Paid draft is never submitted as a Credit collection.

The client compares exact minor units with the displayed payable amount, including configured tax and customer prices. PostgreSQL checks the actual invoice total in the same transaction as inventory, custody, financial and audit posting. Both underpayment and overpayment fail without a partly saved delivery. An empty-only visit retains the existing jar-return workflow and creates no sale, invoice or payment.

**Paid uses the existing CASH confirmed receipt and allocation**, meaning an operator-recorded collection. This two-option workflow does not identify or verify Fonepay. Existing Fonepay receipts, manual reconciliation, partial payments, deposits, invoice receipts, separate previous-credit collection, credit statements, PDFs and admin advanced entry remain available. No financial table or historical data is changed. No automatic provider verification is added.

Customer debt is independent of jar custody and remains in the existing append-only receivable ledger. Current-day collections, new credit and outstanding reports derive from those journals; closing a day does not clear debt. BS dates, original prices/dates, stock transfers, FIFO jar returns, loading, trip submission and admin closing retain their existing operations and permissions.

## Migration 015 safety review

`202610120015_driver_payment_ui.sql` is the **only pending migration** in the linked Cloud history and dry run inspected on 2026-10-12. Cloud currently has migrations 001–014. **015 has not been applied; application needs approval.**

- Adds only `post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid)`, a checked entry point for this form. It delegates to existing `post_trip_visit`, then rejects Paid when the resulting invoice total differs from the received amount. Errors roll back all journals, request keys and audit rows.
- Limits the new entry point to Paid, Credit and empty-only return; constructs its own current-invoice CASH receipt or zero-payment credit intent. It accepts no browser price, invoice total, payment method, old-credit allocation, deposit or actor argument.
- Uses the existing active-account and owned ACTIVE trip / OPEN business-day checks, stock/custody constraints and idempotency. The new function has a fixed empty search path. Execution is revoked from PUBLIC/anon/service_role and granted only to authenticated accounts; role/ownership checks still run inside.
- Creates no table, index, business record, account, inventory seed or backfill. Does not alter an existing routine, RLS policy, grant or ledger, nor delete or reset data. Existing advanced payment RPCs retain their behavior and historical retry payloads.
- Function creation/grants require short catalog locks. It depends on migrations 001–014 and the existing finance posting contract. Deploy this migration before releasing the new form; otherwise saves report that the reviewed driver payment migration is required. Reload the REST schema cache if a newly applied routine is temporarily unavailable.

Reviewed read-only commands:

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
# Apply only after approval and a fresh dry run lists exactly 015:
npx.cmd --no-install supabase db push --linked --yes
```

Do not reset Cloud, repair migration history, disable RLS or seed operational records. No environment changes or credentials are needed.

## Validation

TypeScript, ESLint, formatting and the production build passed. The build used `VALIDATE_BUILD=1`, a separate output directory that leaves the Cloud development server running. The full unit/isolated PostgreSQL suite passed **269 tests in 28 files**. All **22 operational browser scenarios** passed across the initial run and corrected reruns; **48 navigation/security scaffold checks** also passed.

| Command                                                                                                              | Executed result                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck` / `npm.cmd run lint` / `npm.cmd run format:check`                                            | All pass.                                                                                                                                                                                                                                                                                                |
| `npm.cmd test`                                                                                                       | 269/269 tests, 28 files pass. The strengthened failed-request-key rollback assertion was also rerun: 31/31 finance database tests pass.                                                                                                                                                                  |
| `npm.cmd run test:e2e:operations`                                                                                    | Initial run: 18 pass, 4 fail due to an encoded Nepali test label and two incorrect selectors in the new test. These were fixed.                                                                                                                                                                          |
| `npm.cmd run test:e2e:operations -- --grep 'Paid and Credit\|Nepali driver delivery'`                                | Nepali delivery/PDF passes on both viewports; new payment scenarios then exposed the existing dashboard's label as "Confirmed collections" rather than "Actual collections". Selector corrected.                                                                                                         |
| `npm.cmd run test:e2e:operations -- --grep 'Paid and Credit'`                                                        | Both new Paid/Credit scenarios pass (desktop and Pixel 7). Together with earlier passing scenarios, all 22 have been executed successfully.                                                                                                                                                              |
| `npm.cmd run test:e2e`                                                                                               | 48/48 unauthenticated navigation, export and responsive scaffold checks pass.                                                                                                                                                                                                                            |
| `$env:VALIDATE_BUILD='1'; npm.cmd run build`                                                                         | Production build passes; all existing routes compile.                                                                                                                                                                                                                                                    |
| `node --env-file=.env.local scripts/verify-cloud-localization.mjs http://localhost:3000`                             | Actual Cloud admin and driver sign-in, existing localized pages/exports, role exclusions and layouts pass at 1280px and 393px in their currently saved English preferences. Before/after business workspace snapshots match; no business or preference writes.                                           |
| Linked migration history / dry run                                                                                   | Cloud 001–014; only 015 pending, no seeds/roles. No migration applied.                                                                                                                                                                                                                                   |
| `npx.cmd --no-install supabase db query --linked --file scripts/sql/cloud-driver-payment-readonly.sql --output json` | Read-only fingerprints captured for all 43 public application tables and Auth IDs. Cloud has two Auth users, five customers, two trips, three visits/invoices, one payment, thirteen stock movements and six finance entries. All application tables retain RLS; authenticated direct writes are denied. |

Database tests execute actual migration SQL on disposable PostgreSQL (PGlite). Coverage includes exact settlement, blank/over/underpayment rollback of inventory and finance, Credit balance with no receipt, empty-only returns, duplicate retry, registered-customer enforcement, another driver's denial, anonymous grants, changed customer prices and configured tax. Existing partial/Fonepay/reversal/deposit/PDF and ledger tests pass. Translation coverage now also rejects replacement question marks; seven pre-existing corrupted Nepali report/history labels were corrected alongside the new labels.

Playwright uses the test-only loopback Auth/REST adapter and actual application server actions and PostgreSQL routines, on desktop and Pixel 7. It never loads Cloud credentials or writes to Cloud. Hosted operational write acceptance requires an approved staging dataset or authorized real business activity; fixture success must not be reported as a Cloud sale.

The executed driver inventory scenario additionally verifies three new sales, independent pending jars, old-credit recovery, admin return confirmation, two delivery rounds, daily close/new day, unchanged archived reports and credit/stock/jar carry-forward. The historical payment browser scenario uses retained **admin** advanced entry for partial CASH/Fonepay/deposit receipts, then executes **driver** prior-credit and invoice recovery, PDF downloads and admin verification/refunds. No advanced historical coverage was removed to fit the simplified driver form.

## Manual acceptance

After approved migration application, use an authorized active delivery round on an OPEN business day. These steps create real operational records, so run them on staging or as approved genuine business activity.

1. Select a registered customer and quantities. Choose Paid, enter the exact payable amount, review and save. Confirm the invoice has zero outstanding, one receipt and matching collections on the admin dashboard/payment reports.
2. Try blank, lower and higher amounts. Review is disabled with an error; bypassing the UI must also fail atomically. Confirm no new visit, invoice, receipt, stock movement or custody entry appears.
3. Choose Credit. Confirm no amount or reference fields remain. Save and check the full invoice amount in customer credit, zero additional collections, and the unchanged original invoice date.
4. Try Credit with a walk-in: saving must be blocked until a registered customer is selected or created.
5. Toggle Paid/Credit repeatedly and EN/ने. Quantities and Paid draft remain; Credit submits no received amount. Check all four supplied Nepali labels, large touch targets, keyboard selection and no horizontal page overflow.
6. Refresh and sign out/in. Verify saved invoices, receipts and customer balances persist. Collect old credit separately and confirm it is today's collection without another sale.
7. Review historical partial/Fonepay transactions, manually reconcile with genuine evidence, and download invoice/receipt PDFs. Verify historical records and admin recovery remain usable.
8. Return/verify the round, close the day and open the next one. Outstanding customer credit and pending jars carry forward independently; warehouse stock and the previous archived report remain intact.

## Changed files

- Driver form: `src/components/driver-payment.tsx`, `trip-forms.tsx`, `driver-round-workspace.tsx`, `trip-summary.tsx`.
- Validation/data access: `src/domain/finance/driver-payment.ts`, `src/domain/operations/commands.ts`, `src/data-access/operations.ts`.
- English/Nepali dictionaries: `src/lib/i18n/en.json`, `ne.json`.
- Additive SQL: `supabase/migrations/202610120015_driver_payment_ui.sql`.
- Read-only Cloud verification: `scripts/sql/cloud-driver-payment-readonly.sql` (counts/fingerprints/grants, without customer or credential values).
- Unit/authorization/localization and finance database tests; updated operational browser scenarios and new `tests/operations-e2e/driver-payment.spec.ts`; test adapter RPC allowlist.
- This report and README.
