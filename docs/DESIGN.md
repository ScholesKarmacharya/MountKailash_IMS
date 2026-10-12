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
1. `/driver/home`: My Active Trip/vehicle, Loaded Stock, Remaining Stock, empty collection/delivery/visit counts, business-day sales and recorded collections, primary New Delivery, Add / Find Customer, Pending Jars and Submit Trip.
2. `/driver/trips/[id]`: loaded stock, sold, remaining, independent empty collections, all visits and New Delivery. Admin trip creation assigns driver/vehicle/load without customer destinations.
3. Delivery form within `/driver/trips/[id]`: search all active customers, Add New Customer/Edit contact inline without leaving or losing quantity inputs, or walk-in with optional contacts. Large plus/minus and direct integer entry, read-only resolved prices, separate credit/deposit amounts, review and confirmation. Selected customer history includes FIFO pending quantities/original dates and return allocations.
4. `/driver/customers/[id]`: basic info, customer jar balance, outstanding credit, previous records relevant to trip; collect prior credit button.
5. `/driver/trips/[id]/submit`: declare remaining full jars, empty jars, cartons and payment totals; review; submit for admin verification.
6. `/driver/receipts/[id]`: show/share receipt, download PDF (subject to online connectivity).

## Status visuals
`DRAFT`, `LOADED`, `ACTIVE`, `SUBMITTED`, `NEEDS_RESOLUTION`, `APPROVED`, `CLOSED`; payment `UNPAID`, `PARTIAL`, `PAID`, Fonepay `PENDING`, `VERIFIED`, `FAILED`.

## Accessibility / validation
Accessible labels, keyboard support, confirmation dialogs for irreversible actions, readable monetary separators, inline inventory shortfall errors, high contrast, and explicit unsaved state warnings.

## Implemented driver inventory workspace (2026-10-12)
The essential navigation now uses `/driver/home`, `/driver/delivery`, `/driver/customers`, `/driver/pending-jars`, `/driver/sales` and `/driver/return`. Mobile navigation is fixed with six touch targets and reserved content space. Home prioritizes four jar cards, cartons, vehicle and simple round labels, then New Delivery and day/round collections. Dedicated delivery and return screens reuse the original checked trip forms; historical `/driver/trips/[id]` remains supported. Contact forms are inline and preserve quantity drafts. Read-only screens check database updates every 10 seconds and on focus; mutable delivery forms refresh explicitly. See `DRIVER_INVENTORY_WORKSPACE.md` for actual routes and acceptance; earlier screen examples describe the original design scope.
