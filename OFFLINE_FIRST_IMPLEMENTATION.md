# Driver offline-first implementation

The latest normal-delivery notes removal, UAT diagnosis and device recovery behavior are documented in [OFFLINE_DEVICE_RECOVERY.md](OFFLINE_DEVICE_RECOVERY.md).

The driver uses the existing Supabase sign-in. Approved LOADED and ACTIVE trips prepare automatically. IndexedDB stores a cryptographically random 32-byte installation secret and independent device token per driver; the encrypted AES-GCM OfflineVault and UUID journal remain in use. No PIN, passphrase, biometric, manual lock, or separate offline switch is presented.

Local startup restores the workspace independently of the workspace API. Deliveries, customer creation/contact changes, credit collection, cash/Fonepay recording, pause, and return submission commit locally before showing success. Uploads run in the background and reconcile receipts with the original UUID, payload, fingerprint, occurrence, and sequence. Connectivity events never clear or lock an open workspace. Starting or resuming a trip still needs online authorization and a confirmed persisted snapshot.

The status card uses the requested plain-language messages in English and Nepali. Fonepay delivery receipts remain pending until admin verification. Drivers have no new warehouse inventory or product-master write permissions.

## Required Supabase migration

Apply `supabase/migrations/202610160028_offline_device_transfer.sql` to the intended Supabase database before deploying the application changes. It has been tested against disposable PostgreSQL/PGlite databases; it has not been applied to a hosted database.

The migration adds reset metadata to active offline rounds and an admin-only `offline_admin_reset_device` RPC. The Driver sync admin page has **Reset Offline Device**, a required reason, and a warning/confirmation that the old phone may have unsent records unknown to the server. Reset immediately fences the old writer, including legacy devices without a trusted-device row. Only an explicitly reset LOADED/ACTIVE round can bind a replacement. Reset/transfer actor, time, reason, former binding and reported pending count are retained in immutable reviews and audit events.

No historical operations, reviews or rounds are deleted. Accepted operations retain every original field. A replacement inherits the confirmed receipt prefix and exact received-but-unconfirmed envelopes, continues the original sequence, and includes inherited receipts in return/pause manifests. Received records needing review stay blocked until the existing review process authorizes their original UUID/payload; they are never skipped. Operations existing only on the old phone stay there for admin review and are never invented or silently discarded.

The same migration provides authorized customer-context downloads for LOADED trips, without authorizing delivery writes before START, and supports pending Fonepay through the existing validated/idempotent delivery pipeline.

## Existing installations

New automatic keys do not require `OFFLINE_DEVICE_RECOVERY_KEY` and never upload the local encryption secret. Legacy PIN/passphrase/biometric helpers remain available internally for existing encrypted evidence, but are not part of the driver UI. A legacy local copy without an automatic key cannot be decrypted by generating a different key. The latest recovery flow preserves unreadable ciphertext, rebuilds only a zero-pending copy after server authorization, and keeps pending records for admin help. Reset permits a replacement installation while retaining historical evidence.

## Delivery preparation readiness follow-up

The driver runtime now exposes `OfflinePrepState` (`IDLE`, `PREPARING`, `READY`, `FAILED`). Startup independently attempts to open a saved local trip, then automatically prepares an approved LOADED/ACTIVE online trip when no saved trip exists. Every caller shares the same preparation promise; a browser Web Lock also serializes preparation across tabs. Existing installation credentials and saved trips are reused. `READY` is set only after the local trip is opened, read, and attached to the runtime. Preparation no longer shares the delivery-saving busy flag.

The status card shows preparation progress, an offline-ready checkmark, or a friendly failure with Retry. Failed preparation waits for Retry instead of repeating registration on every connectivity poll. An authorization failure preserves all stored data and shows admin guidance. Retrying without internet keeps the failure and Retry button available. Losing connectivity does not change `READY`; reconnecting starts background synchronization.

The delivery form permits editing and review during preparation. Save Delivery is disabled until `READY`, with the requested helper text. The form submit handler and action guard block early submission before invoking the runtime; the runtime independently returns the controlled preparation message for a bypass. No save starts or waits for preparation. Once ready, the existing journal-first commit, projected local updates, immediate success, and background synchronization remain in place.

The delivery key remains `trip.id:epoch`, and preparation never increments the epoch. Continue after a successful save intentionally resets it. React form resets are prevented for delivery drafts. Review comparison now uses canonical business values: server audit fields and omitted-versus-explicit zero custody balances cannot invalidate an unchanged review, while stock, pricing, credit, custody and eligibility changes still do. Normal driver deliveries now send empty notes; optional notes remain in the other workflows.

Files changed specifically for this follow-up:

