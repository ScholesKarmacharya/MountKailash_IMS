# Trusted driver device access

This change extends the existing encrypted driver vault and synchronization
engine. It does not create a second dashboard or change admin authentication.

## Driver setup and use

1. Sign in online with the existing Supabase account and obtain admin approval.
2. Start a confirmed loaded delivery round. In **My Stock → Set up offline
   access**, enter and confirm a PIN of 6–10 digits, then prepare the device.
   Repeated and consecutive digits are rejected.
3. Wait for **Device Ready**. Keep an encrypted backup when persistent browser
   storage is unavailable.
4. Reopen the same app/browser offline and unlock with the PIN. My Stock,
   New Sale, Customers, Unreturned Jars, Sales History and Return to Warehouse
   use the existing driver interface. Recorded stock changes remain encrypted
   in IndexedDB and synchronize through authenticated APIs when connected.

An existing passphrase vault can use **Set unlock PIN** after it is unlocked
online. This wraps the existing key without replacing its journal or operation
IDs. The original passphrase remains usable for legacy records. Older rounds
with a different passphrase have an explicit original-passphrase field after
trusted-device unlock.

**Lock App** clears the mounted keys/data in this tab and locks other tabs while
preserving the trusted setup. **Sign Out** locks local records, ends this browser's
online session and requires online sign-in before device access resumes. Driver
sign-out also works without connectivity; admin sign-out retains its existing
server flow. **Remove Device** requires all local records synchronized and the
round sealed. It revokes access and retains encrypted records. Admin revocation
is available in **Admin → Driver sync**, including device identity, last check-in
and the timestamp of the last confirmed operation.

## Root cause and implementation

The previous offline setup registered a delivery-round writer, rather than a
persistent phone unlock credential. It supported only an eight-character
passphrase without a persistent failed-attempt counter. The server driver
layout and entry routes also required a refreshable online identity before
rendering. The service worker did not reopen the driver shell from the app's
root/sign-in entry paths.

The driver now remembers its encrypted device setup and uses the existing
Supabase session when available. A routing-only HttpOnly cookie lets an
activated phone reach the public driver shell after online authentication
expires. It grants no API access. Unregistered, pending and rejected accounts
retain the original authentication/approval redirects. The driver APIs,
server actions, SQL guards and RLS continue to authorize all server data and
writes.

PIN setup generates a random 256-bit vault secret. A nonextractable AES-GCM
wrapping key is derived using PBKDF2-SHA-256 with 600,000 iterations and a random
salt. PINs/passwords are not persisted. Failed attempts are reserved in an
IndexedDB transaction before decryption, including concurrent tabs. After five
failures, a 30-second delay increases exponentially up to one hour; reopening
does not reset it. Existing vaults retain their encryption and durable journals.

