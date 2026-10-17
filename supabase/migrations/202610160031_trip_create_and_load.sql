-- Proposed quantities are editable trip metadata, never confirmed load evidence.
-- trip_load_items requires a stock movement for each positive quantity and stays
-- immutable. No historical loads, stock balances or archived reports are rewritten.
alter table public.trips add column proposed_load_items jsonb not null default '[]'::jsonb
 check(jsonb_typeof(proposed_load_items)='array' and jsonb_array_length(proposed_load_items)<=100);

create function public.validate_trip_load_proposal(p_items jsonb,p_positive boolean) returns void
language plpgsql security definer set search_path='' as $$
declare x jsonb; product public.products; available integer; warehouse uuid;
begin
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then
  raise exception using errcode='22023',message='Invalid load items.';end if;
 if p_positive and not exists(select 1 from jsonb_array_elements(p_items) i where (i->>'quantity') ~ '^[1-9][0-9]{0,9}$') then
  raise exception using errcode='22023',message='Add at least one product.';end if;
 if exists(select 1 from jsonb_array_elements(p_items) i group by lower(i->>'product_id') having count(*)>1) then
  raise exception using errcode='22023',message='Load each product once.';end if;
 select id into strict warehouse from public.stock_locations where code='MAIN' and kind='WAREHOUSE';
 for x in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
  if jsonb_typeof(x)<>'object' or coalesce(x->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(x->'quantity') is distinct from 'number' or coalesce(x->>'quantity','') !~ '^(0|[1-9][0-9]{0,9})$' then
   raise exception using errcode='22023',message='Enter whole load quantities of zero or more.';end if;
  if (x->>'quantity')::bigint>1000000000 then raise exception using errcode='22023',message='Invalid load quantity.';end if;
  select * into product from public.products where id=(x->>'product_id')::uuid and is_active for share;
  if not found or x->>'stock_kind' is distinct from product.kind::text then
   raise exception using errcode='22023',message='Choose an active loadable product.';end if;
  select coalesce((select quantity from public.inventory_balances where location_id=warehouse and product_id=product.id and stock_kind::text=product.kind::text),0) into available;
  if (x->>'quantity')::integer>available then
   raise exception using errcode='22023',message=format('Requested %s %s, but only %s are now available.',x->>'quantity',product.name,available);end if;
 end loop;
 -- This is an availability check, not a reservation. load_trip/ops_move repeat
 -- the authoritative balance check under their existing ordered row locks.
end $$;

create function public.save_trip_draft_load(p_trip uuid,p_items jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j jsonb; retry uuid; t public.trips; previous jsonb;
begin
 perform public.ops_actor(true);
 j:=jsonb_build_object('operation','DRAFT_LOAD','trip',p_trip,'items',p_items);
 retry:=public.ops_retry(p_key,j);if retry is not null then return retry;end if;
 t:=public.ops_trip(p_trip);
 if t.status<>'DRAFT' then raise exception using errcode='22023',message='Only a draft trip can change proposed quantities.';end if;
 perform public.validate_trip_load_proposal(p_items,false);
 previous:=t.proposed_load_items;
 update public.trips set proposed_load_items=p_items,version=version+1 where id=p_trip;
 return public.ops_finish(p_key,j,p_trip,'TRIP_DRAFT_LOAD_SAVED','trips',jsonb_build_object('items',previous),jsonb_build_object('items',p_items),'Proposed quantities only; physical loading is not confirmed');
end $$;

create function public.create_trip_with_load(p_id uuid,p_driver uuid,p_vehicle uuid,p_day uuid,p_scheduled date,p_notes text,p_items jsonb,p_confirm boolean,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j jsonb; retry uuid; violated_constraint text;
begin
 perform public.ops_actor(true);
 if p_confirm is null then raise exception using errcode='22023',message='Choose whether to save a draft or confirm physical loading.';end if;
 j:=jsonb_build_object('operation','CREATE_TRIP_WITH_LOAD','id',p_id,'driver',p_driver,'vehicle',p_vehicle,'day',p_day,'scheduled',p_scheduled,'notes',p_notes,'items',p_items,'confirm',p_confirm);
 retry:=public.ops_retry(p_key,j);if retry is not null then return retry;end if;
 if p_driver is null then raise exception using errcode='22023',message='Choose a driver.';end if;
 if p_vehicle is null then raise exception using errcode='22023',message='Choose a vehicle.';end if;
 if not exists(select 1 from public.profiles where id=p_driver and role='DRIVER' and is_active and approval_status='APPROVED') then
  raise exception using errcode='22023',message='Choose an available approved driver.';end if;
 if exists(select 1 from public.trips where driver_id=p_driver and status<>'CLOSED') then
  raise exception using errcode='22023',message='This driver is already reserved for another trip.';end if;
 if exists(select 1 from public.trips where vehicle_id=p_vehicle and status<>'CLOSED') then
  raise exception using errcode='22023',message='This vehicle is already assigned to another trip.';end if;
 perform public.validate_trip_load_proposal(p_items,p_confirm);
 -- All nested commands execute inside this one RPC transaction. Their existing
 -- permissions, OPEN-day locks, schedule checks, reservations, numbering, audit
 -- events, notifications and inventory journal are retained.
 perform public.schedule_trip(p_id,p_driver,p_vehicle,p_day,p_scheduled,p_notes,md5(p_key::text||':schedule')::uuid);
 if p_confirm then
  begin
   perform public.load_trip(p_id,p_items,md5(p_key::text||':load')::uuid);
  exception when sqlstate '22023' then
   if sqlerrm='Insufficient stock; balance cannot be negative.' then
    -- The failed load's entire subtransaction is already rolled back. Explain
    -- current availability without introducing a second inventory writer.
    perform public.validate_trip_load_proposal(p_items,true);
    raise exception using errcode='22023',message='Warehouse stock changed. Review current availability and adjust quantities.';
   end if;
   raise;
  end;
 else
  perform public.save_trip_draft_load(p_id,p_items,md5(p_key::text||':proposal')::uuid);
 end if;
 return public.ops_finish(p_key,j,p_id,'TRIP_PREPARATION_CREATED','trips',null,jsonb_build_object('confirmed',p_confirm,'items',p_items),'Admin trip creation and loading workflow');
exception when unique_violation then
 get stacked diagnostics violated_constraint=constraint_name;
 if violated_constraint='one_live_trip_per_driver' then
  raise exception using errcode='22023',message='This driver is already reserved for another trip.';
 elsif violated_constraint='one_live_trip_per_vehicle' then
  raise exception using errcode='22023',message='This vehicle is already assigned to another trip.';
 end if;
 raise;
end $$;

revoke all on function public.validate_trip_load_proposal(jsonb,boolean),public.save_trip_draft_load(uuid,jsonb,uuid),public.create_trip_with_load(uuid,uuid,uuid,uuid,date,text,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_trip_draft_load(uuid,jsonb,uuid),public.create_trip_with_load(uuid,uuid,uuid,uuid,date,text,jsonb,boolean,uuid) to authenticated;
