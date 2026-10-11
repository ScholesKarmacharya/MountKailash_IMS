# Product Requirements Document (PRD)

**Product:** Mount Kailash Water Distribution Management System
**Status:** Draft v0.1, client core workflow confirmed, details pending
**Users:** Warehouse admin and multiple delivery drivers

## Problem and outcome
Today the business needs visibility into what each vehicle loaded, delivered, brought back, and collected in money, and how many jars are at the warehouse, in vehicles, and with customers. The software must provide an accurate financial and physical ledger with verifiable daily close.

## User roles
- **Admin:** Manage accounts, customers, products, standard/customer prices, vehicles, trip assignments/loading, refilling confirmations, reconcile submitted trips, inventory corrections, reports, day close/reopen corrections.
- **Driver:** Access only assigned trips, enter visits to registered or walk-in customers, record sales, full-jar exchanges, empty returns, cash/Fonepay/credit/partial payments, collect prior credit during deliveries, and submit trips. Cannot directly adjust warehouse inventory or approve their own reconciliation.

## In-scope MVP
1. Email/password account access, admin/driver roles and account disabling.
2. Products: refillable 20L water jar (units) and bottled-water carton (cartons); configurable default/customer prices.
3. Customers: registered and walk-ins; registered customers have jar, deposit and money ledgers.
4. Driver vehicle loading, trip started/ongoing/submitted/approved/exception statuses.
5. Multiple visits per trip including repeated visits to same customer; individual visit timestamps.
6. Each visit: full jars sold, cartons sold, empties collected, price overrides (authorized policy), payments, discounts if enabled, notes; deposit policy by customer.
7. Driver return declaration: unsold full jars, empty jars, unsold cartons, damaged/lost units; admin verification with discrepancy resolution.
8. Warehouse full jar / empty jar / carton stock; refilling transactions; vehicle stock; stock movement history; manually created stock adjustments by admin only.
9. Cash, Fonepay recorded manually, credit and partial settlement; customer credit ledger; repayments of old credit recorded during visits.
10. Invoice/receipt for sales and collections, printable and downloadable PDF.
11. Daily business-day open/close (admin closes manually), consolidated sales, old debt collection, payments per method, trip variances, ending stock, carryforward balances, archived reports.
12. Basic reports with filters for date/customer/driver/vehicle/trip; exports.

## Definition of each quantity
- **Water sold:** value of water/carton line items delivered in a sale, excluding refundable jar security deposit.
- **Collections:** payment amounts actually received, including collection against old debt.
- **Credit issued:** unpaid portion of a sale; balance tracks subsequent payments.
- **Full jars warehouse / vehicle:** reusable jars currently filled and available in that location.
- **Empty jars warehouse / vehicle:** reusable jars available for inspection/refilling in that location.
- **Customer outstanding jars:** custody balance; not necessarily a debt denominated in currency.
- **Deposits:** separate refundable liability, never automatically recognized as water revenue.

## Non-goals for MVP
GPS route optimization, automated production machinery integration, jar barcode/RFID per physical jar, payroll, full tax accounting, vehicle fuel/maintenance, general ERP and independent warehouse-worker accounts. May be added later.

## Acceptance outcomes
- With 100 full jars loaded, 80 delivered, 65 empties collected, the vehicle reports 20 full unsold + 65 empties on return, subject to verification.
- Admin can approve returned items; refilling 65 eligible empties moves 65 units from warehouse-empty to warehouse-full without creating new physical jars.
- Driver may make two visits to one customer in a single trip, each separately auditable, aggregated in trip/customer reports.
- Customer can use a deposit arrangement or non-deposit arrangement; water receivable and refundable deposit stay separate.
- Old credit paid during today's delivery appears in today's collections and decreases old balance without modifying previous sales.
- Only admin can approve trip reconciliation, perform direct stock correction, and close business day.
- Closing archives records; next day starts at zero daily transaction totals but retains stock, customer jar balances, deposits, and receivables.
