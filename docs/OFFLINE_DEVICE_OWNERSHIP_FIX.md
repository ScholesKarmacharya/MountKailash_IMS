# Offline device ownership recovery — 17 October 2026

## Approved Cloud deployment completed

Following explicit approval for migration 032 only, a fresh dry run listed only `202610170032_offline_ownership_recovery.sql`. It was then applied successfully using `npx.cmd --no-install supabase db push --linked --yes`; no seeds or roles were applied. A subsequent migration-history read confirms **001–032 applied and matching locally/remotely**.

The post-deployment read-only Cloud check now returns **Device reset required**, `can_reset: true`, `reset_pending: false` for Rabindra's same **Trip #9**. The trip remains **LOADED**, there is still no offline round, and all three existing trusted devices remain revoked. The migration therefore makes the actual conflict resolvable without resetting access or changing trip/device records during deployment.

**Rabindra's live device reset was not performed.** An admin must reload Drivers → Rabindra → Offline Access, confirm the trip, then reset with a reason. Rabindra can then refresh the updated app online to prepare the replacement credentials. That live browser outcome remains to be checked; the isolated desktop/mobile browser flows passed as recorded below.

The remaining sections retain the pre-deployment diagnosis, safety review and test evidence.

## Actual Cloud state before the fix

Read-only checks used the linked Cloud project and the existing admin account. No live reset, registration, stock operation or migration was performed. Credentials and token hashes were neither selected for output nor logged.

Rabindra's driver ID is `3687a597-f643-40d4-8ff9-c265976e72e4`. Current trip **#9** is `f0ca4a6f-9dd2-412e-8cfe-06199e857d93`, **LOADED**, scheduled for 16 October. Both the admin query and the driver's workspace selection identify this trip.

The actual `admin_driver_offline_access(p_driver)` response, restricted to relevant fields, was:

```json
{
  "trip_number": 9,
  "status": "No device registered",
  "device_registered": false,
  "reset_pending": false,
  "can_reset": false
}
```

The authorized `offline_admin_workspace` round query contained **no `driver_offline_rounds` row for Trip #9**. There are **three trusted-device records for Rabindra, all revoked**. There is no active trusted device. Thus an old current-trip round binding did **not** cause this observed Cloud state.

The driver's application query is `readOfflineRound(trip)`, selecting only `trip_id,phase` for the selected trip. The same trip lookup has no stored row. This is server-data verification under admin authorization, not a claim that Rabindra's live browser or authenticated session was exercised. The existing demo driver is a **different account**; its login cannot verify Rabindra's browser identity. The incoming ID/token from Rabindra's browser was not inspected. A cached revoked identity explains the rejected preparation branch and is reproduced by the isolated tests below; development diagnostics can confirm the incoming ID without exposing credentials.

Reproduce the read-only Cloud inspection with:

```powershell
node --env-file=.env.local scripts/diagnose-offline-ownership.mjs
```

## Source of the contradiction

1. Migration 030's admin RPC already reads both trusted devices and the selected trip's round. However, `can_reset` only considers an **active** trusted device or an existing round. Revoked identities without a current round are treated as nothing to resolve.
2. Migration 029's preparation RPC examines the **incoming installation identity**. It rejects an existing revoked device even when there is no round. `offlineRpc` maps that ownership rejection to the generic “linked to another phone” message. That message did not prove another phone owned Trip #9.
3. A no-round reset previously only revoked active devices. It stored no persistent waiting/replacement state for this case. The automatic driver setup continued retrying the same durable revoked credentials. Simply enabling the button would not repair recovery.
4. Admin trip selection also used different sorting from `currentRound`. This was not the cause for Trip #9, but the selectors are now aligned.

## Changes

- Migration **`202610170032_offline_ownership_recovery.sql`** adds private current-trip and ownership-state readers. The selection matches the driver's existing priority, scheduled date, creation time, trip number and ID ordering. Admin status considers current authorization, current round ownership, revoked identities and pending replacement authorization.
- Reset is available for the observed revoked/no-round conflict and for existing current-trip round bindings. A genuinely empty driver with no device/round/reset state remains disabled. The displayed trip is rechecked under the existing shared driver lock; stale confirmations fail safely.
- A reset records its admin, reason, time and request key in the existing immutable audit ledger. With no round, the audited authorization supplies a persistent replacement-waiting state. It does not manufacture a round or change inventory.
- With an existing round, reset reuses the existing locked, audited transfer mechanism and fences the original writer before transfer. A PAUSED current round can replace its device while **remaining PAUSED**; this does not resume operations or bypass closing/review. Terminal SEALED/EXCEPTION history is not reopened.
- A repeat while waiting is audited as reuse, preserving the original authorization/time and a replacement registration already in progress. Retrying an original request key after replacement does not revoke the new owner.
- After reset, the card shows **Waiting for driver device**, the same trip, previous-device revocation and last reset in the existing localized BS date presentation. Dialog state/request keys reset on reopening, so a later confirmation does not accidentally reuse an old successful command.
- For a revoked identity with **no current round**, the checked online preflight can request fresh registration credentials only after the matching admin reset. It never unrevokes the old identity. The browser durably rotates the device ID/token, retains its encryption key, preserves the prior identity and archives the exact old encrypted preparation before reserving a new one. Lost responses retry the same new credentials.
- Rotation refuses to overwrite **any existing current-trip delivery journal**, even one marked synced. Other trips, encrypted history, pending records and archive keys are retained. Those exceptional inconsistent local copies require review rather than automatic replacement.
- A revoked/no-round browser receives an accurate revocation message; a genuinely conflicting round still receives the existing another-phone message. English and Nepali strings are included.
- Development-only diagnostics whitelist driver/trip/device IDs, phase, trusted existence/revocation, replacement/reset flags and binding result. No request bodies, raw errors, token/hash, recovery material, passwords or operation payloads are logged. Production does not query or log these diagnostics. The read-only diagnostic RPC is independently restricted to an operationally authorized admin or the driver themself.

