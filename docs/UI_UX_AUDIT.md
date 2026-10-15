# Mount Kailash UI/UX audit — 14 October 2026

Audit only. No application source, business rules, SQL migrations, RLS policies, or production data were changed. The source-tree hash before and after inspection is identical. Screenshots and audit scripts are isolated evidence artifacts.

Follow-up, 15 October 2026: S01 (mobile Admin navigation above content) is resolved by the responsive drawer described in [ADMIN_MOBILE_NAVIGATION.md](./ADMIN_MOBILE_NAVIGATION.md). Parent-route active highlighting from S04 is also implemented; the original findings below retain the baseline evidence. Finance, closing, sync and history improvements are documented in [FINANCE_OPERATIONS_UI.md](./FINANCE_OPERATIONS_UI.md).

**Scope and evidence**

All 14 requested Admin screens and all six Driver screens were reviewed. Driver connection status, device setup/unlock, prepared-online and offline presentation were also inspected. Driver Sync and Daily History received an additional review because they are visible navigation destinations.

Evidence labels used below:

- **C — Code verified:** directly supported by the current repository.
- **V — Browser verified:** observed rendering, DOM measurements, or interactions in Chromium at the stated viewport. A screenshot capture alone does not establish complete usability.
- **F — Further inspection required:** physical-device, assistive-technology, larger-dataset, or additional-state verification is still needed.

Actual CSS viewport sizes tested: **360 × 800**, **393 × 852**, **768 × 1024**, and **1440 × 1000**. English was inspected across all named screens at all four sizes. Nepali was inspected across all named screens at 360 × 800. This produced **110 baseline render inspections and 22 state captures**, plus focused content screenshots.

The application ran from its existing production build against disposable loopback PostgreSQL fixtures. Fixtures included real posted test cash, credit, Fonepay-pending and approved HOUSE deliveries. Device setup, offline navigation, a pending delivery, lock/unlock presentation, delivery review/success, calendar opening, closing review, invalid product submission and unmatched history filtering were inspected. No live Supabase reset or production transaction was performed.

This is viewport testing, not physical phone usability certification. iOS Safari, Android keyboards, tablet touch interaction, screen readers, 200% browser zoom, large production datasets, every error/recovery branch, and end-user task timings remain untested.

Evidence: [metrics and interaction observations](C:/Users/Acer/Desktop/CODE/mount-kailash/test-results/ui-audit/metrics.json), [audit screenshots](C:/Users/Acer/Desktop/CODE/mount-kailash/test-results/ui-audit/), [fixture-only capture script](C:/Users/Acer/Desktop/CODE/mount-kailash/test-results/ui-audit/run.mjs).

**Priority definitions**

- **Critical:** misleading operational information or a serious task-integrity problem requiring immediate investigation.
- **High:** a frequent task, safety cue, navigation, localization or accessibility problem with substantial user impact.
- **Medium:** recurring friction, inconsistent presentation or avoidable cognitive load.
- **Low:** polish that can follow the operational improvements.

Priorities below describe user impact; they are not claims that every item violates an accessibility standard.

**Immediate finding requiring separate functional review**

**C001 — My Stock displays unsupported zero sales/cash totals — Critical — C + V**

In the fixture, the driver received a confirmed cash receipt of **NPR 1,202.00** and visible invoices including **NPR 1,202.00** and **NPR 450.75**. Admin Payments displayed **NPR 1,803.00** in sales and **NPR 1,202.00** cash. Driver My Stock displayed **NPR 0.00** for sales and cash.

The driver finance response contained **zero journal rows**, while the admin response contained eight. The existing finance RPC intentionally omits journal data for drivers; roundFinance nevertheless derives sales/cash from that array and reports availability using the overall workspace flag.

This is a reproducible **data-presentation contract mismatch**, not a spacing or color issue. It can mislead a driver about collections and handover. It does not establish that the underlying invoices, receipts or journals were posted incorrectly.

Proposed response: distinguish unavailable metric inputs from genuine zero values. Do not reconstruct a second financial ledger in the UI, expose admin journals, relax RLS, or change payment posting. A correct authorized summary solution needs a **separately approved financial/read-model review**; it must not be bundled silently into cosmetic work.

Review locations: [DriverMoney](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/driver-stock.tsx:87), [roundFinance](C:/Users/Acer/Desktop/CODE/mount-kailash/src/domain/operations/driver-workspace.ts:91), [finance data access](C:/Users/Acer/Desktop/CODE/mount-kailash/src/data-access/finance.ts:39), and the private-role contract in [finance_workspace](C:/Users/Acer/Desktop/CODE/mount-kailash/supabase/migrations/202610110008_sprint3_visit_and_reads.sql:112). The SQL file is evidence, not a proposed UI edit.