When available, a platform authenticator with required user verification and
WebAuthn PRF wraps the same secret. Unsupported PRF output never falls back to a
stored plaintext key. The platform chooses its verification method; it may use
fingerprint, face verification or its device passcode. This unlocks local data
and does not replace Supabase authentication. See the
[WebAuthn PRF specification](https://www.w3.org/TR/2026/CR-webauthn-3-20260113/)
and [MDN extension documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions).

Forgotten-PIN recovery requires an approved online identity and fresh Supabase
password authentication. The server decrypts an escrow envelope bound to that
driver/device and lets the browser rewrap the same vault secret under the new
PIN. Existing pending transactions remain intact. Revoked and suspended devices
cannot recover or upload. An already unlocked, authorized phone automatically
prepares its next confirmed active round using the existing device credential.

## Database and deployment preparation

Review and apply the forward-only migration
`supabase/migrations/202610130022_trusted_driver_devices.sql` after migration 21.
It creates the device registry, enforces one active trusted device per driver,
protects secret columns, audits registration/revocation, and checks revocation
inside the existing round writer guard. It preserves existing rounds, operations
and financial/stock history. A receipt trigger updates `last_synced_at` only in
the transaction that confirms an operation, rather than on a connectivity probe.

Configure **OFFLINE_DEVICE_RECOVERY_KEY** as a server-only, random 32-byte hex
key (64 hex characters). Keep it stable and back it up securely. Do not use a
`NEXT_PUBLIC_` prefix, reuse the test fixture key, or rotate it without rewrapping
existing escrow records. Setup fails explicitly if it is missing. The migration
was subsequently applied together with migration 23 to the linked hosted
database on 14 October 2026 with explicit user approval; see
[the hosted correction report](TRIP_CREATION_SCHEMA_ERROR.md). The recovery key
is still absent from the current local server environment and has not been
configured on a hosted server here. No production data was reset or deleted
and no deployment was performed.

HTTPS, service-worker support and retained browser storage are required for
offline reopening. Offline authorization defaults to 24 hours from the last
confirmed snapshot; `OFFLINE_AUTH_MAX_HOURS` supports 1–72 hours. Expiry blocks new
offline operations and preserves all queued data. Authentication expiry blocks
uploads until online reauthentication; it does not erase a still-valid local
grant. Suspension/revocation revalidate at connection time. A disconnected phone
cannot receive an immediate administrative notice.

## Verification

All database/browser fixtures are disposable loopback PostgreSQL/PGlite data;
no hosted Supabase accounts or production business records are used.

Final executed checks:

| Check                                                                                                                        | Executed result                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm test`                                                                                                                   | 452 unit/database tests passed in 44 files; no skips                                            |
| `npm run test:e2e:offline`                                                                                                   | 44 desktop/mobile browser tests passed, including all 22 new trusted-device cases (8.3 minutes) |
| `npm run test:e2e:operations -- driver-approval.spec.ts driver-inventory.spec.ts trip-cycle.spec.ts customer-lookup.spec.ts` | 12 desktop/mobile online regression tests passed (6.3 minutes)                                  |
| Optimized production build used by the offline browser suite                                                                 | Passed, including TypeScript compilation                                                        |
| Lint, route/type generation and TypeScript checks                                                                            | Passed                                                                                          |

A separate production build using `VALIDATE_BUILD=1 npm run build` also passed
against the final source without deployment.

The preliminary full online run executed 38 cases: 32 passed and 6 failed. Four
failures exposed an overly broad public-shell condition that changed existing
pending-account and post-logout redirects. The condition now requires the
trusted-device routing marker, while API authorization remains mandatory. The
other two cases timed out in the interrupted/resource-contended run. All six
failed cases were included in the final 12-case online rerun and passed. A new
complete 38-case online run was not repeated; these results do not claim that
such a final full run occurred.

Changed implementation files: `src/lib/offline/device.ts`,
`src/lib/offline/sign-out.ts`, `src/lib/offline/store.ts`,
`src/lib/offline/sync.ts`, `src/services/trusted-device.ts`,
`src/app/api/driver/device/route.ts`, `src/components/driver-application.tsx`,
`src/components/sign-out-button.tsx`, `src/app/driver/layout.tsx`,
`src/app/page.tsx`, `src/app/sign-in/page.tsx`, `src/app/sign-in/actions.ts`,
`src/services/offline-admin.ts`, `src/app/admin/sync/page.tsx`,
`public/driver-sw.js`, both translation dictionaries and `.env.example`.
Migration 22 and the isolated database/browser/crypto/auth regression tests
accompany these changes. Existing work elsewhere in the dirty repository was
preserved.

Earlier offline attempts found a duplicate same-tab lock notification clearing
the removal confirmation, a lost-response test checking before its intercepted
upload had committed, and redundant initial setup reads delaying readiness.
The lock broadcast now identifies its sending tab. Lost-response tests wait for
the actual commit before reopening. New setup uses the server-confirmed snapshot
only after its empty journal is durable; existing queued operations still require
receipts before showing All Synced. The worker also selects its current shell
cache during reopening, preserving PIN support when older caches remain.
The final full offline run passed every case without increasing test deadlines.

The trusted-device browser scenarios cover activation, PIN unlock after closing
and reopening a tab offline, 100→35 sold→65 remaining, encrypted persistence,
lost-response receipt recovery, admin visibility, wrong PIN/throttling across
refresh, password recovery, account changes, offline/online sign-out, unregistered
and pending access denial, suspension, revocation, expiry, safe removal, existing
passphrase adoption, later-round automatic preparation, and expired online
authentication. They run on desktop Chromium and Pixel 7 mobile emulation.

## Limits and release gates

- Synchronization requires the app open and unlocked. Browser closure, storage
  eviction, device damage and clearing site data cannot be repaired by an
  in-browser queue. Export encrypted backups and retain server confirmations.
- Drivers can operate only against confirmed downloaded stock/customer data.
  New warehouse allocations require connectivity and a confirmed active round.
  Changed pricing, eligibility, custody or stock can require explicit review.
- Web PIN throttling protects ordinary incorrect attempts and app restarts; it
  is not a tamper-resistant hardware counter against a compromised browser or
  an extracted database. Use platform verification/OS device protection where
  available. Device clocks and storage are not trusted hardware.
- Losing the server recovery key prevents forgotten-PIN recovery. Existing PIN
  and legacy passphrase access still preserve the encrypted records. Admin
  recovery/physical-stock review is required for unavailable devices.
- Actual hosted Supabase configuration, intended HTTPS origin and physical phone
  biometric/PRF support still require isolated staging acceptance. Mocked PRF
  tests are not evidence of real biometric hardware compatibility.

Ready for isolated staging acceptance after the reviewed migration and server
recovery key are configured. Production rollout remains gated on that acceptance.
