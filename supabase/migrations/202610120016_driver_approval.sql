-- Forward only. Existing trusted active DRIVER profiles retain authorization.
-- Review the linked project's existing profiles before applying this backfill.
alter table public.profiles
  add column phone text not null default '' check (length(phone)<=40),
  add column approval_status text not null default 'PENDING'
    check (approval_status in ('PENDING','APPROVED','REJECTED','SUSPENDED')),
  add column approved_at timestamptz,
  add column approved_by uuid references public.profiles(id) on delete restrict,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references public.profiles(id) on delete restrict;
-- Preserve existing access, identities, names and histories. Original approval
-- dates/approvers were never recorded: leave them NULL, never invent them.
update public.profiles set approval_status=case when is_active then 'APPROVED' else 'SUSPENDED' end
  where role='DRIVER';
alter table public.profiles add constraint driver_approval_active_consistent
  check (role<>'DRIVER' or is_active=(approval_status='APPROVED'));

-- A trusted provisioning tool cannot accidentally create an operational driver
-- by relying on the old is_active default. Explicit approval remains possible.
create function public.driver_pending_default() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.role='DRIVER' then new.is_active:=new.approval_status='APPROVED'; end if;
  return new;
end;
$$;
revoke all on function public.driver_pending_default() from public,anon,authenticated,service_role;
create trigger profiles_driver_pending before insert on public.profiles
  for each row execute function public.driver_pending_default();

create function public.has_operational_access() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and is_active
    and (role='ADMIN' or (role='DRIVER' and approval_status='APPROVED')));
$$;
revoke all on function public.has_operational_access() from public,anon,service_role;
grant execute on function public.has_operational_access() to authenticated;
-- An additional restrictive SELECT policy preserves every existing scope rule.
-- A pending user may still read their own profile, but no business data.
do $$ declare t text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname<>'profiles'
  loop
    execute format('create policy approved_account_read on public.%I as restrictive for select to authenticated using ((select public.has_operational_access()))',t);
  end loop;
