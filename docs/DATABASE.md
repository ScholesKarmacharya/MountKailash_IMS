# Logical Database Schema v0.1

All tables: UUID primary key, `created_at timestamptz`, optional `updated_at`, with foreign keys and appropriate index/unique constraints. Business transactions store `business_day_id` and `actor_user_id`. Exclude sensitive user credentials from app tables; use auth provider identity.

## Core tables
| Table | Notable columns / relationships |
|---|---|
| `profiles` | `id -> auth.users`, name, role ADMIN/DRIVER, is_active |
| `business_days` | id, date_label, opened_at, opened_by, status OPEN/CLOSING_REVIEW/CLOSED, closed_at/by, version |
| `vehicles` | id, plate_number UNIQUE, active |
| `products` | id, sku UNIQUE, name, kind FULL_JAR/BOTTLE_CARTON, unit, default_price numeric, active |
| `customers` | id, name, phone, type REGISTERED/WALK_IN, credit_terms, active, deposit_policy |
| `customer_prices` | customer_id, product_id, price numeric, active_from/to |
| `stock_locations` | id, kind WAREHOUSE/VEHICLE/CUSTOMER/DAMAGE, vehicle_id/customer_id nullable, unique identity constraint |
| `inventory_balances` | location_id, stock_kind FULL_JAR/EMPTY_JAR/BOTTLE_CARTON, quantity integer, version, unique(location,kind) |
| `stock_movements` | id, from/to location & stock_kind, quantity, type, business_day_id, reference_type/id, actor, idempotency_key UNIQUE |
| `trips` | id, trip_number, business_day_id, driver_id, vehicle_id, status, started/submitted/approved_at, approved_by |
| `trip_load_items` | trip_id, stock_kind, qty, movement_id |
| `trip_visits` | id, trip_id, customer_id nullable, walk_in_name/contact, visited_at, notes |
| `sales` | id, trip_visit_id, invoice_no UNIQUE, customer_id nullable, subtotal/tax/total, status, issued_at |
| `sale_items` | sale_id, product_id, quantity, unit_price_snapshot, line_total |
| `jar_custody_entries` | id, customer_id, visit_id, delta, reason, actor, related_movement_id, resulting_balance or derivable ledger |
| `deposit_entries` | id, customer_id, sale_id nullable, amount_signed numeric, type COLLECT/REFUND/ADJUST, payment_id nullable |
| `payments` | id, customer_id, trip_visit_id nullable, business_day_id, amount, method CASH/FONEPAY, verification_state, external_reference nullable, actor, idempotency_key UNIQUE |
| `payment_allocations` | payment_id, sale_id, allocated_amount, UNIQUE(payment_id,sale_id) |
| `trip_return_declarations` | trip_id, stock_kind, declared_qty, submitted_at, UNIQUE(trip_id,stock_kind) |
| `trip_return_verified` | trip_id, stock_kind, verified_qty, movement_id, approved_by, UNIQUE(trip_id,stock_kind) |
| `trip_discrepancies` | id, trip_id, stock_kind, expected, actual, resolution, status, approved_by |
| `refill_batches` | id, business_day_id, empty_qty, successful_full_qty, rejected_qty, actor, note, posted_at |
| `stock_adjustments` | id, location, kind, delta, reason, approved_by, stock_movement_id |
| `closing_snapshots` | business_day_id, version, totals_json, stock_json, closed_at, closed_by, amendment_reason nullable |
| `audit_events` | id, actor, action, entity, entity_id, before_json/after_json, timestamp, reason |
| `documents` | id, sale_id/closing_id, storage_key, content_hash, document_type, created_at |

## Integrity constraints
- All counts nonnegative; journal move quantity strictly positive. A manual adjustment stores signed delta but executes a validated move.
- `sale_items.quantity > 0`, `unit_price_snapshot >= 0` and all totals calculated server side.
- Payment allocation sum per payment <= verified/recognized payment amount; invoice allocation sum <= outstanding invoice amount.
- Customer jar custody is a signed journal with validation against negative ending custody unless admin correction.
- A driver trip belongs to one business day and one driver; a visit belongs to exactly one trip; no unique `(trip_id, customer_id)` restriction.
- `business_days` permits only one OPEN/CLOSING_REVIEW row per warehouse in MVP (enforced unique partial index or transaction lock).
- All finance/inventory ledger tables append-only for normal roles; corrections represented by reversing entries and audit events.
- Retry-safe idempotency key scoped by actor/operation; unique external gateway transaction reference for verified payment.

## Inventory transfer illustration
Initial vehicle load: WAREHOUSE/FULL_JAR -100; VEHICLE/FULL_JAR +100.
Deliver 80: VEHICLE/FULL_JAR -80; CUSTOMER custody +80.
Collect 65 empties: CUSTOMER custody -65; VEHICLE/EMPTY_JAR +65.
Return and verify: VEHICLE/FULL_JAR -20; WAREHOUSE/FULL_JAR +20; VEHICLE/EMPTY_JAR -65; WAREHOUSE/EMPTY_JAR +65.
Refill 65: WAREHOUSE/EMPTY_JAR -65; WAREHOUSE/FULL_JAR +65.

**Design note:** Customer custody is not exclusively a physical `EMPTY_JAR` inventory balance because jars at customer sites could be in use/full/empty; report custody as a separate ledger to prevent false classification. The customer stock location may be omitted for jars in implementation if custody ledger suffices, but never double-count both as available.

## Indexes
`trips(business_day_id,driver_id,status)`, `trip_visits(trip_id,visited_at)`, `sales(issued_at,customer_id)`, `payments(business_day_id,customer_id)`, `stock_movements(reference_type,reference_id)`, `jar_custody_entries(customer_id,created_at)`, `audit_events(entity,entity_id,created_at)`.

## Implementation checkpoint
Translate this **logical** draft to real migrations only after settling deposit treatment and invoice tax fields. Add tests for trigger/RPC transactions and constraints before enabling actual writes.

## Confirmed implementation additions (2026-10-12)
Migration 012 adds nullable `customers.created_by` stamped by an insert trigger, contact/directory/context RPCs and checked trip/finance wrappers. Existing customers retain unknown/null creator. Historical `trip_customers` remain; new associations identify customers served/collected, never allowed destinations.

Migration 013 adds immutable `custody_event_order` and `return_only_visits`. FIFO lots/allocations derive from existing signed custody entries and order metadata. Equal-timestamp legacy ordering was not stored: positives precede returns with UUID tie-break, original timestamps unchanged. New entries capture exact posting order. No account, inventory, sales, payment, custody journal or archive is rewritten. See Sprint 6 migration review before Cloud application.

Migration 014 adds ordinary contact-person/type/delivery-notes fields and guarded contact/pending-directory RPCs. Raw customer SELECT is admin-only to protect private notes; active drivers use the projected directory even while waiting for loading. Operational writes and financial context still require the driver's own ACTIVE trip on an OPEN day. Legacy contact RPC retry payloads and all stock/finance/custody journals remain compatible. See `DRIVER_INVENTORY_WORKSPACE.md` for review and executed acceptance.
