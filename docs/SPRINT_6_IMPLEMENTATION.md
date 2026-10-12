# Sprint 6 integration and quality assurance - 2026-10-12

The connected application is implemented and its isolated automated checks pass. The user explicitly approved migrations 012-013; both were applied to Supabase Cloud on 2026-10-12 and verified against the existing development server, http://localhost:3000. Production sign-off is pending hosted operational acceptance and the limits below. No reset, deletion, RLS disabling, production test records, credential changes or deployment occurred.

## Audit outcome

| Area                  | Verified behavior and evidence                                                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Driver workspace      | Mobile/desktop active trip and vehicle, loaded/remaining full jars and cartons, empties, deliveries/visits, explicit business-day sales and recorded collections, New Delivery, Add / Find Customer, Pending Jars and Submit Trip. Touch plus/minus and direct entry executed.                |
| Customer access       | Driver-selected active destinations, inline creation/contact editing, repeated visits, optional walk-in contacts and admin creator visibility. No admin preassignment. Backend owned-trip/active-profile/day checks and field whitelists tested.                                              |
| Pending jars          | 20 delivered/15 returned leaves 5; later 10/12 consumes oldest 5 plus 7 newer, leaving 3 at the second delivery's original date. FIFO allocations and dated lots derive from immutable custody entries plus posting-order metadata. Credit remains separate.                                  |
| Returns without sales | A return-only visit changes vehicle empties/custody and audit history without a new sale/invoice. Explicit old-credit/deposit collections remain possible. Same-key retry has one physical effect. Legitimate returns no longer cause a false unposted-finance closing blocker.               |
| Physical inventory    | Warehouse loading, registered/walk-in delivery, independent empties, declaration versus admin reconciliation, refill and separate damaged stock; negative stock/oversized delivery/duplicate retry/rollback checks pass.                                                                      |
| Finance               | Cash, unpaid/monthly arrangement, partial/mixed receipts, old-credit allocation, manual deposit/refund, customer price snapshots, pending/admin-reconciled Fonepay, private print/PDF flows pass. Automatic merchant verification remains unconfigured.                                       |
| Closing/history       | Admin-only manual review/close, frozen posting, rejected cash handover, immutable archive/PDF/CSV, stock/credit/deposit/jar carry-forward and zero new-day counters pass. New snapshots include pending lots/original dates; existing archives remain unchanged.                              |
| Multiple operators    | Separate driver/vehicle browser sessions post together, shared customer custody remains consistent, balances stay with the correct vehicles and cross-driver navigation is denied. This proves simultaneous application requests against the fixture, not independent PostgreSQL connections. |
| Existing Cloud        | Real admin/driver authentication, role redirects/logout and customer/vehicle/driver/trip pages at 1280px/393px pass read-only persistence/layout checks. Cloud now has 001-013 applied; contact/workspace/FIFO readers and current pending-jar report empty states pass.                      |

## Issues fixed

