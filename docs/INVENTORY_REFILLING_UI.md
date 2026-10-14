# Inventory and Refilling/Damage UI improvement

Inventory now opens with current usable warehouse balances and stock by product. Manual corrections use a compact dialog with a before/after preview. Refilling and damage retain their original operations, with product-specific availability, quantity limits, previews and readable processing history.

## UI changes

| Area                      | Result                                                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current inventory         | Compact full/empty/carton cards. MAIN warehouse stock remains separate from vehicles and damaged stock. Historical date filters never alter these balances.                                                                                                                   |
| Stock by product          | Product name, SKU, configured unit, active status and applicable stock states in responsive compact records. Inactive products retain physical stock and correction access.                                                                                                   |
| Manual adjustment         | Adjust Stock opens the shared accessible dialog. Product/state/direction/quantity/reason/supporting notes remain. Preview shows the actual selected warehouse balance and expected result. Invalid, negative and unsupported quantities cannot be submitted through the form. |
| Confirmation and feedback | Existing confirmations, server actions, mandatory explanations and request keys remain. A mounted correction keeps its request key through errors/retries. Successful forms cannot post again until a new entry is opened.                                                    |
| Stock activity            | Real event codes map to readable actions and icons. Records show product, actual configured unit, quantity, stock state, source/destination, responsible user, BS date/time and trip links. Technical references stay in View Details.                                        |
| Refill grouping           | A valid completed refill appears once, with both original input/output movements in its audit details. Matching requires the same processing reference, product, quantity, user, day and warehouse location. Unrelated/mismatched records are not combined.                   |
| Movement filters          | BS range, product, event type, stock state and warehouse/company scope sit directly above activity. Reset and pagination preserve the relevant filters.                                                                                                                       |
| Adjustment history        | Separate BS/product/state filters and pagination. Product/state, signed quantity, before/after balance, explanation, notes, admin and BS time remain visible. Confirmed history has no edit/delete controls.                                                                  |
| Refill availability       | Selected jar product shows current full jars, usable empties, tracked quarantined jars and available refill stock. Quarantine is not subtracted twice from usable stock. Missing quarantine tracking is labeled Not tracked.                                                  |
| Refill preview            | Ten eligible empties convert to ten full jars. The preview shows both counters and blocks quantities exceeding usable empties or supported integer bounds.                                                                                                                    |
| Damage preview            | Full/empty selection shows its actual available stock and expected transfer to the separate damaged location. Damaged stock is excluded from available loading/refilling stock.                                                                                               |
| Processing history        | Compact Refilled/Damaged records with product, quantity, source state, reason, admin, BS time, posting business date and original processing/movement references. History is paginated instead of loading full daily reports for every date.                                  |
| Responsive presentation   | Refilling/damage forms sit side by side on wide screens and stack on smaller screens. Module cards, inputs and dialog controls use the existing teal/white theme and touch target sizes.                                                                                      |

All new labels have English/Nepali translations. Existing role defaults and saved language preferences are preserved; Admin defaults remain English. BS conversion and Nepal timezone handling use the existing calendar utilities.

## Inventory concerns found and resolved

- The old Inventory history queried company-wide movements below a warehouse heading. Vehicle delivery and empty collection do not change warehouse on-hand balances. The default view now filters transfers to/from MAIN; company-wide history is explicitly selectable and includes vehicle activity.
- Actual adjustment events are `MANUAL_INCREASE` and `MANUAL_DECREASE`, not an invented `ADJUSTMENT` database event. Prepared-trip unloads use `TRIP_UNLOAD`. All existing event codes are retained.
- Completed refills have two journal legs. The paginated activity query uses one representative leg per atomic batch, then reads its originals by `processing_id`. Empty-state/input filters use the input representative. This avoids splitting or counting one refill twice across pages; both legs remain accessible.
- Inventory activity and adjustments continue filtering actual event timestamps at Nepal midnight, with an exclusive end bound. Processing history preserves the previous posting-business-date semantics, so overnight postings are not silently reassigned to the calendar date of their timestamp.
- React's action form reset could clear a selected product after a server validation failure while its stateful preview retained the selection. The warehouse forms now preserve their fields on reset; processing previews disappear after confirmed success. Other `OperationForm` callers retain their existing reset behavior.
- The test provider previously returned an empty placeholder for adjustment reads. It now reads real immutable adjustment rows and supplies existing metadata relationships from the disposable PostgreSQL database.

## Business safety

No database tables, migrations, transaction writers, event codes, stock formulas, permissions or RLS policies changed. Refills, damage, corrections, loads, sales, payments, custody, daily close and offline sync retain their existing APIs and atomic database safeguards.

Previews are based on the current page's authoritative database reads. The existing server parser and locked database operation validate again at submission; another operation changing stock cannot make an invalid preview authorize negative stock. An identity or history provider failure is reported, rather than displayed as invented zero stock.

The only shared changes are optional UI props for dialog icons, submit availability, success handling and field preservation, plus optional date-field prefixes and adjustment read filters. Their defaults preserve other callers. Stock actions also invalidate Refilling so its availability refreshes after corrections. No production data was written or reset.

## Components reused

