-- Driver management uses business metadata only. Reuse the existing audited
-- round transfer; no evidence tables, constraints or triggers are changed.
create function public.admin_driver_offline_access(p_driver uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.trips; r public.driver_offline_rounds; d public.driver_trusted_devices; has_device boolean; state text;
begin
 perform public.ops_actor(true);
 if not exists(select 1 from public.profiles where id=p_driver and role='DRIVER') then
  raise exception using errcode='22023',message='Select a driver.';
 end if;
 select * into t from public.trips where driver_id=p_driver and status in ('LOADED','ACTIVE')
  order by (status='ACTIVE') desc,trip_number desc limit 1;
 select * into r from public.driver_offline_rounds where trip_id=t.id;
 select * into d from public.driver_trusted_devices where driver_id=p_driver
  order by (revoked_at is null) desc,registered_at desc,device_id limit 1;
 has_device:=d.device_id is not null and d.revoked_at is null;
 state:=case
  when t.id is null then 'No active trip'
  when r.offline_device_reset_pending then 'Previous device revoked'
  when r.trip_id is not null and (r.phase not in ('PREPARED','ACTIVE') or not has_device or r.device_id<>d.device_id) then 'Needs update'
  when not has_device then 'No device registered'
  else 'Offline access active' end;
 return jsonb_build_object(
  'trip_id',t.id,'trip_number',t.trip_number,
  'vehicle',(select plate_number from public.vehicles where id=t.vehicle_id),
  'status',state,'device_registered',has_device,
  'registered_at',coalesce(d.registered_at,r.registered_at),'last_synced_at',d.last_synced_at,
  'reported_pending',r.reported_pending,
  'review_count',(select count(*) from public.driver_offline_operations where driver_id=p_driver and status='NEEDS_REVIEW'),
  'retry_count',(select count(*) from public.driver_offline_operations where driver_id=p_driver and status='RETRYABLE'),
  'reset_pending',coalesce(r.offline_device_reset_pending,false),
  'can_reset',not coalesce(r.offline_device_reset_pending,false)
   and (r.trip_id is null or r.phase in ('PREPARED','ACTIVE')) and (has_device or r.trip_id is not null));
end $$;

-- p_trip is the trip displayed when the admin confirmed (NULL means no trip).
-- A stale page cannot accidentally reset a newly assigned trip. The shared
-- driver lock serializes reset with automatic registration and transfer.
create function public.offline_admin_reset_access(p_driver uuid,p_trip uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.trips; r public.driver_offline_rounds; j jsonb; retry uuid; revoked jsonb;
begin
 perform public.ops_actor(true);
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
  raise exception using errcode='22023',message='Enter a reason between 3 and 500 characters.';
 end if;
 j:=jsonb_build_object('operation','ADMIN_DRIVER_OFFLINE_RESET','driver',p_driver,'trip',p_trip,'reason',p_reason);
 retry:=public.ops_retry(p_key,j); if retry is not null then return retry; end if;
 if not exists(select 1 from public.profiles where id=p_driver and role='DRIVER') then
  raise exception using errcode='22023',message='Select a driver.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||p_driver::text,0));
 select * into t from public.trips where driver_id=p_driver and status in ('LOADED','ACTIVE')
  order by (status='ACTIVE') desc,trip_number desc limit 1 for update;
 if t.id is distinct from p_trip then
  raise exception using errcode='22023',message='The current trip changed. Reload the driver page before resetting offline access.';
 end if;
 select * into r from public.driver_offline_rounds where trip_id=t.id;
 if r.trip_id is not null then
  -- A separate deterministic command key lets the existing reset remain fully
  -- idempotent while this driver's reset also appears in their account audit.
  perform public.offline_admin_reset_device(t.id,btrim(p_reason),md5(p_key::text||':round-reset')::uuid);
 else
  -- Nothing has been prepared for this trip yet (or there is no active trip).
  -- Revoke any registered phone without manufacturing a round or changing trips.
  select coalesce(jsonb_agg(device_id),'[]'::jsonb) into revoked from public.driver_trusted_devices
   where driver_id=p_driver and revoked_at is null;
  update public.driver_trusted_devices set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_reason),offline_reset_id=p_key
   where driver_id=p_driver and revoked_at is null;
 end if;
 return public.ops_finish(p_key,j,p_driver,'DRIVER_OFFLINE_ACCESS_RESET','profiles',null,
  jsonb_build_object('trip',t.id,'revoked_devices',revoked,'records_preserved',true),btrim(p_reason));
end $$;
revoke all on function public.admin_driver_offline_access(uuid),public.offline_admin_reset_access(uuid,uuid,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_driver_offline_access(uuid),public.offline_admin_reset_access(uuid,uuid,text,uuid) to authenticated;