- `src/components/driver-application.tsx`
- `src/components/driver-runtime-context.ts`
- `src/components/operation-form.tsx`
- `src/components/trip-forms.tsx`
- `src/lib/i18n/en.json`
- `src/lib/i18n/ne.json`
- `tests/offline-e2e/preparation-readiness.spec.ts`
- `OFFLINE_FIRST_IMPLEMENTATION.md`

No additional database migration is needed for the readiness fix. The earlier offline device transfer migration above remains part of the original offline-first refactor.

Readiness follow-up validation:

- TypeScript, lint, modified-file formatting, and `git diff --check`: passed.
- `npm test`: 64 files and 643 tests passed during this follow-up.
- Final targeted offline, storage, device, localization, payment and database checks: all 125 tests in 8 files passed against the final code.
- Final browser regression run: all 18 scenarios passed across desktop and mobile, including the new preparation tests, automatic startup/recovery, delivery/return and next-trip flows, customer price refresh, and overnight reconnect. The new cases assert the original form DOM identity and request UUID, quantities, payment choice, notes and open review through preparation, authorization failure, offline Retry and successful Retry. They also cover bypassed submission, online local-first saving, offline saving, reconnect, restart without registration, and concurrent online/focus events.
- Browser command: `npx playwright test --config=playwright.offline.config.ts preparation-readiness.spec.ts automatic-offline.spec.ts offline.spec.ts overnight-loading.spec.ts --timeout=180000 --reporter=line`.
- Final `npm run build`: passed in the isolated offline-test build directory with loopback fixture configuration. No production database was contacted.

The readiness regressions first exposed unnecessary review invalidation for zero and nonzero custody balances and customer audit fields; those are fixed in the final passing run. The final run also passed the overnight reconnect and login cases that timed out in an earlier run. Test-server teardown required stopping only this task's servers on ports 3004 and 17778 after its browser worker exited. No commit or push was made.

## Original refactor validation

- `npm run typecheck`: passed.
- `npm run lint`: passed with no warnings.
- `npm test`: 64 test files and 643 tests passed.
- Latest device-transfer migration check: all 26 tests in `tests/integration/offline-db.test.ts` passed after the final legacy-binding adjustment.
- Offline browser coverage: all 52 desktop/mobile scenarios have passing results. The final full run passed 51; the remaining test had assumed an immediate server write, was changed to wait for background synchronization, and passed in the targeted rerun (`--last-failed`).
- `npm run build`: optimized production build passed using the isolated offline-test configuration and loopback Supabase fixture.
- Modified-file formatting and `git diff --check`: passed.

Browser commands: `npx playwright test --config=playwright.offline.config.ts --reporter=line`, followed by `npx playwright test --config=playwright.offline.config.ts --last-failed --reporter=line`.

All browser and database tests used disposable loopback fixtures, not production Supabase data. This Windows environment stalled during Playwright web-server teardown after the workers exited; only the task's test servers on ports 3004/17778 were stopped to let the runner finish reporting results. No commit or push was made.

## Every modified or added file

- `OFFLINE_FIRST_IMPLEMENTATION.md`
- `public/driver-sw.js`
- `src/app/admin/sync/page.tsx`
- `src/components/driver-application.tsx`
- `src/components/trip-forms.tsx`
- `src/domain/finance/driver-payment.ts`
- `src/domain/offline/operations.ts`
- `src/domain/offline/snapshot.ts`
- `src/domain/offline/types.ts`
- `src/domain/operations/commands.ts`
- `src/lib/i18n/en.json`
- `src/lib/i18n/ne.json`
- `src/lib/offline/device.ts`
- `src/lib/offline/store.ts`
- `src/lib/offline/sync.ts`
- `src/services/offline-admin.ts`
- `src/services/offline.ts`
- `src/services/trusted-device.ts`
- `supabase/migrations/202610160028_offline_device_transfer.sql`
- `tests/helpers/operations-provider.mjs`
- `tests/integration/offline-db.test.ts`
- `tests/integration/overnight-trips-db.test.ts`
- `tests/offline-e2e/automatic-offline.spec.ts`
- `tests/offline-e2e/business-day.spec.ts`
- `tests/offline-e2e/driver-jar-cards.spec.ts`
- `tests/offline-e2e/house.spec.ts`
- `tests/offline-e2e/instant-delivery.spec.ts`
- `tests/offline-e2e/notifications.spec.ts`
- `tests/offline-e2e/offline.spec.ts`
- `tests/offline-e2e/overnight-loading.spec.ts`
- `tests/offline-e2e/trusted-device.spec.ts`
- `tests/offline-e2e/unified-mode.spec.ts`
- `tests/unit/driver-payment.test.ts`
- `tests/unit/offline-storage.test.ts`
- `tests/unit/trusted-device-server.test.ts`
- `tests/unit/trusted-device.test.ts`
