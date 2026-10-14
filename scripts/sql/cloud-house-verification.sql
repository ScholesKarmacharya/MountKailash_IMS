-- Read-only verification after applying reviewed migrations 17, 18 and 19.
begin read only;
with rls as (
select c.relname as entity, c.relrowsecurity as enabled,
 has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
 has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
 has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
 and c.relname in ('customers','products','visit_items','sales','sale_items','free_supply_adjustments','driver_offline_rounds','driver_offline_operations','driver_offline_reviews') order by c.relname
), private_rpc as (
select p.proname as entity,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('house_snapshot_override','house_delivery_rows','post_trip_visit_core','finance_issue_visit_core','delivery_customer_context_before_house','customer_delivery_history_before_house','day_report_data_before_house','save_customer_contact_online_core','offline_immutable','house_adjustment_immutable') order by p.proname
), admin_rpc as (
select p.proname as entity,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 p.prosecdef as security_definer,
 position('ops_actor(true)' in p.prosrc)>0 as validates_admin
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('save_house_customer','save_house_pricing','adjust_free_supply','house_workspace') order by p.proname
), customer_defaults as (
select supply_type,house_status,count(*) as count from public.customers group by supply_type,house_status
), product_defaults as (
select kind,house_eligible,default_price::text,reference_price::text from public.products order by kind
)
select jsonb_build_object(
 'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='202610130017'),
 'rls',(select jsonb_agg(to_jsonb(r)) from rls r),
 'private_rpc',(select jsonb_agg(to_jsonb(r)) from private_rpc r),
 'admin_rpc',(select jsonb_agg(to_jsonb(r)) from admin_rpc r),
 'customer_defaults',(select jsonb_agg(to_jsonb(r)) from customer_defaults r),
 'product_defaults',(select jsonb_agg(to_jsonb(r)) from product_defaults r),
 'new_records',jsonb_build_object(
  'adjustments',(select count(*) from public.free_supply_adjustments),
  'offline_operations',(select count(*) from public.driver_offline_operations),
  'free_items',(select count(*) from public.visit_items where supply_classification='FREE_SUPPLY'))
) as verification;
rollback;
