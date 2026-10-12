# Driver approval, profile names and navigation

Implementation/acceptance record, 2026-10-12–13. This change reuses Supabase Auth
identities and profiles; existing inventory, sales, customer, finance, trip,
closing, bilingual and BS calendar operations remain intact.

## Behavior and account creation

New driver profiles default to **Pending Approval**. Only an active database
ADMIN can approve, reject, suspend or reactivate a DRIVER. Admin creation has an
explicit approval choice, defaulting to pending. Every admin change requires a
reason, expected profile version and idempotency key, and appends a before/after
audit event. No Auth user or profile is deleted or recreated.

- Pending → Approved or Rejected.
- Approved → Suspended, including when an assigned trip is still open.
- Suspended or Rejected → Approved after a new admin review.
- Suspension retains vehicles/trips/journals for admin handling; it does not
  cancel a trip, reassign stock or reconcile inventory implicitly.
- First recorded approval time/approver are preserved on reactivation. Later
  access decisions remain in the immutable audit ledger. BS/Nepal formatting
  displays approval and activity timestamps in both languages.

Admin Drivers shows name, canonical Auth email, optional phone, status, approval
date/approver, assigned vehicle and recent operational activity. Pending profiles
appear first. Server guards and an admin-only RPC protect directory/details.
Email is read from Auth, avoiding a second stale copy in profiles.

New-account/manual acceptance steps:

1. In Supabase Cloud Dashboard → Authentication → Users, create an account with
   the driver's deliverable email and a unique password. Deliver the password
   securely; never paste it into chat, source or logs. The app needs no service
   key and does not add public signup UI.
2. Admin opens **Drivers → Add driver**, copies the existing Auth UUID, enters the
   real full name/optional phone, leaves **Approval on creation = Pending
   Approval**, enters a reason and saves. **Approve Driver** during creation is
   an explicit alternative, never the default.
3. Alternatively, a profile-less Auth user signs in and completes only their own
   full name/phone on **Waiting for Admin Approval**. The checked RPC creates a
   DRIVER/PENDING profile for the verified Auth ID. Browser email, role, active
   flag, approval and actor/target ID cannot be forwarded by the own-profile form.
   Auth-only accounts appear in the app directory after either path creates the
   full-name profile. Unfinished accounts remain visible in Supabase Users, with
   no operational access.
4. Confirm waiting status and direct denial of `/driver/home`, `/driver/delivery`,
   `/driver/customers`, `/driver/pending-jars`, `/driver/sales`, `/driver/return`
   and `/admin/**`.
5. Admin reviews the identity, enters a reason and chooses **Approve Driver**.
   Driver clicks **Check approval status** or signs in again to reach the driver
   home. Approval grants no warehouse/admin rights; assignment/loading still
   uses the existing trip workflow.
6. **My Profile** edits actual name/phone only. Refresh the workspace to confirm
   the header name. No real name is invented or silently substituted for a stored
   DEMO name. The owner/admin must enter the correct name.
7. Admin uses **Suspend Driver** while the same driver session remains open.
   The next protected request/refresh goes to the status page; direct business
   reads/postings are denied. Admin can still inspect/reconcile the assigned trip.
   Reactivate restores existing scope without changing IDs or resetting trips.
8. Verify admin directory email/phone/vehicle/activity, BS approval date, EN/ने,
   long names on a narrow phone and logout/login. Check that admin historical
   inventory/customer/sales/payment/archive records remain visible.

## Header, localization and logout

One compact driver header includes branding, actual `profiles.name` (translated
role fallback when blank), role/status, language, My Profile and visible Sign Out.
Desktop navigation sits below it. Mobile uses six large bottom-navigation targets:
My Stock, New Sale, Customers, Unreturned Jars, Sales History, Return to Warehouse.
Existing routes and forms remain intact. New English/Nepali text is translated;
saved preferences remain authoritative, with admin EN/driver NE defaults.

Sign Out calls Supabase Auth with `scope: local`, clears this device's session and
redirects to sign-in. No database records or other devices' sessions are changed.
If an error leaves a local session, a safe retry message appears. The installed
SDK can clear the session even on a provider error: that case redirects to sign-in
with an honest local-signout notice. Supabase access tokens retain their normal
provider expiry semantics; suspension checks current database approval even with
previously issued tokens/sessions.

## Migration 016 safety review and Cloud status

**`202610120016_driver_approval.sql` was explicitly approved, applied and verified
in Supabase Cloud on 2026-10-13.** Immediately before application, the fresh dry
run listed exactly 016, with no seeds or roles. The approved push applied only
that file. Linked history now matches for 001–016 and the post-application dry
run reports the remote database up to date, with no pending migrations.

Before backfill, read-only Auth/profile inspection identified exactly one active
DRIVER: the existing `driver@mount-kailash.example` Auth account and its stored
`DEMO Delivery Driver` profile. Verified Auth ID matches the active database
profile; no other driver profiles were present. Both existing admin/driver
credentials authenticated. Business snapshots were unchanged; no credentials
were printed and no profile/access/business writes occurred.

