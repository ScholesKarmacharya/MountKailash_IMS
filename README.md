# Mount Kailash Water Distribution Management System

Specification pack, authenticated application foundation and Sprint 1 product/warehouse implementation (2026-10-11). Product and inventory screens use real Supabase data after the reviewed Sprint 1 migration is applied. Trips, payments, refilling and day closing remain future work. See [Sprint 1 implementation, migration review and testing](docs/SPRINT_1_IMPLEMENTATION.md).

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

Sprint 0 migrates `profiles` and `business_days`; Sprint 1 adds products, warehouse locations, balances, stock movements, adjustments, operation requests and audit events. Direct table writes remain blocked. Authenticated admin-only RPCs validate identity and commit inventory changes atomically. A provisional single operating unit permits one OPEN/CLOSING_REVIEW day. A minimal audited day-opening action enables stock operations; close/reconciliation remain deferred. The app uses the caller's cookie-backed session, never a service-role key. Missing Sprint 1 schema produces a setup state, never fake zero stock.

`npm test` also runs isolated real PostgreSQL migration/RPC/RLS tests using PGlite, with provider identities stubbed and application SQL unchanged. These tests do not need Docker, Cloud credentials or an environment file. They do not replace multi-connection race testing on staging or live Supabase acceptance after migration approval. Supabase pgTAP coverage is in `supabase/tests/sprint1.test.sql` for a disposable database with no active day; never reset Cloud to run tests.

## Sprint 2 operations

Customer, driver, vehicle, trip, delivery and physical return workflows are implemented. Read [Sprint 2 migration review, provisional assumptions and browser acceptance](docs/SPRINT_2_IMPLEMENTATION.md) before applying the three forward-only migrations to Cloud. No new environment variables, database reset or automatic sample stock are required.

See the [Sprint 2 integration audit](docs/SPRINT_2_INTEGRATION_AUDIT.md) for the executed trip cycle, retry/rollback/authorization results, UI fixes and staging checks required before operational sign-off.

`npm run test:e2e:operations` runs the real screens and application SQL against disposable PostgreSQL with a test-only Auth/PostgREST adapter, using separate loopback ports and build output. It does not modify the connected Cloud project. Existing Cloud login verification reuses the running development server; do not launch two Next dev instances against the same build directory.

**Next work:** Sprint 3 financial journals, credit repayments, verified collections, settlement and finance reconciliation. Product-specific customer pricing, deposits and tax need confirmed rules. Refilling/damage and daily close remain separate workflows.
