# Admin trip creation and loading

## Workflow

`/admin/trips` now includes product quantities in Create new trip. Every active loadable product comes from the existing operations workspace, with its actual MAIN warehouse balance, a numeric input and large minus/plus controls. Driver and vehicle availability still respects every unclosed trip; vehicles with physical stock are also excluded. The BS date picker continues submitting a canonical AD date.

The secondary **Save as Draft** action creates a DRAFT trip, reserves its driver/vehicle and saves optional notes, delivery date and proposed quantities. It does not write confirmed load rows, move inventory, stamp physical loading or enable the driver to start.

The primary **Create & Confirm Load** action asks the admin to confirm that loading has physically happened, then creates the trip and confirms the load in one database transaction. Success shows the trip number, driver, vehicle, date, product quantities, Ready to Start status and Open Trip link. The admin trip list refreshes in place. The driver's existing online Start Trip and automatic offline preparation flow remain unchanged.

Existing drafts still open normally. The loading panel restores proposed quantities and supports **Save proposed quantities** or **Confirm warehouse loading**. Product assignment with zero full jars for empty collection remains available in that panel. Existing rescheduling, cancellation, unloading and historical views are retained.

## Existing logic reused

- `schedule_trip` → existing `create_trip` for OPEN-day validation, delivery schedule, assignment, numbering, reservations, audit and assignment notifications.
- `load_trip` → existing `ops_move` for physical confirmation, ordered balance locks, the authoritative nonnegative-stock check, confirmed load rows, inventory movements, loading metadata, audit and stock-loaded notifications.
- Existing `ops_actor`, service permissions, `ops_retry` and `ops_finish` for admin authorization and auditable, payload-checked idempotency.
- Existing BS date picker, localization, product/warehouse workspace, quantity counter, controls and driver activation flow.

## Migration and consistency

Migration **31**, `202610160031_trip_create_and_load.sql`, is required before using the new actions. It has been tested locally and has **not** been applied to a live database.

Confirmed `trip_load_items` are immutable evidence and require a movement ID for every positive quantity. Using them as editable proposals would break that contract. The migration instead adds a bounded `proposed_load_items` JSON array to existing trip metadata; no duplicate load table is introduced. Existing historical rows get the empty default, and no confirmed journal, stock balance or archived report is rewritten.

The new `create_trip_with_load` RPC composes existing commands within a single PostgreSQL transaction. Any schedule, reservation, quantity or load failure rolls back creation and all child writes, including stock movements, load rows, audit events, notifications and request records. Existing driver/vehicle unique indexes remain the final concurrency guard and receive clear reservation messages. PostgreSQL trip numbering retains its existing sequence behavior.

Proposal validation checks unique active products, matching stock kinds, bounded whole quantities and current availability. Confirmed creation additionally requires a positive quantity. This preliminary availability read does not reserve or deduct stock. The existing load writer checks balances again under its ordered row locks. A shortage or a failure after some products have been processed rolls the entire operation back.

On a rejected submission, the server action fetches current stock and reservations. The form displays updated availability, retains entered quantities/date/notes and its request identity, and asks the admin to adjust. A quantity already above updated availability stays visible with a specific error; confirmation remains disabled until it is corrected.

## Duplicate submissions and uncertain responses

The mounted form keeps one trip UUID and request key. An immediate submit guard and pending fieldset prevent double clicks. The RPC's actor-scoped advisory request lock and payload comparison serialize identical retries and return the original trip without another load or journal entry. A different payload cannot reuse a completed key. Child commands have deterministic request keys derived from the parent.

A lost response can be retried with the same form and identity. If creation is known to have succeeded but its confirmation cannot be fetched, the UI offers Open Trip so the admin can inspect the existing result. New identifiers are generated only when the admin explicitly chooses Create another trip.

## Files changed for this request

| Area                    | Files                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin route/action      | `src/app/admin/trips/page.tsx`, new `src/app/admin/trips/actions.ts`                                                                                                                                                                                                                       |
| Shared entry/loading UI | new `src/components/create-trip-form.tsx`, new `src/components/trip-load-products.tsx`, `src/components/trip-forms.tsx`, `src/components/operation-form.tsx`                                                                                                                               |
| Domain/data             | new `src/domain/operations/trip-loading.ts`, `src/domain/operations/commands.ts`, `src/domain/operations/types.ts`, `src/data-access/operations.ts`                                                                                                                                        |
| Migration               | new `supabase/migrations/202610160031_trip_create_and_load.sql`                                                                                                                                                                                                                            |
| Language                | `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`                                                                                                                                                                                                                                             |
| Tests                   | new `trip-create-load-db.test.ts`, `trip-loading.test.ts`, `trip-create-load.spec.ts`; existing migration/driver-approval preservation snapshots, admin-directory, trip-cycle, driver-workflow, overnight-loading and read-only schema diagnostics updated; fixture RPC allowlist extended |

Earlier driver mobile work already present in the working tree is preserved. No commit or push was performed.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: **68 files, 680 tests passed**. This includes the new atomic creation/loading tests, existing inventory/trip/offline integration coverage and migration preservation checks. Historical snapshot comparisons exclude the newly added metadata field and separately verify its empty default; all original historical fields and journal rows are still compared.
- New Playwright scenarios: **8 passed** across desktop Chromium and Pixel 7 emulation. They cover draft quantities and later editing/confirmation; all active products including an extra jar SKU; stock limits; 360/768/1280 layouts; immediate duplicate submissions; driver Ready to Start/activation; changing warehouse stock without partial creation; retained fields; and retry after losing a successful response.
- Existing future-draft/history browser scenario: **2 passed** after adding an explicit visibility wait before its layout measurement. All 10 distinct selected browser cases have passing results across the run and targeted rerun; the entire operations browser suite was not rerun.
- Normal production `npm run build`: passed. Prettier checks for changed files and `git diff --check`: passed.
- Phone and desktop form screenshots were visually reviewed in `test-results/admin-trip-loading/`. Responsive assertions include tablet width and no horizontal overflow.

Browser tests use disposable loopback PostgreSQL fixtures, never hosted business data. No live migration, live business-data write, commit or push was performed.
