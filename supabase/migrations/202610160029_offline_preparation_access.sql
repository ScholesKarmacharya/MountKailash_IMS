-- Forward only. No operation, review, audit event or encrypted history is deleted.
-- An old round can be bound to a legacy device while another device registered
-- before discovering that binding. Admin reset must fence both registrations.
alter table public.driver_trusted_devices add column offline_reset_id uuid;
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
 if r.trip_id is null or t.status not in ('LOADED','ACTIVE') or r.phase not in ('PREPARED','ACTIVE') then
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

-- A replacement may already have registered before discovering the legacy
-- binding. Reapprove only credentials revoked by THIS still-pending admin reset,
-- never the former writer or an independently revoked device. One driver lock
-- prevents two replacements from becoming approved concurrently.
alter function public.trusted_device_register(uuid,text,text,text) rename to trusted_device_register_before_admin_transfer;
revoke all on function public.trusted_device_register_before_admin_transfer(uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.trusted_device_register(p_device uuid,p_token text,p_name text,p_recovery text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.driver_trusted_devices; r public.driver_offline_rounds;
begin
 perform public.ops_actor(false);
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||auth.uid()::text,0));
 select * into d from public.driver_trusted_devices where device_id=p_device for update;
 if d.driver_id=auth.uid() and d.revoked_at is not null and d.token_hash=public.offline_hash(p_token) then
  select x.* into r from public.driver_offline_rounds x join public.trips t on t.id=x.trip_id
   where x.driver_id=auth.uid() and t.driver_id=auth.uid() and t.status in ('LOADED','ACTIVE')
    and x.phase in ('PREPARED','ACTIVE') and x.offline_device_reset_pending and x.device_id<>p_device
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
revoke all on function public.trusted_device_register(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.trusted_device_register(uuid,text,text,text) to authenticated;

-- Read-only preparation preflight. Normal sign-in never authorizes a transfer.
create function public.offline_preparation_access(p_trip uuid,p_device uuid,p_token text) returns jsonb
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
  and r.phase in ('PREPARED','ACTIVE') and d.offline_reset_id=r.offline_device_reset_id
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
revoke all on function public.offline_preparation_access(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.offline_preparation_access(uuid,uuid,text) to authenticated;
