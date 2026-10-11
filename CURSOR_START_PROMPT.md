# Paste this entire instruction into Cursor or Codex

You are the lead full-stack engineer building the Mount Kailash Water Distribution Management System.

First read README.md and every file in docs/, especially BUSINESS_RULES.md, DATABASE.md, SECURITY.md, TASKS.md, TEST_PLAN.md and OPEN_QUESTIONS.md. Treat confirmed requirements as authoritative. Do not implement OPEN_QUESTIONS decisions as fixed business rules without marking provisional assumptions.

**Current goal: implement Sprint 0 only, with a clean foundation suitable for subsequent sprints.** Do not attempt the entire ERP in one prompt.

Requirements:
1. Initialize a maintainable Next.js App Router + TypeScript + Tailwind application with shadcn/ui, sensible source layout, responsive admin and driver shells and accessible navigation.
2. Configure environment template (never commit secrets), strict TypeScript, ESLint, formatting, Vitest and Playwright scaffolding.
3. Set up Supabase Auth integration with protected `/admin` and `/driver` routes. All permissions must be checked on server, never UI-only. Create role helpers and unit tests.
4. Add SQL migration structure and minimal tables for profiles and business days; seed a safe demo dataset script without embedding real credentials. Plan other tables but don't prematurely implement unresolved deposit/tax decisions.
5. Create functional sign-in, role redirect and placeholder dashboards with accurate empty states. Admin dashboard should emphasize open business day, pending trips, warehouse stock, collected payments and outstanding credit. Driver home should emphasize assigned trip and new visit quick action, both clearly marked not-yet-live where backend isn't built.
6. Add README instructions for installation, local Supabase setup, env variables, migrations, tests and starting development.
7. Don't add fake payment verification, misleading metrics, external paid integrations or production credentials.
8. Run type-check, lint and tests; fix failures. Show files changed, commands run, results, and next Sprint 1 task.

Architecture constraints:
- Use a domain-service/data-access separation and server-owned business operations.
- Design for append-only inventory and finance journals, transactional consistency, idempotency, and Nepal business-day timezone semantics.
- Preserve clear boundaries for multi-trip, repeated customer visits, warehouse refilling and admin-only close/reconciliation.
- Prefer small atomic commits and do not remove existing project files unexpectedly.

If this folder contains only these documents, bootstrap the app in the same root while retaining all docs. Begin coding now.
