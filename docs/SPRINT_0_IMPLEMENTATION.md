# Sprint 0 implementation notes

Only scaffold, identity and read-only business-day schema are implemented. Original requirement documents remain authoritative.

## Boundaries

- `src/domain`: pure role policy and Nepal clock display; no browser or database dependencies.
- `src/data-access`: server-only authenticated Supabase queries, with RLS.
- `src/services`: server-owned authorization and application orchestration. Recheck permission here even when a layout already checks it; layouts alone do not secure future actions.
- `src/app`: route composition and authenticated server actions. No service-role client is used by the application.
- `src/components/ui`: editable shadcn-style Radix/CVA primitives and shared tokens, configured in `components.json`.

Auth uses verified `getUser()` identity and queries current profile on the server. Role metadata in tokens or signup payloads is never authoritative. Cookies refresh in Next.js Proxy. Disabled profiles cannot enter workspaces. Drivers cannot enter admin services. Admin may view driver shell according to the confirmed role matrix. Profile reads include self (including inactive status) and active admin; only active admins can read business days. Authenticated roles have no INSERT/UPDATE/DELETE permissions on either table. Provisioning stays in trusted local seed tooling until account-management operations are implemented.

## Provisional decisions

The active-day uniqueness index assumes **one operating unit**, a provisional MVP approach from OPEN_QUESTIONS. It includes both OPEN and CLOSING_REVIEW. Extend to unit-scoped uniqueness if multiple warehouses are confirmed. There is no universal deposit, tax, carton size, price override, carryover, or credit-limit rule in code. No business-day mutation endpoint exists in Sprint 0.

## Subsequent migration plan

Sprint 1 adds product/customer/price/location/vehicle identities, then append-only stock movements and balances. Transfer RPCs must atomically validate active account, business-day status, nonnegative locked balances and actor/operation-scoped idempotency, append an audit event, and commit all changes together. Restrict direct journal writes and corrections to validated server-owned operations. Monetary values use NUMERIC, never JavaScript floating-point arithmetic.

Sprint 2 adds trip state and assignments, multiple trips and repeated visits without `(trip_id, customer_id)` uniqueness. Driver declarations do not return stock until admin reconciliation. Refilling remains a separate warehouse transfer. Sprint 3 adds immutable sales, payment allocations, deposit liabilities and receivable journals after client/accountant decisions. Sprint 4 supplies transactional manual close and snapshots. All operations carry explicit business_day_id, so crossing Nepal midnight never changes attribution. Closed-day corrections append reversal/audit events; neither closing nor opening resets persistent balances.

## Acceptance demonstration

1. Without env configuration, `/sign-in` displays setup instructions; direct admin/driver links redirect there.
2. With local Supabase migrated and demo seed run, sign in using each documented demo email and your supplied password; each reaches its role home. Sign out returns to sign-in.
3. As driver, directly open `/admin/dashboard`; it redirects to driver home. Change that profile to inactive in trusted local Studio, then reload a protected page; access is denied.
4. Admin sees no open day and no invented totals. Driver sees not-yet-live assigned trip and disabled new-visit action. Both shells adapt to narrow viewports and expose keyboard navigation.
5. Database negative tests live in `supabase/tests/sprint0.test.sql`; run with `npx supabase test db` after reset.

Automated tests do not yet represent ERP scenarios T01–T22 as implemented. Authenticated browser flows require running local Supabase and seeded credentials. Supabase Auth login rate limiting is configured locally; review production Auth rate-limit settings before deployment. This scaffold is not a production deployment.
