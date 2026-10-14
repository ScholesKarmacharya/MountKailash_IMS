# Admin and Driver notifications

Implemented locally on 14 October 2026. This work adds notifications to the existing dashboards; it does not implement the broader UI/UX audit redesign.

## Existing architecture reused

- Admin `AppShell` and the persistent online/offline `DriverApplication` each mount the same notification control beside the language switcher.
- Supabase Auth, active/approved profile checks, existing trip permissions and RLS remain authoritative. The browser uses the existing publishable key, never a service-role key.
- Existing command RPCs, `ops_retry`, `ops_finish` and immutable audit events remain the business writers. Notification triggers observe their confirmed events in the same PostgreSQL transaction.
- Existing offline operations, acknowledgements, manifests, synchronization controller, PIN unlock, AES-GCM encrypted `OfflineVault`, and service-worker shell are reused. Notifications are an optional field in the encrypted local state, so existing vaults remain compatible.
- Existing English/Nepali dictionaries, profile language defaults, Lucide icons, buttons and Nepal-timezone BS date formatting are reused.

## UI and delivery

Both navbars have a 44px bell control, an unread badge only when needed, a bounded scrollable inbox, unread highlighting, individual/read-all actions, pagination and friendly loading/empty/error states. Read-all uses the highest observed sequence as a cutoff, preserving notifications created later.

Popups use event-specific icons, teal/white styling, a validated destination link and a manual close control. They dismiss after ten seconds; hovering or focusing pauses dismissal. Opening the inbox dismisses the current popup without deleting the notification. Arrival batches show the newest alert and a count of additional alerts. Initial history fetches do not replay old alerts.

The authenticated browser client maintains one recipient-filtered INSERT/UPDATE subscription to `public.notifications`. Subscriptions, polling, visibility/focus handlers and in-flight feed reads are cleaned up on identity/connectivity changes or unmount. Socket events prompt an authenticated feed refresh rather than supplying trusted business data directly. Focus, reconnect and a visible-page ten-second polling fallback reconcile missed events and read updates across loaded history pages. Seen notification IDs are stored in per-user session storage; sensitive payloads are never stored there.

This follows Supabase's [Postgres Changes/RLS model](https://supabase.com/docs/guides/realtime/postgres-changes). The migration adds only the notifications table to an existing `supabase_realtime` publication and preserves other members. If the deployment has no such publication, Realtime must be configured by its operator; the in-app polling fallback continues to work.

## Database changes

Forward-only migration: `supabase/migrations/202610140025_notifications.sql`.

`notifications` stores UUID, ordering sequence, recipient profile, stable event key, event type, entity/trip IDs, structured payload, creation time and read time. Payloads contain event-time driver/vehicle/date/reference details and confirmed or declared product counts, rather than permanently duplicated translated titles/messages.

An event/recipient/type unique constraint plus the existing command idempotency prevents duplicate creation. Private trigger/helpers cannot be called by Auth users. Auth users have SELECT only on their own inbox; acknowledgement RPCs validate ownership and can change only read timestamps. Opening or acknowledging an alert cannot confirm a return or modify inventory. A rolled-back operation rolls its notifications back too.

There is no organization/tenant model in the existing schema: this installation has one warehouse account. Recipients use its active admin profiles and the trip's approved assigned driver. If multi-organization support is added later, notification tenancy must follow that authoritative model.

## Events implemented

| Existing confirmed event                                          | Notification                                                                       | Recipient                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `TRIP_CREATED` / `TRIP_SCHEDULED`                                 | New Trip Assigned, including final scheduled date and not-yet-loaded status        | Assigned driver                      |
| `TRIP_LOADED`                                                     | Stock Loading Confirmed, actual product quantities                                 | Assigned driver                      |
| Material `TRIP_RESCHEDULE` or authorized `TRIP_CARRYOVER`         | Trip Updated                                                                       | Assigned driver                      |
| `TRIP_CANCEL` / physically unloaded `TRIP_UNLOAD_CANCEL`          | Trip Cancelled                                                                     | Assigned driver                      |
| `TRIP_SUBMITTED`                                                  | Warehouse Return Awaiting Confirmation, declared counts and server submission time | All active warehouse admins          |
| `TRIP_CLOSED` following actual reconciliation                     | Warehouse Return Confirmed                                                         | Assigned driver                      |
| `TRIP_DISCREPANCY`                                                | Trip Stock Needs Review; return remains unconfirmed                                | Warehouse admins and affected driver |
| Committed offline `NEEDS_REVIEW` or recorded idempotency conflict | Synchronization/Transaction Needs Review                                           | Warehouse admins and affected driver |
| Admin rejects an unresolved offline record                        | Transaction Needs Review                                                           | Affected driver                      |

