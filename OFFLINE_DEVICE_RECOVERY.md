# Driver delivery and offline device recovery

Normal `/driver/delivery` no longer shows Visit notes in editing or review. Its hidden payload and local delivery draft send `notes: ""`; the runtime also ignores a forged normal-delivery note. Admin delivery notes, historical notes, database columns and separate Instant Delivery notes remain supported.

## Confirmed UAT failure

A read-only check of the already linked project, using its existing active diagnostic admin account, found:

- Migration 28's reset columns are absent (`42703`). The reset/transfer mechanism in the repository therefore was not deployed to UAT.
- Active trip **#7** has an ACTIVE offline round with **2 confirmed operations**. Its bound device is different from its driver's one currently registered device.
- Trip #6 is LOADED and has no offline round or registered device.

There are also two local failure paths in the old preparation code. A legacy `preparations` entry is encrypted with its original key; a newly generated automatic key cannot decrypt it. The error handler matched words such as `unlock`/`passphrase` and incorrectly described this setup-only failure as saved delivery records. An existing unreadable local copy also caused the same message even when its pending count was zero. Both paths are now reproduced in automated tests. No affected browser was attached to this session, so its exact local ciphertext/key combination was not inspected directly.

The previous registration order could register a replacement before discovering that a legacy round belonged to another device. Resetting only that round's former device could leave the unrelated registration blocking a fresh replacement. Migration 29 fixes this additional UAT-shaped case.

## Final behavior

Automatic preparation remains deduplicated by one promise and a browser Web Lock. Approved online LOADED/ACTIVE trips prepare at startup. An existing readable local trip opens automatically; READY continues to work offline. Draft customer, quantities, cartons, payment and amount remain mounted while preparation or Retry runs. Save stays disabled until READY, then commits locally before background synchronization.

Both automatic registration and trip registration check `offline_preparation_access` first. Ownership conflicts return `DEVICE_RESET_REQUIRED` with:

> This trip is linked to another phone. Ask the warehouse admin to reset offline access.

Missing migrations get a distinct admin-update message. Generic permission denials remain separate. “Saved records on this phone need help from the admin” is used only when the local metadata actually reports pending records.

Unreadable setup credentials contain no delivery journal. They can be reserved again with the automatic identity after their exact encrypted bytes are archived. An unreadable journal may be rebuilt only when its local pending and review counts are both zero, and only after an authorized server snapshot has been fetched. The old ciphertext, original ID/AAD, IV and salt are archived in the same IndexedDB transaction that installs the new copy. A changed row or any pending/review record aborts replacement. Existing pending journals are never overwritten. Archived data also prevents removal of an automatic encryption key that may protect it.

IndexedDB upgrades automatically from version 2 to version 3 to add the local `archives` table. It preserves existing rows and introduces no driver PIN, passphrase, biometric or Unlock App flow.

## Required UAT deployment and admin action

Apply these forward migrations, in order, before using the updated recovery flow:

1. `supabase/migrations/202610160028_offline_device_transfer.sql` — existing reset/transfer support, currently missing from UAT.
2. `supabase/migrations/202610160029_offline_preparation_access.sql` — explicit ownership preflight and reset support for stale registered devices.

Then the warehouse admin opens **Driver sync → trip #7 → Reset Offline Device**, enters a reason, and confirms the warning. The reset revokes currently registered phones for that driver and immediately fences the former writer, including legacy devices without a registration row. It records the admin, timestamp, reason, reset ID and revoked identities without deleting operations, reviews or audits.

The driver taps **Retry**. A new identity can register, or a replacement registered during the earlier failed flow can be reapproved only if it was revoked by this exact still-pending admin reset. A per-device reset ID proves that authorization; unrelated past revocations and the former round writer cannot be reapproved. Driver locks prevent two replacements registering concurrently. Repeated reset commands reuse the pending authorization without invalidating the replacement.

The actual transfer retains the confirmed sequence/receipt prefix and any exact server-received envelopes. New operations continue the sequence. Reset, replacement approval and transfer retain their audit trail; the reset admin remains recorded. Unsynced records existing only on the old phone remain there for admin review.

**Live application data was read only. These migrations and the trip #7 admin reset have not been executed against UAT.** No commit or push was made.

Read-only diagnosis can be repeated with `node --env-file=.env.local scripts/diagnose-offline-readiness.mjs`. It validates the linked project and active admin, and prints only schema/readiness metadata, not passwords, tokens, encryption keys or operation payloads.

## Files changed for this request

- `src/components/trip-forms.tsx`
- `src/components/driver-application.tsx`
- `src/app/admin/sync/page.tsx`
- `src/data-access/offline.ts`
- `src/domain/offline/types.ts`
- `src/lib/offline/store.ts`
- `src/lib/offline/device.ts`
- `src/services/trusted-device.ts`
- `src/services/offline.ts`
- `src/lib/i18n/en.json`
- `src/lib/i18n/ne.json`
- `supabase/migrations/202610160029_offline_preparation_access.sql`
- `scripts/diagnose-offline-readiness.mjs`
- `tests/helpers/operations-provider.mjs`
- `tests/unit/offline-storage.test.ts`
- `tests/unit/offline-rpc-errors.test.ts`
- `tests/unit/trusted-device-server.test.ts`
- `tests/unit/trusted-device.test.ts`
- `tests/integration/offline-db.test.ts`
- `tests/offline-e2e/automatic-offline.spec.ts`
- `tests/offline-e2e/preparation-readiness.spec.ts`
- `tests/offline-e2e/unified-mode.spec.ts`
- `OFFLINE_FIRST_IMPLEMENTATION.md`
- `OFFLINE_DEVICE_RECOVERY.md`

## Validation

- Full unit/integration suite: **65 files, 657 tests passed**.
- Database reset/transfer tests: **28 passed**, including legacy binding plus stale registration, exact-reset reapproval, unrelated revocation rejection, repeat reset commands, old-device fencing and original evidence preservation.
- `npm run typecheck`, `npm run lint`, modified-file Prettier checks and `git diff --check`: passed.
- `npm run build`: optimized production build passed in the isolated offline-test directory using the loopback fixture configuration.
- Browser coverage: **all 26 desktop/mobile scenarios have passing results**. The initial run passed 20. Six recovery cases needed updated assertions for the completed admin-reset status and language selection after key loss (one startup also timed out under concurrent suite load); all six passed in the targeted rerun. No application checks were removed.
- Browser commands: `npx playwright test --config=playwright.offline.config.ts automatic-offline.spec.ts preparation-readiness.spec.ts unified-mode.spec.ts overnight-loading.spec.ts --timeout=180000 --reporter=line`, followed by the same config with `--last-failed --timeout=180000 --reporter=line`.

Browser/database mutation tests used disposable loopback fixtures. On Windows, the browser worker exited but web-server teardown stalled; only this task's servers on ports 3004/17778 were stopped so the runner could report its results. No live UAT migration, reset, delivery or financial write was performed.
