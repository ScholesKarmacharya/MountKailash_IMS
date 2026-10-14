-- Read-only fingerprints of original fields; additive offline/HOUSE metadata is
-- excluded so the same query works both before and after the forward migrations.
begin read only;
with original_rows as (
 select 'customers' as entity, to_jsonb(t)-array['supply_type','house_status','house_version'] as row from public.customers t
 union all select 'products',to_jsonb(t)-array['house_eligible','reference_price','house_version'] from public.products t
 union all select 'stock_movements',to_jsonb(t) from public.stock_movements t
 union all select 'inventory_balances',to_jsonb(t) from public.inventory_balances t
 union all select 'trips',to_jsonb(t) from public.trips t
 union all select 'trip_visits',to_jsonb(t)-'offline_occurred_at' from public.trip_visits t
 union all select 'visit_items',to_jsonb(t)-array['supply_classification','reference_price_snapshot','free_value_snapshot'] from public.visit_items t
 union all select 'sales',to_jsonb(t)-'supply_classification' from public.sales t
 union all select 'sale_items',to_jsonb(t)-array['supply_classification','reference_price_snapshot'] from public.sale_items t
 union all select 'invoices',to_jsonb(t) from public.invoices t
 union all select 'payments',to_jsonb(t) from public.payments t
 union all select 'customer_ledger',to_jsonb(t) from public.customer_ledger t
 union all select 'finance_journal',to_jsonb(t) from public.finance_journal t
 union all select 'jar_custody_entries',to_jsonb(t) from public.jar_custody_entries t
 union all select 'jar_custody_balances',to_jsonb(t) from public.jar_custody_balances t
 union all select 'business_days',to_jsonb(t) from public.business_days t
 union all select 'business_day_closings',to_jsonb(t) from public.business_day_closings t
 union all select 'billing_company',to_jsonb(t) from public.billing_company t
 union all select 'customer_billing',to_jsonb(t) from public.customer_billing t
 union all select 'customer_prices',to_jsonb(t) from public.customer_prices t
 union all select 'payment_allocations',to_jsonb(t) from public.payment_allocations t
 union all select 'payment_verification_events',to_jsonb(t) from public.payment_verification_events t
 union all select 'invoice_adjustments',to_jsonb(t) from public.invoice_adjustments t
 union all select 'deposit_transactions',to_jsonb(t) from public.deposit_transactions t
 union all select 'credit_issued',to_jsonb(t) from public.credit_issued t
 union all select 'business_day_amendments',to_jsonb(t) from public.business_day_amendments t
 union all select 'warehouse_processing',to_jsonb(t) from public.warehouse_processing t
)
select e.entity,count(o.row) as original_count,md5(string_agg(o.row::text,'|' order by o.row::text)) as original_fingerprint
from unnest(array['customers','products','stock_movements','inventory_balances','trips','trip_visits','visit_items','sales','sale_items','invoices','payments','customer_ledger','finance_journal','jar_custody_entries','jar_custody_balances','business_days','business_day_closings','billing_company','customer_billing','customer_prices','payment_allocations','payment_verification_events','invoice_adjustments','deposit_transactions','credit_issued','business_day_amendments','warehouse_processing']) e(entity)
left join original_rows o on o.entity=e.entity group by e.entity order by e.entity;
rollback;
