# Trip creation schema error

Verified on 14 October 2026, Nepal time, against the project's currently linked Supabase database.

The application was running the new scheduled-trip form while the database had migrations only through `202610130021`. The two missing migrations have now been applied with the user's explicit approval:

- [22: trusted driver devices](../supabase/migrations/202610130022_trusted_driver_devices.sql)
- [23: overnight trip loading](../supabase/migrations/202610130023_overnight_trip_loading.sql)

## Actual diagnostic results

| Request / check                                                       | Result                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /rest/v1/rpc/schedule_trip`                                     | HTTP **404**, database/API code **PGRST202**: `public.schedule_trip(p_day, p_driver, p_id, p_key, p_notes, p_scheduled, p_vehicle)` is absent from the schema cache. |
| Zero-row trip read selecting `scheduled_date,loading_business_day_id` | HTTP **400**, code **42703**: required columns are absent.                                                                                                           |
| `POST /rest/v1/rpc/trusted_device_directory`                          | HTTP **404**, code **PGRST202**: migration 22 is also absent.                                                                                                        |
| `supabase migration list --linked`                                    | Migrations 1–21 applied; 22 and 23 pending.                                                                                                                          |
| `supabase db push --linked --dry-run`                                 | Would apply **only migrations 22 and 23**. Nothing was pushed.                                                                                                       |
| Operations and finance snapshot comparison                            | Unchanged before/after both diagnostic runs.                                                                                                                         |

This is a schema/application mismatch. Refreshing the browser alone cannot create the missing database function. The scheduled-trip form must not fall back to the old `create_trip` command and silently discard the selected date.

The diagnostic script uses the existing active admin identity and a null request-key probe, which rejects before any trip, stock, audit or operation-request write even when migration 23 is installed. No valid business command or test fixture was submitted to the linked database, and credentials were not printed.

## Local correction

`src/data-access/operations.ts` now gives an explicit missing-migration message for scheduled-trip/preparation schema failures. English and Nepali dictionaries contain the message. Server diagnostics record only the RPC name, HTTP status and database code, without customer fields, submitted arguments or provider details.

`tests/unit/operations-write.test.ts` covers missing RPC/column errors, preservation of authorization failures, unrelated RPC errors and acknowledged successful record IDs. The focused run passed **26 tests in four files**, including operation permissions, translations and historical-migration preservation. Lint and TypeScript checks passed. The initial translation check caught a PowerShell Unicode encoding issue; it was corrected and the full focused run passed afterward.

The forward migrations were already reviewed and tested during the overnight implementation. Their lifecycle, metadata backfill, historical preservation and safeguards are described in [the overnight loading report](OVERNIGHT_LOADING_AND_DAILY_CLOSE.md).

## Approved database correction and verification

The user approved applying migrations 22 and 23 to the currently linked database. `supabase db push --linked --yes --agent no` applied exactly those two migrations successfully. The subsequent migration list confirms local and remote history match through `202610130023`. No database reset, financial rewrite, stock reset, RLS disable or application deployment was performed.

Read-only SQL fingerprints taken immediately before and after the migration matched for **all 530 original records across 47 tables**, including stock movements, balances, sales, payments, invoices, customer credit, jar custody, offline operations, operation requests, audit events and historical closing archives. Only the six newly added trip metadata columns were excluded from the original-field comparison. The separate metadata check verified all existing trips received their original business-day schedule and assignment, with historical loading timestamps/actors left null.

| Post-migration check                                          | Result                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated `schedule_trip` null-key probe                  | HTTP **400 / 22023**, `Request key required.` The function now exists and rejects this intentionally invalid probe before writes.                                                      |
| Zero-row read of new trip columns                             | HTTP **200**, no error.                                                                                                                                                                |
| Authenticated trusted-device directory                        | HTTP **200**, no error.                                                                                                                                                                |
| Operations/finance snapshots during diagnostic                | Unchanged.                                                                                                                                                                             |
| SQL metadata, RLS, closed-history guard and permission checks | **12 passed**. Anonymous write RPC access and authenticated legacy-core execution remain denied; device secret columns are not directly selectable.                                    |
| Actual admin browser trip page using hosted database          | **1 passed**. Signed in, loaded `/admin/trips` with HTTP 200, and verified the scheduled-date field, driver/vehicle controls and Create draft trip button. The form was not submitted. |

The SQL checks are reproducible using `scripts/sql/cloud-overnight-preservation.sql` and `scripts/sql/cloud-overnight-verification.sql`. The latter checks the immediate migration backfill and empty new tables; these expectations intentionally stop applying once users create new trips, trusted devices or carryovers. The browser check is `tests/live-diagnostics/trip-schema.spec.ts`, explicitly run with the live diagnostic configuration. It creates no business fixture or operation. Valid trip creation and stock workflows were exercised previously in isolated tests documented in the overnight report; no valid production trip was created during this verification.

The trip page can now be refreshed and the intended driver/vehicle selected before creating the actual trip. The prior missing-function error is resolved.

The server-only `OFFLINE_DEVICE_RECOVERY_KEY` is also absent from the current local environment. It is required for the previously implemented trusted-device PIN/recovery setup; it is separate from the immediate scheduled-trip RPC failure.
