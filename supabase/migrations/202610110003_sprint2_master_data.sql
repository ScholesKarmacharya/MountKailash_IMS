-- Forward-only Sprint 2 master data. Existing identities and journals stay intact.
alter table public.profiles add column version integer not null default 1 check (version>0);
create table public.customers (
  id uuid primary key,
  name text not null check(length(btrim(name)) between 1 and 120),
  shop_name text not null default '' check(length(shop_name)<=160),
  phone text not null default '' check(length(phone)<=40),
  address text not null default '' check(length(address)<=500),
  notes text not null default '' check(length(notes)<=2000),
  is_active boolean not null default true,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_search_name on public.customers(lower(name));
create table public.vehicles (
  id uuid primary key,
  plate_number text not null unique check(length(btrim(plate_number)) between 1 and 40),
  description text not null default '' check(length(description)<=500),
  location_id uuid not null unique references public.stock_locations(id),
  is_active boolean not null default true,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
revoke all on public.customers,public.vehicles from anon,authenticated,service_role;
grant select on public.customers,public.vehicles to authenticated;
create policy customers_admin_read on public.customers for select to authenticated using((select public.is_active_admin()));
create policy vehicles_admin_read on public.vehicles for select to authenticated using((select public.is_active_admin()));

-- Internal, non-callable primitives. Caller identity always comes from Auth.
create function public.ops_actor(p_admin boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id=auth.uid() and is_active for share;
  if not found or (p_admin and v_profile.role<>'ADMIN') then
    raise exception using errcode='42501',message='Not authorized for this operation.';
  end if;
  return v_profile.id;
end;
$$;
create function public.ops_retry(p_key uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_request public.operation_requests;
begin
  if p_key is null then raise exception using errcode='22023',message='Request key required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
  select * into v_request from public.operation_requests where actor_user_id=auth.uid() and idempotency_key=p_key;
  if found then
    if v_request.payload<>p_payload then raise exception using errcode='22023',message='Idempotency key already used for a different request.'; end if;
    return v_request.result_id;
  end if;
  return null;
end;
$$;
create function public.ops_finish(p_key uuid,p_payload jsonb,p_result uuid,p_action text,p_entity text,p_before jsonb,p_after jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  insert into public.operation_requests(actor_user_id,idempotency_key,payload,result_id) values(auth.uid(),p_key,p_payload,p_result);
  insert into public.audit_events(actor_user_id,action,entity,entity_id,before_json,after_json,reason)
    values(auth.uid(),p_action,p_entity,p_result,p_before,p_after,p_reason);
  return p_result;
end;
$$;
revoke all on function public.ops_actor(boolean),public.ops_retry(uuid,jsonb),public.ops_finish(uuid,jsonb,uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create function public.save_customer(p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_notes text,p_active boolean,p_version integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_old public.customers; v_new public.customers;
begin
  perform public.ops_actor(true);
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_shop is null or length(p_shop)>160
    or p_phone is null or length(p_phone)>40 or p_address is null or length(p_address)>500 or p_notes is null or length(p_notes)>2000
    or p_active is null or p_version is null or p_version<0 or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode='22023',message='Invalid customer details.';
  end if;
  v_payload:=jsonb_build_object('operation','CUSTOMER','id',p_id,'name',p_name,'shop',p_shop,'phone',p_phone,'address',p_address,'notes',p_notes,'active',p_active,'version',p_version,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  select * into v_old from public.customers where id=p_id for update;
  if found then
    if v_old.version<>p_version then raise exception using errcode='40001',message='Record changed; reload before saving.'; end if;
    update public.customers set name=btrim(p_name),shop_name=btrim(p_shop),phone=btrim(p_phone),address=btrim(p_address),notes=btrim(p_notes),is_active=p_active,version=version+1,updated_at=now() where id=p_id returning * into v_new;
  else
    if p_version<>0 then raise exception using errcode='22023',message='Customer not found.'; end if;
    insert into public.customers(id,name,shop_name,phone,address,notes,is_active) values(p_id,btrim(p_name),btrim(p_shop),btrim(p_phone),btrim(p_address),btrim(p_notes),p_active) returning * into v_new;
  end if;
  return public.ops_finish(p_key,v_payload,p_id,'CUSTOMER_SAVED','customers',case when p_version=0 then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason));
end;
$$;
create function public.save_vehicle(p_id uuid,p_plate text,p_description text,p_active boolean,p_version integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_old public.vehicles; v_new public.vehicles; v_location uuid;
begin
  perform public.ops_actor(true);
  if p_id is null or p_plate is null or length(btrim(p_plate)) not between 1 and 40 or p_description is null or length(p_description)>500
    or p_active is null or p_version is null or p_version<0 or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode='22023',message='Invalid vehicle details.';
  end if;
  v_payload:=jsonb_build_object('operation','VEHICLE','id',p_id,'plate',p_plate,'description',p_description,'active',p_active,'version',p_version,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  select * into v_old from public.vehicles where id=p_id for update;
  if found then
    if v_old.version<>p_version then raise exception using errcode='40001',message='Record changed; reload before saving.'; end if;
    update public.vehicles set plate_number=upper(btrim(p_plate)),description=btrim(p_description),is_active=p_active,version=version+1,updated_at=now() where id=p_id returning * into v_new;
  else
    if p_version<>0 then raise exception using errcode='22023',message='Vehicle not found.'; end if;
    insert into public.stock_locations(code,name,kind) values('VEHICLE_'||p_id::text,upper(btrim(p_plate)),'VEHICLE') returning id into v_location;
    insert into public.vehicles(id,plate_number,description,is_active,location_id) values(p_id,upper(btrim(p_plate)),btrim(p_description),p_active,v_location) returning * into v_new;
  end if;
  return public.ops_finish(p_key,v_payload,p_id,'VEHICLE_SAVED','vehicles',case when p_version=0 then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason));
end;
$$;
revoke all on function public.save_customer(uuid,text,text,text,text,text,boolean,integer,text,uuid),public.save_vehicle(uuid,text,text,boolean,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_customer(uuid,text,text,text,text,text,boolean,integer,text,uuid),public.save_vehicle(uuid,text,text,boolean,integer,text,uuid) to authenticated;
