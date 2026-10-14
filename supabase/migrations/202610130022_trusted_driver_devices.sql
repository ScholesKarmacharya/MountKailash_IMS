-- Forward only. Existing round writers and journals are retained.
create table public.driver_trusted_devices (
 device_id uuid primary key, driver_id uuid not null references public.profiles(id),
 token_hash text not null, name text not null check(length(name) between 1 and 120),
 recovery_box text not null check(length(recovery_box) between 30 and 10000),
 registered_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 last_synced_at timestamptz,
 revoked_at timestamptz, revoked_by uuid references public.profiles(id), revoke_reason text
);
create unique index one_active_trusted_device_per_driver on public.driver_trusted_devices(driver_id) where revoked_at is null;
alter table public.driver_trusted_devices enable row level security;
revoke all on public.driver_trusted_devices from public,anon,authenticated,service_role;
grant select(device_id,driver_id,name,registered_at,last_seen_at,last_synced_at,revoked_at,revoked_by,revoke_reason) on public.driver_trusted_devices to authenticated;
create policy trusted_device_read on public.driver_trusted_devices for select to authenticated using(public.has_operational_access() and (public.is_active_admin() or driver_id=auth.uid()));
create function public.trusted_device_confirmed_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='CONFIRMED' then
  update public.driver_trusted_devices set last_synced_at=new.processed_at where device_id=(select device_id from public.driver_offline_rounds where trip_id=new.trip_id);
 end if;
 return new;
end $$;
revoke all on function public.trusted_device_confirmed_sync() from public,anon,authenticated,service_role;
create trigger trusted_device_sync_receipt after insert or update of status on public.driver_offline_operations for each row execute function public.trusted_device_confirmed_sync();

create function public.trusted_device_register(p_device uuid,p_token text,p_name text,p_recovery text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.driver_trusted_devices;
begin
 perform public.ops_actor(false);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='DRIVER') or p_device is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_recovery is null or length(p_recovery) not between 30 and 10000 then
  raise exception using errcode='42501',message='An approved driver and a secure device identity are required.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||auth.uid()::text,0));
 select * into d from public.driver_trusted_devices where device_id=p_device for update;
 if d.device_id is not null then
  if d.driver_id<>auth.uid() or d.revoked_at is not null or d.token_hash<>public.offline_hash(p_token) then raise exception using errcode='42501',message='Trusted device access was revoked or does not belong to this driver.'; end if;
  -- Registration is idempotent, and cannot silently replace the recovery key.
  return jsonb_build_object('device',d.device_id,'registered',true);
 end if;
 if exists(select 1 from public.driver_trusted_devices where driver_id=auth.uid() and revoked_at is null) then raise exception using errcode='42501',message='Only one trusted device is allowed. Ask the admin to review the existing device.'; end if;
 insert into public.driver_trusted_devices(device_id,driver_id,token_hash,name,recovery_box) values(p_device,auth.uid(),public.offline_hash(p_token),btrim(p_name),p_recovery);
 insert into public.audit_events(actor_user_id,action,entity,entity_id,after_json,reason) values(auth.uid(),'TRUSTED_DEVICE_REGISTERED','driver_trusted_devices',p_device,jsonb_build_object('name',btrim(p_name)),'Approved driver activated device');
 return jsonb_build_object('device',p_device,'registered',true);
end $$;
create function public.trusted_device_recovery(p_device uuid) returns text language plpgsql security definer set search_path='' as $$
declare v_box text;
begin
 perform public.ops_actor(false);
 select recovery_box into v_box from public.driver_trusted_devices where device_id=p_device and driver_id=auth.uid() and revoked_at is null;
 if not found then raise exception using errcode='42501',message='Trusted device access is unavailable.'; end if;
 return v_box;
end $$;
create function public.trusted_device_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_admin() then raise exception using errcode='42501',message='Admin access required.'; end if;
 return coalesce((select jsonb_agg((to_jsonb(d)-array['token_hash','recovery_box'])||jsonb_build_object('driver_name',p.name) order by d.registered_at desc) from public.driver_trusted_devices d join public.profiles p on p.id=d.driver_id),'[]'::jsonb);
end $$;
create function public.trusted_device_revoke(p_device uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.driver_trusted_devices;
begin
 perform public.ops_actor(false);
 select * into d from public.driver_trusted_devices where device_id=p_device for update;
 if not found or (not public.is_active_admin() and d.driver_id<>auth.uid()) then raise exception using errcode='42501',message='Not authorized to revoke this device.'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Enter a reason between 3 and 500 characters.'; end if;
 if not public.is_active_admin() and exists(select 1 from public.driver_offline_rounds where device_id=p_device and (phase='ACTIVE' or reported_pending>0)) then raise exception using errcode='22023',message='Sync and seal the delivery round before removing this device.'; end if;
 if d.revoked_at is null then
  update public.driver_trusted_devices set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_reason) where device_id=p_device;
  insert into public.audit_events(actor_user_id,action,entity,entity_id,after_json,reason) values(auth.uid(),'TRUSTED_DEVICE_REVOKED','driver_trusted_devices',p_device,jsonb_build_object('records_preserved',true),btrim(p_reason));
 end if;
 return p_device;
end $$;

-- Existing round permissions remain intact; new trusted devices additionally
-- honor revocation and the one-device policy at every read/check-in/upload.
create or replace function public.offline_device(p_trip uuid,p_device uuid,p_token text) returns public.driver_offline_rounds
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; d public.driver_trusted_devices;
begin
 select * into r from public.driver_offline_rounds where trip_id=p_trip and driver_id=auth.uid() and device_id=p_device and token_hash=public.offline_hash(p_token) for update;
 if not found then raise exception using errcode='42501',message='This device is not the authorized writer for this load.'; end if;
 select * into d from public.driver_trusted_devices where device_id=p_device for update;
 if d.device_id is not null and (d.revoked_at is not null or d.driver_id<>auth.uid() or d.token_hash<>public.offline_hash(p_token)) then raise exception using errcode='42501',message='Trusted device access was revoked. Keep saved records for admin review.'; end if;
 update public.driver_trusted_devices set last_seen_at=now() where device_id=p_device and driver_id=auth.uid();
 return r;
end $$;
alter function public.offline_register(uuid,uuid,text) rename to offline_register_round_core;
revoke all on function public.offline_register_round_core(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.offline_register(p_trip uuid,p_device uuid,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.ops_actor(false);
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||auth.uid()::text,0));
 if exists(select 1 from public.driver_trusted_devices where device_id=p_device and (revoked_at is not null or driver_id<>auth.uid() or token_hash<>public.offline_hash(p_token))) or exists(select 1 from public.driver_trusted_devices where driver_id=auth.uid() and revoked_at is null and device_id<>p_device) then raise exception using errcode='42501',message='Use the approved trusted device for this driver.'; end if;
 perform public.offline_register_round_core(p_trip,p_device,p_token);
 return to_jsonb(public.offline_device(p_trip,p_device,p_token))-array['token_hash','exception_reason','exception_by','exception_at'];
end $$;
revoke all on function public.trusted_device_register(uuid,text,text,text),public.trusted_device_recovery(uuid),public.trusted_device_revoke(uuid,text),public.trusted_device_directory(),public.offline_register(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.trusted_device_register(uuid,text,text,text),public.trusted_device_recovery(uuid),public.trusted_device_revoke(uuid,text),public.trusted_device_directory(),public.offline_register(uuid,uuid,text) to authenticated;
