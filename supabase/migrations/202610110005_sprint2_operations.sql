create function public.save_driver(p_id uuid,p_name text,p_active boolean,p_version integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_old public.profiles; v_new public.profiles; v_payload jsonb; v_retry uuid;
begin
  perform public.ops_actor(true);
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_active is null
    or p_version is null or p_version<0 or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Invalid driver details.'; end if;
  v_payload:=jsonb_build_object('operation','DRIVER','id',p_id,'name',p_name,'active',p_active,'version',p_version,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  select * into v_old from public.profiles where id=p_id for update;
  if found then
    if v_old.role<>'DRIVER' then raise exception using errcode='42501',message='Only driver profiles can be managed here.'; end if;
    if v_old.version<>p_version then raise exception using errcode='40001',message='Record changed; reload before saving.'; end if;
    if not p_active and exists(select 1 from public.trips where driver_id=p_id and status<>'CLOSED') then raise exception using errcode='22023',message='Reconcile or cancel the assigned trip before disabling this driver.'; end if;
    update public.profiles set name=btrim(p_name),is_active=p_active,version=version+1,updated_at=now() where id=p_id returning * into v_new;
  else
    if p_version<>0 then raise exception using errcode='22023',message='Driver not found.'; end if;
    -- Auth identity must already exist; no passwords or signup metadata are accepted.
    insert into public.profiles(id,name,role,is_active) values(p_id,btrim(p_name),'DRIVER',p_active) returning * into v_new;
  end if;
  return public.ops_finish(p_key,v_payload,p_id,'DRIVER_SAVED','profiles',case when p_version=0 then null else to_jsonb(v_old) end,to_jsonb(v_new),btrim(p_reason));
end;
$$;
create function public.create_trip(p_id uuid,p_driver uuid,p_vehicle uuid,p_day uuid,p_customers jsonb,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_customer uuid; v_location uuid; v_trip public.trips;
begin
  perform public.ops_actor(true);
  if p_id is null or p_driver is null or p_vehicle is null or p_day is null or p_notes is null or length(p_notes)>2000
    or p_customers is null or jsonb_typeof(p_customers)<>'array' or jsonb_array_length(p_customers)>200 then raise exception using errcode='22023',message='Invalid trip assignment.'; end if;
  v_payload:=jsonb_build_object('operation','CREATE_TRIP','id',p_id,'driver',p_driver,'vehicle',p_vehicle,'day',p_day,'customers',p_customers,'notes',p_notes);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  perform 1 from public.business_days where id=p_day and status='OPEN' for share;
  if not found then raise exception using errcode='22023',message='An OPEN business day is required.'; end if;
  perform 1 from public.profiles where id=p_driver and role='DRIVER' and is_active for share;
  if not found then raise exception using errcode='22023',message='An active driver is required.'; end if;
  select location_id into v_location from public.vehicles where id=p_vehicle and is_active for share;
  if not found then raise exception using errcode='22023',message='An active vehicle is required.'; end if;
  if exists(select 1 from public.inventory_balances where location_id=v_location and quantity>0) then raise exception using errcode='22023',message='Vehicle stock must be reconciled before another trip.'; end if;
  insert into public.trips(id,driver_id,vehicle_id,business_day_id,notes,created_by) values(p_id,p_driver,p_vehicle,p_day,btrim(p_notes),auth.uid()) returning * into v_trip;
  for v_customer in select distinct value::uuid from jsonb_array_elements_text(p_customers) loop
    perform 1 from public.customers where id=v_customer and is_active for share;
    if not found then raise exception using errcode='22023',message='Route customer is missing or inactive.'; end if;
    insert into public.trip_customers(trip_id,customer_id) values(p_id,v_customer);
  end loop;
  return public.ops_finish(p_key,v_payload,p_id,'TRIP_CREATED','trips',null,to_jsonb(v_trip),'Admin trip assignment');
end;
$$;
create function public.assign_trip_customer(p_trip uuid,p_customer uuid,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_trip public.trips;
begin
  perform public.ops_actor(true);
  v_payload:=jsonb_build_object('operation','ROUTE_CUSTOMER','trip',p_trip,'customer',p_customer);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  v_trip:=public.ops_trip(p_trip);
  if v_trip.status not in ('DRAFT','LOADED','ACTIVE') then raise exception using errcode='22023',message='Trip no longer accepts route changes.'; end if;
  perform 1 from public.customers where id=p_customer and is_active for share;
  if not found then raise exception using errcode='22023',message='Route customer is missing or inactive.'; end if;
  insert into public.trip_customers values(p_trip,p_customer,now()) on conflict do nothing;
  return public.ops_finish(p_key,v_payload,p_trip,'ROUTE_CUSTOMER_ADDED','trips',null,jsonb_build_object('customer_id',p_customer),'Admin route assignment');
end;
$$;
create function public.load_trip(p_trip uuid,p_items jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_trip public.trips; v_old public.trips; v_item record; v_product public.products;
  v_warehouse uuid; v_vehicle uuid; v_movement uuid; v_line integer:=0;
begin
  perform public.ops_actor(true);
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception using errcode='22023',message='Invalid load items.'; end if;
  v_payload:=jsonb_build_object('operation','LOAD','trip',p_trip,'items',p_items);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  v_trip:=public.ops_trip(p_trip);v_old:=v_trip;
  if v_trip.status<>'DRAFT' then raise exception using errcode='22023',message='Only a draft trip can be loaded.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid) group by product_id having count(*)>1)
    or not exists(select 1 from jsonb_to_recordset(p_items) as x(quantity integer) where quantity>0) then raise exception using errcode='22023',message='Load each product once with at least one positive quantity.'; end if;
  select id into strict v_warehouse from public.stock_locations where code='MAIN' and kind='WAREHOUSE';
  select location_id into strict v_vehicle from public.vehicles where id=v_trip.vehicle_id;
  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid,stock_kind public.stock_kind,quantity integer) order by product_id loop
    if v_item.quantity is null or v_item.quantity not between 0 and 1000000000 then raise exception using errcode='22023',message='Invalid load quantity.'; end if;
    select * into v_product from public.products where id=v_item.product_id and is_active for share;
    if not found or v_item.stock_kind is null or v_item.stock_kind::text<>v_product.kind::text then raise exception using errcode='22023',message='Only active full jars and cartons can be loaded.'; end if;
    insert into public.inventory_balances(location_id,product_id,stock_kind) values(v_vehicle,v_product.id,v_item.stock_kind) on conflict do nothing;
    if v_product.kind='FULL_JAR' then
      insert into public.inventory_balances(location_id,product_id,stock_kind) values(v_vehicle,v_product.id,'EMPTY_JAR') on conflict do nothing;
    end if;
    v_movement:=null;
    if v_item.quantity>0 then
      v_line:=v_line+1;
      v_movement:=public.ops_move(v_trip,v_product.id,v_item.stock_kind,v_item.quantity,'TRIP_LOAD',v_warehouse,v_vehicle,null,p_key,v_line);
    end if;
    insert into public.trip_load_items(trip_id,product_id,stock_kind,quantity,movement_id) values(p_trip,v_product.id,v_item.stock_kind,v_item.quantity,v_movement);
  end loop;
  update public.trips set status='LOADED',version=version+1 where id=p_trip returning * into v_trip;
  return public.ops_finish(p_key,v_payload,p_trip,'TRIP_LOADED','trips',to_jsonb(v_old),to_jsonb(v_trip)||jsonb_build_object('items',p_items),'Admin warehouse load');
end;
$$;
create function public.transition_trip(p_trip uuid,p_action text,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_trip public.trips; v_old public.trips;
begin
  perform public.ops_actor(p_action in ('REVIEW','CANCEL'));
  if p_action is null or p_action not in ('START','REVIEW','CANCEL') or p_reason is null or length(p_reason)>500 then raise exception using errcode='22023',message='Invalid trip action.'; end if;
  v_payload:=jsonb_build_object('operation','TRANSITION','trip',p_trip,'action',p_action,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  v_trip:=public.ops_trip(p_trip);v_old:=v_trip;
  if p_action='START' and v_trip.status='LOADED' then
    update public.trips set status='ACTIVE',started_at=now(),version=version+1 where id=p_trip returning * into v_trip;
  elsif p_action='REVIEW' and v_trip.status in ('SUBMITTED','DISCREPANCY') then
    update public.trips set status='UNDER_REVIEW',version=version+1 where id=p_trip returning * into v_trip;
  elsif p_action='CANCEL' and v_trip.status='DRAFT' and length(btrim(p_reason))>=3 then
    update public.trips set status='CLOSED',closed_at=now(),closed_by=auth.uid(),close_reason=btrim(p_reason),version=version+1 where id=p_trip returning * into v_trip;
  else raise exception using errcode='22023',message='Trip action is not allowed in its current state.';
  end if;
  return public.ops_finish(p_key,v_payload,p_trip,'TRIP_'||p_action,'trips',to_jsonb(v_old),to_jsonb(v_trip),coalesce(nullif(btrim(p_reason),''),'Authorized trip transition'));
end;
$$;
create function public.post_trip_visit(p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,p_payment jsonb,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_trip public.trips; v_item record; v_product public.products; v_location uuid;
  v_visit uuid:=gen_random_uuid(); v_line integer:=0; v_move uuid; v_custody integer; v_after bigint;
  v_value numeric(14,2):=0; v_reported numeric(14,2); v_selection text; v_reference text;
begin
  perform public.ops_actor(false);
  if p_walk_name is null or length(p_walk_name)>120 or p_walk_phone is null or length(p_walk_phone)>40 or p_notes is null or length(p_notes)>2000
    or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100
    or p_payment is null or jsonb_typeof(p_payment)<>'object' then raise exception using errcode='22023',message='Invalid delivery details.'; end if;
  v_selection:=p_payment->>'selection';v_reference:=coalesce(p_payment->>'reference','');
  if v_selection is null or v_selection not in ('CASH','FONEPAY','UNPAID','PARTIAL') or length(v_reference)>200
    or (p_payment->>'reported_amount' is not null and p_payment->>'reported_amount' !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') then raise exception using errcode='22023',message='Invalid pending payment details.'; end if;
  v_reported:=(p_payment->>'reported_amount')::numeric;
  v_payload:=jsonb_build_object('operation','VISIT','trip',p_trip,'customer',p_customer,'walk_name',p_walk_name,'walk_phone',p_walk_phone,'items',p_items,'payment',p_payment,'notes',p_notes);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  v_trip:=public.ops_trip(p_trip);
  if v_trip.status<>'ACTIVE' then raise exception using errcode='22023',message='Only an active trip accepts deliveries.'; end if;
  if p_customer is not null then
    perform 1 from public.customers where id=p_customer and is_active for share;
    if not found then raise exception using errcode='22023',message='Customer is missing or inactive.'; end if;
    if not public.is_active_admin() and not exists(select 1 from public.trip_customers where trip_id=p_trip and customer_id=p_customer) then raise exception using errcode='42501',message='Customer is not assigned to this route.'; end if;
  elsif length(btrim(p_walk_name))=0 or v_selection in ('UNPAID','PARTIAL') then raise exception using errcode='22023',message='Registered customer required for ongoing credit or jar custody.';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid) group by product_id having count(*)>1) then raise exception using errcode='22023',message='Each delivery product must appear once.'; end if;
  select location_id into strict v_location from public.vehicles where id=v_trip.vehicle_id;
  insert into public.trip_visits(id,trip_id,business_day_id,customer_id,walk_in_name,walk_in_phone,notes,actor_user_id) values(v_visit,p_trip,v_trip.business_day_id,p_customer,btrim(p_walk_name),btrim(p_walk_phone),btrim(p_notes),auth.uid());
  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid,full_jars integer,empty_jars integer,cartons integer) order by product_id loop
    if v_item.full_jars is null or v_item.empty_jars is null or v_item.cartons is null or v_item.full_jars not between 0 and 1000000000 or v_item.empty_jars not between 0 and 1000000000 or v_item.cartons not between 0 and 1000000000
      or v_item.full_jars::bigint+v_item.empty_jars::bigint+v_item.cartons::bigint=0 then raise exception using errcode='22023',message='Delivery quantities must be nonnegative whole numbers with at least one item.'; end if;
    if not exists(select 1 from public.trip_load_items where trip_id=p_trip and product_id=v_item.product_id) then raise exception using errcode='42501',message='Product is not assigned to this trip.'; end if;
    select * into strict v_product from public.products where id=v_item.product_id for share;
    if (v_product.kind='FULL_JAR' and v_item.cartons<>0) or (v_product.kind='BOTTLE_CARTON' and (v_item.full_jars<>0 or v_item.empty_jars<>0)) then raise exception using errcode='22023',message='Delivery quantities do not match product.'; end if;
    if not v_product.is_active and (v_item.full_jars>0 or v_item.cartons>0) then raise exception using errcode='22023',message='Inactive products cannot be delivered.'; end if;
    if p_customer is null and v_item.full_jars<>v_item.empty_jars then raise exception using errcode='22023',message='Walk-in jars require an equal empty exchange; register the customer for custody.'; end if;
    if p_customer is not null and v_product.kind='FULL_JAR' then
      insert into public.jar_custody_balances(customer_id,product_id) values(p_customer,v_product.id) on conflict do nothing;
      select quantity into v_custody from public.jar_custody_balances where customer_id=p_customer and product_id=v_product.id for update;
      v_after:=v_custody::bigint+v_item.full_jars::bigint-v_item.empty_jars::bigint;
      if v_after<0 or v_after>2147483647 or v_custody::bigint+v_item.full_jars::bigint>2147483647 then raise exception using errcode='22023',message='Customer jar balance would be invalid; admin custody review required.'; end if;
      update public.jar_custody_balances set quantity=v_after::integer where customer_id=p_customer and product_id=v_product.id;
    end if;
    if v_item.full_jars>0 then
      v_line:=v_line+1;v_move:=public.ops_move(v_trip,v_product.id,'FULL_JAR',v_item.full_jars,'DELIVERY',v_location,null,v_visit,p_key,v_line);
      if p_customer is not null then insert into public.jar_custody_entries(customer_id,product_id,visit_id,movement_id,delta,resulting_balance,reason,actor_user_id,business_day_id)
        values(p_customer,v_product.id,v_visit,v_move,v_item.full_jars,v_custody+v_item.full_jars,'Full jars delivered',auth.uid(),v_trip.business_day_id); end if;
    end if;
    if v_item.empty_jars>0 then
      v_line:=v_line+1;v_move:=public.ops_move(v_trip,v_product.id,'EMPTY_JAR',v_item.empty_jars,'EMPTY_COLLECTION',null,v_location,v_visit,p_key,v_line);
      if p_customer is not null then insert into public.jar_custody_entries(customer_id,product_id,visit_id,movement_id,delta,resulting_balance,reason,actor_user_id,business_day_id)
        values(p_customer,v_product.id,v_visit,v_move,-v_item.empty_jars,v_after::integer,'Empty jars collected',auth.uid(),v_trip.business_day_id); end if;
    end if;
    if v_item.cartons>0 then v_line:=v_line+1;perform public.ops_move(v_trip,v_product.id,'BOTTLE_CARTON',v_item.cartons,'DELIVERY',v_location,null,v_visit,p_key,v_line); end if;
    insert into public.visit_items(visit_id,product_id,full_jars,empty_jars,cartons,unit_price_snapshot) values(v_visit,v_product.id,v_item.full_jars,v_item.empty_jars,v_item.cartons,v_product.default_price);
    v_value:=v_value+v_product.default_price*(v_item.full_jars::numeric+v_item.cartons::numeric);
  end loop;
  if v_selection='UNPAID' and coalesce(v_reported,0)<>0 then raise exception using errcode='22023',message='Unpaid instructions cannot report a collected amount.'; end if;
  if v_selection='PARTIAL' and (v_reported is null or v_reported<=0 or v_reported>=v_value) then raise exception using errcode='22023',message='Partial amount must be greater than zero and less than delivery value.'; end if;
  if v_reported>v_value then raise exception using errcode='22023',message='Reported amount exceeds delivery value.'; end if;
  -- Store the computed value without updating the immutable visit header.
  insert into public.delivery_value_snapshots(visit_id,value) values(v_visit,v_value);
  insert into public.delivery_payment_intents(visit_id,selection,reported_amount,reference) values(v_visit,v_selection,v_reported,btrim(v_reference));
  return public.ops_finish(p_key,v_payload,v_visit,'DELIVERY_POSTED','trip_visits',null,jsonb_build_object('trip_id',p_trip,'items',p_items,'value',v_value,'finance','PENDING_SPRINT3'),'Audited physical delivery; settlement pending');
end;
$$;

-- Immutable value snapshots are separate so headers never need a post-insert UPDATE.
create table public.delivery_value_snapshots (
  visit_id uuid primary key references public.trip_visits(id),
  value numeric(14,2) not null check(value>=0),
  created_at timestamptz not null default now()
);
alter table public.delivery_value_snapshots enable row level security;
revoke all on public.delivery_value_snapshots from anon,authenticated,service_role;
grant select on public.delivery_value_snapshots to authenticated;
create policy delivery_value_read on public.delivery_value_snapshots for select to authenticated using(exists(select 1 from public.trip_visits v where v.id=visit_id and public.can_read_trip(v.trip_id)));
create trigger delivery_value_immutable before update or delete on public.delivery_value_snapshots for each row execute function public.reject_journal_mutation();
create trigger delivery_value_no_truncate before truncate on public.delivery_value_snapshots for each statement execute function public.reject_journal_mutation();

create function public.submit_trip(p_trip uuid,p_counts jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_trip public.trips; v_old public.trips; v_payload jsonb; v_retry uuid;
begin
  perform public.ops_actor(false);
  v_payload:=jsonb_build_object('operation','SUBMIT','trip',p_trip,'counts',p_counts);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  v_trip:=public.ops_trip(p_trip);v_old:=v_trip;
  if v_trip.status<>'ACTIVE' then raise exception using errcode='22023',message='Only an active trip can be submitted.'; end if;
  perform public.ops_counts(v_trip,p_counts);
  insert into public.trip_return_declarations(trip_id,product_id,stock_kind,quantity) select p_trip,product_id,stock_kind,quantity from jsonb_to_recordset(p_counts) as x(product_id uuid,stock_kind public.stock_kind,quantity integer);
  update public.trips set status='SUBMITTED',submitted_at=now(),version=version+1 where id=p_trip returning * into v_trip;
  return public.ops_finish(p_key,v_payload,p_trip,'TRIP_SUBMITTED','trips',to_jsonb(v_old),to_jsonb(v_trip)||jsonb_build_object('counts',p_counts),'Driver physical return declaration; warehouse unchanged');
end;
$$;
create function public.reconcile_trip(p_trip uuid,p_counts jsonb,p_reason text,p_accept_variance boolean,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_trip public.trips; v_old public.trips; v_payload jsonb; v_retry uuid; v_check uuid:=gen_random_uuid(); v_item record;
  v_vehicle uuid; v_warehouse uuid; v_expected integer; v_declared integer; v_mismatch boolean; v_move uuid; v_variance_move uuid; v_line integer:=0;
begin
  perform public.ops_actor(true);
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 or p_accept_variance is null then raise exception using errcode='22023',message='Reconciliation reason is required.'; end if;
  v_payload:=jsonb_build_object('operation','RECONCILE','trip',p_trip,'counts',p_counts,'reason',p_reason,'accept',p_accept_variance);
  v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
  v_trip:=public.ops_trip(p_trip);v_old:=v_trip;
  if v_trip.status not in ('SUBMITTED','UNDER_REVIEW','DISCREPANCY') then raise exception using errcode='22023',message='Only a submitted trip can be reconciled.'; end if;
  perform public.ops_counts(v_trip,p_counts);
  select location_id into strict v_vehicle from public.vehicles where id=v_trip.vehicle_id;
  select id into strict v_warehouse from public.stock_locations where code='MAIN' and kind='WAREHOUSE';
  select exists(select 1 from jsonb_to_recordset(p_counts) as x(product_id uuid,stock_kind public.stock_kind,quantity integer)
    join public.inventory_balances b on b.product_id=x.product_id and b.stock_kind=x.stock_kind and b.location_id=v_vehicle where b.quantity<>x.quantity) into v_mismatch;
  insert into public.trip_return_checks(id,trip_id,actor_user_id,reason,outcome) values(v_check,p_trip,auth.uid(),btrim(p_reason),case when v_mismatch and not p_accept_variance then 'DISCREPANCY' else 'APPROVED' end);
  for v_item in select * from jsonb_to_recordset(p_counts) as x(product_id uuid,stock_kind public.stock_kind,quantity integer) order by product_id,stock_kind loop
    select quantity into strict v_expected from public.inventory_balances where location_id=v_vehicle and product_id=v_item.product_id and stock_kind=v_item.stock_kind for update;
    select quantity into strict v_declared from public.trip_return_declarations where trip_id=p_trip and product_id=v_item.product_id and stock_kind=v_item.stock_kind;
    v_move:=null;v_variance_move:=null;
    if not v_mismatch or p_accept_variance then
      if v_item.quantity<>v_expected then
        v_line:=v_line+1;
        if v_item.quantity<v_expected then v_variance_move:=public.ops_move(v_trip,v_item.product_id,v_item.stock_kind,v_expected-v_item.quantity,'VARIANCE_LOSS',v_vehicle,null,null,p_key,v_line);
        else v_variance_move:=public.ops_move(v_trip,v_item.product_id,v_item.stock_kind,v_item.quantity-v_expected,'VARIANCE_GAIN',null,v_vehicle,null,p_key,v_line); end if;
      end if;
      if v_item.quantity>0 then v_line:=v_line+1;v_move:=public.ops_move(v_trip,v_item.product_id,v_item.stock_kind,v_item.quantity,'TRIP_RETURN',v_vehicle,v_warehouse,null,p_key,v_line); end if;
    end if;
    insert into public.trip_return_check_items(check_id,product_id,stock_kind,expected,declared,actual,movement_id) values(v_check,v_item.product_id,v_item.stock_kind,v_expected,v_declared,v_item.quantity,v_move);
    if v_item.quantity<>v_expected then insert into public.trip_discrepancies(check_id,product_id,stock_kind,expected,actual,resolution,approved_by,movement_id)
      values(v_check,v_item.product_id,v_item.stock_kind,v_expected,v_item.quantity,btrim(p_reason),case when p_accept_variance then auth.uid() end,v_variance_move); end if;
  end loop;
  if v_mismatch and not p_accept_variance then
    update public.trips set status='DISCREPANCY',version=version+1 where id=p_trip returning * into v_trip;
  else
    update public.trips set status='CLOSED',closed_at=now(),closed_by=auth.uid(),close_reason=btrim(p_reason),version=version+1 where id=p_trip returning * into v_trip;
  end if;
  return public.ops_finish(p_key,v_payload,p_trip,case when v_trip.status='CLOSED' then 'TRIP_CLOSED' else 'TRIP_DISCREPANCY' end,'trips',to_jsonb(v_old),to_jsonb(v_trip)||jsonb_build_object('check_id',v_check,'counts',p_counts,'variance_approved',p_accept_variance),btrim(p_reason));
end;
$$;
create function public.adjust_customer_custody(p_customer uuid,p_product uuid,p_delta integer,p_day uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_before integer; v_after bigint; v_entry uuid;
begin
  perform public.ops_actor(true);
  if p_delta is null or p_delta=0 or abs(p_delta::bigint)>1000000000 or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Invalid custody correction.'; end if;
  v_payload:=jsonb_build_object('operation','CUSTODY','customer',p_customer,'product',p_product,'delta',p_delta,'day',p_day,'reason',p_reason);
  v_retry:=public.ops_retry(p_key,v_payload);if v_retry is not null then return v_retry;end if;
  perform 1 from public.business_days where id=p_day and status='OPEN' for share;
  if not found then raise exception using errcode='22023',message='An OPEN business day is required.';end if;
  perform 1 from public.customers where id=p_customer for share;
  if not found then raise exception using errcode='22023',message='Customer not found.';end if;
  perform 1 from public.products where id=p_product and kind='FULL_JAR' for share;
  if not found then raise exception using errcode='22023',message='Custody requires a jar product.';end if;
  insert into public.jar_custody_balances(customer_id,product_id) values(p_customer,p_product) on conflict do nothing;
  select quantity into v_before from public.jar_custody_balances where customer_id=p_customer and product_id=p_product for update;
  v_after:=v_before::bigint+p_delta::bigint;
  if v_after<0 or v_after>2147483647 then raise exception using errcode='22023',message='Customer jar balance would be invalid; admin custody review required.';end if;
  update public.jar_custody_balances set quantity=v_after::integer where customer_id=p_customer and product_id=p_product;
  insert into public.jar_custody_entries(customer_id,product_id,delta,resulting_balance,reason,actor_user_id,business_day_id)
    values(p_customer,p_product,p_delta,v_after::integer,btrim(p_reason),auth.uid(),p_day) returning id into v_entry;
  return public.ops_finish(p_key,v_payload,v_entry,'CUSTODY_CORRECTED','jar_custody_entries',jsonb_build_object('quantity',v_before),jsonb_build_object('quantity',v_after,'customer_id',p_customer,'product_id',p_product),btrim(p_reason));
end;
$$;

-- One consistent read snapshot, with invoker RLS on EVERY underlying table.
create function public.operations_workspace(p_trip uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'customers',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.customers c where public.is_active_admin() or p_trip is null or exists(select 1 from public.trip_customers tc where tc.trip_id=p_trip and tc.customer_id=c.id)),'[]'::jsonb),
  'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.plate_number) from public.vehicles v),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_active',p.is_active,'version',p.version) order by p.name) from public.profiles p where p.role='DRIVER'),'[]'::jsonb),
  'products',coalesce((select jsonb_agg((to_jsonb(p)-'default_price')||jsonb_build_object('default_price',p.default_price::text) order by p.name) from public.products p),'[]'::jsonb),
  'locations',coalesce((select jsonb_agg(to_jsonb(l)) from public.stock_locations l),'[]'::jsonb),
  'balances',coalesce((select jsonb_agg(to_jsonb(b)) from public.inventory_balances b),'[]'::jsonb),
  'custody',coalesce((select jsonb_agg(to_jsonb(b)) from public.jar_custody_balances b),'[]'::jsonb),
  'days',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'date_label',d.date_label,'status',d.status)) from public.business_days d where d.status<>'CLOSED'),'[]'::jsonb),
  'trips',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select t.*,v.plate_number,p.name as driver_name,d.date_label from public.trips t
    join public.vehicles v on v.id=t.vehicle_id join public.profiles p on p.id=t.driver_id join public.business_days d on d.id=t.business_day_id
    where (p_trip is null and (t.status<>'CLOSED' or t.id in(select id from public.trips where status='CLOSED' order by created_at desc limit 100))) or t.id=p_trip
  ) x),'[]'::jsonb),
  'loads',coalesce((select jsonb_agg(to_jsonb(l)) from public.trip_load_items l where l.trip_id=p_trip),'[]'::jsonb),
  'route',coalesce((select jsonb_agg(to_jsonb(r)) from public.trip_customers r where r.trip_id=p_trip),'[]'::jsonb),
  'visits',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('value_snapshot',s.value::text) order by v.created_at desc) from public.trip_visits v join public.delivery_value_snapshots s on s.visit_id=v.id where v.trip_id=p_trip),'[]'::jsonb),
  'items',coalesce((select jsonb_agg((to_jsonb(i)-'unit_price_snapshot')||jsonb_build_object('unit_price_snapshot',i.unit_price_snapshot::text)) from public.visit_items i join public.trip_visits v on v.id=i.visit_id where v.trip_id=p_trip),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg((to_jsonb(i)-'reported_amount')||jsonb_build_object('reported_amount',i.reported_amount::text)) from public.delivery_payment_intents i join public.trip_visits v on v.id=i.visit_id where v.trip_id=p_trip),'[]'::jsonb),
  'declarations',coalesce((select jsonb_agg(to_jsonb(d)) from public.trip_return_declarations d where d.trip_id=p_trip),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc,m.line_number) from public.stock_movements m where m.trip_id=p_trip),'[]'::jsonb),
  'checks',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.trip_return_checks c where c.trip_id=p_trip),'[]'::jsonb),
  'check_items',coalesce((select jsonb_agg(to_jsonb(i)) from public.trip_return_check_items i join public.trip_return_checks c on c.id=i.check_id where c.trip_id=p_trip),'[]'::jsonb),
  'discrepancies',coalesce((select jsonb_agg(to_jsonb(i)) from public.trip_discrepancies i join public.trip_return_checks c on c.id=i.check_id where c.trip_id=p_trip),'[]'::jsonb),
  'custody_history',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.jar_custody_entries e where public.is_active_admin() or exists(select 1 from public.trip_visits v where v.id=e.visit_id and v.trip_id=p_trip)),'[]'::jsonb)
 );
