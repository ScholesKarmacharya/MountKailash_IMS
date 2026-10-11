# Open Client Decisions

Only the questions below remain open; confirmed requirements are in `PRD.md`.

| Priority | Decision | Provisional approach, not client-confirmed |
|---|---|---|
| P0 | Are jars only exchanged, or can customers permanently purchase a physical jar? | Treat jars as returnable custody; exception requires admin operation |
| P0 | Exact jar deposit/refund calculation and whether deposit may offset debts | Separate refundable deposit; do not auto-offset |
| P0 | Can delivery drivers change a price or grant discounts? | Default/customer price locked; admin-controlled override |
| P0 | Who authorizes actual warehouse loads/reload stock? | Admin only |
| P0 | Actual method to reconcile collected cash and Fonepay at end of each trip | Admin checks submitted totals and payment rows |
| P0 | Does returning a vehicle unload all full/empty items, or can stock remain on vehicle overnight? | All are declared and warehouse verified per trip; allow future configurable carryover |
| P1 | Does every shop receive formal invoices, and what are tax/PAN/VAT printing requirements? | Generic receipt/PDF first; compliance pending accountant confirmation |
| P1 | Are there customer credit limits, due dates and overdue penalties? | Due date optional, no penalty until confirmed |
| P1 | How to handle one-time walk-in who takes a reusable jar without returning an empty? | Require identifiable/registered account for ongoing custody |
| P1 | Is internet unreliable on delivery routes, requiring full offline operation? | Online-first with retry protection |
| P1 | Official Fonepay merchant gateway availability, bank partner, sandbox and webhook contract? | Manual entry only until validated |
| P1 | Are multiple warehouses/factories required? | One warehouse initially, schema extensible |
| P2 | Do warehouse employees need individual accounts? | Admin records refills initially |
| P2 | Should vehicle GPS/fuel/tracking be implemented? | Out of scope |

**Do not assume** bottled-water carton pack size, jar refill prices, jar deposit amounts, tax rates, or monthly credit limits. All must be configurable or explicitly deferred.
