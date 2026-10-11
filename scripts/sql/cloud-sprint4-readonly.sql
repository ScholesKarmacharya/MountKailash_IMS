-- Metadata and preservation hashes only. No credentials, customer contacts or mutations.
begin read only;
select version from supabase_migrations.schema_migrations order by version;
select c.relname as table_name,c.relrowsecurity as rls,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read,
  has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as authenticated_write
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  and c.relname in ('business_days','sales','invoices','payments','finance_journal','inventory_balances',
    'business_day_closings','business_day_amendments','warehouse_processing') order by c.relname;
select p.proname,p.prosecdef as security_definer,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
  p.proname in ('finance_workspace','finance_command','post_trip_visit','business_day_command','business_day_history',
    'business_day_report','day_report_data','day_blockers','process_warehouse_jars','link_closed_day_finance_correction') order by p.proname;
select 'profiles' as entity,count(*) as records,md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) as fingerprint from public.profiles p
union all select 'auth_ids',count(*),md5(coalesce(string_agg(id::text,'' order by id),'')) from auth.users
union all select 'business_days',count(*),md5(coalesce(string_agg(to_jsonb(d)::text,'' order by id),'')) from public.business_days d
union all select 'balances',count(*),md5(coalesce(string_agg(to_jsonb(b)::text,'' order by location_id,product_id,stock_kind),'')) from public.inventory_balances b
union all select 'stock_movements',count(*),md5(coalesce(string_agg((to_jsonb(m)-'processing_id')::text,'' order by id),'')) from public.stock_movements m
union all select 'finance_journal',count(*),md5(coalesce(string_agg(to_jsonb(j)::text,'' order by id),'')) from public.finance_journal j;
select (select count(*) from public.customers) as customers,(select count(*) from public.trips) as trips,
  (select count(*) from public.sales) as sales,(select count(*) from public.invoices) as invoices,
  (select count(*) from public.payments) as payments,(select count(*) from public.deposit_transactions) as deposits;
select jsonb_build_object(
 'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
   'read',has_table_privilege('authenticated',c.oid,'SELECT'),'write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE')) order by c.relname)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (
     'business_days','sales','invoices','payments','finance_journal','inventory_balances','business_day_closings','business_day_amendments','warehouse_processing')),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,'settings',p.proconfig,
   'anonymous',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
     'finance_workspace','finance_command','post_trip_visit','business_day_command','business_day_history','business_day_report',
     'day_report_data','day_blockers','process_warehouse_jars','link_closed_day_finance_correction')),
 'preservation',jsonb_build_object(
   'auth_ids',(select md5(coalesce(string_agg(id::text,'' order by id),'')) from auth.users),
   'profiles',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from public.profiles p),
   'days',(select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by id),'')) from public.business_days d),
   'balances',(select md5(coalesce(string_agg(to_jsonb(b)::text,'' order by location_id,product_id,stock_kind),'')) from public.inventory_balances b),
   'stock',(select md5(coalesce(string_agg((to_jsonb(m)-'processing_id')::text,'' order by id),'')) from public.stock_movements m),
   'finance',(select md5(coalesce(string_agg(to_jsonb(j)::text,'' order by id),'')) from public.finance_journal j)),
 'counts',jsonb_build_object('users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
   'days',(select count(*) from public.business_days),'customers',(select count(*) from public.customers),'trips',(select count(*) from public.trips),
   'invoices',(select count(*) from public.invoices),'payments',(select count(*) from public.payments),
   'balances',(select count(*) from public.inventory_balances),'stock_movements',(select count(*) from public.stock_movements),
   'finance_journal',(select count(*) from public.finance_journal))
) as verification;
rollback;