**Shared issues affecting several screens**

| ID / priority                          | Verified problem and user impact                                                                                                                                                                                                                                              | Proposed improvement                                                                                                                                                                                                                                    | Files and reuse                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 — High — C + V                     | Below the 1024px sidebar breakpoint, the entire 16-entry admin navigation stacks before content. At 360px, most page titles start at y=1,114px; Overview starts at 1,138px. At 768px, Overview starts at 1,062px. Users must scroll past navigation before reaching the task. | Keep the desktop sidebar; use a compact, accessible menu disclosure/drawer on phone/tablet with the same destinations and permissions. Preserve an accessible page title and skip link.                                                                 | [AppShell](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/app-shell.tsx:50), [Navigation](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/navigation.tsx:17). Reuse Button, role-aware links, LanguageSwitcher and the existing skip link.                                                                                                         |
| S02 — High — C + V                     | Driver main content is limited to 768px at a 1440px viewport, with about 704px of inner content. The header/nav spans a much wider area. This leaves excessive desktop whitespace and forces stock/report content into a tall narrow column.                                  | Use role/task-specific responsive widths: compact entry forms, broader stock/history layouts, consistent header alignment. Retain one mobile column.                                                                                                    | [driver shell](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/driver-application.tsx:1188), driver-home-view, driver-sales-view. Reuse existing grid and card primitives.                                                                                                                                                                                  |
| S03 — High — C + V                     | The connection panel precedes every Driver screen: 195px in the unprepared baseline and 280px in the prepared sample, before additional storage/network notices. It competes with the task. A fresh device says “Device records are locked” although setup has not occurred.  | A compact connection/pending-record strip, one relevant next action, and expandable device details. Explicitly distinguish not configured, locked, ready, pending and review-required states. Keep persistence warnings and recovery actions available. | [driver status rendering](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/driver-application.tsx:1190). Reuse existing connectivity/SyncView/device state; change presentation, not truth conditions.                                                                                                                                                       |
| S04 — Medium — C + V                   | Fifteen admin destinations share the Package icon. Child customer routes have no active sidebar link: zero aria-current links were observed on a customer detail page. Location and destination recognition are weak.                                                         | Use existing Lucide icons by destination and retain the parent section highlight on child routes. Avoid additional navigation levels.                                                                                                                   | [Navigation](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/navigation.tsx:94). Reuse current paths and role authorization.                                                                                                                                                                                                                                |
| S05 — High — C + V                     | Driver navigation labels are 12px; the six-destination two-row phone bar is 153px high at 360px. Small text is difficult to scan even though link targets themselves are large.                                                                                               | Test clearer 13–14px labels, consistent icon size and approved short EN/Nepali wording. Retain the six existing destinations and adequate bottom content clearance.                                                                                     | [Navigation](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/navigation.tsx:30), driver shell bottom padding. Do not add an unnecessary “More” navigation hierarchy.                                                                                                                                                                                        |
| S06 — Medium — C + V                   | Card padding, titles, metric sizes and control styling vary. The generic Card uses p-6, while individual screens override p-3/p-4/p-5. Several pages use custom buttons/selects alongside shared controls. Hierarchy becomes inconsistent.                                    | Define compact/standard/form card variants, shared PageHeader, MetricCard, StatusBadge and Toolbar patterns. Keep teal/white, restrained borders and the existing font.                                                                                 | [Card](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/ui/card.tsx), [Button](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/ui/button.tsx), [Input](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/ui/input.tsx), [OperationsHeading](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/operations-layout.tsx).                    |
| S07 — High — C + V                     | New Sale quantities entered as 2 delivered/1 returned became 0/0 after navigating to Unreturned Jars and back, without a leave confirmation. The generic form warning listens for beforeunload, but the persistent driver navigation uses pushState and unmounts the form.    | Protect in-app navigation when a draft is actually dirty; offer Stay/Discard, or preserve the existing draft state. Do not automatically post a delivery or queue an incomplete transaction.                                                            | [navigation interception](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/driver-application.tsx:1054), [DeliveryForm](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/trip-forms.tsx:341), [OperationForm](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/operation-form.tsx:114). Keep request IDs and reviewed-payload rules unchanged. |
| S08 — Medium — C + V                   | Product validation messages are localized, but remain generic “This field is required.” Invalid fields had no aria-invalid or aria-describedby. Server errors are generally form-level blocks. Users must infer which field needs correction.                                 | Shared visible field errors and an error summary, focus on the first invalid field, required/optional cues, telephone/decimal keyboards, and descriptive error linkage. Preserve server bounds and validation authority.                                | Input, [Field/Select](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/operation-form.tsx:13), inventory-forms, finance-admin-forms, localization. Reuse existing localized messages and AmountInput.                                                                                                                                                        |
| S09 — Medium — C + V                   | Confirmation styles differ: delivery review plus a native confirmation, generic native confirmations for many admin saves, and a direct prepared-device return action. Native dialogs cannot present a consistent branded summary.                                            | A shared accessible confirmation/review presentation scaled to the action. Keep deliberate confirmation for closing, variance approval, access changes and queue sealing; preserve all guards and payloads.                                             | OperationForm, inventory-forms, driver-status-form, trip-forms, offline/workspace. Reuse existing review data, not new calculations.                                                                                                                                                                                                                                |
| S10 — Medium — C; V for selected cases | Empty/loading/success presentation is fragmented. Existing EmptyState is not consistently used; global loading is a pulsing line; operation success can appear both inline and as a toast. “Continue with updated data” causes a full reload in admin forms.                  | Consistent skeleton/status, no-records vs no-matches vs unavailable states, contextual success, and predictable focus after continuing. Avoid unnecessary motion.                                                                                       | [EmptyState](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/empty-state.tsx), [loading](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/loading.tsx), [error boundary](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/error.tsx), OperationFeedback, OperationForm, inventory-forms. F: inspect every retry/recovery state before rollout.              |
| S11 — Medium — C + V                   | Backend/internal language appears in normal operation: Sprint/migration wording, UUIDs, uppercase journal enums, “immutable” explanations and developer-oriented metadata. It makes routine screens feel unfinished.                                                          | Plain operational wording; put support references and implementation detail in a small technical disclosure for authorized admins. Preserve audit access and unavailable states.                                                                        | operations-layout, finance-overview, [metadata](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/layout.tsx), inventory page, driver-stock, admin/sync.                                                                                                                                                                                                             |
| S12 — High — C + V                     | Daily Close blocker messages remain English in Nepali mode, including Fonepay, trip and vehicle blockers. These are necessary instructions, not customer-supplied names.                                                                                                      | Translate blocker presentation by the existing code/type or known message templates; keep customer names, IDs and stored reasons unchanged. Audit dynamic server messages separately from dictionary keys.                                              | [blocker rendering](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/daily-close/page.tsx:82), i18n/messages, en.json, ne.json. No change to blocker logic.                                                                                                                                                                                                   |
| S13 — High — C + V                     | Opening a driver jar card removes the focused button and leaves activeElement on BODY. Keyboard users are not taken to the new details.                                                                                                                                       | Focus the detail heading when opening and restore the originating card/action when returning; announce loading/errors appropriately.                                                                                                                    | [driver jar details](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/driver-pending-jars.tsx:251). Reuse an accessible DetailPanel pattern. F: screen-reader verification remains necessary.                                                                                                                                                                |
| S14 — Medium — C + V                   | Pricing, Payments and Credit contain horizontally scrolling mobile tables. At 360px, the pricing/house tables use 270px containers with 409px/653px content. Actions and status columns can be offscreen. Page-wide overflow was not observed.                                | Responsive summary rows/cards for operational mobile use, with complete details available. For retained tables, add an obvious scroll cue and keep important identity/action columns discoverable.                                                      | admin/pricing, admin/payments, admin/credit; reusable responsive table/row component.                                                                                                                                                                                                                                                                               |
| S15 — Medium — C; F                    | Many tables have no caption/explicit header scope; focus styles and date-popup behavior are not standardized. This is a context/consistency risk, not proof that every table or popup is inaccessible.                                                                        | Accessible table names/header relationships; consistent focus rings; verify popup keyboard movement, focus return and interaction with fixed navigation.                                                                                                | Table pages, bs-date-picker, ui/button, ui/input, directory. F: assistive technology and keyboard traversal tests.                                                                                                                                                                                                                                                  |

