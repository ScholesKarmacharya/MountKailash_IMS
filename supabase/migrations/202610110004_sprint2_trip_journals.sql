create type public.trip_status as enum ('DRAFT','LOADED','ACTIVE','SUBMITTED','UNDER_REVIEW','CLOSED','DISCREPANCY');
create table public.trips (
  id uuid primary key,
  trip_number bigint generated always as identity unique,
  business_day_id uuid not null references public.business_days(id),
  driver_id uuid not null references public.profiles(id),
  vehicle_id uuid not null references public.vehicles(id),
  status public.trip_status not null default 'DRAFT',
  notes text not null default '' check(length(notes)<=2000),
  started_at timestamptz, submitted_at timestamptz,
  closed_at timestamptz, closed_by uuid references public.profiles(id),
  close_reason text not null default '',
  created_by uuid not null references public.profiles(id),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  check ((status='CLOSED' and closed_at is not null and closed_by is not null) or
    (status<>'CLOSED' and closed_at is null and closed_by is null))
);
create unique index one_live_trip_per_driver on public.trips(driver_id) where status<>'CLOSED';
revoke all on sequence public.trips_trip_number_seq from public,anon,authenticated,service_role;
create unique index one_live_trip_per_vehicle on public.trips(vehicle_id) where status<>'CLOSED';
create index trips_day_driver_status on public.trips(business_day_id,driver_id,status);
create table public.trip_customers (
  trip_id uuid not null references public.trips(id),
  customer_id uuid not null references public.customers(id),
  created_at timestamptz not null default now(),
  primary key(trip_id,customer_id)
);
create table public.trip_visits (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  business_day_id uuid not null references public.business_days(id),
  customer_id uuid references public.customers(id),
  walk_in_name text not null default '' check(length(walk_in_name)<=120),
  walk_in_phone text not null default '' check(length(walk_in_phone)<=40),
  notes text not null default '' check(length(notes)<=2000),
  actor_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check(customer_id is not null or length(btrim(walk_in_name))>0)
);
create index visits_trip_created on public.trip_visits(trip_id,created_at);
-- Repeated customer visits intentionally have no (trip_id,customer_id) uniqueness.
alter table public.stock_movements drop constraint stock_movements_actor_user_id_idempotency_key_key;
alter table public.stock_movements drop constraint stock_movements_movement_type_check;
alter table public.stock_movements drop constraint stock_movements_check;
alter table public.stock_movements add column line_number integer not null default 0 check(line_number>=0),
  add column trip_id uuid references public.trips(id),
  add column visit_id uuid references public.trip_visits(id),
  add column from_quantity_before integer check(from_quantity_before>=0),
  add column from_quantity_after integer check(from_quantity_after>=0),
  add column to_quantity_before integer check(to_quantity_before>=0),
  add column to_quantity_after integer check(to_quantity_after>=0),
  add constraint stock_movement_request_line unique(actor_user_id,idempotency_key,line_number),
  add constraint stock_movement_type check(movement_type in ('MANUAL_INCREASE','MANUAL_DECREASE','TRIP_LOAD','DELIVERY','EMPTY_COLLECTION','TRIP_RETURN','VARIANCE_LOSS','VARIANCE_GAIN')),
  add constraint stock_movement_direction check(
    (movement_type in ('MANUAL_INCREASE','EMPTY_COLLECTION','VARIANCE_GAIN') and from_location_id is null and to_location_id is not null) or
    (movement_type in ('MANUAL_DECREASE','DELIVERY','VARIANCE_LOSS') and from_location_id is not null and to_location_id is null) or
    (movement_type in ('TRIP_LOAD','TRIP_RETURN') and from_location_id is not null and to_location_id is not null and from_location_id<>to_location_id)),
  add constraint operational_movement_trip check(movement_type in ('MANUAL_INCREASE','MANUAL_DECREASE') or trip_id is not null);
