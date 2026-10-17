# Driver mobile workflow

## Implementation map and scope

The persistent `DriverApplication` still owns authentication, automatic encrypted workspace preparation, the single trusted writer, local-first operations and background sync. Its layout now delegates driver presentation to shared mobile components. Admin pages and accounting/domain commands have not been redesigned.

Routes handled by this same offline-capable application:

| Route                       | Screen                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/driver/home`              | Greeting, trip, three current stock cards, primary delivery/start action, quick actions, last three activities |
| `/driver/delivery`          | Registered/walk-in delivery, quantities, empty returns, payment, review, save                                  |
| `/driver/customers`         | Search/list, customer details, separate add/edit panel, delivery/collection links                              |
| `/driver/pending-jars`      | Existing customer jar cards and return details                                                                 |
| `/driver/sales`             | Collapsed delivery/receipt cards, current business-day default, collapsed BS date filters and totals           |
| `/driver/instant-delivery`  | Active-trip action first; no-trip home action; collapsed history/filter section                                |
| `/driver/return`            | Current stock, counted returns, Review Return, Confirm Return, warehouse waiting status                        |
| `/driver/collections` (new) | Customer, outstanding balance, amount, Cash/Fonepay pending, optional manual deposit/reference                 |
| `/driver/more` (new)        | Instant Delivery, Unreturned Jars, Collections, Return to Warehouse, profile, overnight stop, sign out         |

Invoice, receipt and trip detail routes remain authenticated server views. The driver's trip-detail Start link returns to the same guarded Home activation flow. Its extra sticky action bar was removed so it cannot overlap the mobile navigation.

## Presentation changes

- Compact teal header with driver name, connection indicator, notifications, language and menu. Five single-row mobile tabs: My Stock, New Sale, Customers, History, More. Desktop has a wider balanced content area.
- Compact connectivity strip replaces the repeated multi-paragraph panel. Pending changes remain local-first. “Updating balances…” is shown between upload acknowledgements and the completed balance download; the app no longer prematurely claims “All synced” during that interval.
- Home displays full jars remaining, empty jars collected and cartons remaining once. Day/round accounting totals and explanations are removed from Home; detailed totals remain secondary in History.
- Normal delivery keeps stock and financial validation, registered and walk-in destinations, CASH/CREDIT/FONEPAY, and the existing review contract. Repeated jar calculations and the manual stock-refresh block are removed from normal entry; the concise pending balance and reviewed product summary remain. Admin delivery presentation retains its original detail.
- Customers no longer permanently display add or collection forms. Name, phone and address are primary; shop name, contact person and descriptive customer type are behind More customer details. Shop name remains a separate optional data field because it has existing identity/directory uses. HOUSE classification/approval remains intact.
- Normal delivery still submits an empty visit note. Driver customer forms no longer ask for Delivery notes; existing notes are preserved in a hidden field when editing. No historical notes or database fields were removed.
- History cards show customer, amount, payment/state, product counts and date in their summary; opening a card reveals product details, outstanding amount and invoice link. Local records remain visible before a server invoice exists. Filters and collection/trip history are secondary.
- Return review uses the exact existing local stock/count objects. Confirming records the existing SUBMIT operation and prevents new sales locally. Warehouse stock only changes after the existing admin verification process.

## Why Ready to Start was not clickable

`roundLabel("LOADED")` produced a **status badge**, not a button. The previous Home separately rendered the “Start delivering” form only when `tripCanStart` returned true. Open-day and scheduled-date conditions could therefore hide the action while the same LOADED badge still said Ready to Start. The blocked state did not consistently explain the specific condition. There was already a `start` domain command; no new accounting or lifecycle command was needed.

Home now separates **Ready to Start** from a full-width **Start Trip** action for every LOADED trip. Internet, current open day and schedule restrictions have visible explanations. DRAFT trips explicitly require warehouse load confirmation. The UI also respects the server's Nepal calendar-date restriction rather than assuming that an advanced business-day label alone permits starting early.

Start Trip reuses the existing flow:

1. Require a current online session.
2. Finish automatic preparation if necessary.
3. Reuse the server's automatic-device registration/ownership preflight with the prepared credentials. Account login does not grant another phone's offline ownership.
4. Call the existing `transition_trip(START)` through `driverOperationAction`. SQL still checks the approved assigned driver, LOADED state, open day and scheduled date, using existing locks and idempotency.
5. Refresh the encrypted snapshot and workspace, activate the existing sync controller, show Trip active and retain Offline ready. Already-started state is recognized after an authoritative refresh. Known ownership failures retain the precise warehouse-reset message.

## Previous returned trip rule

The existing database has `one_live_trip_per_driver` on `trips(driver_id) WHERE status <> 'CLOSED'`. SUBMITTED, UNDER_REVIEW and DISCREPANCY trips still reserve the driver. Physical vehicle stock also blocks reassignment until it is reconciled. A returned trip therefore blocks assignment/loading of the next trip until warehouse confirmation closes it. No new UI rule was invented to prohibit starting an otherwise valid LOADED trip.

A database test now proves returned → reassignment refused → warehouse confirmation → next load and start allowed. A screenshot showing both an unclosed returned trip and a loaded trip for one driver is not sufficient to override this invariant; it can reflect cached history, different assignments or schema drift. This implementation inspected the repository rules and isolated fixtures, not live UAT rows.

## Keyboard and draft safety

`DriverPageContainer` provides a reusable Android keyboard-safe layout for every driver form, including customer editors, search, numeric/currency inputs, selects and textareas:

- `min-height: 100dvh`, normal document scrolling, safe-area padding and one measured navigation allowance.
- Driver and cached public-shell viewport metadata requests `interactive-widget=resizes-content` and `viewport-fit=cover`, with zoom still enabled.
- Focus and VisualViewport resize/scroll listeners hide the mobile bottom tabs while editing. Overlay keyboards contribute only their measured occluded height; resize-content keyboards do not add an arbitrary spacer.
- Focused fields scroll into view only when outside the usable viewport, with an Android animation follow-up and correction for browsers that retain the layout viewport. Header and form actions are not sticky/fixed over inputs.
- Driver fields use readable font sizes; number, amount and phone inputs retain numeric, decimal and tel keyboards.

Visited screens stay mounted for the current trip. Each screen keeps its own query parameters and reset counter, so another tab's customer parameter cannot change an unsaved delivery. Connectivity, preparation, locale and snapshot changes do not remount forms. Customer add/edit uses the same component before and after preparation. Forms reset on explicit cancel/Continue, navigation to a new sale after a successful save, or a genuine trip change. Only saved/completed forms are cleared by that navigation.

## Offline data integrity and database changes

No migration is added by this work. No IndexedDB schema, encryption, local key, UUID/sequence, operation payload, trusted-device SQL, immutable evidence, financial posting or return-count validation was changed. Existing migration 28–30 reset/transfer support remains required for deployments that have not installed it.

New screens navigate through the existing cached public shell. Deliveries, contacts, previous-credit collections and returns still commit to the encrypted local journal first and upload through the same controller. Known second-device ownership failures still say: “This trip is linked to another phone. Ask the warehouse admin to reset offline access.” Admin reset and single-replacement authorization remain covered by the existing end-to-end suite.

## Validation

- `npm run typecheck` and `npm run lint`: passed.
- `npm test`: 66 files and 669 tests passed, including SQL, offline integration and unit coverage. The previous-trip test exercises real isolated SQL constraints and warehouse confirmation. After the final driver wording changes, all 11 localization tests passed again.
- Playwright offline/driver coverage: all 74 distinct desktop/Pixel scenarios have passing results across the broad run and targeted reruns after fixes. These include automatic preparation, loaded-trip activation, local deliveries and collections, reconnect/sync, customers, return, second-device ownership/reset, preserved evidence, draft safety, notifications and overnight continuation. This was not a single uninterrupted green full-suite run.
- The final React lifecycle fixes were followed by eight affected startup, mobile workflow, keyboard and notification checks; all passed after rerunning one timing-sensitive upload test with a timeout that accommodates the existing retry backoff.
- `npm run build`: passed for both the isolated offline fixture and normal production configuration. Prettier checks for changed files and `git diff --check` passed.
- Responsive checks passed at 360, 768 and 1280 pixels, including no horizontal overflow, compact header, five-tab navigation and reachable primary actions. Phone, tablet and desktop screenshots were visually reviewed.

Browser keyboard testing uses Chromium/Pixel 7 emulation with an overlay VisualViewport model and checks focused input visibility, hidden navigation and draft retention across tab/connectivity changes. A physical Android installed TWA/IME was not available in this workspace and is not claimed as tested.

## Changed components and supporting files

- New shared presentation: `driver-mobile-layout.tsx`, `driver-connectivity-status.tsx`, `driver-trip-card.tsx`, `driver-workspace-screens.tsx`.
- Refactored driver views: `driver-application.tsx`, `driver-home-view.tsx`, `driver-stock.tsx`, `driver-customers.tsx`, `driver-sales-view.tsx`, `instant-delivery.tsx`.
- Forms: `delivery-customers.tsx`, `trip-forms.tsx`, `offline/collection.tsx`, `offline/workspace.tsx`; driver-only actions in `trip-summary.tsx`.
- Layout/routes: `app/driver/layout.tsx`, new `app/driver/more/page.tsx` and `app/driver/collections/page.tsx`, cached `app/offline/page.tsx`, driver-scoped rules in `app/globals.css`, and `driver-runtime-context.ts`.
- Language: English and Nepali dictionaries.
- Tests: new `mobile-workflow.spec.ts`, `responsive-driver.spec.ts` and `driver-navigation.ts`; existing driver/offline browser tests updated for More, explicit Add Customer and two-step returns; loaded-trip fixture support; an additional SQL trip-assignment test.

No commit, push, live migration or live business-data write was performed.