## Files changed for this fix

- `supabase/migrations/202610170032_offline_ownership_recovery.sql`
- `src/services/offline-admin.ts`, `trusted-device.ts`, `offline.ts`, new `offline-diagnostics.ts`
- `src/data-access/offline.ts`, `src/domain/offline/admin.ts`, `src/lib/offline/device.ts`
- `src/components/driver-application.tsx`, `src/components/offline/admin-driver-access.tsx`
- `src/app/admin/drivers/[id]/page.tsx`; the existing reset Server Action still authenticates and revalidates the driver/admin views
- `src/lib/i18n/en.json`, `ne.json`
- `scripts/diagnose-offline-ownership.mjs`
- New `tests/integration/offline-ownership-recovery-db.test.ts`, new `tests/unit/offline-diagnostics.test.ts`, new `tests/offline-e2e/ownership-recovery.spec.ts`
- Updated offline SQL, admin, device, RPC-error and browser tests; isolated provider allowlist and private driver verification config
- This report and the pointer in `ADMIN_OFFLINE_ACCESS.md`

Preexisting changes from earlier work and the other editor are preserved. No commit or push was made.

## Migration safety and rollout

Before the approved deployment, linked history reported **001–031 applied** and `supabase db push --linked --dry-run` listed only **032**. Migration 031 was already present remotely at inspection time; this task did not apply it. The completed 032 deployment is recorded above.

032 changes restricted PostgreSQL functions and execution grants. It creates no business fixtures, tables, accounts or inventory, changes no table grants/RLS policies and performs no historical data rewrite, delete, truncate or reset. It retains the existing authorization checks, writer locks, idempotency and audit/transfer implementation. Its intentional permission change lets an authorized admin resolve the previously unresolvable revoked/no-round state and safely replace a paused writer without resuming its trip.

Ownership RPC definitions and preparation responses change, so deploy the migration with the matching application update. Concurrent preparation/reset may briefly wait for the existing locks. Old phone-only changes remain on that phone for review and are not silently copied or replayed. Existing current-trip local journals are deliberately protected from automatic identity rotation.

After approval and a fresh dry run still showing only 032, the Cloud command is:

```powershell
npx.cmd --no-install supabase db push --linked --yes
```

Do not run `db reset`. Deploy/restart the updated app. An admin can then open **Drivers → Rabindra → Offline Access**, confirm Trip #9, reset with a reason and check **Waiting for driver device**. Rabindra refreshes the same browser while online; automatic preparation should reach **Offline ready**. An authorized reset changes access, so it has not been silently performed on Rabindra's live account during testing.

## Verification

All business fixtures use disposable PGlite databases and loopback application/provider ports, never Cloud business data. The SQL upgrade test first runs migrations through 031, proves the actual pre-fix disabled-admin/rejected-driver combination, then applies 032. It also covers loaded-round ownership with active/revoked trusted rows, repeat resets during replacement registration, preserved binding/evidence, old-writer fencing, private-helper/other-driver denial, paused-state preservation and read-only PostgREST diagnostic transactions.

Results:

- `npm.cmd test -- --maxWorkers=1`: **698 passed, 70 files, no skipped tests** (final full run, 79.39 seconds).
- The targeted nine-file unit/authorization/SQL suite passed **96 tests** before the additional paused/read-only cases; a subsequent focused SQL run passed **39 tests**. Both additional cases are included in the final 698-test full run.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- Final ownership browser command below: **10 passed in 2.0 minutes**, desktop Chrome and Pixel 7, with a clean process exit. This includes the original admin reset/history/permission regressions and both new ownership-recovery flows.
- Prettier checks of all files changed for this fix and `git diff --check`: passed.
- `npm.cmd run test:e2e:driver-verification -- ownership-recovery.spec.ts preparation-readiness.spec.ts --reporter=line`: the production application build passed. Browser cases were corrected/retested separately as described below; this initial combined browser run is not claimed as fully passing.
- `npx.cmd --no-install supabase migration list --linked`: 001–031 applied, 032 pending.
- `npx.cmd --no-install supabase db push --linked --dry-run`: only 032; no seeds or roles listed.

Final browser command:

```powershell
npx.cmd --no-install playwright test --config=playwright.driver-verification.config.ts ownership-recovery.spec.ts automatic-offline.spec.ts --grep 'revoked browser|bound owner A|admin warns before reset|admin driver offline card|driver cannot open admin' --reporter=list
```

Earlier browser attempts corrected test-harness mistakes: an unaccepted native confirmation, an incorrectly noncanonical test envelope and checking a My Stock card while still on New Sale. These were not bypassed application checks. A sandboxed run completed all ten case assertions but stalled during test-server cleanup; it was interrupted and rerun with permission to terminate its own child processes. No live Rabindra login/reset flow is claimed as passed.

Manual UAT checklist after deployment:

1. Open Rabindra's admin detail page; verify Trip #9 and an enabled reset for the revoked-device conflict.
2. Confirm reset with a reason. Check Waiting for driver device, previous device revoked and the last reset timestamp.
3. Refresh Rabindra's browser online. Check preparation followed by Offline ready, without the former ownership error.
4. Reload the admin detail page; verify current access and the reset audit entry.
5. Preserve any old phone-only data. Confirm old credentials are rejected by the server; do not clear browser storage to make the warning disappear.
6. Record a normal approved delivery and verify its stock/payment/jar ledger and receipt once. This last step writes business data and must use a legitimate delivery or an explicitly approved test environment.
