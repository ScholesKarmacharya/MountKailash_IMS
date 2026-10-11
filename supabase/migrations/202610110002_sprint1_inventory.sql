-- Additive Sprint 1. No existing users, days or journals are replaced.
create type public.product_kind as enum ('FULL_JAR', 'BOTTLE_CARTON');
create type public.stock_kind as enum ('FULL_JAR', 'EMPTY_JAR', 'BOTTLE_CARTON');

create table public.products (
  id uuid primary key,
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind public.product_kind not null,
  unit text not null check (length(btrim(unit)) between 1 and 40),
  default_price numeric(14,2) not null check (default_price >= 0),
  is_active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('WAREHOUSE','VEHICLE','CUSTOMER','DAMAGE')),
  created_at timestamptz not null default now()
);
-- Provisional one warehouse; no vehicle/customer identities or stock invented.
insert into public.stock_locations(code,name,kind) values ('MAIN','Main warehouse','WAREHOUSE');
create table public.inventory_balances (
  location_id uuid not null references public.stock_locations(id),
  product_id uuid not null references public.products(id),
  stock_kind public.stock_kind not null,
  quantity integer not null default 0 check (quantity >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  primary key (location_id,product_id,stock_kind)
);
create table public.operation_requests (
  actor_user_id uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  payload jsonb not null,
  result_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id,idempotency_key)
);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  stock_kind public.stock_kind not null,
  from_location_id uuid references public.stock_locations(id),
  to_location_id uuid references public.stock_locations(id),
  quantity integer not null check (quantity > 0),
  movement_type text not null check (movement_type in ('MANUAL_INCREASE','MANUAL_DECREASE')),
  business_day_id uuid not null references public.business_days(id),
  actor_user_id uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique(actor_user_id,idempotency_key),
  check ((movement_type='MANUAL_INCREASE' and from_location_id is null and to_location_id is not null)
    or (movement_type='MANUAL_DECREASE' and from_location_id is not null and to_location_id is null))
);
create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  stock_movement_id uuid not null unique references public.stock_movements(id),
  delta integer not null check (delta <> 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  notes text not null default '' check (length(notes) <= 2000),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  created_at timestamptz not null default now(),
  check (quantity_after::bigint = quantity_before::bigint + delta::bigint)
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id),
  action text not null,
  entity text not null,
  entity_id uuid not null,
  before_json jsonb,
  after_json jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index stock_movements_day_created on public.stock_movements(business_day_id,created_at desc);
create index stock_adjustments_created on public.stock_adjustments(created_at desc,id);
create index audit_events_entity on public.audit_events(entity,entity_id,created_at desc);

create function public.reject_journal_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception using errcode='42501', message='Journal entries are immutable; append a correction.'; end;
$$;
create trigger movements_immutable before update or delete on public.stock_movements for each row execute function public.reject_journal_mutation();
create trigger adjustments_immutable before update or delete on public.stock_adjustments for each row execute function public.reject_journal_mutation();
create trigger audit_immutable before update or delete on public.audit_events for each row execute function public.reject_journal_mutation();
create trigger requests_immutable before update or delete on public.operation_requests for each row execute function public.reject_journal_mutation();
create trigger movements_no_truncate before truncate on public.stock_movements for each statement execute function public.reject_journal_mutation();
create trigger adjustments_no_truncate before truncate on public.stock_adjustments for each statement execute function public.reject_journal_mutation();
create trigger audit_no_truncate before truncate on public.audit_events for each statement execute function public.reject_journal_mutation();
create trigger requests_no_truncate before truncate on public.operation_requests for each statement execute function public.reject_journal_mutation();
revoke all on function public.reject_journal_mutation() from public,anon,authenticated;

-- Lock the authoritative profile until commit: disabling an actor cannot race a write.
create function public.require_inventory_admin() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  select id into v_actor from public.profiles where id=auth.uid() and role='ADMIN' and is_active for share;
  if v_actor is null then raise exception using errcode='42501', message='Active admin required.'; end if;
  return v_actor;
end;
$$;
revoke all on function public.require_inventory_admin() from public,anon,authenticated;