**Admin screen audit**

The shared shell/navigation findings apply to every Admin screen; the entries below add screen-specific issues.

**A01 — Overview — High — C + V**

Problems/impact: business-day status, warehouse cards, trip counters, nine finance metrics, queues, operational activity and driver activity compete for prominence. The fixture page is 6,189px tall at 360px and 3,115px at 1440px. Routine management requires scanning a long dashboard.

Improvement: prioritize business day, stock, collections and items needing attention; group secondary financial breakdowns and audit activity in disclosures. Use explicit scope labels for day totals versus carried balances. Do not remove reconciliations or alter calculations.

Files: [dashboard page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/dashboard/page.tsx), finance-overview, warehouse-stock, admin-driver-activity, prepared-trips. Reuse MetricCard, StatusBadge, TripList, OperationalRefresh.

**A02 — Products — Medium — C + V**

Problems/impact: the new-product form precedes browsing; existing products use expandable edit forms without search/status filtering. The subtitle describes deposits/tax as future workflows despite implemented finance features. Catalog editing feels like a setup tool.

Improvement: browsing-first product rows/cards, an Add Product action exposing the same form, clearer active status and current copy. Keep fixed product kind, audit reasons and historical retention.

Files: [products page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/products/page.tsx), [ProductForm](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/inventory-forms.tsx:76). Reuse Directory, FormSection, StatusBadge and existing product validation.

