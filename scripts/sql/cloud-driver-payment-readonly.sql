-- Read-only counts and fingerprints; never outputs contacts, passwords or journal contents.
begin read only;
with snapshots as (
select 'profiles' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.profiles t
union all
select 'business_days' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.business_days t
union all
select 'products' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.products t
union all
select 'stock_locations' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.stock_locations t
union all
select 'inventory_balances' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.inventory_balances t
union all
select 'operation_requests' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.operation_requests t
union all
select 'stock_movements' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.stock_movements t
union all
select 'stock_adjustments' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.stock_adjustments t
union all
select 'audit_events' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.audit_events t
union all
select 'customers' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.customers t
union all
select 'vehicles' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.vehicles t
union all
select 'trips' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trips t
union all
select 'trip_customers' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trip_customers t
union all
select 'trip_visits' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trip_visits t
union all
select 'trip_load_items' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trip_load_items t
union all
select 'visit_items' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.visit_items t
union all
select 'delivery_payment_intents' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.delivery_payment_intents t
union all
select 'jar_custody_balances' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.jar_custody_balances t
union all
select 'jar_custody_entries' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.jar_custody_entries t
union all
select 'trip_return_declarations' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trip_return_declarations t
union all
select 'trip_return_checks' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trip_return_checks t
union all
select 'trip_return_check_items' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trip_return_check_items t
union all
select 'trip_discrepancies' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.trip_discrepancies t
union all
select 'delivery_value_snapshots' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.delivery_value_snapshots t
union all
select 'billing_company' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.billing_company t
union all
select 'customer_billing' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.customer_billing t
union all
select 'customer_prices' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.customer_prices t
union all
select 'sales' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.sales t
union all
select 'sale_items' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.sale_items t
union all
select 'invoices' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.invoices t
union all
select 'payments' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.payments t
union all
select 'payment_allocations' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.payment_allocations t
union all
select 'payment_verification_events' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.payment_verification_events t
union all
select 'invoice_adjustments' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.invoice_adjustments t
union all
select 'customer_ledger' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.customer_ledger t
union all
select 'deposit_transactions' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.deposit_transactions t
union all
select 'finance_journal' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.finance_journal t
union all
select 'credit_issued' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.credit_issued t
union all
select 'business_day_closings' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.business_day_closings t
union all
select 'business_day_amendments' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.business_day_amendments t
union all
select 'warehouse_processing' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.warehouse_processing t
union all
select 'custody_event_order' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.custody_event_order t
union all
select 'return_only_visits' as name, count(*) as rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as fingerprint from public.return_only_visits t
), protected as (
 select c.relname as name,c.relrowsecurity as rls,has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as direct_write
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
)
select jsonb_build_object(
 'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'users',jsonb_build_object('count',(select count(*) from auth.users),'ids',(select md5(coalesce(string_agg(id::text,'' order by id),'')) from auth.users)),
 'business',(select jsonb_agg(to_jsonb(s) order by name) from snapshots s),
 'tables',(select jsonb_agg(to_jsonb(p) order by name) from protected p),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,'settings',p.proconfig,'anonymous',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('post_driver_delivery','post_trip_visit','post_trip_visit_core','finance_command','finance_issue_visit'))
) as verification;
rollback;