No alerts are created by ordinary jar sales, reads, refreshes, identical date rescheduling, failed/rolled-back commands, or merely saving an offline queue entry. Review alerts describe an unresolved recorded failure; they do not describe a successful business transaction.

The current system uses return submission as its trip submission action; there is no separate driver settlement-submission action. Trip assignment/vehicle changes are deliberately immutable, and there is no authorized loaded-quantity edit workflow. Those unsupported business actions were not added or loosened. Cancel/create produces removal/new-assignment notifications through the existing cancellation and creation workflows. A future dedicated reassignment or load-adjustment writer must add its own atomic event mapping.

## Offline behavior

The bell stays visible in the offline shell. Private cached history and unread counts are available after unlocking an existing prepared vault; a locked shell exposes no private notification payloads or badge. Up to 500 synchronized notifications are cached per vault. Devices without a prepared vault have no persistent offline notification cache.

Offline read actions are queued in the encrypted vault. On reconnect, these acknowledgements are flushed, missed history is fetched and exact server unread counts are reconciled. Newer notifications remain unread when an older offline read-all cutoff is applied. Offline return submissions remain in the existing operation queue and notify admins only once their server transaction actually confirms. A disconnected phone receives no new messages; trip links require reconnecting.

## Push evaluation

Background push is not enabled. The current driver service worker supports shell caching, but has no push subscription registry, push sender, VAPID credentials, push handlers or preference management. Reliable in-app notifications are implemented independently.

An optional follow-up would add authenticated subscription ownership/revocation, an explicit permission button, HTTPS delivery, a transactionally reliable push worker, notification-ID deduplication and privacy-safe lock-screen wording. [MDN's Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) requires a service worker and subscription infrastructure; [Apple documents Home Screen web-app requirements for iOS web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers). Browser/platform capability needs runtime checks and physical-device testing. No permission prompt is shown automatically.

## Files changed for this feature

New application/database files:

- `src/components/notification-bell.tsx`
- `src/domain/notifications.ts`
- `src/lib/notifications/realtime.ts`
- `src/lib/supabase/browser.ts`
- `src/app/api/notifications/route.ts`
- `supabase/migrations/202610140025_notifications.sql`

Integration/translation changes:

- `src/components/app-shell.tsx`
- `src/components/driver-application.tsx`
- `src/domain/offline/types.ts`
- `src/lib/i18n/en.json`, `src/lib/i18n/ne.json`

Tests:

- `tests/integration/notifications-db.test.ts`
- `tests/unit/notifications.test.ts`
- `tests/unit/notification-api.test.ts`
- `tests/unit/offline-storage.test.ts`
- `tests/operations-e2e/notifications.spec.ts`
- `tests/offline-e2e/notifications.spec.ts`
- `tests/helpers/operations-provider.mjs` (new RPC allowlist and PostgreSQL UUID-array argument support)

## Verification and deployment limits

- 524 unit/database integration tests passed, including existing stock, payments, refilling, daily close, trip and offline regressions. Fourteen notification database cases cover recipient isolation, read ownership, command retries, rollback, load/return quantities, discrepancies, offline confirmation/review, pagination, read-only PostgREST transactions, publication preservation and rejecting alerts from a foreign operation UUID replay.
- Six browser scenarios passed: trip lifecycle in separate Admin/Driver A/Driver B sessions on desktop and Pixel 7, 360×800 pagination/read reconciliation in both browser projects, and encrypted offline reopening/reconnect in desktop and Pixel 7 projects. The Pixel 7 viewport is 393×727 CSS pixels; desktop uses 1280×720.
- Production build, TypeScript typecheck, targeted ESLint and formatting checks passed.
- Screenshots under ignored `test-results/notifications-*.png` were visually inspected. This is browser viewport/emulation testing, not a claim of physical-device or full screen-reader certification.
- Browser tests use disposable loopback PostgreSQL with real migrations, RPCs and RLS. Online delivery tests exercise the fallback refresh path; unit tests cover subscription filtering, reconnect and cleanup. Hosted Supabase WebSocket delivery and two physical devices have not been tested.
- Initial test failures exposed a read-only authorization-lock mismatch, a test provider UUID-array conversion gap, offline loading state, focus restoration, an offline read/reload durability race and tests that needed to reopen a dropdown after changing language. Read status now changes after its encrypted write is durable. These were corrected; no failing final checks remain.
- This migration has NOT been applied to hosted Supabase, and application code has NOT been deployed. Deploy the forward migration using the project's normal migration process, ensure `notifications` is in the Realtime publication, then verify the live socket path with independently signed-in Admin, Driver A and Driver B sessions before release. No database reset or hosted business-data mutation was performed.

Existing uncommitted work was retained. This feature does not fix unrelated findings from `docs/UI_UX_AUDIT.md`.
