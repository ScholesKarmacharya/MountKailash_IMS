# Implementation Backlog

Do work in order, protect `main`, use feature branches and review migrations. Each task must add tests and an acceptance demonstration before marked complete.

## Sprint 0: Scaffold
- [ ] S0.1 Initialize Next.js App Router + TS, Tailwind, lint, formatter, tests, env example.
- [ ] S0.2 Configure Supabase local dev, migrations and seed demo accounts (no real passwords committed).
- [ ] S0.3 Responsive shell for `/admin` and `/driver`, loading/error boundaries.
- [ ] S0.4 Auth login/log out and role-aware route guards; verify server enforcement.
- [ ] S0.5 Design system: forms, numeric entry, empty/loading/error states.

## Sprint 1: Master data & stock
- [ ] S1.1 Products, customer identities and configurable default/customer prices.
- [ ] S1.2 Warehouse/vehicle stock balance schema and append-only movement journal.
- [ ] S1.3 Atomic transfer service and negative-stock/idempotency tests.
- [ ] S1.4 Admin vehicle management and registered customer CRUD.
- [ ] S1.5 Admin-only reason-coded stock adjustments with audit logs.
- [ ] S1.6 Warehouse refill batches and damaged jar accounting.

## Sprint 2: Trips and jar custody
- [ ] S2.1 Create trips, assign driver/vehicle, approve loads.
- [ ] S2.2 Driver assigned trip screens and repeated visits to same customer.
- [ ] S2.3 Post deliveries and empty return transactions atomically.
- [ ] S2.4 Customer outstanding jar ledger with no-deposit and deposit terms.
- [ ] S2.5 Driver submits declaration, admin verifies return and exceptions, closes trip.

## Sprint 3: Finance
- [ ] S3.1 Snapshot prices on sale line items; issue invoice numbers.
- [ ] S3.2 Separate money receivable ledger and jar deposit liability ledger.
- [ ] S3.3 Cash/Fonepay manual records, partial payments and allocation across invoices.
- [ ] S3.4 Collect prior-month debt during new trip without increasing today's sales.
- [ ] S3.5 Printable receipts and PDF generation, private document storage.
- [ ] S3.6 Fonepay integration adapter placeholder; implement verification only with approved access/docs.

## Sprint 4: Business days and reports
- [ ] S4.1 Open/close business days manually, require admin, handle across midnight.
- [ ] S4.2 Closing blockers and reconciliation dashboard.
- [ ] S4.3 Atomic closing snapshot and immutable archive; carry forward stock/credit/deposits.
- [ ] S4.4 Trip/day/month/customer/driver reports and PDFs/CSVs.
- [ ] S4.5 Admin correction/reversal flow with immutable audit trail.

## Sprint 5: QA, security and deploy
- [ ] S5.1 E2E tests for multi-trip and driver-to-admin approval.
- [ ] S5.2 RLS/authorization tests and duplicate submission race tests.
- [ ] S5.3 Operational training, staging UAT with client, backup/restore test.
- [ ] S5.4 Vercel deployment, env/secret documentation, admin handover.

## Definition of done
Tests pass, no outstanding negative stock or double-spend issue, all finance amounts computed server side, audit logs present, role permissions verified, mobile workflow usable, and stakeholder acceptance documented.

## Sprint 6: system integration and UX (2026-10-12)
- [x] Connected driver-selected customer workflow, inline contacts, backend restrictions and migration upgrade preservation tests.
- [x] FIFO pending jars/original dates, return-only posting, driver dashboard and admin reports implemented against actual PostgreSQL RPCs.
- [x] Final automated validation and documented results: see `SPRINT_6_IMPLEMENTATION.md`.
- [x] Explicitly approve/apply Cloud migrations 012-013; verify catalog/grants, record preservation and connected read-only desktop/mobile flows.
- [ ] Execute hosted staging write acceptance for customer creation, delivery/FIFO, return-only posting and closing.
- [ ] Multi-connection contention/races, production-volume checks, restore drill and staff acceptance before deployment.
