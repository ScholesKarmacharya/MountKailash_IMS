# Driver current trip and shared activation

## Root cause

The server's overview already orders trips by creation time and normal cancellation stores `status = CLOSED` plus `cancelled = true`. The main failure was in `DriverApplication`: whenever local state existed, its projected trip replaced the server-selected trip. A prepared Trip #8 vault was not locally sealed, so the release condition (sealed and every operation synced) never released it after warehouse cancellation. Automatic restoration also preferred any pending vault over the newly selected server trip. A server response selecting Trip #9 could therefore coexist with a dashboard still showing the cached LOADED Trip #8.

The selector additionally excluded CLOSED but did not explicitly exclude the cancellation flag. Notifications refreshed their inbox without prompting the workspace. Driver trip details rendered a Start Trip link back to Home, and their runtime context was null. The default history fallback also used only the current vault's scoped trips, omitting preserved cancelled trips from the online history list.

These findings come from repository inspection and the disposable Trip #8 → Trip #9 regression fixture, not inspection or modification of live UAT rows.

## Selection and offline evidence

`currentRound` now excludes cancelled, CLOSED and unknown statuses. It orders ACTIVE, LOADED, DRAFT, then returned SUBMITTED/UNDER_REVIEW/DISCREPANCY status fallbacks. Ties use earliest scheduled date, newest creation time, descending trip number and ID. Returned status remains available when no actionable trip exists. Existing database reservation rules are unchanged.

The normal driver workspace and `offlineCurrent` use this selector. Instant Delivery retains its explicitly authorized eligible-trip choice. The service also prefers the trip-specific read over overview metadata: if cancellation commits between those two reads, it cannot return an old LOADED label with a CLOSED snapshot. Online local projections are used only when their trip ID matches the server's selection. Local balances/drafts remain projected for that same trip; its displayed status/day come from the authoritative workspace.

When the selected trip changes, the app stops the old controller and detaches its writer. It preserves the encrypted vault and every original operation/receipt, adds a durable retired-writer marker and records the server-selected trip ID for offline reopening. The marker prevents new operations even from an already-open stale tab. It does not fabricate a server acknowledgement, change an original payload, delete evidence or merge it into the new trip. The replacement uses its own existing user/trip vault ID and normal preparation flow. The pending count still includes preserved older rows.

Startup restoration checks both the remembered selection and retired markers. An unlock/preparation that finishes after a newer probe cannot reinstall the old trip. A probe that confirms the already-restored writer preserves its Ready state. Closed/cancelled cached trips are not reopened as writers. Online History falls back to the server overview so cancelled Trip #8 remains labelled Cancelled and can be opened separately.

No new database migration or IndexedDB schema version is required. The new encrypted local metadata and row flag are optional additions compatible with existing version 3 vault storage. The earlier admin loading migration 31 is separate from this fix; this task does not apply live migrations.

## Notifications, refresh and Start Trip

The existing recipient-filtered Supabase notification subscription still treats socket events as prompts to fetch the authorized inbox. Newly fetched assignment, loading, update, cancellation and return-confirmation events now prompt the driver's workspace refresh immediately, including events already read elsewhere. Known IDs do not repeatedly trigger it. Focus, visibility, reconnect and normal five-second workspace polling remain active.

Workspace probes now coalesce: one request runs at a time, with one follow-up pass when a change arrives while it is running. Query changes and activation refreshes use the same mechanism. A detail page refreshes its server-rendered contents when the observed trip status, cancellation or schedule/loading metadata changes.

`StartTripAction` is shared by Home and authenticated Trip Details. Notification View Trip continues using the validated actual trip ID, for example `/driver/trips/<trip-9-id>`. Details retain vehicle, scheduled date, loaded stock, status and historical evidence. A loaded trip can be started directly there without returning Home.

Both locations call the same runtime handler: require internet, refresh the authoritative selection, reject cancelled/noncurrent targets, ensure that trip's automatic preparation, perform the existing device-ownership preflight, invoke the existing server/domain START command, and refresh the active snapshot and workspace. Existing OPEN-day, schedule and ownership rules retain visible reasons. Cancelled/completed trips expose no activation action. Carryover still uses its existing transition.

The form has an immediate submit guard in addition to pending UI and its stable request key. The runtime coalesces concurrent activation attempts for the same trip, and a fresh ACTIVE status returns Already started instead of another transition request. Database idempotency remains the final guard.

## Files changed for this fix

- `src/domain/operations/driver-workspace.ts`, `src/services/driver-workspace.ts`: selection and cancellation guards.
- `src/components/driver-application.tsx`, `driver-runtime-context.ts`: authoritative/local reconciliation, safe restoration, refresh coordination and shared activation handler.
- New `src/components/start-trip-action.tsx`; `driver-trip-card.tsx`, `trip-summary.tsx`, `operation-form.tsx`: shared action, live detail context and duplicate-submit protection.
- `src/components/notification-bell.tsx`: relevant inbox changes prompt workspace refresh.
- `src/domain/offline/types.ts`, `src/lib/offline/store.ts`: optional retained-writer metadata and durable write guard.
- English/Nepali dictionaries; selector/service/storage unit tests; new `tests/offline-e2e/current-trip.spec.ts`.

Earlier admin, mobile and integration-verification work already present in the working tree is preserved. No commit or push was performed.

## Verification

- `npm test`: **68 files, 685 tests passed**, including selector/service race coverage, encrypted retirement and separate-vault preservation, existing inventory/trip/accounting integration tests and notification subscription tests.
- `npm run typecheck` and `npm run lint`: passed.
- The exact Trip #8 cancellation → Trip #9 loaded → separate offline reopen → notification View Trip → one direct START request regression passed on desktop Chromium and Pixel 7 emulation. The stored old loads and operations are compared after replacement and activation.
- The refresh-burst test verifies that 20 prompts produce sequential coalesced workspace reads with a maximum of one request in flight.
- Full offline Playwright: **77/78 passed** in the initial desktop/mobile run. The remaining mobile cancellation case encountered unexpected fixture numbering and device ownership while a separate verification run could reset the same database through a hardcoded reset URL. The test now uses the selected fixture provider and checks reset success. Its isolated mobile rerun passed **2/2**, covering the exact cancellation/replacement case and refresh bursts; the exact case also passed earlier on both projects. Every one of the 78 scenarios has a passing result, with this initial isolation failure recorded rather than hidden.
- Loopback fixture builds and the normal optimized production build (`VALIDATE_BUILD=1`, offline fixture mode disabled) passed, including TypeScript and route generation.
- Formatting checks for this fix's source/tests/report and `git diff --check`: passed.

Tests use loopback fixtures and encrypted local test data; no live business data is modified. Realtime subscription routing/cleanup is unit-tested and browser tests exercise the authorized feed's refresh prompts; no hosted WebSocket delivery or physical Android device is claimed as tested.