create index movement_trip_visit on public.stock_movements(trip_id,visit_id);
create table public.trip_load_items (
  trip_id uuid not null references public.trips(id),
  product_id uuid not null references public.products(id),
  stock_kind public.stock_kind not null check(stock_kind in ('FULL_JAR','BOTTLE_CARTON')),
  quantity integer not null check(quantity>=0),
  movement_id uuid references public.stock_movements(id),
  created_at timestamptz not null default now(),
  primary key(trip_id,product_id),
  check((quantity=0 and movement_id is null) or (quantity>0 and movement_id is not null))
);
create table public.visit_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.trip_visits(id),
  product_id uuid not null references public.products(id),
  full_jars integer not null check(full_jars>=0),
  empty_jars integer not null check(empty_jars>=0),
  cartons integer not null check(cartons>=0),
  unit_price_snapshot numeric(14,2) not null check(unit_price_snapshot>=0),
  created_at timestamptz not null default now(),
  unique(visit_id,product_id),
  check(full_jars::bigint+empty_jars::bigint+cartons::bigint>0)
);
create table public.delivery_payment_intents (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.trip_visits(id),
  selection text not null check(selection in ('CASH','FONEPAY','UNPAID','PARTIAL')),
  reported_amount numeric(14,2) check(reported_amount>=0),
  reference text not null default '' check(length(reference)<=200),
  settlement_state text not null default 'PENDING_SPRINT3' check(settlement_state='PENDING_SPRINT3'),
  created_at timestamptz not null default now()
);
comment on table public.delivery_payment_intents is 'Unverified driver instruction only, not payments, revenue, receivables, invoices or provider verification. Settlement in Sprint 3.';
create table public.jar_custody_balances (
  customer_id uuid not null references public.customers(id),
  product_id uuid not null references public.products(id),
  quantity integer not null default 0 check(quantity>=0),
  created_at timestamptz not null default now(),
  primary key(customer_id,product_id)
);
create table public.jar_custody_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  product_id uuid not null references public.products(id),
  visit_id uuid references public.trip_visits(id),
  movement_id uuid references public.stock_movements(id),
  delta integer not null check(delta<>0),
  resulting_balance integer not null check(resulting_balance>=0),
  reason text not null,
  actor_user_id uuid not null references public.profiles(id),
  business_day_id uuid not null references public.business_days(id),
  created_at timestamptz not null default now()
);
create table public.trip_return_declarations (
  trip_id uuid not null references public.trips(id),
  product_id uuid not null references public.products(id),
  stock_kind public.stock_kind not null,
  quantity integer not null check(quantity>=0),
  created_at timestamptz not null default now(),
  primary key(trip_id,product_id,stock_kind)
);
create table public.trip_return_checks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  actor_user_id uuid not null references public.profiles(id),
  reason text not null,
  outcome text not null check(outcome in ('DISCREPANCY','APPROVED')),
  created_at timestamptz not null default now()
);
create table public.trip_return_check_items (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.trip_return_checks(id),
  product_id uuid not null references public.products(id),
  stock_kind public.stock_kind not null,
  expected integer not null check(expected>=0),
  declared integer not null check(declared>=0),
  actual integer not null check(actual>=0),
  movement_id uuid references public.stock_movements(id),
  created_at timestamptz not null default now(),
  unique(check_id,product_id,stock_kind)
);
create table public.trip_discrepancies (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.trip_return_checks(id),
  product_id uuid not null references public.products(id),
  stock_kind public.stock_kind not null,
  expected integer not null, actual integer not null,
  resolution text not null,
  approved_by uuid references public.profiles(id),
  movement_id uuid references public.stock_movements(id),
  created_at timestamptz not null default now(),
  check(expected<>actual)
);

create function public.guard_trip_history() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception using errcode='42501',message='Historical trips cannot be deleted.'; end if;
  if OLD.status='CLOSED' then raise exception using errcode='42501',message='Closed trips are immutable.'; end if;
  if NEW.id<>OLD.id or NEW.driver_id<>OLD.driver_id or NEW.vehicle_id<>OLD.vehicle_id or NEW.business_day_id<>OLD.business_day_id then
    raise exception using errcode='42501',message='Trip assignment is immutable; cancel the draft and create another.';
  end if;
  return NEW;
end;
$$;
create trigger trips_preserve before update or delete on public.trips for each row execute function public.guard_trip_history();
create function public.guard_assigned_vehicle() returns trigger language plpgsql set search_path='' as $$
begin
  if NEW.location_id<>OLD.location_id then raise exception using errcode='42501',message='Vehicle stock location is immutable.'; end if;
  if not NEW.is_active and exists(select 1 from public.trips where vehicle_id=NEW.id and status<>'CLOSED') then
    raise exception using errcode='22023',message='Reconcile or cancel the assigned trip before disabling this vehicle.';
  end if;
  return NEW;
end;
$$;
create trigger assigned_vehicle_guard before update on public.vehicles for each row execute function public.guard_assigned_vehicle();
revoke all on function public.guard_trip_history(),public.guard_assigned_vehicle() from public,anon,authenticated,service_role;

create function public.can_read_trip(p_trip uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and
    (p.role='ADMIN' or exists(select 1 from public.trips t where t.id=p_trip and t.driver_id=p.id)));
