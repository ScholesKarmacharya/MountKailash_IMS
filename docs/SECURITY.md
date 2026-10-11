# Security and Access Control

## Role matrix
| Operation | Admin | Driver |
|---|---|---|
| View all warehouse stock, all customers, reports | Yes | No, limited assigned/customer data |
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
