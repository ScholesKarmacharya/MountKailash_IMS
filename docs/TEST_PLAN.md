# Test Plan and Acceptance Scenarios

## Critical operational tests
**T01 Full cycle:** Admin warehouse has >= 100 full jars; loads vehicle with 100; driver delivers 80 jars, collects 65 empty jars, submits with 20 unsold full +65 empties. Admin verifies. Assert warehouse full increases by 20 at return, warehouse empty increases by 65; vehicle becomes 0/0; customer custody +15 overall. Refill all 65; warehouse empty decreases 65 and full increases 65. Combined full available from these returns 85. No jars created by trip approval alone.

**T02 Repeat visits:** Same registered customer visited twice in one trip. Both visits appear separately; customer jar balance and invoice totals include both; no uniqueness conflict.

**T03 Multi-trip:** Trip 1 approved and unloaded, refill posted, then Trip 2 loaded using valid warehouse balance. No stock allocated twice. Both roll into one business day report.

**T04 Multiple vehicles:** Two drivers attempt to load last 10 full jars at same time. Only eligible reservation commits, other receives insufficient-stock error, stock never goes negative.

**T05 Walk-in:** Allow cash walk-in without persisted customer profile if no ongoing jar custody; require registered identity for tracked jar deposit/credit per provisional rule.

**T06 Customer prices:** Default price and negotiated customer price apply correctly; invoice line preserves price even after catalog update.

**T07 Monthly credit:** Sale on day A on credit, payment on day B during delivery. Day A sales do not change, day B collections increase, customer receivable decreases. Partial collections allocate accurately.

**T08 Deposits:** Collect jar refundable deposit separately; verify water sales not inflated. Refund is separately recorded and journaled.

**T09 Payment methods:** Cash vs Fonepay recorded correctly; manual Fonepay is never mislabeled gateway verified. Replayed payment callback with same external transaction reference does not duplicate payment.

**T10 Driver return discrepancy:** Driver declares 20 full returns but admin counts 19. Trip cannot approve as balanced; discrepancy must be resolved with reason and audit event.

**T11 Day close:** Admin closes at 11:30 PM, no 10 PM auto close. Closed date retains all sales and deposits, opening next day has zero new-day sales, carries forward customer credit and warehouse stock. Admin cannot close with unresolved trip without explicit authorized exception.

**T12 Midnight crossing:** Active business day can cross midnight; transaction remains attributed to assigned business_day_id, regardless of calendar date.

## Security tests
**T13** Driver tries direct POST to stock-adjust API: 403 and no movement.
**T14** Driver opens another driver's trip: denied.
**T15** Driver tries close business day / approve own trip: denied.
**T16** Mutating a posted invoice or closed day: denied; adjustment must be a new auditable reversal entry.
**T17** Double-click on save delivery with same idempotency key: only one inventory and financial mutation.
**T18** Invalid quantities (negative, decimals for jars, huge numbers), stale session, missing customer, invalid prices: request rejected.

## Reports and usability
**T19** Trip sums reconcile with individual visits even when same customer appears repeatedly.
**T20** Day reports distinguish sales, debt collected, new debt, cash, Fonepay, deposit collected and deposit refunded.
**T21** Admin historical date search and PDF/CSV data match on-screen totals.
**T22** Driver forms mobile viewport, accessibility labels, confirmation and retry behavior work.

## Testing levels
Unit: price resolution, ledger math, closing state machine. Integration: SQL transfers/locks/RLS and journal consistency. E2E: admin + driver browser flows. UAT: observe physical factory run with sample data and sign off discrepancies.