$$;
create function public.can_read_customer(p_customer uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_admin() or exists(select 1 from public.profiles p join public.trips t on t.driver_id=p.id
    join public.trip_customers tc on tc.trip_id=t.id where p.id=auth.uid() and p.is_active and tc.customer_id=p_customer);
$$;
create function public.can_read_vehicle_stock(p_location uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_admin() or exists(select 1 from public.profiles p join public.trips t on t.driver_id=p.id
    join public.vehicles v on v.id=t.vehicle_id where p.id=auth.uid() and p.is_active and t.status<>'CLOSED' and v.location_id=p_location);
$$;
create function public.can_read_trip_product(p_product uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.trips t on t.driver_id=p.id join public.trip_load_items l on l.trip_id=t.id
    where p.id=auth.uid() and p.is_active and l.product_id=p_product);
$$;
revoke all on function public.can_read_trip(uuid),public.can_read_customer(uuid),public.can_read_vehicle_stock(uuid),public.can_read_trip_product(uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_read_trip(uuid),public.can_read_customer(uuid),public.can_read_vehicle_stock(uuid),public.can_read_trip_product(uuid) to authenticated;
create policy customer_route_read on public.customers for select to authenticated using(public.can_read_customer(id));
create policy vehicle_assigned_read on public.vehicles for select to authenticated using(exists(select 1 from public.trips t where t.vehicle_id=vehicles.id and public.can_read_trip(t.id)));
create policy products_trip_read on public.products for select to authenticated using(public.can_read_trip_product(id));
create policy location_vehicle_read on public.stock_locations for select to authenticated using(kind='VEHICLE' and public.can_read_vehicle_stock(id));
create policy balances_vehicle_read on public.inventory_balances for select to authenticated using(
  public.can_read_vehicle_stock(location_id) and exists(
    select 1 from public.trips t join public.vehicles v on v.id=t.vehicle_id
    join public.trip_load_items l on l.trip_id=t.id
    where t.driver_id=auth.uid() and t.status<>'CLOSED' and v.location_id=inventory_balances.location_id and l.product_id=inventory_balances.product_id));
create policy movement_trip_read on public.stock_movements for select to authenticated using(trip_id is not null and public.can_read_trip(trip_id));
create policy day_assigned_read on public.business_days for select to authenticated using(exists(select 1 from public.trips t where t.business_day_id=business_days.id and public.can_read_trip(t.id)));

do $$
declare v_table text;
begin
  foreach v_table in array array['trips','trip_customers','trip_visits','trip_load_items','visit_items','delivery_payment_intents','jar_custody_balances','jar_custody_entries','trip_return_declarations','trip_return_checks','trip_return_check_items','trip_discrepancies'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from anon,authenticated,service_role',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
    if v_table not in ('trips','jar_custody_balances') then
      execute format('create trigger immutable before update or delete on public.%I for each row execute function public.reject_journal_mutation()',v_table);
    end if;
    execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.reject_journal_mutation()',v_table);
  end loop;
end;
$$;
create policy trip_read on public.trips for select to authenticated using(public.can_read_trip(id));
create policy route_read on public.trip_customers for select to authenticated using(public.can_read_trip(trip_id));
create policy visit_read on public.trip_visits for select to authenticated using(public.can_read_trip(trip_id));
create policy load_read on public.trip_load_items for select to authenticated using(public.can_read_trip(trip_id));
create policy item_read on public.visit_items for select to authenticated using(exists(select 1 from public.trip_visits v where v.id=visit_id and public.can_read_trip(v.trip_id)));
create policy payment_intent_read on public.delivery_payment_intents for select to authenticated using(exists(select 1 from public.trip_visits v where v.id=visit_id and public.can_read_trip(v.trip_id)));
create policy custody_balance_read on public.jar_custody_balances for select to authenticated using(public.can_read_customer(customer_id));
create policy custody_entry_read on public.jar_custody_entries for select to authenticated using(public.is_active_admin() or exists(select 1 from public.trip_visits v where v.id=visit_id and public.can_read_trip(v.trip_id)));
create policy declaration_read on public.trip_return_declarations for select to authenticated using(public.can_read_trip(trip_id));
create policy return_check_read on public.trip_return_checks for select to authenticated using(public.can_read_trip(trip_id));
create policy return_check_item_read on public.trip_return_check_items for select to authenticated using(exists(select 1 from public.trip_return_checks c where c.id=check_id and public.can_read_trip(c.trip_id)));
create policy discrepancy_read on public.trip_discrepancies for select to authenticated using(exists(select 1 from public.trip_return_checks c where c.id=check_id and public.can_read_trip(c.trip_id)));
create policy audit_trip_read on public.audit_events for select to authenticated using(
  (entity='trips' and public.can_read_trip(entity_id)) or
  (entity='trip_visits' and exists(select 1 from public.trip_visits v where v.id=entity_id and public.can_read_trip(v.trip_id))));

create function public.ops_trip(p_trip uuid) returns public.trips
language plpgsql security definer set search_path='' as $$
declare v_trip public.trips;
begin
  select * into v_trip from public.trips where id=p_trip and (driver_id=auth.uid() or public.is_active_admin()) for update;
  if not found then raise exception using errcode='42501',message='Assigned trip access required.'; end if;
  perform 1 from public.business_days where id=v_trip.business_day_id and status='OPEN' for share;
  if not found then raise exception using errcode='22023',message='An OPEN business day is required.'; end if;
  return v_trip;
end;
$$;
create function public.ops_move(p_trip public.trips,p_product uuid,p_kind public.stock_kind,p_quantity integer,p_type text,p_from uuid,p_to uuid,p_visit uuid,p_key uuid,p_line integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_location uuid; v_before integer; v_from_before integer; v_to_before integer; v_id uuid; v_kind public.product_kind;
begin
  if p_quantity is null or p_quantity<=0 or p_from is not distinct from p_to then raise exception using errcode='22023',message='Invalid movement.'; end if;
  select kind into strict v_kind from public.products where id=p_product for share;
  if (v_kind='FULL_JAR' and p_kind='BOTTLE_CARTON') or (v_kind='BOTTLE_CARTON' and p_kind<>'BOTTLE_CARTON') then raise exception using errcode='22023',message='Stock state does not match product.'; end if;
  -- Deterministic location locks. Callers process products/states in sorted order.
  for v_location in select distinct x from unnest(array[p_from,p_to]) x where x is not null order by x loop
    insert into public.inventory_balances(location_id,product_id,stock_kind) values(v_location,p_product,p_kind) on conflict do nothing;
    select quantity into v_before from public.inventory_balances where location_id=v_location and product_id=p_product and stock_kind=p_kind for update;
    if v_location=p_from then
      v_from_before:=v_before;
      if v_before<p_quantity then raise exception using errcode='22023',message='Insufficient stock; balance cannot be negative.'; end if;
    else
      v_to_before:=v_before;
      if v_before::bigint+p_quantity::bigint>2147483647 then raise exception using errcode='22023',message='Stock quantity exceeds supported range.'; end if;
    end if;
  end loop;
  update public.inventory_balances set quantity=quantity-p_quantity,version=version+1 where location_id=p_from and product_id=p_product and stock_kind=p_kind;
  update public.inventory_balances set quantity=quantity+p_quantity,version=version+1 where location_id=p_to and product_id=p_product and stock_kind=p_kind;
  insert into public.stock_movements(product_id,stock_kind,from_location_id,to_location_id,quantity,movement_type,business_day_id,actor_user_id,idempotency_key,line_number,trip_id,visit_id,from_quantity_before,from_quantity_after,to_quantity_before,to_quantity_after)
    values(p_product,p_kind,p_from,p_to,p_quantity,p_type,p_trip.business_day_id,auth.uid(),p_key,p_line,p_trip.id,p_visit,v_from_before,v_from_before-p_quantity,v_to_before,v_to_before+p_quantity) returning id into v_id;
  return v_id;
end;
$$;
create function public.ops_counts(p_trip public.trips,p_counts jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_location uuid; v_expected integer; v_count integer;
begin
  if p_counts is null or jsonb_typeof(p_counts)<>'array' or jsonb_array_length(p_counts)>200 then raise exception using errcode='22023',message='Invalid return counts.'; end if;
  select location_id into strict v_location from public.vehicles where id=p_trip.vehicle_id;
  select count(*) into v_expected from public.inventory_balances b where b.location_id=v_location and exists(select 1 from public.trip_load_items l where l.trip_id=p_trip.id and l.product_id=b.product_id);
  select count(*) into v_count from jsonb_to_recordset(p_counts) as x(product_id uuid,stock_kind public.stock_kind,quantity integer)
    join public.inventory_balances b on b.product_id=x.product_id and b.stock_kind=x.stock_kind and b.location_id=v_location
    where x.quantity between 0 and 1000000000 and exists(select 1 from public.trip_load_items l where l.trip_id=p_trip.id and l.product_id=x.product_id);
  if v_count<>v_expected or v_count<>jsonb_array_length(p_counts) or exists(
    select 1 from jsonb_to_recordset(p_counts) as x(product_id uuid,stock_kind text) group by product_id,stock_kind having count(*)>1) then
    raise exception using errcode='22023',message='Provide every assigned stock count exactly once.';
  end if;
end;
$$;
revoke all on function public.ops_trip(uuid),public.ops_move(public.trips,uuid,public.stock_kind,integer,text,uuid,uuid,uuid,uuid,integer),public.ops_counts(public.trips,jsonb) from public,anon,authenticated,service_role;
