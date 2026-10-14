# Driver Unreturned Jars UI

Implemented 2026-10-14 at `/driver/pending-jars`. This change updates only that driver's screen and its presentation adapters; the existing header/navigation, admin page, inventory workflows and posting/synchronization logic are preserved.

## Presentation

- Three compact summaries: Total Pending Jars, Customers Pending, and Oldest Pending in Nepal calendar days. No weekly return number is invented.
- One teal/white card per active customer with an outstanding quantity. Cards include name, optional phone, REGULAR/HOUSE status, large pending count, original outstanding date/age, available round/last-return metadata, and a smaller To Return box. Whole cards are keyboard-accessible buttons.
- Search by name or phone; highest-pending, oldest and recent-activity sorts. Delivery date filtering reuses the existing BS calendar and stays collapsed until requested.
- Date/search filters select matching customers. Each card keeps the customer's complete pending quantity; filtering does not manufacture a smaller balance. Summary totals also remain unchanged by these filters.
- Mobile uses a single card column and compact two-column summaries; desktop uses two card columns within the existing driver content width.
- Details show pending delivery lots and recent delivery/return/correction activity, with the existing per-product resulting balances. Driver-friendly labels replace the old financial/ledger explanation blocks.
- English and Nepali strings reuse the existing language switch and BS/Nepal-timezone date formatter.

## Data and offline behavior

`driverJarCustomers` groups the existing `PendingJarWorkspace` FIFO rows for online display. Device quantities call the existing `customerEstimate` function. The existing offline FIFO lot preview was moved from `OfflinePending` into this presentation adapter; it does not write any ledger, stock, or queue records. A single `DriverPendingJars` component renders both connection modes.

Pending device deliveries remain labelled Saved on Device or Needs Review. Confirmed acknowledgement IDs are excluded exactly as in the existing projection. The details panel reads the existing cached customer context while offline; online it uses the existing authorized `/api/driver/customers/[id]/context` operation for the assigned active trip. Repeated reads occur only when the selected customer's data changes or Retry is requested. No admin-only RPC is used by drivers.

The existing driver context exposes up to 50 recent custody entries, and that limit/authorization is preserved. When no authorized active trip or cached history is available, details still show the known pending lots and explain that recent activity needs an assigned round. Historical balances remain the ledger's existing per-product snapshots. No missing history is invented.

Offline occurrence metadata is used when available rather than labelling synchronization time as delivery time. Existing physical stock, FIFO settlement, HOUSE rules, audited permanent-jar exceptions, durable encrypted device records and synchronization idempotency are unchanged.

## Files

New:

- `src/components/driver-pending-jars.tsx`
- `src/domain/operations/driver-jars.ts`
- `tests/unit/driver-jars.test.ts`
- `tests/operations-e2e/driver-jar-cards.spec.ts`
- `tests/offline-e2e/driver-jar-cards.spec.ts`
- `docs/DRIVER_UNRETURNED_JARS_UI.md`

Updated:

- `src/components/driver-application.tsx`: route both modes to the shared screen.
- `src/components/offline/views.tsx`: remove the superseded text-heavy pending view.
- `src/domain/operations/types.ts`: expose existing optional visit occurrence metadata to the presentation code.
- `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`: screen messages.
- `tests/operations-e2e/pending-jars.spec.ts`: use the new summary presentation for existing balance assertions; delivery/report checks are retained.

## Verification

All transaction tests use isolated disposable PostgreSQL data and loopback fixture services. Production Supabase was not modified.

- Unit/database regression: **52 files, 499 tests passed**.
- Online browser checks: **6 passed**, including the new screen and existing FIFO/return-only/driver authorization scenarios on desktop and Pixel 7 viewport.
- Offline browser checks: **2 passed**, including durable reopening, device-only versus confirmed values, and driver/admin reconciliation without duplicate visits.
- Typecheck, production build, targeted ESLint and formatting checks passed.
- Desktop/mobile cards and detail screenshots were visually inspected; browser checks verified no horizontal overflow in English/Nepali.

No database migration is required for this UI redesign. The earlier admin page's migration 24 remains a separate deployment requirement.