$$;
revoke all on function public.save_driver(uuid,text,boolean,integer,text,uuid),public.create_trip(uuid,uuid,uuid,uuid,jsonb,text,uuid),
  public.assign_trip_customer(uuid,uuid,uuid),public.load_trip(uuid,jsonb,uuid),public.transition_trip(uuid,text,text,uuid),
  public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.submit_trip(uuid,jsonb,uuid),
  public.reconcile_trip(uuid,jsonb,text,boolean,uuid),public.adjust_customer_custody(uuid,uuid,integer,uuid,text,uuid),public.operations_workspace(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.save_driver(uuid,text,boolean,integer,text,uuid),public.create_trip(uuid,uuid,uuid,uuid,jsonb,text,uuid),
  public.assign_trip_customer(uuid,uuid,uuid),public.load_trip(uuid,jsonb,uuid),public.transition_trip(uuid,text,text,uuid),
  public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.submit_trip(uuid,jsonb,uuid),
  public.reconcile_trip(uuid,jsonb,text,boolean,uuid),public.adjust_customer_custody(uuid,uuid,integer,uuid,text,uuid),public.operations_workspace(uuid)
  to authenticated;

create function public.customer_delivery_history(p_customer uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
   select v.id,v.trip_id,t.trip_number,t.business_day_id,d.date_label,t.status,v.created_at,
     coalesce(sum(i.full_jars),0)::bigint as full_jars,coalesce(sum(i.empty_jars),0)::bigint as empty_jars,
     coalesce(sum(i.cartons),0)::bigint as cartons,s.value::text as value_snapshot
   from public.trip_visits v join public.trips t on t.id=v.trip_id
   join public.business_days d on d.id=t.business_day_id
   join public.delivery_value_snapshots s on s.visit_id=v.id join public.visit_items i on i.visit_id=v.id
   where v.customer_id=p_customer group by v.id,t.id,d.id,s.value
 ) x;
$$;
revoke all on function public.customer_delivery_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_delivery_history(uuid) to authenticated;