**A03 — Pricing & Free Supply — High — C + V**

Problems/impact: billable default pricing and HOUSE reference values share a table beneath a general “Reference value only; excluded from revenue and customer credit” statement. Its placement can blur which value is only a reference. Expanded edit forms sit inside a horizontally scrolling cell. The HOUSE table hides approval/balance columns on a phone.

Improvement: separate the visible meaning of Default Selling Price, HOUSE Eligibility and Reference Value; place reference-only copy beside the appropriate field/report. Use a consistent row editor/panel and compact HOUSE records. Keep zero-price free-supply rules and all approved reference amounts unchanged.

Files: [pricing page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/pricing/page.tsx:54), house-filters, operation-form. Reuse AmountInput, StatusBadge, CustomerCard, BsDatePicker.

**A04 — Inventory — High — C + V**

Problems/impact: movement rows literally use question marks as separators, display FULL_JAR/EMPTY_COLLECTION and expose movement/day/actor UUIDs as primary content. The sampled phone screen includes 33 raw UUID occurrences. Manual adjustments share the normal page's visual priority with stock viewing.

Improvement: readable movement names, product/state/quantity/date hierarchy, named actors and business dates where already supplied; keep raw references in expandable audit detail. Make verified manual adjustment a distinct action with its existing reason/evidence requirements.

Files: [inventory page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/inventory/page.tsx:148), AdjustmentForm, warehouse-stock. Reuse stockLabels, DateValue, compact audit row and confirmation pattern. No stock-ledger changes.

**A05 — Refilling and Damage — High — C; V for layout**

Problems/impact: two different operations use similarly weighted forms and long explanatory text. The processing form does not show current eligible empty stock next to refill quantity. The meaning of an irreversible physical processing entry is mostly in helper copy.

Improvement: clear Refill/Damage sections, visible current relevant stock from the existing workspace, concise operation-specific guidance and an action-specific review summary. Keep completed-batch requirements, 1:1 conversion, damage location and server validation exactly as implemented.

Files: [refilling page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/refilling/page.tsx), [ProcessingForm](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/day-forms.tsx:140). Reuse stock summary, Counter/Input, FormSection, existing confirmation. F: inspect success, rejected quantity and no-open-day states with operators.

**A06 — Trips — High — C + V**

Problems/impact: raw lifecycle statuses appear as similar gray badges. Only date filtering is exposed. Creation is below the list, and detail pages combine multiple lifecycle forms/history. Up to 100 closed trips can make action discovery slow.

Improvement: clear status labels, existing-state filter chips and prominent Create Trip action; organize trip detail around the currently permitted next action, with load/return/history sections. Preserve future-dated loads, carryover, guarded transitions, variance approval and physical receipt.

Files: [trips page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/trips/page.tsx), trip-summary, trip-list, trip-forms. Reuse roundLabel, StatusBadge, BsDateRange, TripList and existing forms. F: multi-trip, overnight and discrepancy detail views need broader visual testing.

**A07 — Customers — High — C + V for directory; C for detailed form structure**

Problems/impact: list browsing and a long create form share one page. Search exists, but operational status/type filtering is absent. Customer detail stacks editing, custody correction, delivery history, FIFO rows, finance history, billing, negotiated prices and refunds. Routine contact work is mixed with sensitive account changes.

Improvement: common customer cards/rows and clear Add/Edit actions; organize detail into Contact, Jars, Finance and Settings sections while retaining all data. Keep HOUSE approval and free supply visibly separate from jar obligations and financial balances.

