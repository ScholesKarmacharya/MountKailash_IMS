# Security and Access Control

## Role matrix
| Operation | Admin | Driver |
|---|---|---|
| View warehouse stock and global reports | Yes | No |
| Search active customer contacts | Yes | Yes, contact-only RPC during own ACTIVE trip on OPEN day |
| Create customers / edit ordinary contacts during delivery | Yes | Yes, owned ACTIVE trip on OPEN day, audited/version checked |
| View selected customer credit/jar history and pending dates | Yes | Yes, authorized trip, no other drivers' raw invoices/trips |
| Create/assign/load trips | Yes | No |
| View assigned active trips | Yes | Yes |
| Record visits, sales, empty returns and payments for assigned open trip | Yes | Yes |
| Submit own assigned trip | Yes | Yes |
| Verify/approve trip, resolve discrepancy | Yes | No |
| Record/refill warehouse empty jars | Yes | No |
| Directly add/remove/correct stock | Yes, audited | No |
| Modify default or customer pricing | Yes | No |
| Close business day or authorize post-close corrections | Yes | No |
| Read historic admin reports | Yes | No |

## Controls
- Every write checks session, role, account enabled, assigned trip, trip status and business-day status on server, regardless of UI.
- RLS limits driver reads to assigned trips and relevant customers; no global raw customer/finance table exposure.
- Service-role key never in browser, frontend environment, or downloadable bundle.
- Financial, inventory and close actions use DB transaction with immutable audit event and idempotency key.
- Reconciliation, price overrides and stock adjustments are high-trust operations requiring admin privileges. Consider re-authentication for close/correction as a future enhancement.
- Rate limit login and sensitive endpoints. Validate numbers, UUIDs, decimal precision and invoice transitions server side.
- Store PDF files in private object storage; use authorized short-lived download links.
- Encrypt traffic (TLS), retain secure backups, perform tested restore drills, and use least-privileged deployment secrets.
- Record payment verification source and status. Do not mark external Fonepay payment verified based solely on driver submission.
- Keep contact details minimal; redact personally identifiable details from routine error logs.
- Log admin changes including actor, time, reason, old and new quantity or status.

## Explicit negative tests
Driver attempts to call admin stock-adjust endpoint directly; driver edits another driver's trip; edit posted invoice; submit duplicate sale/payment; driver sends forged verified Fonepay flag; approve same trip twice; close a day with unresolved stock discrepancy; reopen past day without authorization.

## Driver customer RPC boundary (2026-10-12)
Contact search projects ordinary contacts without broadening raw customer RLS. Selected-customer context validates an owned ACTIVE trip and OPEN day; admin notes are excluded from driver RPC responses. Drivers cannot call private posting/context/FIFO/report helpers or write ordering metadata. Served-customer associations commit with successful sales/collections; failed postings roll back all effects. Existing route history and completed request retries remain intact. Pending jar readers enforce active identity and eligible trip in the database as well as the server.

Migration 014 adds a separate read-only pending/contact directory for active staff while awaiting loading. Raw customer rows become admin-only because they include private notes. Projected driver contact responses exclude notes, billing, deposit policy and creator details. Drivers may read active customers' dated pending jars; selected financial context and contact/visit writes still require their owned ACTIVE trip on an OPEN day. `save_customer_contact` remains private; only checked wrappers are executable. Extended fields share the same version, canonical retry payload and audit transaction.
