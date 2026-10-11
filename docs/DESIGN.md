# UX / Page Specifications

## Experience
Responsive web app, desktop-first admin and mobile-first driver. Fast numeric entry, large touch targets, optional customer quick search, clear status labels. Show relevant business day instead of assuming clock date.

## Admin screens
1. `/admin/dashboard`: open business day, active/pending trips, today's jars/cartons sold, cash/Fonepay collections, new credit, old credit collected, warehouse full/empty counts, alerts.
2. `/admin/inventory`: available full/empty/damaged jars and cartons; movement history; audited manual adjustment modal.
3. `/admin/refilling`: record empty jars processed, refilled units, damaged units, validation and history.
4. `/admin/trips`: list and create; assign driver/vehicle; load stock; trip lifecycle; submitted returns verification and discrepancy handling.
5. `/admin/customers`: registered/walk-in conversion, customer prices, jar custody, refundable deposit, receivable ledger, invoices.
6. `/admin/products`: default prices, SKU/unit settings, carton definitions.
7. `/admin/payments`: recorded cash, Fonepay pending/verified, allocations and daily reconciliation.
8. `/admin/daily-close`: checklist with blockers, preview sales vs collections, confirmed returns, stock and debt carryforward, explicit Close Day confirmation.
9. `/admin/reports`: choose previous business day/month, drill to trip/driver/customer; export PDF/CSV.
10. `/admin/settings`: driver account assignment, role management, vehicles, optional deposit and credit policies.

## Driver screens
1. `/driver/home`: active assigned trip, status, counts and quick actions.
2. `/driver/trips/[id]`: loaded stock, sold, remaining, collected empties, all visits with add visit button.
3. `/driver/trips/[id]/visits/new`: customer search/add walk-in, item quantities, empty jar count, unit prices (read-only unless policy), deposit, payment entry, outstanding and save confirmation.
4. `/driver/customers/[id]`: basic info, customer jar balance, outstanding credit, previous records relevant to trip; collect prior credit button.
5. `/driver/trips/[id]/submit`: declare remaining full jars, empty jars, cartons and payment totals; review; submit for admin verification.
6. `/driver/receipts/[id]`: show/share receipt, download PDF (subject to online connectivity).

## Status visuals
`DRAFT`, `LOADED`, `ACTIVE`, `SUBMITTED`, `NEEDS_RESOLUTION`, `APPROVED`, `CLOSED`; payment `UNPAID`, `PARTIAL`, `PAID`, Fonepay `PENDING`, `VERIFIED`, `FAILED`.

## Accessibility / validation
Accessible labels, keyboard support, confirmation dialogs for irreversible actions, readable monetary separators, inline inventory shortfall errors, high contrast, and explicit unsaved state warnings.