Files: [customers page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/customers/page.tsx), [customer detail](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/customers/[id]/page.tsx), master-forms, customer-report, customer-finance, finance-admin-forms. Reuse Directory, customer cards, DetailPanel, FormSection and the existing audited correction form. F: extensive customer-detail mobile review remains necessary.

**A08 — Unreturned Jars — Medium — C + V**

Problems/impact: the recent card redesign is a useful reusable pattern, but six filters, global summary guidance and history can still create a tall phone experience. Summary totals intentionally cover all customers while card filters select a subset. Customer history adds its own search/date controls and a full list above the directory.

Improvement: concise “All customers” summary scope, progressive advanced filters, and a focused master/detail presentation with clear return navigation. Preserve complete history, FIFO dates, confirmed-only admin data and audited corrections. Do not change totals when filtering as an incidental design edit.

Files: [admin jar page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/pending-jars/page.tsx), admin-jar-cards, customer-jar-history, pending-jars. Reuse the existing cards, DateValue, metric patterns and DetailPanel.

**A09 — Vehicles — Medium — C + V**

Problems/impact: generic directory cards show plate/description/status, followed by a flat registration form. Current assignment/availability is not easy to distinguish from active/inactive status. Child route context is lost in navigation.

Improvement: consistent vehicle rows with existing assignment context, a concise register/edit panel and separate Active status versus trip assignment labels. Use existing data only; do not introduce fleet-management scope.

Files: [vehicles page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/vehicles/page.tsx), [vehicle detail](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/vehicles/[id]/page.tsx), directory, VehicleForm. Reuse StatusBadge, Directory, FormSection and parent navigation highlighting.

**A10 — Drivers — High — C + V**

Problems/impact: account information, approval/suspension actions and details links produce tall cards. Provisioning instructions require Supabase Auth and a UUID, exposing a technical prerequisite in the regular directory. Approved and pending users are not organized into a clear review queue.

Improvement: concise driver summaries, a clearly identified approval queue and controlled access-action panel. Make “Add existing account” accurate, with the existing external provisioning prerequisite in expandable guidance. Do not implement a new account-creation backend as part of UI work.

Files: [drivers page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/drivers/page.tsx), account-forms, driver-status-form, driver-account-summary, driver detail. Reuse Directory, StatusBadge, confirmation, Field and existing approval labels.

**A11 — Payments — High — C + V**

Problems/impact: nine overview metrics come before transaction work. “Update overview” and “Filter history” operate on separate scopes. Receipt/invoice/journal presentations differ, and receipt status/action columns require sideways scrolling on mobile. Pending Fonepay needs stronger action hierarchy.

Improvement: clearly separate selected-business-day totals from history filters; foreground reconciliation items and maintain distinct cash-recorded/Fonepay-reconciled wording. Use a consistent receipt list and detail action. Retain explicit verification evidence, reversals, deposit separation and current data scope.

Files: [payments page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/payments/page.tsx), finance-overview, payment-detail, PaymentReview. Reuse MetricCard, FilterToolbar, StatusBadge, AmountInput and responsive rows.

**A12 — Customer Credit — High — C + V**

Problems/impact: an individual statement tool precedes portfolio aging and the customer list. Rows include zero-balance customers; account, overdue and deposit information share a wide table. Unconfigured due-date warnings are verbose, and deposit liability can be mistaken for available credit.

Improvement: portfolio overview first, explicit statement customer selection, visible overdue/unconfigured indicators and clearer “Credit owed” versus “Refundable deposit” columns. Optional presentation filtering should retain access to zero balances. Keep configured due dates and financial calculations unchanged.

Files: [credit page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/credit/page.tsx), credit-statement, customer-finance. Reuse BsDateRange, DateValue, StatusBadge, MetricCard and responsive account rows.

**A13 — Billing Settings — Medium — C + V**

Problems/impact: company identity, registration, tax mode, label, percentage and audit reason appear as one flat form. Tax label/rate controls remain present across modes. Generic text fields do not help telephone/decimal input.

Improvement: Company and Tax sections, a clear current-configuration summary, conditional presentation of relevant controls while retaining the existing submitted values/contract, and localized field guidance. Do not infer PAN/VAT treatment or alter settings validation.

Files: [billing page](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/billing/page.tsx), [CompanyForm](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/finance-admin-forms.tsx:14), Field/Input/Select. Reuse FormSection, AmountInput-style decimal input and confirmation.

