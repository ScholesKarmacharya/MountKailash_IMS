# Admin driver offline access

Implemented at **Admin → Drivers → View Driver Details → Offline Access**.

The card shows the driver's name, current LOADED/ACTIVE trip, vehicle, registration and sync times, last reported pending count, and server records awaiting review or retry. It does not expose device identifiers or credentials. Status describes server information, not proof that a particular phone has prepared its local data. Phone-only changes are explicitly unknown.

## Reset flow

1. An admin opens **Reset Offline Access**. The accessible confirmation dialog names the driver, explains replacement access and history preservation, and warns: “Changes that exist only on the old phone may not be recoverable after reset.” Cancel makes no request. Reason is optional; a blank reason uses “Reset offline access from driver management”.
2. The Server Action calls `resetDriverOfflineAccess`, which checks `admin:read` and validates identifiers and reason. The database RPC independently calls `ops_actor(true)`, requiring an active ADMIN. A driver cannot invoke either the metadata RPC or reset RPC directly.
3. `offline_admin_reset_access` locks the driver's registration lane and verifies the displayed trip is still the current trip. A stale confirmation fails instead of resetting a newly assigned trip. Stable command keys make retries idempotent.
4. When a current round exists, the wrapper reuses `offline_admin_reset_device` from migrations 28–29. This revokes every currently registered phone for that driver and marks the round replacement-pending, with reset time, admin, reason and reset ID. The wrapper uses a deterministic nested command key and adds a driver-profile audit entry, visible in this page's audit history. The original reset/transfer review and trip audit records remain intact.
5. The old writer fails `offline_device` while reset is pending and remains rejected after transfer by its revoked registration and obsolete round binding. Historical operations retain their original device, sequence, UUID, payload, hash, and receipt. No history is copied into new operations or deleted.
6. The driver reopens/reloads the app **while online**. Existing automatic preparation performs ownership preflight, registers one replacement, then transfers the current round to it. No PIN, passphrase or manual setup is needed. Exact server-received review/retry envelopes and confirmed sequence history are inherited. The unique active-device index and shared driver lock prevent duplicate ownership. A replacement registered before the old binding was discovered may be reapproved only when its credentials were revoked by this exact pending admin reset; independently revoked devices and the former writer cannot use that exception.
7. The admin sees: “Offline access reset successfully. The driver can reopen the app while online.” Repeated reset is disabled while replacement is pending. The trip remains LOADED/ACTIVE throughout.

## Edge cases and deployment

- Legacy round without a trusted-device row: **Needs update**, reset available; the round reset flag fences the legacy writer.
- No prepared round but a registered phone: revoke that phone and audit the action; do not create an artificial round. Fresh replacement credentials can prepare normally.
- No active trip but a registered phone: revoke and audit safely, without changing any historical trip or round.
- No device and no current round: disabled UI; direct authorized RPC calls are harmless, audited, idempotent no-ops.
- A round in PAUSED/SEALED/EXCEPTION requires the existing Driver sync review flow; the simple card does not bypass those controls.
- Missing migration: **Needs update**, reset disabled, with a clear deployment-update message. An admin reset cannot substitute for a missing database update.
- The known ownership-conflict message remains: “This trip is linked to another phone. Ask the warehouse admin to reset offline access.”

New migration: `supabase/migrations/202610160030_admin_offline_access.sql`. It adds only two restricted RPCs and reuses the existing reset/revocation/audit fields. Migrations **28, 29 and 30** must be deployed in order with this app. There are no table deletions, truncations, trigger changes, or additional direct table grants.

No migrations or driver resets were applied to live/UAT data during this implementation. The previously diagnosed UAT deployment lacks migration 28; deploying these pending migrations is still required before that environment can use reset.

## Files changed for this request

- `src/app/admin/drivers/[id]/page.tsx` — card and friendly reset audit label.
- `src/app/admin/drivers/actions.ts` — reset Server Action, success/error feedback and revalidation.
- `src/components/offline/admin-driver-access.tsx` — simple card and confirmation form.
- `src/components/admin-dialog.tsx` — optional destructive styling and disabled trigger support.
- `src/domain/offline/admin.ts` — safe card response type.
- `src/services/offline-admin.ts` — admin-only metadata and reset service, missing-migration fallback.
- `src/lib/i18n/en.json`, `src/lib/i18n/ne.json` — English/Nepali strings.
- `supabase/migrations/202610160030_admin_offline_access.sql` — safe admin metadata/reset RPCs.
- `tests/helpers/operations-provider.mjs` — loopback fixture RPC allowlist.
- `tests/integration/offline-db.test.ts` — real SQL authorization, history, active trip, replacement, stale page, no-device/no-trip and audit checks.
- `tests/unit/offline-admin.test.ts` — server authorization, validation and missing-migration handling.
- `tests/offline-e2e/automatic-offline.spec.ts` — driver-page dialog/cancel/reset, replacement reload, permissions and empty states on desktop/mobile.
- `ADMIN_OFFLINE_ACCESS.md` — this implementation and deployment report.

Earlier offline-first changes in the working tree were preserved. No commit or push was made.

## Validation

- `npm.cmd run typecheck` — passed.
- `npm.cmd run lint` — passed.
- Targeted Vitest suite — **78 tests passed across 6 files**: `offline-db`, `offline-admin`, `trusted-device-server`, `trusted-device`, `offline-rpc-errors`, and `localization`. The final SQL check includes legacy registration timestamps as well as authorization, evidence preservation, audit, trip and replacement behavior.
- `npx.cmd playwright test --config=playwright.offline.config.ts automatic-offline.spec.ts preparation-readiness.spec.ts --timeout=180000 --reporter=line` — **20 passed**, desktop and Pixel 7, using isolated loopback PostgreSQL fixtures. Includes cancel/reset via Drivers → Driver Details, exact warning/success messages, driver audit visibility, denied driver access, empty states, ownership error before reset and automatic preparation after an online page reload.
- `npm.cmd run build` — passed for both the isolated loopback fixture build and the normal environment production build (`VALIDATE_BUILD=1`, isolated output directory).
- Prettier checks on changed source/tests/report and `git diff --check` — passed.

All fixture servers were stopped after testing. No live business data was modified by these checks.
