-- Forward-only ownership recovery. No records, accounts, journals or policies
-- are deleted. Existing revoked credentials stay revoked.
-- Match domain/operations/driver-workspace.currentRound, including tie breakers.
create function public.offline_current_trip(p_driver uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select t.id from public.trips t join public.business_days b on b.id=t.business_day_id
 where t.driver_id=p_driver and not t.cancelled
 and t.status in ('ACTIVE','LOADED','DRAFT','SUBMITTED','UNDER_REVIEW','DISCREPANCY')
 order by array_position(array['ACTIVE','LOADED','DRAFT','SUBMITTED','UNDER_REVIEW','DISCREPANCY'],t.status::text),
 coalesce(t.scheduled_date,b.date_label),t.created_at desc,t.trip_number desc,t.id limit 1
$$;

-- Shared, private metadata reader: both authorization sources matter. Never
-- return tokens, hashes, recovery material or operation payloads.
create function public.offline_driver_access_state(p_driver uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.trips; r public.driver_offline_rounds; d public.driver_trusted_devices;
 a public.audit_events; has_device boolean; waiting boolean; eligible boolean; state text;
begin
 select * into t from public.trips where id=public.offline_current_trip(p_driver);
 select * into r from public.driver_offline_rounds where trip_id=t.id;
 select * into d from public.driver_trusted_devices where driver_id=p_driver
  order by (revoked_at is null) desc,registered_at desc,device_id limit 1;
 select * into a from public.audit_events where entity='profiles' and entity_id=p_driver
  and action='DRIVER_OFFLINE_ACCESS_RESET' and after_json->>'replacement_pending'='true'
  and (after_json->>'trip') is not distinct from t.id::text
  order by created_at desc,id desc limit 1;
 has_device:=d.device_id is not null and d.revoked_at is null;
 eligible:=coalesce(t.status in ('LOADED','ACTIVE'),false);
 waiting:=coalesce(r.offline_device_reset_pending,false)
  or (r.trip_id is null and a.id is not null);
 state:=case when waiting then 'Waiting for driver device'
  when r.trip_id is not null and eligible and (r.phase not in ('PREPARED','ACTIVE','PAUSED') or not has_device or r.device_id<>d.device_id) then 'Needs update'
  when eligible and not has_device and d.device_id is not null then 'Device reset required'
  when t.id is null or not eligible then 'No active trip'
  when not has_device then 'No device registered'
  else 'Offline access active' end;
 return jsonb_build_object('trip_id',t.id,'trip_number',t.trip_number,
  'vehicle',(select plate_number from public.vehicles where id=t.vehicle_id),
  'status',state,'device_registered',has_device,
  'registered_at',coalesce(d.registered_at,r.registered_at),'last_synced_at',d.last_synced_at,
  'reported_pending',r.reported_pending,
  'review_count',(select count(*) from public.driver_offline_operations where driver_id=p_driver and status='NEEDS_REVIEW'),
  'retry_count',(select count(*) from public.driver_offline_operations where driver_id=p_driver and status='RETRYABLE'),
  'reset_pending',waiting,
  'previous_device_revoked',exists(select 1 from public.driver_trusted_devices where driver_id=p_driver and revoked_at is not null) or coalesce(r.offline_device_reset_pending,false),
  'last_reset_at',coalesce(r.offline_device_reset_at,a.created_at),
  'last_reset_by',coalesce(r.offline_device_reset_by,a.actor_user_id),
  'can_reset',has_device or (eligible and (r.trip_id is not null or d.device_id is not null)) or waiting,
  'diagnostics',jsonb_build_object('driver_id',p_driver,'current_trip_id',t.id,
   'round_phase',r.phase,'round_device_id',r.device_id,
   'trusted_device_exists',d.device_id is not null,'trusted_device_revoked',d.revoked_at is not null,
   'replacement_allowed',waiting));
end $$;

create or replace function public.admin_driver_offline_access(p_driver uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.ops_actor(true);
 if not exists(select 1 from public.profiles where id=p_driver and role='DRIVER') then
  raise exception using errcode='22023',message='Select a driver.';
 end if;
 return public.offline_driver_access_state(p_driver);
end $$;

create or replace function public.offline_admin_reset_access(p_driver uuid,p_trip uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.trips; r public.driver_offline_rounds; j jsonb; retry uuid; revoked jsonb; state jsonb;
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
 select * into t from public.trips where id=public.offline_current_trip(p_driver) for update;
 if t.id is distinct from p_trip then
  raise exception using errcode='22023',message='The current trip changed. Reload the driver page before resetting offline access.';
 end if;
 state:=public.offline_driver_access_state(p_driver);
 -- Different request keys while waiting must not revoke an in-flight replacement
 -- or change the original reset authorization/time.
 if (state->>'reset_pending')::boolean then
  return public.ops_finish(p_key,j,p_driver,'DRIVER_OFFLINE_ACCESS_RESET_REUSED','profiles',null,
   jsonb_build_object('trip',t.id,'records_preserved',true),btrim(p_reason));
 end if;
 select * into r from public.driver_offline_rounds where trip_id=t.id;
 if r.trip_id is not null and t.status in ('LOADED','ACTIVE') then
  perform public.offline_admin_reset_device(t.id,btrim(p_reason),md5(p_key::text||':round-reset')::uuid);
 else
  select coalesce(jsonb_agg(device_id),'[]'::jsonb) into revoked from public.driver_trusted_devices
   where driver_id=p_driver and revoked_at is null;
  update public.driver_trusted_devices set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_reason),offline_reset_id=p_key
   where driver_id=p_driver and revoked_at is null;
 end if;
 return public.ops_finish(p_key,j,p_driver,'DRIVER_OFFLINE_ACCESS_RESET','profiles',null,
  jsonb_build_object('trip',t.id,'revoked_devices',revoked,'records_preserved',true,
   'replacement_pending',(state->>'can_reset')::boolean),btrim(p_reason));
end $$;

-- The actual UAT case has NO round: this browser holds a previously revoked
-- installation credential. A checked admin reset can authorize fresh credentials,
-- never reactivate those credentials or transfer an old encrypted journal.
-- Every normal check and round transfer remains in migration 29's preflight.
alter function public.offline_preparation_access(uuid,uuid,text) rename to offline_preparation_access_before_recovery;
revoke all on function public.offline_preparation_access_before_recovery(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.offline_preparation_access(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.driver_trusted_devices; state jsonb;
begin
 perform public.ops_actor(false);
 if p_trip=public.offline_current_trip(auth.uid()) and exists(select 1 from public.trips
   where id=p_trip and driver_id=auth.uid() and status in ('LOADED','ACTIVE') and not cancelled)
   and p_device is not null and p_token ~ '^[a-f0-9]{64}$'
   and not exists(select 1 from public.driver_offline_rounds where trip_id=p_trip)
   and not exists(select 1 from public.driver_trusted_devices where driver_id=auth.uid() and revoked_at is null) then
  select * into d from public.driver_trusted_devices where device_id=p_device and driver_id=auth.uid()
   and revoked_at is not null and token_hash=public.offline_hash(p_token);
  if d.device_id is not null then
   state:=public.offline_driver_access_state(auth.uid());
   if (state->>'reset_pending')::boolean and (state->>'last_reset_at')::timestamptz>=d.revoked_at then
    return jsonb_build_object('allowed',false,'replace_installation',true);
   end if;
   raise exception using errcode='MK002',message='This browser holds revoked offline credentials. An admin reset is required.';
  end if;
 end if;
 return public.offline_preparation_access_before_recovery(p_trip,p_device,p_token);
end $$;

-- Nonsecret, read-only development diagnostics. The application calls this only
-- in development; database authorization also restricts it to admin or self.
create function public.offline_ownership_diagnostics(p_driver uuid,p_device uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare state jsonb; d public.driver_trusted_devices;
begin
 -- STABLE RPCs run in read-only PostgREST transactions; use the read guard,
 -- never ops_actor's FOR SHARE row lock.
 if not public.has_operational_access() then
  raise exception using errcode='42501',message='Not authorized.';
 end if;
 if p_driver<>auth.uid() and not public.is_active_admin() then
  raise exception using errcode='42501',message='Not authorized.';
 end if;
 state:=public.offline_driver_access_state(p_driver);
 select * into d from public.driver_trusted_devices where driver_id=p_driver and device_id=p_device;
 return (state->'diagnostics')||jsonb_build_object('reset_eligible',(state->>'can_reset')::boolean,
  'incoming_device_id',p_device,'incoming_trusted_exists',d.device_id is not null,
  'incoming_trusted_revoked',d.revoked_at is not null);
end $$;
revoke all on function public.offline_current_trip(uuid),public.offline_driver_access_state(uuid),
 public.offline_ownership_diagnostics(uuid,uuid),public.offline_preparation_access(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.offline_ownership_diagnostics(uuid,uuid),public.offline_preparation_access(uuid,uuid,text) to authenticated;
-- A paused current trip may replace a lost phone without resuming the trip.
-- Reuse the same reset/transfer checks, locks, audit and token fencing, while
-- retaining phase=PAUSED. SEALED/EXCEPTION and terminal trips remain protected.
create or replace function public.offline_admin_reset_device(p_trip uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; t public.trips; j jsonb; retry uuid; owner_id uuid; revoked jsonb;
begin
 perform public.ops_actor(true);
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
  raise exception using errcode='22023',message='Enter a reason between 3 and 500 characters.';
 end if;
 j:=jsonb_build_object('operation','OFFLINE_DEVICE_RESET','trip',p_trip,'reason',p_reason);
 retry:=public.ops_retry(p_key,j); if retry is not null then return retry; end if;
 select driver_id into owner_id from public.trips where id=p_trip;
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||owner_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 select * into r from public.driver_offline_rounds where trip_id=p_trip for update;
 select * into t from public.trips where id=p_trip for update;
 if r.trip_id is null or t.status not in ('LOADED','ACTIVE') or r.phase not in ('PREPARED','ACTIVE','PAUSED') then
  raise exception using errcode='22023',message='Only a loaded or active delivery trip can replace its offline device.';
 end if;
 -- A second admin request must not invalidate a replacement already retrying
 -- this reset. Return the existing authorization without re-revoking devices.
 if r.offline_device_reset_pending then
  return public.ops_finish(p_key,j,p_trip,'OFFLINE_DEVICE_RESET_REUSED','trips',null,
   jsonb_build_object('reset_id',r.offline_device_reset_id,'records_preserved',true),p_reason);
 end if;
 select coalesce(jsonb_agg(device_id),'[]'::jsonb) into revoked from public.driver_trusted_devices
  where driver_id=r.driver_id and revoked_at is null;
 update public.driver_trusted_devices set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_reason),offline_reset_id=p_key
  where driver_id=r.driver_id and revoked_at is null;
 update public.driver_offline_rounds set offline_device_reset_pending=true,
  offline_device_reset_at=now(),offline_device_reset_by=auth.uid(),
  offline_device_reset_reason=btrim(p_reason),offline_device_reset_id=p_key where trip_id=p_trip;
 insert into public.driver_offline_reviews(trip_id,actor_id,action,details,reason)
  values(p_trip,auth.uid(),'DEVICE_RESET',jsonb_build_object('reset_id',p_key,'previous_device',r.device_id,
   'revoked_devices',revoked,'confirmed_sequence',r.confirmed_sequence,'reported_pending',r.reported_pending,
   'unreported_local_records','unknown; preserve old phone data'),btrim(p_reason));
 return public.ops_finish(p_key,j,p_trip,'OFFLINE_DEVICE_RESET','trips',
  jsonb_build_object('device',r.device_id),jsonb_build_object('reset_id',p_key,'revoked_devices',revoked,'records_preserved',true),p_reason);
end $$;

create or replace function public.offline_register(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; t public.trips;
begin
 perform public.ops_actor(false);
 if p_device is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='A secure device identity is required.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||auth.uid()::text,0));
 if exists(select 1 from public.driver_trusted_devices where device_id=p_device and
   (revoked_at is not null or driver_id<>auth.uid() or token_hash<>public.offline_hash(p_token))) or
   exists(select 1 from public.driver_trusted_devices where driver_id=auth.uid() and revoked_at is null and device_id<>p_device) then
  raise exception using errcode='42501',message='Use the approved trusted device for this driver.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 select * into r from public.driver_offline_rounds where trip_id=p_trip for update;
 if r.trip_id is not null and r.device_id<>p_device then
  select * into t from public.trips where id=p_trip and driver_id=auth.uid() for update;
  if not r.offline_device_reset_pending or r.driver_id<>auth.uid() or t.id is null or
    t.status not in ('LOADED','ACTIVE') or r.phase not in ('PREPARED','ACTIVE','PAUSED') or
    not exists(select 1 from public.driver_trusted_devices where device_id=p_device and driver_id=auth.uid()
      and revoked_at is null and token_hash=public.offline_hash(p_token)) then
   raise exception using errcode='42501',message='An explicit admin device reset is required for this trip.';
  end if;
  update public.driver_offline_rounds set device_id=p_device,token_hash=public.offline_hash(p_token),
   offline_device_reset_pending=false,last_seen_at=now() where trip_id=p_trip;
  insert into public.driver_offline_reviews(trip_id,actor_id,action,details,reason)
   values(p_trip,auth.uid(),'DEVICE_TRANSFER',jsonb_build_object('reset_id',r.offline_device_reset_id,
    'previous_device',r.device_id,'replacement_device',p_device,'confirmed_sequence',r.confirmed_sequence,
    'previous_reported_pending',r.reported_pending),r.offline_device_reset_reason);
  insert into public.audit_events(actor_user_id,action,entity,entity_id,before_json,after_json,reason)
   values(auth.uid(),'OFFLINE_DEVICE_TRANSFERRED','trips',p_trip,jsonb_build_object('device',r.device_id),
    jsonb_build_object('device',p_device,'reset_id',r.offline_device_reset_id),r.offline_device_reset_reason);
 end if;
 perform public.offline_register_round_core(p_trip,p_device,p_token);
 return to_jsonb(public.offline_device(p_trip,p_device,p_token))-array['token_hash','exception_reason','exception_by','exception_at'];
end $$;

create or replace function public.trusted_device_register(p_device uuid,p_token text,p_name text,p_recovery text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.driver_trusted_devices; r public.driver_offline_rounds;
begin
 perform public.ops_actor(false);
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||auth.uid()::text,0));
 select * into d from public.driver_trusted_devices where device_id=p_device for update;
 if d.driver_id=auth.uid() and d.revoked_at is not null and d.token_hash=public.offline_hash(p_token) then
  select x.* into r from public.driver_offline_rounds x join public.trips t on t.id=x.trip_id
   where x.driver_id=auth.uid() and t.driver_id=auth.uid() and t.status in ('LOADED','ACTIVE')
    and x.phase in ('PREPARED','ACTIVE','PAUSED') and x.offline_device_reset_pending and x.device_id<>p_device
    and x.offline_device_reset_id=d.offline_reset_id
    and x.offline_device_reset_at=d.revoked_at and x.offline_device_reset_by=d.revoked_by
   order by x.offline_device_reset_at desc limit 1 for update of x;
  if r.trip_id is not null then
   if exists(select 1 from public.driver_trusted_devices where driver_id=auth.uid() and revoked_at is null and device_id<>p_device) then
    raise exception using errcode='MK001',message='Another replacement device has already registered.';
   end if;
   update public.driver_trusted_devices set revoked_at=null,revoked_by=null,revoke_reason=null,offline_reset_id=null,last_seen_at=now() where device_id=p_device;
   insert into public.audit_events(actor_user_id,action,entity,entity_id,before_json,after_json,reason)
    values(auth.uid(),'OFFLINE_REPLACEMENT_APPROVED','driver_trusted_devices',p_device,
     jsonb_build_object('revoked_at',d.revoked_at,'revoked_by',d.revoked_by),
     jsonb_build_object('reset_id',r.offline_device_reset_id,'reset_by',r.offline_device_reset_by,'replacement_device',p_device),r.offline_device_reset_reason);
  end if;
 end if;
 return public.trusted_device_register_before_admin_transfer(p_device,p_token,p_name,p_recovery);
end $$;

create or replace function public.offline_preparation_access_before_recovery(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.trips; r public.driver_offline_rounds; d public.driver_trusted_devices; replacement boolean;
begin
 perform public.ops_actor(false);
 select * into t from public.trips where id=p_trip and driver_id=auth.uid() and status in ('LOADED','ACTIVE');
 if t.id is null or p_device is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='An approved driver and assigned loaded or active trip are required.';
 end if;
 select * into r from public.driver_offline_rounds where trip_id=p_trip;
 select * into d from public.driver_trusted_devices where device_id=p_device;
 replacement:=coalesce(r.offline_device_reset_pending and r.device_id<>p_device and d.driver_id=auth.uid()
  and r.phase in ('PREPARED','ACTIVE','PAUSED') and d.offline_reset_id=r.offline_device_reset_id
  and d.revoked_at=r.offline_device_reset_at and d.revoked_by=r.offline_device_reset_by,false);
 if exists(select 1 from public.driver_trusted_devices where driver_id=auth.uid() and revoked_at is null and device_id<>p_device)
   or (d.device_id is not null and (d.driver_id<>auth.uid() or (d.revoked_at is not null and not replacement) or d.token_hash<>public.offline_hash(p_token)))
   or (r.trip_id is not null and (
    r.driver_id<>auth.uid()
    or (r.device_id=p_device and (r.offline_device_reset_pending or r.token_hash<>public.offline_hash(p_token)))
    or (r.device_id<>p_device and not r.offline_device_reset_pending)
   )) then
  raise exception using errcode='MK001',message='An explicit warehouse admin device reset is required before this phone can prepare this trip.';
 end if;
 return jsonb_build_object('allowed',true);
end $$;
notify pgrst, 'reload schema';