**A14 — Daily Close — High — C + V**

Problems/impact: English blocker instructions appear in Nepali mode. The populated fixture renders 11,561px of phone content, mixing immediate blockers, future-trip information and the complete report. Review/close/resume have different explanatory density and appearance.

Improvement: a task-oriented checklist: active day and blockers, reconciliations, then explicit final confirmation. Keep the complete report accessible in grouped sections. Preserve all five confirmations, net cash, evidence notes, review freeze/resume, future trips and immutable archive behavior.

Files: [daily close](C:/Users/Acer/Desktop/CODE/mount-kailash/src/app/admin/daily-close/page.tsx), day-forms, day-report, prepared-trips. Reuse translated StatusBadge, checklist rows, FormSection, DateValue and explicit confirmation. Closing review was inspected in both languages at 360px; successful final closing was not performed in this audit.

**Additional Admin destinations**

**A15 — Driver Sync — High — C + V:** technical device IDs and recovery actions need an operational pending/review hierarchy. Empty sections should say what is known and unknown; an offline phone's unreported records must not be represented as centrally confirmed zero. Files: admin/sync, offline/admin-exception; reuse StatusBadge, audit disclosure and existing server acknowledgements. F: revoked-device/multi-device/exception states need further inspection.

**A16 — Daily History — Medium — C + V:** report selection, exports, financial detail and the older pending-row presentation have different density/filter patterns. Files: admin/reports, day-report, pending-jars. Reuse FilterToolbar, BsDateRange, archive detail and consistent export buttons without changing archived report contents.

**Driver screen audit**

**D01 — My Stock — Critical for C001; High for presentation — C + V**

Problems/impact: unsupported financial zeroes are documented separately above. The title “My day” differs from “My Stock”; connection setup precedes stock. Day and round money cards repeat dense helper text. “Full Jars Sold” includes approved free HOUSE deliveries: in the fixture, 22 included 10 free jars, so the physical counter's visible label can imply paid sales.

Improvement: stock and the active round first, one clear New Sale action, a compact secondary breakdown, and a visible “Jars Delivered” label for that unchanged physical quantity. Use explicit metric availability and scope. Preserve HOUSE, stock and financial data semantics.

Files: driver-home-view, driver-stock, driver-application. Reuse DriverStock, MetricCard, roundLabel, StatusBadge. Financial read-model correction requires separate approval.

**D02 — New Sale — High — C + V**

Problems/impact: unsaved quantities are lost on internal navigation. Customer selection, jar/carton counters, price, vehicle stock, several pending-balance explanations, payment, notes and history produce a tall entry screen. Review then native confirmation repeats much of the same content.

Improvement: clear Customer → Quantities → Payment → Review hierarchy, concise pending-before/after presentation, compact secondary history and navigation protection. Maintain Paid/Credit/free/return-only logic, exact amount matching, stock/custody errors and existing reviewed transaction IDs. Keep the same form in online/offline modes.

Files: trip-forms/DeliveryForm, delivery-customers, driver-payment, operation-form, driver-application. Reuse Counter, AmountInput, ProductDeliverySummary and the existing context lookup.

**D03 — Customers — High — C + V**

Problems/impact: the unprepared online screen has no h1. Prepared devices use OfflineCustomers even while online, changing cards into compact edit rows, changing title sizing, exposing an always-visible add/edit form and an extra collection form. Phone/new-delivery/pending-jar actions differ. The switch is driven by local device state, not just network connectivity.

Improvement: one shared customer directory, title, cards and Add/Edit presentation; attach existing online or local handlers through adapters. Keep phone and selected-customer actions consistent. Show collections only when intentionally requested.

Files: [DriverCustomers](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/driver-customers.tsx), [OfflineCustomers](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/offline/workspace.tsx:10), offline/collection, driver-application. Reuse Directory/customer cards, DeliveryCustomerForm and the existing runtime.

**D04 — Unreturned Jars — Medium; High for focus — C + V**

Problems/impact: the new cards and summaries are clearer than the older presentation. Remaining issues are shared status-panel dominance, body focus after opening details, and subtle global-summary/date-filter scope. Recent driver history is limited to the existing authorized context.

Improvement: retain the current grouping and quantities; fix detail focus/return behavior and clarify scope with short labels. Reuse this card pattern across driver directories. Do not introduce an independent balance or broaden history permissions.

Files: driver-pending-jars, driver-jars, driver-runtime-context. Reuse current summary/card components, DateValue and DetailPanel. The existing up-to-50-entry context limit remains a data contract, not a visual defect to bypass.

