-- Run before and after migrations 22/23. Return hashes/counts, never row contents.
-- Only the six newly added trip metadata fields are excluded from comparison.
begin read only;
with original_rows as (
 select 'profiles' as entity,to_jsonb(t) as row from public.profiles t
 union all select 'business_days',to_jsonb(t) from public.business_days t
 union all select 'products',to_jsonb(t) from public.products t
 union all select 'stock_locations',to_jsonb(t) from public.stock_locations t
 union all select 'inventory_balances',to_jsonb(t) from public.inventory_balances t
 union all select 'operation_requests',to_jsonb(t) from public.operation_requests t
 union all select 'stock_movements',to_jsonb(t) from public.stock_movements t
 union all select 'stock_adjustments',to_jsonb(t) from public.stock_adjustments t
 union all select 'audit_events',to_jsonb(t) from public.audit_events t
 union all select 'customers',to_jsonb(t) from public.customers t
 union all select 'vehicles',to_jsonb(t) from public.vehicles t
 union all select 'trips',to_jsonb(t)-array['scheduled_date','created_business_day_id','loaded_at','loaded_by','loading_business_day_id','cancelled'] from public.trips t
 union all select 'trip_customers',to_jsonb(t) from public.trip_customers t
 union all select 'trip_visits',to_jsonb(t) from public.trip_visits t
 union all select 'trip_load_items',to_jsonb(t) from public.trip_load_items t
 union all select 'visit_items',to_jsonb(t) from public.visit_items t
 union all select 'delivery_payment_intents',to_jsonb(t) from public.delivery_payment_intents t
 union all select 'jar_custody_balances',to_jsonb(t) from public.jar_custody_balances t
 union all select 'jar_custody_entries',to_jsonb(t) from public.jar_custody_entries t
 union all select 'trip_return_declarations',to_jsonb(t) from public.trip_return_declarations t
 union all select 'trip_return_checks',to_jsonb(t) from public.trip_return_checks t
 union all select 'trip_return_check_items',to_jsonb(t) from public.trip_return_check_items t
 union all select 'trip_discrepancies',to_jsonb(t) from public.trip_discrepancies t
 union all select 'delivery_value_snapshots',to_jsonb(t) from public.delivery_value_snapshots t
 union all select 'billing_company',to_jsonb(t) from public.billing_company t
 union all select 'customer_billing',to_jsonb(t) from public.customer_billing t
 union all select 'customer_prices',to_jsonb(t) from public.customer_prices t
 union all select 'sales',to_jsonb(t) from public.sales t
 union all select 'sale_items',to_jsonb(t) from public.sale_items t
 union all select 'invoices',to_jsonb(t) from public.invoices t
 union all select 'payments',to_jsonb(t) from public.payments t
 union all select 'payment_allocations',to_jsonb(t) from public.payment_allocations t
 union all select 'payment_verification_events',to_jsonb(t) from public.payment_verification_events t
 union all select 'invoice_adjustments',to_jsonb(t) from public.invoice_adjustments t
 union all select 'customer_ledger',to_jsonb(t) from public.customer_ledger t
 union all select 'deposit_transactions',to_jsonb(t) from public.deposit_transactions t
 union all select 'finance_journal',to_jsonb(t) from public.finance_journal t
 union all select 'credit_issued',to_jsonb(t) from public.credit_issued t
 union all select 'business_day_closings',to_jsonb(t) from public.business_day_closings t
 union all select 'business_day_amendments',to_jsonb(t) from public.business_day_amendments t
 union all select 'warehouse_processing',to_jsonb(t) from public.warehouse_processing t
 union all select 'custody_event_order',to_jsonb(t) from public.custody_event_order t
 union all select 'return_only_visits',to_jsonb(t) from public.return_only_visits t
 union all select 'driver_offline_rounds',to_jsonb(t) from public.driver_offline_rounds t
 union all select 'driver_offline_operations',to_jsonb(t) from public.driver_offline_operations t
 union all select 'driver_offline_reviews',to_jsonb(t) from public.driver_offline_reviews t
 union all select 'free_supply_adjustments',to_jsonb(t) from public.free_supply_adjustments t
), entities as (
 select c.relname as entity from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r'
 and c.relname not in ('driver_trusted_devices','trip_carryovers')
)
select e.entity,count(o.row) as original_count,
 md5(string_agg(o.row::text,'|' order by o.row::text)) as original_fingerprint
from entities e left join original_rows o on o.entity=e.entity
group by e.entity order by e.entity;
rollback;
