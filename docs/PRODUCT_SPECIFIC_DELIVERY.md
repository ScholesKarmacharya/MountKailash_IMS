# Product-specific delivery fields

The New Sale/New Delivery form, confirmation (including the save dialog), trip visits and customer totals, driver sales history, admin customer history, invoice and allocated receipt details/PDFs, and daily report HTML/PDF/CSV now display quantities according to the database product kind.

- `BOTTLE_CARTON`: Water Cartons and Cartons Delivered only. No jar delivery, collection or custody fields.
- `FULL_JAR`: Water Jars, Jars Delivered, Empty Jars Returned and Unreturned Jars. The last value is the **signed net change** from the visit: delivered minus returned. A return-only visit can therefore show a negative change.
- The registered customer's confirmation also shows previous unreturned jars and the updated total. For example, a previous balance of 10 plus 12 delivered minus 8 returned yields 14; this visit's increase is 4. Historical visits show their own recorded change, never today's balance presented as the historical balance.
- Mixed deliveries show a separate section for each product. Database names remain unchanged; even a misleading name containing “jar” or “carton” cannot determine the product type.
- English/Nepali labels and localized digits work with the existing BS calendar. Paid/Credit remains the driver's payment interface. Histories retain truthful partial and pending payment states for earlier/admin transactions.

## Data and deployment

**No migration or Cloud database write is required.** Existing inventory, financial, custody, FIFO, closing and idempotency functions are unchanged. Cartons reduce carton stock; jars reduce full-jar stock; positive empty returns increase vehicle empty stock and post custody movements. The existing SQL rejects jar quantities on cartons and creates no zero-valued jar custody entries for carton sales. No new carton-return workflow is introduced.

Authorized readers enrich display models from `visit_items` and `products`, using the caller's existing RLS, bounded filters and paginated quantities. Product kinds cannot change after creation and visit items cannot be rewritten. Invoice product names, original prices, money calculations and closed-day report snapshots remain the stored values. Closed archives are not rewritten; only the display/export projection changes. System-wide stock/counter totals continue to report all stock states; individual product and visit sections show only applicable fields.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e:operations
npm.cmd run format:check
$env:VALIDATE_BUILD='1'; npm.cmd run build
```

Database and browser fixtures use disposable PostgreSQL and loopback-only test servers, not Supabase Cloud. New tests cover carton-only, jar-only and mixed quantities, signed return-only changes, existing custody, type/name mismatch, no carton custody postings, idempotent posting, driver read isolation, REST pagination, Paid/Credit, both languages and actual generated PDFs. Existing trip, finance, inventory, security and daily-closing regressions remain enabled.

The Nepali PDF regression renders a preview in ignored `test-results/localization/nepali-pdf-preview.png`. PDF text extraction can reorder Devanagari glyphs; exact Unicode labels are checked in source documents and translations, while rendered/exported PDF checks use the shaped glyph output.

## Manual acceptance

Use staging or genuine authorized deliveries for steps that save records; do not create Cloud test business records without approval.

1. Load only cartons: verify New Delivery has only Cartons Delivered, and a quantity of 5 reviews as 5 cartons with no jar fields. Save Paid with the exact total and verify the invoice, receipt, vehicle carton stock and admin collections.
2. Select jars: enter 12 delivered and 8 returned. Verify this visit's net change is 4. With 10 already held, verify the updated total is 14. Collect more earlier jars than newly delivered to check the negative visit change and nonnegative updated total.
3. Review a mixed delivery: verify separate jar and carton sections, exact quantities and the unchanged payable amount. Choose Credit for a registered customer and check the existing credit ledger.
4. Switch EN/ने before review and while reviewing. Verify drafts, quantities, payment status and BS dates remain correct, and the screen fits a mobile viewport.
5. Inspect saved driver sales/trip history and admin invoice/customer/daily reports. Download invoice and receipt PDFs in both languages and daily report PDF/CSV. A carton product row must not acquire jar fields, including in grouped totals.
6. Refresh and sign out/in: verify saved quantities and balances persist. Review older partial/Fonepay records; pending Fonepay remains pending until genuine reconciliation.

## Executed results — 2026-10-12

| Command/check                                                                               | Result                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                                     | Passed                                                                                                                                                                                                                  |
| `npm.cmd run lint`                                                                          | Passed                                                                                                                                                                                                                  |
| `npm.cmd test`                                                                              | 277 tests passed in 30 files                                                                                                                                                                                            |
| `npm.cmd run test:e2e:operations`                                                           | All 26 scenarios passed on desktop and mobile, including the four new product-specific scenarios                                                                                                                        |
| Updated Nepali PDF render test                                                              | Passed separately; rendered preview visually inspected                                                                                                                                                                  |
| `npm.cmd run format:check`                                                                  | Passed                                                                                                                                                                                                                  |
| `$env:VALIDATE_BUILD='1'; npm.cmd run build`                                                | Passed using separate validation output; Cloud development server preserved                                                                                                                                             |
| `node --env-file=.env.local scripts/verify-cloud-driver-payments.mjs http://localhost:3000` | Existing Cloud role authentication, unsaved Paid/Credit drafts, decimal input, quantity controls and touch/layout checks passed at 1280px/393px; invalid-status probes rejected before posting and anonymous RPC denied |
| `node --env-file=.env.local scripts/verify-cloud-localization.mjs http://localhost:3000`    | Existing Cloud admin/driver pages, BS date/exports, role restrictions and layout passed at 1280px/393px using their current English preferences                                                                         |

Both Cloud checks compared business workspace snapshots before and after: unchanged. No Cloud deliveries, customer records, stock, prices, payments, preferences or fixtures were written. Actual new-sale saves, stock persistence and jar/credit updates were executed on disposable PostgreSQL through the real application, not on Cloud.

The initial product browser run exposed a test-only sign-out/navigation race; awaiting the sign-in route fixed it, and the final complete browser run passed all scenarios. Initial translation and PDF extraction assertions were corrected; exact Nepali source labels and actual PDF rendering are verified. Next's development server emitted two cancellation-stream diagnostics during rapid navigation in the passing inventory scenarios; the installed runtime identifies these as destination-stream cancellation, with no failed save or stock/finance assertion. No accounting or permission bug was found or changed.

No migration is pending for this change. Carton customer returns remain outside the delivery form; existing unsold vehicle-to-warehouse returns continue to work. No additional production business workflow has been claimed as executed.