**D05 — Sales History — High — C + V**

Problems/impact: invoice, collection, round and pending-device records use different visual patterns. Date filtering to an unmatched period leaves empty invoice/collection sections without a no-matches message: the empty checks use the unfiltered arrays. This was reproduced with zero displayed rows and zero empty messages.

Improvement: a consistent history layout with clear Sales/Collections/Pending sections, prominent amount/customer/status, and no-match states derived from the displayed arrays. Distinguish device-only items from confirmed documents. Keep original dates and authorization.

Files: [DriverSalesView](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/driver-sales-view.tsx:61), offline/views, trip-list, ProductDeliverySummary. Reuse FilterToolbar, transaction rows, StatusBadge and EmptyState.

**D06 — Return to Warehouse — High — C + V for presentation; C for direct submit path**

Problems/impact: unprepared online ReturnForm shows expected/count information and confirmation, while a prepared device uses a different counter layout and “Prepare return and seal device queue” action. The prepared path calls save directly from its button, with no equivalent review stage in that component. Queue terminology is difficult, and prefilling expected counts can look like physical verification has already happened.

Improvement: one shared count/review interface, clear Expected versus Counted labels, a plain “Submit return counts” action and an explicit explanation that it locks further deliveries and waits for warehouse confirmation. Keep manifest, sealing, discrepancy and admin receipt behavior unchanged. Do not move warehouse stock from the client.

Files: [ReturnForm](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/trip-forms.tsx:1362), [OfflineReturnForm](C:/Users/Acer/Desktop/CODE/mount-kailash/src/components/offline/workspace.tsx:160), driver-application. Reuse Counter, Product/Stock row, StatusBadge and confirmation. The audit did not click the sealing action; its invocation path is code-verified.

**D07 — Online/offline and sync status — High — C + V**

Problems/impact: several competing lines describe connection, device readiness, pending count, lock state, retries and persistent-storage warnings. Offline with no pending operations says “Waiting to Sync,” which can sound like unsaved work exists. Some essential warnings remain buried among routine text.

Improvement: connection badge, clearly scoped pending-device count and last confirmed sync where available; one primary recovery action. Expand details for review/authorization/storage exceptions. Never equate online connectivity with central confirmation, hide pending operations, or call unreported phone data synchronized.

Files: driver-application, offline/banner, operational-refresh. Reuse existing SyncView, snapshot/receipt metadata and device state.

**D08 — Device setup and unlock — High — C + V**

Problems/impact: the setup panel simultaneously offers PIN, confirmation and offline passphrase under “PIN or passphrase” guidance. It interrupts the task and pushes My day to y=946px in the 360px sample. Recovery/older-records/backup information uses different controls and technical wording. Multi-round dropdowns use UUIDs in code.

Improvement: a clear primary PIN setup path with existing legacy passphrase recovery in a secondary disclosure; a compact unlock panel with specific next steps. Show recognizable round/vehicle/date labels where already available. Preserve encryption, approved-device limits, pending records, biometrics and recovery authentication.

Files: driver-application device-unlock sections, offline/registration, sign-out-button. Reuse Password/Input, Button, StatusBadge and DetailPanel. F: multiple vaults, PIN recovery, biometrics and actual mobile keyboard behavior require dedicated testing.

**Cross-cutting accessibility, translation and date assessment**

Verified strengths: the UI already has a skip link, labeled controls in the sampled baseline, readable primary colors, generally 44px shared controls, 52px quantity-stepper columns, meaningful button text, localized required-field messages, and BS calendar/date formatting. The driver root reserves bottom space for fixed navigation; the presence of that bar is not, by itself, evidence that final controls are unreachable.

Remaining work:

