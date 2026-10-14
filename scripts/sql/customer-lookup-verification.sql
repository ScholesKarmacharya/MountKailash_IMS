-- Read-only schema, permissions and function metadata for the lookup repair.
begin read only;
select jsonb_build_object(
 'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='202610130017'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'volatility',p.provolatile,'security_definer',p.prosecdef,'owner',pg_get_userbyid(p.proowner),'body_hash',md5(p.prosrc),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'))) from pg_proc p where p.oid in ('public.delivery_customer_context(uuid,uuid)'::regprocedure,'public.house_workspace(timestamptz,timestamptz,uuid,uuid,uuid)'::regprocedure,'public.offline_contexts(uuid)'::regprocedure)),
 'rls',(select jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity,'policies',(select count(*) from pg_policy where polrelid=c.oid))) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('customers','customer_prices','jar_custody_entries','jar_custody_balances','customer_ledger','profiles','driver_offline_rounds','driver_offline_operations')),
 'customer_columns',(select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='customers')
) as verification;
rollback;