end $$;
create or replace function public.ops_actor(p_admin boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id=auth.uid() and is_active
    and (role='ADMIN' or approval_status='APPROVED') for share;
  if not found or (p_admin and v_profile.role<>'ADMIN') then
    raise exception using errcode='42501',message='Not authorized for this operation.';
  end if;
  return v_profile.id;
end;
$$;

-- Auth identity and email come from auth.users; passwords/metadata are never read.
-- A profile-less authenticated account can ONLY register itself as pending.
create function public.save_own_profile(p_name text,p_phone text,p_version integer,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_old public.profiles; v_new public.profiles; v_payload jsonb; v_retry uuid;
begin
  if v_id is null or not exists(select 1 from auth.users where id=v_id) then
    raise exception using errcode='42501',message='Sign in to update your profile.';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_phone is null or length(p_phone)>40
    or p_version is null or p_version<0 then raise exception using errcode='22023',message='Enter a full name and a valid optional phone number.'; end if;
  v_payload:=jsonb_build_object('operation','OWN_PROFILE','name',p_name,'phone',p_phone,'version',p_version);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  select * into v_old from public.profiles where id=v_id for update;
  if found then
    if v_old.version<>p_version then raise exception using errcode='40001',message='Record changed; reload before saving.'; end if;
    -- Access, role, approval, Auth ID and historical foreign keys stay unchanged.
    update public.profiles set name=btrim(p_name),phone=btrim(p_phone),version=version+1,updated_at=now()
      where id=v_id returning * into v_new;
  else
    if p_version<>0 then raise exception using errcode='22023',message='Profile not found.'; end if;
    insert into public.profiles(id,name,role,is_active,approval_status,phone)
      values(v_id,btrim(p_name),'DRIVER',false,'PENDING',btrim(p_phone)) returning * into v_new;
  end if;
  return public.ops_finish(p_key,v_payload,v_id,'PROFILE_UPDATED','profiles',
    case when p_version=0 then null else to_jsonb(v_old) end,to_jsonb(v_new),'Account owner updated contact details');
end;
$$;

create function public.save_driver_account(p_id uuid,p_name text,p_phone text,p_version integer,p_approve boolean,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_old public.profiles; v_new public.profiles; v_payload jsonb; v_retry uuid;
begin
  perform public.ops_actor(true);
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_phone is null or length(p_phone)>40
    or p_version is null or p_version<0 or p_approve is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500
    then raise exception using errcode='22023',message='Invalid driver details.'; end if;
  v_payload:=jsonb_build_object('operation','DRIVER_ACCOUNT','id',p_id,'name',p_name,'phone',p_phone,'version',p_version,'approve',p_approve,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  select * into v_old from public.profiles where id=p_id for update;
  if found then
    if v_old.role<>'DRIVER' then raise exception using errcode='42501',message='Only driver profiles can be managed here.'; end if;
    if v_old.version<>p_version then raise exception using errcode='40001',message='Record changed; reload before saving.'; end if;
    if p_approve then raise exception using errcode='22023',message='Use the approval action to change account access.'; end if;
    update public.profiles set name=btrim(p_name),phone=btrim(p_phone),version=version+1,updated_at=now()
      where id=p_id returning * into v_new;
  else
    if p_version<>0 then raise exception using errcode='22023',message='Driver not found.'; end if;
    if not exists(select 1 from auth.users where id=p_id and email is not null) then
      raise exception using errcode='22023',message='Create the email account in Supabase Auth first.';
    end if;
    insert into public.profiles(id,name,role,is_active,phone,approval_status,approved_at,approved_by,status_changed_at,status_changed_by)
      values(p_id,btrim(p_name),'DRIVER',p_approve,btrim(p_phone),case when p_approve then 'APPROVED' else 'PENDING' end,
        case when p_approve then now() end,case when p_approve then auth.uid() end,now(),auth.uid()) returning * into v_new;
  end if;
  return public.ops_finish(p_key,v_payload,p_id,'DRIVER_ACCOUNT_SAVED','profiles',
    case when p_version=0 then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason));
end;
$$;

create function public.change_driver_status(p_id uuid,p_status text,p_version integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_old public.profiles; v_new public.profiles; v_payload jsonb; v_retry uuid;
begin
  perform public.ops_actor(true);
  if p_id is null or p_status is null or p_status not in ('APPROVED','REJECTED','SUSPENDED') or p_version is null or p_version<1
    or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Invalid driver approval action.'; end if;
  v_payload:=jsonb_build_object('operation','DRIVER_STATUS','id',p_id,'status',p_status,'version',p_version,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  select * into v_old from public.profiles where id=p_id for update;
  if not found or v_old.role<>'DRIVER' then raise exception using errcode='42501',message='Only driver profiles can be managed here.'; end if;
  if v_old.version<>p_version then raise exception using errcode='40001',message='Record changed; reload before saving.'; end if;
  if not ((v_old.approval_status in ('PENDING','REJECTED','SUSPENDED') and p_status='APPROVED')
    or (v_old.approval_status='PENDING' and p_status='REJECTED')
    or (v_old.approval_status='APPROVED' and p_status='SUSPENDED')) then
    raise exception using errcode='22023',message='This approval action is not valid for the current account status.';
  end if;
  -- Suspension immediately blocks NEW operations, even during an assigned trip.
  -- ops_actor locks the actor FOR SHARE; in-flight operations finish before the
  -- status UPDATE obtains its lock. Trips and journals remain for admin handling.
  update public.profiles set approval_status=p_status,is_active=(p_status='APPROVED'),version=version+1,updated_at=now(),
    status_changed_at=now(),status_changed_by=auth.uid(),
    approved_at=case when p_status='APPROVED' then coalesce(approved_at,now()) else approved_at end,
    approved_by=case when p_status='APPROVED' then coalesce(approved_by,auth.uid()) else approved_by end
    where id=p_id returning * into v_new;
  return public.ops_finish(p_key,v_payload,p_id,'DRIVER_STATUS_CHANGED','profiles',to_jsonb(v_old),to_jsonb(v_new),btrim(p_reason));
end;
$$;

-- Retain the old signature for compatibility without a hidden activation path.
create or replace function public.save_driver(p_id uuid,p_name text,p_active boolean,p_version integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_old public.profiles; v_new public.profiles; v_payload jsonb; v_retry uuid;
begin
  perform public.ops_actor(true);
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_active is null or p_version is null or p_version<0
    or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Invalid driver details.'; end if;
  v_payload:=jsonb_build_object('operation','DRIVER','id',p_id,'name',p_name,'active',p_active,'version',p_version,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  select * into v_old from public.profiles where id=p_id for update;
  if found then
    if v_old.role<>'DRIVER' then raise exception using errcode='42501',message='Only driver profiles can be managed here.'; end if;
    if v_old.version<>p_version then raise exception using errcode='40001',message='Record changed; reload before saving.'; end if;
    if p_active and not v_old.is_active then raise exception using errcode='22023',message='Use the approval action to change account access.'; end if;
    if not p_active and exists(select 1 from public.trips where driver_id=p_id and status<>'CLOSED') then raise exception using errcode='22023',message='Reconcile or cancel the assigned trip before disabling this driver.'; end if;
    update public.profiles set name=btrim(p_name),is_active=p_active,
      approval_status=case when not p_active and approval_status='APPROVED' then 'SUSPENDED' else approval_status end,
      status_changed_at=case when is_active<>p_active then now() else status_changed_at end,
      status_changed_by=case when is_active<>p_active then auth.uid() else status_changed_by end,
      version=version+1,updated_at=now() where id=p_id returning * into v_new;
  else
    if p_version<>0 then raise exception using errcode='22023',message='Driver not found.'; end if;
    insert into public.profiles(id,name,role,is_active,approval_status,status_changed_at,status_changed_by)
      values(p_id,btrim(p_name),'DRIVER',false,'PENDING',now(),auth.uid()) returning * into v_new;
  end if;
  return public.ops_finish(p_key,v_payload,p_id,'DRIVER_SAVED','profiles',case when p_version=0 then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason));
end;
$$;

create function public.admin_driver_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  -- Read guard (ops_actor's row lock is intentionally not used in a STABLE RPC).
  if not public.is_active_admin() then raise exception using errcode='42501',message='Admin access required.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'email',u.email,'phone',p.phone,'version',p.version,'is_active',p.is_active,
    'approval_status',p.approval_status,'approved_at',p.approved_at,'approved_by_name',a.name,
    'status_changed_at',p.status_changed_at,
    'assigned_vehicles',coalesce((select jsonb_agg(v.plate_number order by v.plate_number) from public.trips t
      join public.vehicles v on v.id=t.vehicle_id where t.driver_id=p.id and t.status<>'CLOSED'),'[]'::jsonb),
    'recent_activity',greatest((select max(e.created_at) from public.audit_events e where e.actor_user_id=p.id),
      (select max(greatest(t.created_at,t.started_at,t.submitted_at,t.closed_at)) from public.trips t where t.driver_id=p.id))
  ) order by case p.approval_status when 'PENDING' then 0 else 1 end,p.name)
    from public.profiles p join auth.users u on u.id=p.id left join public.profiles a on a.id=p.approved_by
    where p.role='DRIVER'),'[]'::jsonb);
end;
$$;
revoke all on function public.save_own_profile(text,text,integer,uuid),
  public.save_driver_account(uuid,text,text,integer,boolean,text,uuid),
  public.change_driver_status(uuid,text,integer,text,uuid),public.admin_driver_directory()
  from public,anon,authenticated,service_role;
grant execute on function public.save_own_profile(text,text,integer,uuid),
  public.save_driver_account(uuid,text,text,integer,boolean,text,uuid),
  public.change_driver_status(uuid,text,integer,text,uuid),public.admin_driver_directory() to authenticated;