create function public.save_product(p_id uuid,p_sku text,p_name text,p_kind public.product_kind,p_unit text,
  p_price text,p_active boolean,p_version integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_payload jsonb; v_request public.operation_requests; v_old public.products; v_new public.products; v_location uuid;
begin
  v_actor := public.require_inventory_admin();
  if p_id is null or p_key is null or p_version is null or p_version < 0 or p_sku is null or p_name is null
    or p_kind is null or p_unit is null or p_active is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500
    or p_price is null or p_price !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    raise exception using errcode='22023',message='Invalid product details.';
  end if;
  v_payload := jsonb_build_object('operation','PRODUCT','id',p_id,'sku',p_sku,'name',p_name,'kind',p_kind,
    'unit',p_unit,'price',p_price,'active',p_active,'version',p_version,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_key::text,0));
  select * into v_request from public.operation_requests where actor_user_id=v_actor and idempotency_key=p_key;
  if found then
    if v_request.payload <> v_payload then raise exception using errcode='22023',message='Idempotency key already used for a different request.'; end if;
    return v_request.result_id;
  end if;
  select * into v_old from public.products where id=p_id for update;
  if found then
    if v_old.version <> p_version then raise exception using errcode='40001',message='Product changed; reload before saving.'; end if;
    if v_old.kind <> p_kind then raise exception using errcode='22023',message='Product kind cannot change after creation.'; end if;
    update public.products set sku=p_sku,name=btrim(p_name),unit=btrim(p_unit),default_price=p_price::numeric,
      is_active=p_active,version=version+1,updated_at=now() where id=p_id returning * into v_new;
  else
    if p_version <> 0 then raise exception using errcode='22023',message='Product not found.'; end if;
    insert into public.products(id,sku,name,kind,unit,default_price,is_active)
      values(p_id,p_sku,btrim(p_name),p_kind,btrim(p_unit),p_price::numeric,p_active) returning * into v_new;
    select id into strict v_location from public.stock_locations where code='MAIN' and kind='WAREHOUSE';
    insert into public.inventory_balances(location_id,product_id,stock_kind)
      select v_location,p_id,s from unnest(case when p_kind='FULL_JAR'
        then array['FULL_JAR','EMPTY_JAR']::public.stock_kind[] else array['BOTTLE_CARTON']::public.stock_kind[] end) s;
  end if;
  insert into public.audit_events(actor_user_id,action,entity,entity_id,before_json,after_json,reason)
    values(v_actor,case when p_version=0 then 'PRODUCT_CREATED' else 'PRODUCT_UPDATED' end,'products',p_id,
      case when p_version=0 then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason));
  insert into public.operation_requests values(v_actor,p_key,v_payload,p_id,now());
  return p_id;
end;
$$;

