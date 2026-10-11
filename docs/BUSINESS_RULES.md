# Business Rules and State Transitions

## 1. Basic transactions
- Product units are integers >= 0. Financial values use `NUMERIC(14,2)` with server-side currency rules; store NPR and never use floating point for ledger arithmetic.
- Every stock change must have an immutable movement event: actor, timestamp, business_day_id, product/container type, source location, destination location, quantity, movement_type, related trip/visit/refill/adjustment and idempotency key.
- **One action, one atomic DB transaction:** record movement(s), related sale/payment/return and resulting balances together.
- No negative warehouse/vehicle available stock. Handle physically missing stock through an explicit variance/damage workflow, not negative quantity.

## 2. Trip loading and delivery
1. Admin creates trip for one driver, one vehicle, one business day, and approves load quantities. Loading transfers stock from warehouse to vehicle.
2. A driver can record unlimited visits for a trip, including repeated visits to a customer; never enforce unique(trip_id, customer_id).
3. A visit can have multiple items; full 20L jar deliveries and empty collections are separate entries. A walk-in can be served with basic identifying details; for repeat credit, deposits or jar custody, require a registered customer account.
4. Delivering a full 20L jar transfers it from vehicle-full to customer custody (physical position represented through customer jar ledger). Returning an empty transfers custody from customer to vehicle-empty. Sale value is based on delivered water units, not difference between full and empty jars.
5. Bottle-carton sales transfer cartons from vehicle to customer, no jar return ledger change.
6. Pricing resolved from customer-specific price if active, otherwise default price; persist actual unit price on every invoice item. Any ad hoc price override must follow explicit authorization policy (OPEN_QUESTIONS).
7. Driver submits a trip at warehouse with declared physical returns and payment totals. After submission, visit editing is locked absent admin-authorized correction.
8. Admin compares expected vehicle remaining balances against actual counts. Mark discrepancy and resolve; approve only when balanced or approved adjustment is recorded. Stock is physically returned via admin-confirmed reconciliation, not on driver declaration alone.
9. Drivers may execute multiple approved trips during one open business day. Reuse previously returned/refilled jars only once warehouse stock is available.

## 3. Jar custody and deposits
- For registered customer C: **closing jars held = opening jars held + full jars delivered - empty jars collected - documented jar writeoffs/returns**.
- Do not allow an unexplained negative customer custody balance; an exceptional return needs admin review.
- If customer gives a deposit for a jar, record customer refundable deposit balance separately from sale and cash collection. Refunds must be explicit and auditable.
- No-deposit customers can still have outstanding jar custody balance; price/contract terms may differ by customer.
- Different customer deposit terms and refund conditions remain configurable; no universal deposit pricing assumption.

## 4. Refilling and damaged jars
- Returning empty jars updates **warehouse empty** after trip acceptance. Refilling must be an explicit admin-recorded operation, transferring eligible quantity from warehouse-empty to warehouse-full.
- Rejected/damaged jars move into a separate warehouse-damaged status; do not automatically refill them.
- Admin adjustments must require reason, actor, before/after, and supporting notes; **normal** loading, sales, returning and refilling are workflow movements, not manual adjustments.

## 5. Sales, credit, payment
- Sale invoices are immutable after posting; corrections use void/reversal or credit-note flows with audit trail.
- Credit is an outstanding balance, **not** a payment method. Payment methods: cash, Fonepay, and configurable others; status: unpaid, partial or paid.
- Payments can be applied to one or multiple invoices. An old-credit payment at a delivery increases collections on current day and reduces receivables, without increasing current-day sales.
- Monthly due dates can be configured per customer. Exact month-end statements and aging rules are provisional.
- Fonepay is **manual/pending verification** unless sanctioned merchant APIs and trustworthy server-side payment verification are provisioned. Receipt reference or screenshot alone is not automatic proof. Prevent duplicate gateway event processing.

## 6. Business-day lifecycle
- Business day: OPEN -> CLOSING_REVIEW -> CLOSED. Only admin can initiate/confirm closing.
- Operating time is typically 07:00-22:00 Nepal local time, but **no fixed open/close timer**. Assign transactions to the current business day, not simply calendar date; business day may cross midnight.
- Closing checklist: every trip reconciled or explicitly resolved; all collections checked; cash/Fonepay reconciliation recorded; stock variance resolved; report snapshot generated.
- CLOSED days immutable to normal edits. Any correction requires admin authorization, reversal/new correction event, reason and a visible amended report/version.
- Starting another day resets only **daily counters and active work queues**. Warehouse stock, jars with customers, deposits, receivables, and entire audit history carry forward.
- Do not permit two simultaneously OPEN business days for same operating unit in MVP. If old day remains open on next calendar morning, prominently warn admin.

## 7. Concurrent use
- Use database transactions/locking or compare-and-swap versions for competing inventory reservations and trip approvals. Enforce server-validated idempotency keys for driver retries.
- Support intermittent internet by clear submission confirmation, unsent data warnings and retry-safe APIs; full offline entry/sync is not committed until business confirms needs.