After migration, that existing driver remains active with APPROVED status and
the same Auth ID, name, version and role. Before/after normalized hashes of the
operations workspace, finance workspace and existing profile fields
(`id`, `name`, `role`, `is_active`, `version`) matched; both original profiles remain. New columns and approval status
are the intended migration changes. Original approval dates/approvers remain
NULL rather than being invented. No new Auth accounts or business records were
created, and no account was suspended, deleted or renamed.

Actual Cloud browser checks passed for both roles at 1280px and 393px: login,
stored name after refresh, navigation/layout, readable profile forms, logout and
protected-route exclusion. Admin Drivers and Driver Details load the existing
Auth email and APPROVED status, with rendered suspension controls. Driver
navigation to Admin Drivers redirects to its own home, and direct driver and
anonymous `admin_driver_directory` calls both return 42501. These were read-only
checks; no profile or status forms were submitted.

Migration scope:

- Adds optional phone, checked approval status and approval/status actor/time
  metadata to profiles. Auth remains the canonical source of email and identity.
- Backfills trusted active DRIVER profiles to APPROVED and inactive profiles to
  SUSPENDED. IDs, names, roles and active flags stay unchanged. Original approval
  dates/actors were never recorded: keep NULL and display **Not recorded**.
- CHECK requires DRIVER `is_active` to agree with APPROVED status. An insert
  trigger defaults newly provisioned drivers to inactive pending. Existing
  active-account checks in older RPCs remain effective through this invariant.
- Strengthens the shared operation actor check; adds restrictive approved-account
  reads to every existing public RLS business table. Existing ownership/admin
  scope policies remain. Profiles retain safe own-profile reads.
- Adds checked own-contact, admin provisioning/status and admin-directory RPCs.
  Empty fixed search paths and authenticated-only grants; anonymous execution
  and private helper execution are denied. Browser metadata grants no access.
- Keeps legacy `save_driver` callable with its old signature, but new accounts
  are pending and hidden activation is rejected. Legacy assigned-trip disabling
  checks remain; the explicit suspension RPC can block access immediately.
- No Auth IDs/users, business journals, archived report rows, payment posting or
  stock rules change. No reset, table drop, RLS disabling, seed or sample record.

