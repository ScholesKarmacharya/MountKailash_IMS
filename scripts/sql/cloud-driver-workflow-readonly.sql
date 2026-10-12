-- Read-only catalog checks and preservation fingerprints; no customer contacts or credentials.
begin read only;
select jsonb_build_object(
 'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'creator_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='created_by'),
 'contact_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='customers' and column_name in ('contact_person','customer_type','delivery_notes')),
 'customer_rls',(select relrowsecurity from pg_class where oid='public.customers'::regclass),
 'customer_direct_write',has_table_privilege('authenticated','public.customers','INSERT,UPDATE,DELETE'),
 'sprint6_tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'direct_write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE')))
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('custody_event_order','return_only_visits')),
 'policies',(select jsonb_agg(jsonb_build_object('name',policyname,'command',cmd,'roles',roles,'using',qual)) from pg_policies where schemaname='public' and tablename='customers'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,'settings',p.proconfig,
   'anonymous',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by p.proname)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
     'post_trip_visit','post_trip_visit_core','finance_command','finance_command_core','create_trip','create_trip_core',
     'assign_trip_customer','save_delivery_customer','save_delivery_contact','save_customer_contact','delivery_customer_context','delivery_customer_context_core','delivery_customer_directory','delivery_trip','can_search_delivery_customers',
     'pending_jar_workspace','pending_jar_directory','pending_jar_rows','jar_return_allocations','record_custody_order','finance_issue_visit','finance_issue_visit_core','day_report_data','day_report_data_core')),
 'counts',jsonb_build_object('users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
   'customers',(select count(*) from public.customers),'trips',(select count(*) from public.trips),
   'visits',(select count(*) from public.trip_visits),'invoices',(select count(*) from public.invoices),'payments',(select count(*) from public.payments),
   'stock_movements',(select count(*) from public.stock_movements),'finance_journal',(select count(*) from public.finance_journal)),
 'preservation',jsonb_build_object(
   'users',(select md5(coalesce(string_agg(id::text,'' order by id),'')) from auth.users),
   'profiles',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from public.profiles p),
   'customers',(select md5(coalesce(string_agg((to_jsonb(c)-array['contact_person','customer_type','delivery_notes'])::text,'' order by id),'')) from public.customers c),
   'days',(select md5(coalesce(string_agg(to_jsonb(d)::text,'' order by id),'')) from public.business_days d),
   'trips',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.trips t),
   'stock',(select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by id),'')) from public.stock_movements m),
   'finance',(select md5(coalesce(string_agg(to_jsonb(j)::text,'' order by id),'')) from public.finance_journal j))
) as verification;
rollback;
