begin read only;
with checks as (
 select 'one_time_column' as check_name, exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='is_one_time' and is_nullable='NO' and column_default='false') as passed
 union all select 'instant_metadata_rls', exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='instant_deliveries' and c.relrowsecurity)
 union all select 'metadata_immutable', (select count(*)=2 from pg_catalog.pg_trigger where tgrelid='public.instant_deliveries'::regclass and not tgisinternal and tgname in ('instant_immutable','instant_no_truncate'))
 union all select 'driver_trip_exclusivity_preserved', (select count(*)=2 from pg_catalog.pg_indexes where schemaname='public' and indexname in ('one_live_trip_per_driver','one_live_trip_per_vehicle'))
 union all select 'business_ledger_rls_preserved', (select count(*)=6 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('stock_movements','jar_custody_entries','instant_deliveries','payments','invoices','driver_offline_operations') and c.relrowsecurity)
 union all select 'no_direct_authenticated_metadata_writes', not has_table_privilege('authenticated','public.instant_deliveries','INSERT,UPDATE,DELETE,TRUNCATE')
 union all select 'authenticated_protected_sale_rpc', has_function_privilege('authenticated','public.post_instant_delivery(uuid,uuid,text,text,text,jsonb,text,text,text,uuid)','EXECUTE')
 union all select 'anonymous_sale_rpc_denied', not has_function_privilege('anon','public.post_instant_delivery(uuid,uuid,text,text,text,jsonb,text,text,text,uuid)','EXECUTE')
 union all select 'anonymous_history_denied', not has_function_privilege('anon','public.instant_history(uuid)','EXECUTE')
 union all select 'private_row_helper_denied', not has_function_privilege('authenticated','public.instant_row(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.instant_row_before_collection_access(uuid)','EXECUTE')
 union all select 'private_offline_implementation_denied', not has_function_privilege('authenticated','public.offline_post_before_instant(uuid,uuid,text,uuid,integer,text,timestamptz,text,text)','EXECUTE')
 union all select 'private_contact_implementation_denied', not has_function_privilege('authenticated','public.delivery_customer_directory_before_instant()','EXECUTE')
 union all select 'authenticated_history_rpc', has_function_privilege('authenticated','public.instant_workspace()','EXECUTE') and has_function_privilege('authenticated','public.instant_history(uuid)','EXECUTE')
 union all select 'collection_rls_guard', exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='instant_deliveries' and policyname='instant_read' and qual like '%can_read_instant_customer%')
 union all select 'offline_instant_kind', exists(select 1 from pg_catalog.pg_constraint where conrelid='public.driver_offline_operations'::regclass and conname='driver_offline_operations_kind_check' and pg_get_constraintdef(oid) like '%INSTANT%')
) select check_name,passed from checks order by check_name;
rollback;