Risks: profile ALTER/backfill/constraint validation briefly locks the table; apply
in a quiet window. Shared actor row locks serialize access changes against
in-flight operations. An already-authorized write can finish before suspension
commits; subsequent writes are denied. Trusted direct profile tooling must keep
active/approval fields consistent. Demo scripts preserve existing names and access
decisions and create new drivers inactive pending. REST schema cache may need
reload if a newly applied RPC is temporarily unavailable. Reinspect profiles and
the exact dry-run list immediately before applying if provisioning has changed.

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
node --env-file=.env.local scripts/verify-cloud-driver-approval.mjs --inspect
# Approved command executed for migration 016 (already applied):
npx.cmd --no-install supabase db push --linked --yes
# Existing-account read-only browser checks, with the dev server running:
node --env-file=.env.local scripts/verify-cloud-driver-approval.mjs http://localhost:3000
```

Cloud public signup is currently **enabled**, despite the intended private account
model. No Cloud Auth setting was changed. Migration 016 prevents public signup
metadata/self-profile creation granting operational access. An admin should
disable **Allow new users to sign up** in Cloud Auth settings for a private
deployment; local config.toml does not configure Cloud.

## Verification and remaining acceptance

SQL tests apply 016 over actual pre-migration stock, trip, delivery, sale, payment
and jar histories, compare full snapshots/Auth IDs, and test defaults, lifecycle,
version/idempotency/audit, self-approval denial, restricted reads/postings and
suspension during an assigned trip. Existing archive-upgrade tests include 016.

Browser acceptance uses the real app/migrations with disposable PostgreSQL on
loopback 3002/17777. Auth is a test adapter, not Cloud email delivery. Scenarios
cover mobile/desktop pending completion, admin creation/review, existing-session
suspension, name edits/refresh, BS approval dates, navigation/languages, logout
outage and protected-route denial. Regression includes real inventory, delivery,
Paid/Credit, FIFO returns, reconciliation and closing.

Executed checks:

| Command/check                                                                     | Result                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                           | Passed, strict TypeScript and Next route types.                                                                                                                                                                                                                       |
| `npm.cmd run lint`                                                                | Passed.                                                                                                                                                                                                                                                               |
| `npm.cmd run format:check`                                                        | Passed.                                                                                                                                                                                                                                                               |
| `npm.cmd run test -- --reporter=dot --maxWorkers=1`                               | 305 tests passed in 32 files, including actual PostgreSQL authorization and migration-preservation tests.                                                                                                                                                             |
| `npm.cmd run test:e2e`                                                            | 56 desktop/mobile scaffold and unauthenticated route checks passed.                                                                                                                                                                                                   |
| `npm.cmd run test:e2e -- --grep /account`                                         | All four account-route checks passed after the guard fix, with the configuration error gone.                                                                                                                                                                          |
| `npm.cmd run test:e2e:operations`                                                 | Initial full run: 28 passed, two desktop Sign Out flows timed out. Fixed refresh coordination; targeted eight-scenario rerun passed, including both failures. All 30 distinct operational scenarios have passing executions across the full run and corrected reruns. |
| `npm.cmd run test:e2e:operations -- tests/operations-e2e/driver-approval.spec.ts` | Final four desktop/mobile approval scenarios passed after the compact header and waiting-page guard changes.                                                                                                                                                          |
| `$env:VALIDATE_BUILD='1'; npm.cmd run build`                                      | Final production build passed in its separate output directory; existing development server preserved.                                                                                                                                                                |
| Read-only Cloud browser script above                                              | Existing admin and driver passed at 1280px and 393px: stored profile names, refresh, navigation, no horizontal overflow, logout and protected-route exclusion. Business snapshots unchanged.                                                                          |
| `npx.cmd --no-install supabase db push --linked --dry-run`                        | Passed before application with only 016 and no seeds/roles; passed afterward with no pending migrations.                                                                                                                                                              |

Two implementation issues found and fixed during acceptance: Sign Out now pauses
automatic operational refresh while the session changes, and the waiting page
verifies identity/configuration before reading the profile instead of relying on
its layout (Next can render both concurrently). The provider-outage test also
executes the installed SDK's local-session clearing behavior rather than
pretending a failed provider response always leaves the session active.

An earlier simultaneous build/unit-test run hit resource-related timeouts;
running the unit suite serially passed. Run the heavy build and browser suites
sequentially on this workstation. Development logs intermittently emit Next
stream-cancellation warnings during rapid navigation; associated browser/data
assertions passed. These are recorded rather than asserted to be fixed.

Cloud operational write acceptance (new approval/suspension/profile edit) still
requires a designated account and explicit permission for those writes. The
migration is applied and the corresponding isolated PostgreSQL/browser tests
passed; the read-only Cloud checks do not claim live mutations were executed.
SMTP delivery, true concurrent hosted
transactions and additional devices/browsers need staging/manual acceptance. No
test business data is inserted into Cloud.

## Files changed

- `README.md`
- `docs/DATABASE.md`
- `docs/DRIVER_APPROVAL.md`
- `docs/SECURITY.md`
- `scripts/cloud-demo.mjs`
- `scripts/seed-demo.mjs`
- `scripts/verify-cloud-driver-approval.mjs`
- `scripts/verify-cloud-inventory.mjs`
- `scripts/verify-cloud-localization.mjs`
- `scripts/verify-cloud-login.mjs`
- `scripts/verify-cloud-operations.mjs`
- `src/app/account/layout.tsx`
- `src/app/account/page.tsx`
- `src/app/account/profile/page.tsx`
- `src/app/admin/drivers/[id]/page.tsx`
- `src/app/admin/drivers/page.tsx`
- `src/app/api/preferences/route.ts`
- `src/app/operations-actions.ts`
- `src/app/page.tsx`
- `src/app/sign-in/actions.ts`
- `src/app/sign-in/page.tsx`
- `src/components/account-forms.tsx`
- `src/components/app-shell.tsx`
- `src/components/driver-account-summary.tsx`
- `src/components/driver-status-form.tsx`
- `src/components/localization.tsx`
- `src/components/master-forms.tsx`
- `src/components/navigation.tsx`
- `src/components/sign-out-button.tsx`
- `src/data-access/accounts.ts`
- `src/data-access/profiles.ts`
- `src/domain/auth/accounts.ts`
- `src/domain/auth/roles.ts`
- `src/lib/i18n/en.json`
- `src/lib/i18n/ne.json`
- `src/proxy.ts`
- `src/services/accounts.ts`
- `src/services/auth.ts`
- `supabase/migrations/202610120016_driver_approval.sql`
- `tests/e2e/scaffold.spec.ts`
- `tests/helpers/operations-provider.mjs`
- `tests/integration/business-days-db.test.ts`
- `tests/integration/driver-approval-db.test.ts`
- `tests/integration/driver-workflow-db.test.ts`
- `tests/integration/finance-db.test.ts`
- `tests/integration/operations-db.test.ts`
- `tests/operations-e2e/daily-close.spec.ts`
- `tests/operations-e2e/driver-approval.spec.ts`
- `tests/operations-e2e/driver-inventory.spec.ts`
- `tests/operations-e2e/driver-payment.spec.ts`
- `tests/operations-e2e/driver-workflow.spec.ts`
- `tests/operations-e2e/finance.spec.ts`
- `tests/operations-e2e/localization.spec.ts`
- `tests/operations-e2e/pending-jars.spec.ts`
- `tests/operations-e2e/product-delivery.spec.ts`
- `tests/operations-e2e/trip-cycle.spec.ts`
- `tests/unit/accounts-service.test.ts`
- `tests/unit/locale-preferences.test.ts`
- `tests/unit/profile-access.test.ts`
- `tests/unit/roles.test.ts`
- `tests/unit/server-guards.test.ts`
- `tests/unit/sign-in.test.ts`