- Make labels/required state/error linkage consistent; form-level alerts alone do not identify the affected field.
- Treat inline links under 44px as usability candidates, not automatic WCAG failures. WCAG 2.2 AA target-size rules use a 24px minimum with spacing and other exceptions. [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Measure actual text/component contrast, including muted, disabled and alert states. Normal text generally requires 4.5:1 and large text 3:1; no full contrast certification was performed here. [W3C contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Verify keyboard focus is visible and not hidden by fixed navigation/popups. Jar-detail focus loss was reproduced; full keyboard and assistive-technology coverage is still pending. [W3C focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- Keep BS/Nepal conversion and canonical stored values unchanged. Standardize visible “Business day,” “Scheduled delivery,” “Original delivery” and “Confirmed at” meaning.
- Translate dynamic blockers/errors without translating customer-entered names, addresses, reasons or historical data.
- Inspect long Nepali labels, high numeric counts, motion preferences, localization persistence failures and device recovery notices on physical devices.

**Reusable design system**

PageHeader, MetricCard, StatusBadge, FormSection, FieldError, FilterToolbar, ResponsiveDataTable, DetailPanel, ConfirmAction and AuditDisclosure are **proposed shared patterns**, not claims that these named components already exist. The foundation column identifies the actual components that can be reused. Later screen recommendations refer to reusing the proposed patterns after the foundation phase.

| Shared pattern              | Existing foundation                                                | Recommended reuse                                                                                                    |
| --------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| PageHeader                  | OperationsHeading + role shells                                    | Consistent title/subtitle/actions, responsive density and business-day context.                                      |
| MetricCard                  | WarehouseStock, DriverStock, FinanceOverview, jar summaries        | Compact spacing, clear unit/scope, explicit unavailable state. Reuse existing quantities/calculations.               |
| StatusBadge / StatusBanner  | roundLabel, approvalLabels, existing status strings and sync state | Central visual variants while keeping domain-specific meaning and confirmation rules distinct.                       |
| FormSection / FieldError    | Field, Select, Input, AmountInput, Counter                         | Consistent labels, numeric keyboards, help/errors and focus behavior. Preserve validators and request serialization. |
| FilterToolbar               | BsDateRange/BsDatePicker, Directory search                         | Search/sort/basic filters with advanced options disclosed; explicit scope and reset.                                 |
| Customer/Vehicle/Driver row | Directory, admin jar cards, DriverPendingJars                      | Shared visuals with separate authorized role data adapters.                                                          |
| ResponsiveDataTable         | Existing table/list markup                                         | Named headers, mobile summaries and complete detail.                                                                 |
| DetailPanel / ConfirmAction | Existing details, review state and native confirmations            | Consistent keyboard focus, return action and risk-specific confirmation without new business transitions.            |
| Loading/Empty/Error/Success | EmptyState, OperationForm feedback, root boundaries                | Distinguish unavailable, no records, no matches, pending-device and confirmed success.                               |
| AuditDisclosure             | Inventory/finance/history details                                  | Human-readable primary row with authorized IDs/evidence retained in a disclosure.                                    |

Keep current teal/white tokens, the local Devanagari-capable font, simple borders, rounded cards and restrained spacing. No new animation, decorative artwork, chart requirement, icon library or complicated menu structure is necessary.

**Recommended implementation order**

1. **Triage C001 separately.** Confirm the driver financial display contract in controlled UAT. Agree a truthful interim presentation and any separately authorized summary work. Do not bundle financial/RLS changes into the visual redesign.
2. **Define shared foundations.** Typography, spacing, card variants, PageHeader, fields/errors, statuses, responsive rows, empty/loading/feedback and confirmation/focus patterns.
3. **Fix the shared shells.** Admin phone/tablet navigation; driver responsive content width, clearer nav labels and compact connection/device presentation. Keep existing destinations.
4. **Finish the driver operational flow.** New Sale navigation protection, shared Customers and Return presentation for prepared/unprepared/online/offline states, My Stock hierarchy, jar-detail focus and filtered sales empty states.
5. **Improve admin operational management.** Overview, Products, Inventory, Refilling/Damage, Trips, Customers, Vehicles and Drivers. Use disclosures/panels for editing and audited corrections.
6. **Improve financial/closing presentation.** Pricing semantics, Payments scope/reconciliation, Credit/deposit distinction, Billing sections, Daily Close translations/checklist, Driver Sync and archive presentation.
7. **Validate each batch before expanding.** All four viewport sizes; English/Nepali; keyboard/focus; physical phones and keyboards; normal/empty/loading/error/success; HOUSE; pending Fonepay; zero/outstanding jars; future trips; device locked/prepared/offline/pending/review states. Run existing transaction/sync/regression checks to prove no business behavior changed.

**What remains unverified**

Physical Android/iOS usability, Safari rendering, screen-reader announcements/table associations, complete contrast compliance, 200% zoom/reflow, multiple saved rounds, biometric/PIN recovery, long production datasets, every trip/discrepancy/refill error branch, and task completion times with actual drivers/admins.

Do not treat these as confirmed defects. They are acceptance-test requirements for the approved implementation work.

**Approval boundary**

The audit is complete. Application source is unchanged. The proposed UI improvements and the separate financial-display review have not been implemented. Work should begin only after the user's approval of the scope and order.
