# Sprint 1 Cloud verification — 2026-10-11

Sprint 1 schema is already applied and the live application reads actual Supabase Cloud data. Migration history shows both `202610110001` and `202610110002` applied. A linked dry run reports no pending migrations. The migration was not replayed or repaired, and the database was not reset.

## Results

- Full jars, empty jars and water cartons display actual warehouse totals: **0 / 0 / 0**. There is one existing user-created product. No new catalog products or stock were retained by verification.
- Real Cloud RPCs passed rollback-only checks for opening a business day with the Nepal date, opening retries, duplicate active-day prevention, stock increase/decrease for all three states, adjustment retries, payload-conflict rejection, negative-stock prevention and mandatory reasons.
- Every tested adjustment had a linked movement and audit event with actor, day, reason and before/after quantities. These test entries were rolled back, preserving the immutable operational history.
- Real driver sessions were denied warehouse reads, direct balance updates and the stock-adjustment RPC. Driver navigation to every admin screen redirected to driver home. The SQL checks also denied driver day opening and direct admin table writes.
- Browser quantities matched the database on 1280px desktop and 393px mobile, after refresh and after sign-out/sign-in. The actual no-active-day UI and confirmation cancellation were checked; no test business day was retained.
- `npm.cmd test`: **75 passed**, including 17 isolated real PostgreSQL tests. Type-check, lint and formatting passed. Existing Sprint 0 and Sprint 1 pgTAP SQL suites passed against Cloud within their rollback transactions (12 and 20 assertions respectively).
- No application integration defect was found. A fresh navigation/reload displays real quantities rather than the pre-migration Unavailable state. No existing application behavior was rewritten.

## Preserved database state

Counts and quantities were identical before and after transaction, API and browser checks:

| Item                             |    Before |     After |
| -------------------------------- | --------: | --------: |
| Auth users                       |         2 |         2 |
| Profiles                         |         2 |         2 |
| Existing products                |         1 |         1 |
| Business days                    |         0 |         0 |
| Full jars / empty jars / cartons | 0 / 0 / 0 | 0 / 0 / 0 |
| Stock movements                  |         0 |         0 |
| Stock adjustments                |         0 |         0 |
| Existing audit events            |         1 |         1 |
| Existing operation requests      |         1 |         1 |

Provider sign-in/out activity is expected; no passwords, tokens, secret keys or stored operational records were printed. No user was deleted or replaced.

## Repeatable commands

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
npx.cmd --no-install supabase db query --linked --file scripts/sql/cloud-inventory-readonly.sql
npx.cmd --no-install supabase db query --linked --file scripts/sql/cloud-inventory-rollback.sql
node --env-file=.env.local scripts/verify-cloud-inventory.mjs http://localhost:3000
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
```

The rollback-only SQL must run as one request/connection, with its final ROLLBACK intact. It uses the two existing active DEMO identities, creates only uncommitted product fixtures, and never replaces or changes an existing operational day. If a day is in closing review it stops rather than bypassing that state. It imposes short lock/statement timeouts. Any failed assertion aborts the transaction. Run the read-only snapshot before and after to confirm stock and identities are unchanged. Do not split the file into separate requests or add COMMIT.

The read-only browser/API helper loads saved passwords privately, requires a Cloud URL matching the linked project, and targets only a loopback app URL. It records no browser artifacts or secret-bearing diagnostics. It does not call successful admin business-write APIs. API and UI comparisons use current quantities; concurrent staff activity can legitimately invalidate a fixed before/after comparison.

The pgTAP suites were run with `supabase db query --linked --file supabase/tests/sprint0.test.sql` and the equivalent Sprint 1 command, without Docker. These also roll back fixtures, but require no active operational day. Prefer staging for repeated pgTAP runs once actual operations begin. CLI query support was verified using the installed CLI's help; never substitute reset or migration repair commands to run tests.

## Operational handoff

The admin can now open an actual business day from Inventory and enter approved physical counts with mandatory reasons. Configure actual products and prices before adding stock; do not use the rollback test quantities as operating balances. Day opening is manual and never resets stock. Closing/reconciliation remain future work, so do not force-close a day just to start another.

Committed browser stock-entry acceptance with actual quantities and simultaneous multi-connection race acceptance remain for approved operational/staging testing. The Cloud RPC success paths have already passed rollback-only checks; this is distinct from committing sample transactions into the warehouse ledger.

## Sprint 2: Customer, Vehicle and Trip Management

1. **Customer master data:** admin CRUD, registered/walk-in identities, active status, minimal contact details and configurable customer prices. Driver access must be restricted to customers relevant to assigned trips. Deposit, tax, discount and credit-limit decisions remain explicitly deferred/provisional.
2. **Vehicles:** admin CRUD, unique plate numbers, active status and vehicle stock locations. Preserve existing records when deactivating vehicles; do not remove historical trip references.
3. **Trips:** open-day trips assigned to one driver and vehicle, multiple trips per day, admin-approved atomic warehouse-to-vehicle loads, immutable movements, nonnegative balances and idempotent retries. Extend inventory movement types through additive migrations rather than treating loading as manual correction.
4. **Driver operations:** assigned-trip-only reads/actions, mobile trip view, repeated customer visits without a `(trip, customer)` uniqueness constraint, explicit timestamps and trip-state guards. Delivery posting must be scoped with the required custody/billing boundaries.
5. **Return/reconciliation boundary:** driver declarations do not return stock automatically; admin verifies physical returns and resolves discrepancies. Dedicated refill/damage transactions remain separate workflows. Business-day closing stays blocked from premature implementation.
6. **Tests:** customer-price precedence, inactive master-data rules, two-driver stock contention, cross-driver isolation, duplicate loading/visit retries, repeated visits, multi-trip carryforward and admin-only return verification.

Start with customer and vehicle identities plus the trip-assignment schema, then implement atomic loading before exposing driver delivery writes.