1. Prior implementation required admin-assigned customer routes and admin-only registration. Replaced by checked driver contact/destination operations; retain historical associations and successful old request retries.
2. Driver customer reads needed global active contacts and earlier balances while preserving private operational scope. Added contact projection and selected-customer context RPCs rather than broadening raw financial/warehouse RLS. Admin notes are excluded from driver directory/context responses.
3. Original custody history showed signed changes without FIFO pending delivery dates. Added immutable posting order and derived pending/return intervals. Dates do not move when a customer returns jars or a day closes.
4. Empty-only visits issued zero-value sales/invoices. New visits now use an explicit immutable return-only marker and skip sales/invoice creation, retaining stock/custody/audit and optional allocated collections. Existing zero-value documents are preserved. Return-only visits count as customer visits and are excluded from Recent Sales.
5. Direct numeric overstock entry was silently ignored. Typed excess now remains visible with validation/review blocked; database still rejects it atomically. Plus/minus remains bounded.
6. Concurrent Playwright configurations cleaned the same artifact directory. Configurations now use separate ignored output directories. New test helpers also wait for logout navigation and install one dialog handler; test synchronization failures were corrected rather than counted as passes.
7. Dependency audit found critical test-runner advisories. Updated only development Vitest from 3 to 5.0.3 and regenerated the lockfile; all tests pass. Migration guidance was checked against [official Vitest documentation](https://vitest.dev/guide/migration/). Production dependencies report zero advisories; five high findings remain in the development ESLint/Next glob chain.

8. Post-migration Cloud Auth tests exposed a five-second assertion deadline while admin sign-in was still pending. Sequential browser checks passed. Set explicit 30-second assertion/60-second test deadlines for the hosted suite, preserving all exact role/navigation/logout checks; the normal two-worker suite then passed all four tests.

## Approved Cloud migrations and safety review

The dry run listed exactly these two forward-only files; 001-011 were already applied. After explicit user approval, `npx.cmd --no-install supabase db push --linked --yes` successfully applied both. Remote history and the final dry run confirm 001-013 are applied with no pending migrations, seeds or roles:

| File                                        | Changes                                                                                                                                                                                            | Review risk                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202610120012_driver_customer_workflow.sql` | Nullable customer creator/indexes/trigger; authorized contact/directory/context RPCs; invoker workspace update; private posting cores with checked wrappers; reject new destination preassignment. | ALTER/index DDL needs a quiet window. Existing customer creator remains null. Function renames revoke client access to the cores, so external callers must use public RPCs. Existing function signatures and stored retry payloads remain compatible.                                                                      |
| `202610120013_sprint6_pending_jars.sql`     | Immutable custody order and return-only markers, RLS/grants/triggers; FIFO readers/context; return-only finance handling; legitimate-return closing checks and dated future closing snapshots.     | Indexes existing custody entries without changing their journal rows. Legacy exact-timestamp ordering was not recorded: positives precede returns with stable UUID tie-break. New events capture exact posting order. Existing archived JSON and zero-value documents are preserved. Review query cost on staging volumes. |

The upgrade regression applies both files over a populated pre-012 database with existing users, customer, closed trip/day, custody, stock, financial journals and a closing archive. It compares complete before/after snapshots, verifies nonzero legacy pending custody and retries old route-bearing create/visit/payment requests after closure. All pass.

With a normal recovery checkpoint available, inspect the exact pending list during a quiet operational window:

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
npx.cmd --no-install supabase db query --linked --file scripts/sql/cloud-driver-workflow-readonly.sql --output json
```

The approved application and post-application checks were:

```powershell
npx.cmd --no-install supabase db push --linked --yes
npx.cmd --no-install supabase db push --linked --dry-run
npx.cmd --no-install supabase db query --linked --file scripts/sql/cloud-driver-workflow-readonly.sql --output json
```

Do not use reset, seed/include-all options, manual history repair or replay applied SQL. Files may commit separately; inspect any failure and repair forward. A dry run checks history, not hosted SQL execution. No new environment variables, secrets or Docker were needed. The existing local application now reads the new Cloud schema; no deployment was performed.

Before/after Cloud counts and all seven preservation fingerprints matched: account IDs, complete profiles/roles, existing customer fields, business days, trips, stock journal and finance journal. Both new tables have RLS enabled and deny direct client writes. Public RPCs permit authenticated execution and deny anonymous execution; private posting/FIFO cores deny authenticated and anonymous execution. Fixed empty search paths were verified from Cloud catalogs.

Post-application API/browser checks executed the actual contact directory, `operations_workspace` with `driver_workflow: true`, and admin `pending_jar_workspace` (zero outstanding lots). All four admin directories and the current pending-jar report pass at 1280px/393px, including refresh, actual row counts and the correct empty state. The existing driver has no ACTIVE trip on an OPEN day, so unrestricted pending reads correctly return permission denial; no trip was started or populated to manufacture an operational test.

## Commands actually executed

| Command                                                                                | Result                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm.cmd test`                                                                         | 213 passed across 20 files with Vitest 5.0.3: unit/server guards and real PostgreSQL inventory/trip/finance/closing/FIFO/upgrade tests.                                                                            |
| `npm.cmd run test:e2e:operations`                                                      | 14 passed, desktop/mobile: physical trip, 80-jar driver flow, FIFO/return-only, simultaneous drivers/vehicles, finance/PDF, daily close/refill/damage/exports/carry-forward and stale stock.                       |
| `npm.cmd run test:e2e`                                                                 | 38 passed, unauthenticated/setup and protected pages/PDF/export routes on desktop/mobile.                                                                                                                          |
| `$env:AUTH_E2E_BASE_URL='http://localhost:3000'; npm.cmd run test:e2e:auth`            | 4 passed against existing Cloud admin/driver accounts: role redirects, responsive shell, admin exclusion and logout/access revocation. No business writes or credential artifacts.                                 |
| `npm.cmd run typecheck`                                                                | Passed strict TypeScript and Next route generation.                                                                                                                                                                |
| `npm.cmd run lint`                                                                     | Passed without errors/warnings.                                                                                                                                                                                    |
| `$env:VALIDATE_BUILD='1'; npm.cmd run build`                                           | Passed, separate `.next-build-check`; running development output preserved.                                                                                                                                        |
| `npm.cmd run format:check`                                                             | Passed.                                                                                                                                                                                                            |
| `node --env-file=.env.local scripts/verify-cloud-operations.mjs http://localhost:3000` | Four actual Cloud directories plus the pending-jar report, new RPC availability, real row counts, empty states, refresh and responsive layout passed at 1280px/393px; driver warehouse hidden.                     |
| `npx.cmd --no-install supabase db push --linked --dry-run`                             | Before approval: exactly 012-013 pending. After approved application: remote up to date, no pending migrations/seeds/roles.                                                                                        |
| `npx.cmd --no-install supabase db push --linked --yes`                                 | Applied exactly approved migrations 012 and 013; no seeds, roles, resets or failures.                                                                                                                              |
| Read-only Cloud preservation/catalog query                                             | Before/after account IDs, profile/customer/day/trip/stock/finance fingerprints and counts matched. Two users/profiles, one customer/trip, zero visits/invoices/payments and two existing stock movements retained. |
| `npm.cmd audit --omit=dev --json`                                                      | Zero production advisories. After Vitest update, full audit has five high development lint-chain findings, no critical findings.                                                                                   |

The operations fixture executes actual application migrations/RPCs/RLS/actions/screens in disposable PGlite PostgreSQL, with test-only Auth/PostgREST on loopback. It does not contact Cloud. Real Cloud tests are read-only apart from sign-in/out. Neither a hosted write flow nor a real merchant settlement is claimed.

After the approved Cloud application, `npm.cmd test` again passed 213/213 across 20 files. Actual Cloud operations/report and inventory browser checks passed at desktop/mobile widths; the normal Cloud Auth suite passed 4/4 after the timeout correction. Warehouse quantities remain 45 full / 0 empty / 0 carton, with the same two audited adjustments. No successful business write was performed in Cloud.

Additional checks executed: `npm.cmd install --save-dev vitest@^5.0.3 --no-fund --fetch-retries=1 --fetch-timeout=60000` completed; no existing runtime package version changed. Final `npm.cmd run test:e2e:operations -- pending-jars.spec.ts` passed all four desktop/mobile FIFO and simultaneous-driver cases after the last dashboard correction. `node --env-file=.env.local scripts/verify-cloud-inventory.mjs http://localhost:3000` verified actual Cloud 45 full / 0 empty / 0 carton warehouse quantities, two adjustment/audit entries, denied driver RPC/direct writes with nonexistent IDs, responsive display and refresh/sign-out/sign-in persistence; the Cloud inventory snapshot stayed unchanged. `git diff --check` passed. CI is configured to run operations E2E and the production dependency audit; no remote CI run is claimed.

## Remaining limitations, security and deployment assessment

- **Not ready for production sign-off:** 012-013 are applied and Cloud schema/read-only checks pass. Hosted staging write acceptance remains required; current Cloud business records were neither seeded nor changed. Active-trip creation/editing, FIFO delivery/returns and closing writes were executed against disposable PostgreSQL, not against Cloud.
- **Independent connection races remain unverified:** PGlite uses one database connection and the test provider serializes SQL. Two-browser simultaneous request tests passed, but staging must exercise last-stock loading, overlapping visit/submit/close, same-key retries, competing payments and refill/load with independent connections. No native PostgreSQL server was available and production test writes were not authorized.
- **Five high development advisories remain:** `braces`/`micromatch`/`fast-glob` through the current Next ESLint chain. npm proposes a major framework-lint downgrade, which was not forced. Resolve via a compatible upstream fix before tooling security sign-off; runtime audit is clean. Vite also emits a non-failing warning about a future native config-loader default; the current runner works.
- Confirm Cloud public signup/private staff provisioning settings; the older Cloud setup report recorded signup enabled. This audit did not change Auth settings. Account role assignment is still server-owned and tested. Recheck recovery/invitation URLs and deployment HTTPS/cookies/secret configuration before staff onboarding.
- Legacy entries sharing an exact timestamp cannot reveal their original intra-transaction sequence; the documented deterministic FIFO tie-break preserves dates and total balances. Admin corrections are explicitly labeled with their correction dates, never presented as newly discovered original deliveries.
- Production-volume directory, customer allocation and report pagination/performance, backup/restore drills and staff training remain acceptance work. PDFs are private on-demand documents, not archived object-storage copies. Full offline sync and automatic Fonepay integration remain unconfigured.
- Client decisions remain open: anonymous ongoing jar custody/permanent jar sales; detailed deposit/refund amounts/offsets; tax/PAN/VAT and accountant-approved printing; price overrides/discounts; exact monthly statement/credit-limit/penalty rules; cash shortage/handover and pending-payment closing policy; overnight stock/multiple warehouses. Deposits stay configurable and tax unconfigured until confirmed.

No remaining failing application check is known within the executed coverage. The limits above are not represented as passing tests or confirmed business policies.

## Manual hosted acceptance checklist

Use an approved staging Supabase project or separately approved genuine operations. Do not manufacture production inventory or customers to run this checklist.

1. Cloud migration application, role/directory checks and baseline comparison are complete. Repeat these read-only checks after deployment and confirm staging history includes 012-013 before operational acceptance.
2. Admin creates an eligible trip with driver/vehicle only and loads an approved 80 jars. Warehouse deduction and vehicle increment must agree. Driver cannot load/adjust stock or operate another driver's trip.
3. Driver starts the trip, searches an existing customer and creates another inline. Set quantities before adding/editing; they must survive. Confirm the new creator/contact is visible to admin and duplicate detection asks for explicit separate-customer confirmation.
4. Record 20 + 25 existing + 10 walk-in equal exchange + 15 repeat. Collect independently valid empties. Ten full jars remain; 11 must fail with no extra stock, finance, custody or audit rows. Submit physical counts; warehouse only changes after admin verification.
5. On a separate approved case record 20/15 then 10/12: pending 5 then 3, dated to the second delivery. Collect 3 without a sale: no new invoice, zero pending, unchanged financial credit and increased vehicle empties. Verify FIFO history and admin reports after refresh/logout.
6. Check monthly arrangement/customer price, cash/partial/unpaid/mixed receipts, previous-credit collection and explicit deposit receipt/refund. Download invoice/payment/deposit PDFs. Old credit collected today must not increase today's sales; pending Fonepay must not reduce recognized receivables or count as confirmed collections.
7. Admin independently reconciles or rejects Fonepay using genuine evidence; no automatic provider claim. Verify balanced finance journals, allocation capacity and immutable corrections. Complete returned-stock verification, refill eligible empties and quarantine damaged jars separately.
8. Begin manual close at any valid time; posting freezes. Confirm actual cash/checks, close once and download archive PDF/CSV. Open the next day: stock, credit, deposits and original pending dates carry, daily counters start at zero, prior archive remains unchanged after later returns/corrections.
9. Run two independent staging connections/browsers concurrently on last available stock, shared-customer returns/payments, duplicate requests and close versus posting. Assert one winner or safe serialized results, no negatives/duplicates/partial journals, no deadlocks left open and no cross-driver access.
10. Complete production-volume checks, dependency remediation, restore drill, Cloud Auth/deployment review and warehouse staff acceptance before deployment approval.

## Files changed

- SQL: the two reviewed and applied migrations; `scripts/sql/cloud-driver-workflow-readonly.sql`; expanded read-only `scripts/verify-cloud-operations.mjs` checks.
- Domain/server: `src/domain/auth/roles.ts`, `src/domain/operations/{commands,types,customer-context,pending-jars}.ts`, `src/domain/business-days/{types,reports}.ts`, `src/data-access/{operations,pending-jars}.ts`, `src/services/{operations,pending-jars}.ts`, `src/app/operations-actions.ts`.
- Screens: `src/app/driver/home/page.tsx`, `src/app/admin/customers/{page,[id]/page}.tsx`, `src/app/admin/reports/page.tsx`.
- Components: `delivery-customers`, `pending-jars`, `finance-payment`, `operation-form`, `trip-forms`, `trip-summary`, `day-report`.
- Tests: new driver/FIFO integration and desktop/mobile workflows; pending service guards; existing operation/finance/closing fixtures, command/service/role tests and test provider updated to the confirmed requirements.
- Tooling/docs: `package.json`/lockfile (development Vitest only), Playwright output directories/Cloud Auth deadlines, `tsconfig.json`, CI operations/runtime-audit checks, README, authoritative core specification updates, this report and driver workflow report. Old implementation reports retain their historical dated results; this report is the current status.

No existing migration, environment file, Auth user setup script or runtime dependency was changed.
