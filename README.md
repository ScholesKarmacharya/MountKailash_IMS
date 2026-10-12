# Mount Kailash Water Distribution Management System

Application through Sprint 4 with Sprint 6 integration, driver inventory/sales workspace and dated FIFO pending-jar tracking (2026-10-12). Cloud migrations 001-014 are verified applied, including the explicitly approved driver/FIFO/workspace migrations. See [driver inventory acceptance and Cloud verification](docs/DRIVER_INVENTORY_WORKSPACE.md), [Sprint 6 validation](docs/SPRINT_6_IMPLEMENTATION.md) and [driver workflow changes](docs/DRIVER_WORKFLOW_IMPLEMENTATION.md). Existing accounts and business data are preserved; hosted operational write acceptance remains outstanding.

English/Nepali localization and the Bikram Sambat business calendar are implemented. EN/ने switches immediately without losing drafts; preferences belong to each Supabase Auth user (admin default English, driver default Nepali). Both languages use BS dates. See [implementation, tests, supported dates and manual acceptance](docs/BILINGUAL_BS_CALENDAR.md). No SQL migration or environment change is needed.

Driver New Delivery now uses **Paid / Credit**. Paid requires the exact invoice total; Credit requires a registered customer and records no collection. Admin advanced payments and previous-credit recovery remain available. The additive validation migration `202610120015_driver_payment_ui.sql` is pending Cloud approval/application; deploy it before using the updated form. See [payment behavior, safety review and acceptance checklist](docs/DRIVER_PAYMENT_UI.md).

## Goal

Track 20L full jars, collected empty jars, water-bottle cartons, multiple drivers and vehicles, repeated customer visits, trip reconciliation, refilling, customer deposits, monthly credit, payments, invoices, and manually closed business days.

## Read in order

1. `docs/PRD.md`
2. `docs/BUSINESS_RULES.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DATABASE.md`
5. `docs/SECURITY.md`
6. `docs/DESIGN.md`
7. `docs/TASKS.md`
8. `docs/TEST_PLAN.md`
9. `docs/OPEN_QUESTIONS.md`
10. `CURSOR_START_PROMPT.md`

## Initial stack

Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase Auth + PostgreSQL, SQL migrations, Vitest, Playwright, Vercel. Enforce authorization on server and in the database.

## Operating principles

- Never overwrite audit history or reset inventory on day closing.
- Distinguish physical jars and balances from revenue, credit and refundable deposits.
- Driver trip submission is **not** admin reconciliation approval.
- Support multiple customer visits per trip and multiple trips per day.
- Only admin may manually adjust stock, approve reconciliations, or close a business day.
- Daily closing is manual, generally operations are 7 AM to 10 PM but no automatic cutoff.
- Payments collected today on prior credit are **today's collections**, not today's sales.
- Fonepay auto-verification is contingent on official merchant integration approval; do not simulate verification in production.

## Scope caution

The unanswered business questions in `docs/OPEN_QUESTIONS.md` have conservative defaults marked **provisional**. Do not silently lock them into irreversible schema or workflows.

## Install and start

For an already-linked **Supabase Cloud** project, follow [Cloud setup and login](docs/SUPABASE_CLOUD_SETUP.md). Cloud does not require Docker or a database reset. The instructions below are for disposable local Supabase development.

Use Node.js 22.13+ (or Node 24 LTS), npm and Docker Desktop for local Supabase.

```sh
npm ci
cp .env.example .env.local
npx supabase start
npx supabase db reset
npx supabase status
```

On PowerShell, use `Copy-Item .env.example .env.local` and `npm.cmd` / `npx.cmd` if script execution policy blocks npm.ps1. Run the CLI from this root. `db reset` destroys **local** database data; use only on the disposable development database. Checked-in SQL lives in `supabase/migrations`; demo data is not automatically seeded by reset.

Fill `.env.local` with local status output:

| Variable                               | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Local API URL, normally http://127.0.0.1:54321            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key (local legacy anon key also works) |
| `SUPABASE_SERVICE_ROLE_KEY`            | Local elevated key, used **only by demo seed script**     |
| `DEMO_ADMIN_PASSWORD`                  | Your unique local admin password, at least 12 characters  |
| `DEMO_DRIVER_PASSWORD`                 | Your unique local driver password, at least 12 characters |