-- Minimal prerequisite only. No automatic cutoff, closing or reopening implemented.
create function public.open_inventory_business_day(p_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id uuid; v_request public.operation_requests; v_payload jsonb := '{"operation":"OPEN_DAY"}';
begin
  v_actor := public.require_inventory_admin();
  if p_key is null then raise exception using errcode='22023',message='Request key required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_key::text,0));
  select * into v_request from public.operation_requests where actor_user_id=v_actor and idempotency_key=p_key;
  if found then
    if v_request.payload <> v_payload then raise exception using errcode='22023',message='Idempotency key already used for a different request.'; end if;
    return v_request.result_id;
  end if;
  perform pg_advisory_xact_lock(610110002);
  if exists(select 1 from public.business_days where status in ('OPEN','CLOSING_REVIEW')) then
    raise exception using errcode='22023',message='A business day is already active.';
  end if;
  insert into public.business_days(date_label,opened_by) values((now() at time zone 'Asia/Kathmandu')::date,v_actor) returning id into v_id;
  insert into public.audit_events(actor_user_id,action,entity,entity_id,after_json,reason)
    values(v_actor,'DAY_OPENED','business_days',v_id,jsonb_build_object('status','OPEN'),'Opened for warehouse operations');
  insert into public.operation_requests values(v_actor,p_key,v_payload,v_id,now());
  return v_id;
end;
$$;

create function public.adjust_warehouse_stock(p_product uuid,p_kind public.stock_kind,p_delta integer,p_reason text,
  p_notes text,p_day uuid,p_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_payload jsonb; v_request public.operation_requests; v_product public.products;
  v_day public.business_days; v_location uuid; v_before integer; v_after bigint; v_movement uuid; v_adjustment uuid;
begin
  v_actor := public.require_inventory_admin();
  if p_product is null or p_kind is null or p_delta is null or p_delta=0 or abs(p_delta::bigint)>1000000000
    or p_reason is null or length(btrim(p_reason)) not between 3 and 500 or p_notes is null or length(p_notes)>2000
    or p_day is null or p_key is null then raise exception using errcode='22023',message='Invalid adjustment details.'; end if;
  v_payload := jsonb_build_object('operation','ADJUST','product',p_product,'kind',p_kind,'delta',p_delta,
    'reason',p_reason,'notes',p_notes,'day',p_day);
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_key::text,0));
  select * into v_request from public.operation_requests where actor_user_id=v_actor and idempotency_key=p_key;
  if found then
    if v_request.payload <> v_payload then raise exception using errcode='22023',message='Idempotency key already used for a different request.'; end if;
    return v_request.result_id;
  end if;
  select * into v_day from public.business_days where id=p_day for share;
  if not found or v_day.status <> 'OPEN' then raise exception using errcode='22023',message='An OPEN business day is required.'; end if;
  select * into v_product from public.products where id=p_product for share;
  if not found then raise exception using errcode='22023',message='Product not found.'; end if;
  -- Inactive products retain their stock; admins may correct physical counts.
  if (v_product.kind='FULL_JAR' and p_kind='BOTTLE_CARTON') or
    (v_product.kind='BOTTLE_CARTON' and p_kind <> 'BOTTLE_CARTON') then
    raise exception using errcode='22023',message='Stock state does not match product.';
  end if;
  select id into strict v_location from public.stock_locations where code='MAIN' and kind='WAREHOUSE';
  select quantity into v_before from public.inventory_balances
    where location_id=v_location and product_id=p_product and stock_kind=p_kind for update;
  if not found then raise exception using errcode='22023',message='Stock balance not found.'; end if;
  v_after := v_before::bigint+p_delta::bigint;
  if v_after < 0 then raise exception using errcode='22023',message='Insufficient stock; balance cannot be negative.'; end if;
  if v_after > 2147483647 then raise exception using errcode='22023',message='Stock quantity exceeds supported range.'; end if;
  update public.inventory_balances set quantity=v_after::integer,version=version+1
    where location_id=v_location and product_id=p_product and stock_kind=p_kind;
  insert into public.stock_movements(product_id,stock_kind,from_location_id,to_location_id,quantity,movement_type,business_day_id,actor_user_id,idempotency_key)
    values(p_product,p_kind,case when p_delta<0 then v_location end,case when p_delta>0 then v_location end,
      abs(p_delta),case when p_delta>0 then 'MANUAL_INCREASE' else 'MANUAL_DECREASE' end,p_day,v_actor,p_key) returning id into v_movement;
  insert into public.stock_adjustments(stock_movement_id,delta,reason,notes,quantity_before,quantity_after)
    values(v_movement,p_delta,btrim(p_reason),btrim(p_notes),v_before,v_after::integer) returning id into v_adjustment;
  insert into public.audit_events(actor_user_id,action,entity,entity_id,before_json,after_json,reason)
    values(v_actor,'STOCK_ADJUSTED','stock_adjustments',v_adjustment,jsonb_build_object('quantity',v_before),
      jsonb_build_object('quantity',v_after,'movement_id',v_movement,'business_day_id',p_day),btrim(p_reason));
  insert into public.operation_requests values(v_actor,p_key,v_payload,v_adjustment,now());
  return v_adjustment;
end;
$$;

revoke all on function public.save_product(uuid,text,text,public.product_kind,text,text,boolean,integer,text,uuid),
  public.open_inventory_business_day(uuid),
  public.adjust_warehouse_stock(uuid,public.stock_kind,integer,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_product(uuid,text,text,public.product_kind,text,text,boolean,integer,text,uuid),
  public.open_inventory_business_day(uuid),
  public.adjust_warehouse_stock(uuid,public.stock_kind,integer,text,text,uuid,uuid) to authenticated;

-- Cookie-backed caller JWT only. RPCs recheck active admin; no app service key.
alter table public.products enable row level security;
alter table public.stock_locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.operation_requests enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.products,public.stock_locations,public.inventory_balances,public.operation_requests,
  public.stock_movements,public.stock_adjustments,public.audit_events from anon,authenticated,service_role;
grant select on public.products,public.stock_locations,public.inventory_balances,public.stock_movements,
  public.stock_adjustments,public.audit_events to authenticated;
create policy products_admin_read on public.products for select to authenticated using ((select public.is_active_admin()));
create policy locations_admin_read on public.stock_locations for select to authenticated using ((select public.is_active_admin()));
create policy balances_admin_read on public.inventory_balances for select to authenticated using ((select public.is_active_admin()));
create policy movements_admin_read on public.stock_movements for select to authenticated using ((select public.is_active_admin()));
create policy adjustments_admin_read on public.stock_adjustments for select to authenticated using ((select public.is_active_admin()));
create policy audit_admin_read on public.audit_events for select to authenticated using ((select public.is_active_admin()));
comment on table public.stock_movements is 'Append-only physical movements. Manual adjustments only in Sprint 1; trip/refill workflow movements require separate future RPCs.';
comment on table public.inventory_balances is 'Persistent stock per location, product and state; never reset by day opening or closing.';