Reused `Card`, `Button`, `Input`, `AdminDialog`, `DialogClose`, `StatusBadge`, `OperationForm`, `Field`, `WarehouseStock`, `BsDateRange`, `BsDatePicker`, `T`, `Message`, `Value`, `DateValue` and `LocalizedNav`. No new design system, charts or decorative animation was added.

## Files changed for this task

| File                                                              | Purpose                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/app/admin/inventory/page.tsx`                                | Inventory composition, adjustment dialog and independent history filters             |
| `src/app/admin/refilling/page.tsx`                                | Current stock, processing forms and paginated history                                |
| `src/app/admin/inventory/actions.ts`                              | Refilling-page invalidation after stock changes                                      |
| `src/components/warehouse-stock.tsx`                              | Compact current stock cards                                                          |
| `src/components/warehouse-product-stock.tsx`                      | Stock by product                                                                     |
| `src/components/inventory-forms.tsx`                              | Existing correction form, preview, bounds, retained fields and stable key            |
| `src/components/warehouse-processing-form.tsx`                    | Existing processing action with availability and previews                            |
| `src/components/day-forms.tsx`                                    | Re-export processing form; other daily-close forms retained                          |
| `src/components/stock-change-preview.tsx`                         | Shared before/after display                                                          |
| `src/components/inventory-history.tsx`                            | Activity, adjustment, processing records and pagination                              |
| `src/components/inventory-history-filters.tsx`                    | Shared scoped history filter presentation                                            |
| `src/components/bs-date-picker.tsx`                               | Optional field-name prefix for independent ranges                                    |
| `src/components/admin-dialog.tsx`                                 | Optional action icon                                                                 |
| `src/components/operation-form.tsx`                               | Optional warehouse-only UI flags and success callback                                |
| `src/domain/inventory/presentation.ts`                            | Validated filters, safe previews and event/batch presentation                        |
| `src/data-access/warehouse-ui.ts`, `src/services/warehouse-ui.ts` | Authorized read-only activity, quarantine and processing queries                     |
| `src/data-access/inventory.ts`, `src/services/inventory.ts`       | Optional adjustment filters and complete audit references                            |
| `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`                    | New labels and explanations                                                          |
| `tests/helpers/operations-provider.mjs`                           | Existing-table joins and actual audit rows in the isolated fixture                   |
| `tests/unit/inventory-presentation.test.ts`                       | Stock bounds, filter validation and safe refill grouping                             |
| `tests/unit/warehouse-ui-data.test.ts`                            | Query scopes, pagination, midnight bounds, posting dates, row caps and authorization |
| `tests/operations-e2e/warehouse-ui.spec.ts`                       | Real correction, refill, damage, history, retry and responsive scenarios             |
| `tests/operations-e2e/daily-close.spec.ts`                        | Updated labels for the retained processing workflow                                  |
| `docs/INVENTORY_REFILLING_UI.md`                                  | Completion report                                                                    |

## Verification

- **614 unit/database integration tests passed across 61 files.** This includes inventory, finance, physical jar conservation, damage quarantine, immutable histories, permissions, trip settlement, overnight work, HOUSE, Instant Delivery, offline sync and notifications.
- **10 new browser scenarios passed:** two workflows each at 1280×720 desktop, 1024×768 laptop, 768×1024 tablet, 412×839 mobile and 360×800 narrow mobile.
- The correction scenario verifies warehouse-only balances, product/state previews, excessive-quantity rejection, canceled confirmation, single posting/idempotent retry, unchanged original records, company scope, date filtering and independent 25-entry adjustment pagination.
- The processing scenario verifies 33 full/50 empty becoming 43/40 after ten refills, then recording three damaged empties and two damaged full jars. Usable stock finishes at 41 full/37 empty, with five quarantined jars. Physical warehouse-plus-quarantine jars remain 83; vehicle stock remains unchanged. The displayed numbers come from actual fixture operations, not UI constants.
- Processing failures retain the product/quantity/preview; a short mandatory reason cannot write any batch. Historical processing records and both refill journal IDs remain accessible. Replaying a confirmed refill request does not add jars or movements.
- English/Nepali switching and page/dialog horizontal overflow were checked at all five emulated sizes. Screenshots were inspected. These are Chromium browser emulations, not physical device or assistive-technology certification.
- Browser checks also reject page/hydration errors. Warehouse dropdowns use plain translated option text. Closing an adjustment restores body scrolling; desktop and narrow-phone wheel scrolling were explicitly verified after close.
- **Four retained browser regressions passed** on desktop/mobile: daily close with refilling, damage, archive exports and next-day carry-forward; and the complete physical trip cycle with driver sales, returns and settlement.
- Production build, TypeScript, targeted ESLint and Prettier passed.

Initial checks found missing translations and the form-reset issue; both were fixed. Early browser assertions were corrected to compare warehouse postings with the complete business-day journal instead of the trip-only movement list. No unresolved test failure is currently known.

## Outstanding shared-shell issue

The existing Admin navigation still stacks all destinations before content below 1024px. This was already recorded as S01 in `docs/UI_UX_AUDIT.md` and is visible in the current phone/tablet inspection. Module controls and forms work at the tested sizes, but the complete mobile Admin experience retains that navigation limitation. The shared sidebar/navbar was kept outside this module change.

No changes were deployed or committed. Earlier workspace work was preserved.
