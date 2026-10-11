-- Catalog and preservation checks only. No credentials or business row contents.
begin read only;
select jsonb_build_object(
 'existing',jsonb_build_object(
   'auth_users',(select count(*) from auth.users),
   'auth_ids',(select md5(coalesce(string_agg(id::text,',' order by id),'')) from auth.users),
   'profiles',(select count(*) from public.profiles),
   'profile_identity_roles',(select md5(coalesce(string_agg(jsonb_build_array(id,name,role,is_active)::text,',' order by id),'')) from public.profiles),
   'products',(select count(*) from public.products),
   'product_records',(select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by id),'')) from public.products p),
   'business_days',(select count(*) from public.business_days),
   'day_records',(select md5(coalesce(string_agg(to_jsonb(d)::text,',' order by id),'')) from public.business_days d),
   'stock_records',(select md5(coalesce(string_agg(to_jsonb(b)::text,',' order by location_id,product_id,stock_kind),'')) from public.inventory_balances b),
   'movements',(select count(*) from public.stock_movements),
   'adjustments',(select count(*) from public.stock_adjustments),
   'audit_events',(select count(*) from public.audit_events),
   'operation_requests',(select count(*) from public.operation_requests)),
 'tables',(select jsonb_agg(jsonb_build_object('name',t.name,'exists',c.oid is not null,'rls',coalesce(c.relrowsecurity,false),
   'read_grant',coalesce(has_table_privilege('authenticated',c.oid,'SELECT'),false),
   'direct_writes_blocked',not coalesce(has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'),false),
   'policy_count',(select count(*) from pg_policy p where p.polrelid=c.oid)))
   from unnest(array['profiles','customers','vehicles','trips','trip_customers','trip_visits','trip_load_items','visit_items',
     'trip_return_declarations','trip_return_checks','trip_return_check_items','trip_discrepancies',
     'jar_custody_balances','jar_custody_entries','delivery_payment_intents','delivery_value_snapshots']) t(name)
   left join pg_class c on c.oid=to_regclass('public.'||t.name)),
 'functions',(select jsonb_agg(jsonb_build_object('name',t.name,'exists',p.oid is not null,
   'authenticated_execute',coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false),
   'anonymous_execute',coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false),
   'security_definer',coalesce(p.prosecdef,false),'configuration',p.proconfig))
   from unnest(array['operations_workspace','customer_delivery_history','save_customer','save_vehicle','save_driver',
     'create_trip','assign_trip_customer','load_trip','transition_trip','post_trip_visit','submit_trip','reconcile_trip',
     'adjust_customer_custody','ops_actor','ops_retry','ops_finish','ops_trip','ops_move','ops_counts']) t(name)
   left join pg_proc p on p.proname=t.name and p.pronamespace='public'::regnamespace),
 'policies',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'command',cmd)),'[]'::jsonb)
   from pg_policies where schemaname='public' and tablename in ('customers','vehicles','trips','trip_visits','trip_load_items',
     'trip_return_declarations','trip_return_checks','trip_return_check_items','inventory_balances','stock_movements'))
) as verification;
rollback;
