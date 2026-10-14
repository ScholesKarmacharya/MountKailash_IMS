-- Read-only post-migration checks; no business commands or test fixtures.
begin read only;
select 'trip_metadata_backfill' as check_name,
 not exists(select 1 from public.trips t join public.business_days d on d.id=t.business_day_id
  where t.scheduled_date is distinct from d.date_label
   or t.created_business_day_id is distinct from t.business_day_id
   or t.loaded_at is not null or t.loaded_by is not null
   or t.loading_business_day_id is not null or t.cancelled) as passed
union all select 'closed_trip_guard_enabled',exists(
 select 1 from pg_catalog.pg_trigger where tgrelid='public.trips'::regclass
 and tgname='trips_preserve' and tgenabled='O')
union all select 'operational_rls_enabled',not exists(
 select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in (
  'trips','inventory_balances','stock_movements','customers','profiles','business_days',
  'driver_offline_rounds','driver_offline_operations','driver_trusted_devices','trip_carryovers')
 and not c.relrowsecurity)
union all select 'workspace_remains_security_invoker',not p.prosecdef
 from pg_catalog.pg_proc p where p.oid='public.operations_workspace(uuid)'::regprocedure
union all select 'schedule_authenticated_execute',has_function_privilege(
 'authenticated','public.schedule_trip(uuid,uuid,uuid,uuid,date,text,uuid)','EXECUTE')
union all select 'schedule_anonymous_denied',not has_function_privilege(
 'anon','public.schedule_trip(uuid,uuid,uuid,uuid,date,text,uuid)','EXECUTE')
union all select 'preparation_anonymous_denied',not has_function_privilege(
 'anon','public.trip_preparation_command(uuid,text,date,text,jsonb,uuid)','EXECUTE')
union all select 'loader_anonymous_denied',not has_function_privilege(
 'anon','public.load_trip(uuid,jsonb,uuid)','EXECUTE')
union all select 'legacy_loader_authenticated_denied',not has_function_privilege(
 'authenticated','public.load_trip_before_schedule(uuid,jsonb,uuid)','EXECUTE')
union all select 'legacy_registration_authenticated_denied',not has_function_privilege(
 'authenticated','public.offline_register_round_core(uuid,uuid,text)','EXECUTE')
union all select 'trusted_device_secrets_not_selectable',
 not has_column_privilege('authenticated','public.driver_trusted_devices','token_hash','SELECT')
 and not has_column_privilege('authenticated','public.driver_trusted_devices','recovery_box','SELECT')
union all select 'new_tables_initially_empty',
 (select count(*)=0 from public.driver_trusted_devices)
 and (select count(*)=0 from public.trip_carryovers);
rollback;