Never commit `.env.local`, use real production credentials for demo seed, or expose a service-role/secret key with `NEXT_PUBLIC_`. The app never reads the service-role variable. Public signup is disabled, and users cannot assign their own role.

```sh
npm run seed:demo
npm run dev
```

Open http://localhost:3000. Seeded emails are `admin@mount-kailash.example` and `driver@mount-kailash.example`; use the passwords you supplied. The seed refuses non-loopback hosts, creates labeled DEMO profiles, preserves existing passwords on reruns, and creates no fake operational balances. With no Supabase configuration, sign-in shows an honest setup state and protected routes remain inaccessible.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
npx playwright install --no-shell chromium
npm run test:e2e
npx supabase test db
npm run test:e2e:auth
```

Vitest covers role permissions, server guards, and Nepal midnight behavior. Playwright covers unconfigured sign-in and direct protected-route navigation on desktop/mobile; it deliberately launches a server with blank Supabase settings. SQL pgTAP tests cover RLS, denied direct writes and active-day uniqueness; Docker/local Supabase is required. `test:e2e:auth` loads `.env.local`, starts on port 3001 and tests real seeded sign-in, redirects, driver exclusion, mobile layout and sign-out. Run it on a fresh seeded local database with no active business day. It does not capture credential-bearing traces or screenshots. Disabled-account acceptance steps are in `docs/SPRINT_0_IMPLEMENTATION.md`. Run formatting with `npm run format` for application files; retain the specification pack's original content.

## Source layout and scope

`src/domain` holds pure policy; `src/data-access` holds server-only queries; `src/services` owns authorization and orchestration; `src/app` holds routes and server actions; `src/components/ui` holds shadcn-compatible primitives. Authenticated pages use dynamic cookie-backed identity checks and no shared user-data cache. Tailwind tokens and shadcn generator aliases are configured in `components.json`.

Sprint 0 migrates `profiles` and `business_days`; subsequent sprints add warehouse, trips, finance and closing journals. Direct table writes remain blocked. Authenticated RPCs validate identity, permissions and day/trip status and commit operations atomically. A provisional single operating unit permits one OPEN/CLOSING_REVIEW day. Admin-only daily closing and immutable snapshots are supplied by Sprint 4. The app uses the caller's cookie-backed session, never a service-role key. Missing schema produces a setup state, never fake zero stock or finance.

`npm test` also runs isolated real PostgreSQL migration/RPC/RLS tests using PGlite, with provider identities stubbed and application SQL unchanged. These tests do not need Docker, Cloud credentials or an environment file. They do not replace multi-connection race testing on staging or live Supabase acceptance after migration approval. Supabase pgTAP coverage is in `supabase/tests/sprint1.test.sql` for a disposable database with no active day; never reset Cloud to run tests.

## Sprint 2 operations

Customer, driver, vehicle, trip, delivery and physical return workflows are implemented. Read [Sprint 2 migration review, provisional assumptions and browser acceptance](docs/SPRINT_2_IMPLEMENTATION.md) before applying the three forward-only migrations to Cloud. No new environment variables, database reset or automatic sample stock are required.

See the [Sprint 2 integration audit](docs/SPRINT_2_INTEGRATION_AUDIT.md) for the executed trip cycle, retry/rollback/authorization results, UI fixes and staging checks required before operational sign-off.

`npm run test:e2e:operations` runs the real screens and application SQL against disposable PostgreSQL with a test-only Auth/PostgREST adapter, using separate loopback ports and build output. It does not modify the connected Cloud project. Existing Cloud login verification reuses the running development server; do not launch two Next dev instances against the same build directory.

## Sprint 3 finance

The current [driver inventory and simple-round workspace](docs/DRIVER_INVENTORY_WORKSPACE.md) adds dedicated mobile stock, delivery, customers, pending jars, sales history and warehouse-return pages while retaining the existing stock/finance transactions. Its forward-only migration `202610120014_driver_inventory_workspace.sql` adds ordinary contact fields, projected lookup for waiting drivers and tighter private-note access. Migration 014 was explicitly approved, applied and verified in Cloud on 2026-10-12; all six driver pages and four admin directories passed actual desktop/mobile read-only browser checks. The earlier dry run was current through 014; the new Paid/Credit form requires the separately reviewed 015 migration above. No new credentials, Docker or sample business data are needed.

Read [Sprint 3 implementation, migration review and manual acceptance](docs/SPRINT_3_IMPLEMENTATION.md). New trip visits atomically issue sales/invoices with approved price snapshots and post cash, pending Fonepay, allocations, credit and explicit deposits. Admin Payments, Customer credit and Billing settings use real Supabase RPC data. Invoice/receipt PDFs are private, generated on demand and support English/Nepali with bundled fonts.

Cloud migrations 006–008 were verified applied on 2026-10-12; the original Sprint 3 implementation report records the earlier pending state. No new secrets, Docker or sample records are needed. Existing Sprint 2 payment intents are preserved without automatic financial backfill. Keep tax unconfigured until confirmed and configure manual deposit arrangements per customer.

Run `npm.cmd test` and `npm.cmd run test:e2e:operations` for disposable PostgreSQL and actual desktop/mobile finance/trip screens. These commands do not contact Cloud or read real passwords. The browser adapter is only a test helper. For read-only Cloud regression with the running development server, use `node --env-file=.env.local scripts/verify-cloud-operations.mjs`; it logs no credentials.

## Sprint 4 business days and reports

Cloud migrations 009-011 are verified applied. Read [Sprint 4 migration review and manual acceptance](docs/SPRINT_4_IMPLEMENTATION.md); its original verification records the earlier pending state. `/admin/daily-close` checks actual trips, physical balances and finance journals, freezes posting during review, requires an explicit net cash handover and confirmations, and atomically archives the close. `/admin/reports` filters Nepal business dates and exports private PDF/Excel-compatible CSV reports. `/admin/refilling` records completed one-for-one refills and quarantines damaged jars separately.

Closing/opening never resets warehouse stock, jar custody, credit, deposits or journals. Earlier-day invoice corrections, receipt reversals and explicitly linked stock corrections append on a new OPEN day; the original archive remains version 1 with subsequent amendments displayed separately. Pending Fonepay never counts as verified collections. The conservative cash and pending-payment closing controls are marked provisional in the Sprint 4 report.

```powershell
npm.cmd test
npm.cmd run test:e2e:operations
npx.cmd --no-install supabase db push --linked --dry-run
```

The first two commands exercise disposable PostgreSQL only. The third checks Cloud history without applying SQL. No Docker, seed or environment changes are needed. The existing Cloud development server remains at http://localhost:3000.

**Next work:** complete hosted staging acceptance, simultaneous-connection close/posting tests, backup/restore verification and operational training. Cloud migrations 012-013 are applied and read-only connected checks pass. Automatic Fonepay still requires official merchant access; deposits remain explicitly configurable and tax unconfigured until confirmed.

## English/Nepali and BS dates

Use the global EN/ने selector after login. History, inventory, trip, pending-jar, payment, invoice, refilling and credit filters provide BS year/month/day pickers and period presets. Credit statements support actual BS months and custom periods. PDFs follow the user's language; Excel-compatible CSV preserves exact ASCII numbers and canonical date columns. Customer-entered content is preserved.

`@inicrea/bikram-sambat-core@0.1.3` supports BS 1975–2100 (canonical 1918-04-13 through 2044-04-12). Dates outside its supported interval display an honest unavailable message. Supabase retains canonical `date`/`timestamptz`, Nepal timezone boundaries and manually managed business-day sessions.

Run `npm.cmd test` for conversion/coverage/permission/financial regressions and `npm.cmd run test:e2e:operations` for real bilingual desktop/mobile workflows on disposable PostgreSQL. With the existing Cloud development server running, `node --env-file=.env.local scripts/verify-cloud-localization.mjs http://localhost:3000` checks actual pages and monthly exports without business or preference writes. Optional `--save-current-preference` saves only each existing demo account's current language and tests reload/login persistence. It does not seed business data or log credentials. Full acceptance steps and limitations are in the linked localization report.
