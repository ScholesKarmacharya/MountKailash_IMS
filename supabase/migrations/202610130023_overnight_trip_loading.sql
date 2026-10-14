-- Forward-only. Loading, refilling, sale and return ledgers remain authoritative.
-- A delivery schedule is not an inventory posting date.
alter table public.stock_movements drop constraint stock_movement_type;
alter table public.stock_movements add constraint stock_movement_type check(movement_type in (
 'MANUAL_INCREASE','MANUAL_DECREASE','TRIP_LOAD','DELIVERY','EMPTY_COLLECTION','TRIP_RETURN','VARIANCE_LOSS','VARIANCE_GAIN',
 'REFILL_INPUT','REFILL_OUTPUT','WAREHOUSE_DAMAGE','TRIP_UNLOAD'));
alter table public.stock_movements drop constraint stock_movement_direction;
alter table public.stock_movements add constraint stock_movement_direction check(
 (movement_type in ('MANUAL_INCREASE','EMPTY_COLLECTION','VARIANCE_GAIN','REFILL_OUTPUT') and from_location_id is null and to_location_id is not null) or
 (movement_type in ('MANUAL_DECREASE','DELIVERY','VARIANCE_LOSS','REFILL_INPUT') and from_location_id is not null and to_location_id is null) or
 (movement_type in ('TRIP_LOAD','TRIP_RETURN','WAREHOUSE_DAMAGE','TRIP_UNLOAD') and from_location_id is not null and to_location_id is not null and from_location_id<>to_location_id));
alter table public.trips add column scheduled_date date;
alter table public.trips add column created_business_day_id uuid references public.business_days(id);
alter table public.trips add column loaded_at timestamptz;
alter table public.trips add column loaded_by uuid references public.profiles(id);
alter table public.trips add column loading_business_day_id uuid references public.business_days(id);
alter table public.trips add column cancelled boolean not null default false;
-- Metadata backfill only; no status, allocation, movement or archived JSON changes.
alter table public.trips disable trigger trips_preserve;
update public.trips t set scheduled_date=d.date_label,created_business_day_id=t.business_day_id
 from public.business_days d where d.id=t.business_day_id;
alter table public.trips enable trigger trips_preserve;
-- Closed rows are immutable. Do not rewrite historical loading metadata.
alter table public.trips alter column scheduled_date set not null;
alter table public.trips alter column created_business_day_id set not null;
create index trips_scheduled_status on public.trips(scheduled_date,status);
alter table public.driver_offline_rounds drop constraint driver_offline_rounds_phase_check;
alter table public.driver_offline_rounds add constraint driver_offline_rounds_phase_check check(phase in ('PREPARED','ACTIVE','PAUSED','SEALED','EXCEPTION'));
alter table public.driver_offline_operations drop constraint driver_offline_operations_kind_check;
alter table public.driver_offline_operations add constraint driver_offline_operations_kind_check check(kind in ('CUSTOMER','CONTACT','DELIVERY','PAYMENT','SUBMIT','PAUSE'));

create table public.trip_carryovers (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id),
 from_day_id uuid not null references public.business_days(id), reason text not null check(length(btrim(reason)) between 3 and 500),
 authorized_by uuid not null references public.profiles(id), authorized_at timestamptz not null default now(),
 resumed_day_id uuid references public.business_days(id), resumed_at timestamptz,
 unique(trip_id,from_day_id)
);
alter table public.trip_carryovers enable row level security;
revoke all on public.trip_carryovers from public,anon,authenticated,service_role;
grant select on public.trip_carryovers to authenticated;
create policy carryover_read on public.trip_carryovers for select to authenticated using(public.has_operational_access() and public.can_read_trip(trip_id));
-- A prepared trip still references yesterday until START. Its approved driver
-- must be able to read the current period's metadata to start it tomorrow.
-- This grants no stock, customer, finance, or another driver's trip visibility.
create policy day_prepared_driver_read on public.business_days for select to authenticated using(
 status in ('OPEN','CLOSING_REVIEW') and public.has_operational_access() and exists(
  select 1 from public.trips t where t.driver_id=auth.uid() and (
   t.status in ('DRAFT','LOADED') or (t.status='ACTIVE' and exists(select 1 from public.trip_carryovers c where c.trip_id=t.id and c.resumed_at is null)))));

create function public.trip_schedule_defaults() returns trigger language plpgsql set search_path='' as $$
begin
 new.scheduled_date:=coalesce(new.scheduled_date,(select date_label from public.business_days where id=new.business_day_id));
 new.created_business_day_id:=new.business_day_id; return new;
end $$;
create trigger trip_schedule_defaults before insert on public.trips for each row execute function public.trip_schedule_defaults();
create function public.trip_nepal_date() returns date language sql volatile set search_path='' as $$
 select (clock_timestamp() at time zone 'Asia/Kathmandu')::date;
$$;

create or replace function public.guard_trip_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='42501',message='Historical trips cannot be deleted.';end if;
 if old.status='CLOSED' then raise exception using errcode='42501',message='Closed trips are immutable.';end if;
 if new.id<>old.id or new.driver_id<>old.driver_id or new.vehicle_id<>old.vehicle_id or new.created_business_day_id<>old.created_business_day_id then
  raise exception using errcode='42501',message='Trip assignment is immutable; cancel the draft and create another.';end if;
 if new.business_day_id<>old.business_day_id and not (
   (old.status='LOADED' and new.status='ACTIVE' and new.scheduled_date<=(select date_label from public.business_days where id=new.business_day_id)) or
   (old.status='ACTIVE' and new.status='ACTIVE' and exists(select 1 from public.trip_carryovers c where c.trip_id=old.id and c.from_day_id=old.business_day_id and c.resumed_day_id=new.business_day_id))) then
  raise exception using errcode='42501',message='Only starting a prepared trip or resuming authorized carryover can change its posting day.';end if;
 if old.scheduled_date<>new.scheduled_date and old.status not in ('DRAFT','LOADED') then
  raise exception using errcode='42501',message='Only an unstarted trip can be rescheduled.';end if;
 return new;
end $$;

-- Same lock order as existing writers: trip, then shared OPEN day. Close takes
-- only the exclusive day lock, so a concurrent load either commits first or fails.
create or replace function public.ops_trip(p_trip uuid) returns public.trips
language plpgsql security definer set search_path='' as $$
declare t public.trips; d uuid;
begin
 select * into t from public.trips where id=p_trip and (driver_id=auth.uid() or public.is_active_admin()) for update;
 if not found then raise exception using errcode='42501',message='Assigned trip access required.';end if;
 if t.status in ('DRAFT','LOADED') then
  select id into d from public.business_days where status='OPEN' for share;
 else
  d:=t.business_day_id;
  perform 1 from public.business_days where id=d and status='OPEN' for share;
  if not found then d:=null;end if;
  if exists(select 1 from public.trip_carryovers c where c.trip_id=p_trip and c.from_day_id=t.business_day_id and c.resumed_at is null) then
   raise exception using errcode='22023',message='Trip is paused for authorized carryover. Open the next day and resume it before delivering.';end if;
 end if;
 if d is null then raise exception using errcode='22023',message='An OPEN business day is required.';end if;
 -- For preparation only, the returned composite posts transfers to the actual
 -- OPEN day. The persisted assignment is moved only when deliveries start.
 t.business_day_id:=d;return t;
end $$;

create function public.schedule_trip(p_id uuid,p_driver uuid,p_vehicle uuid,p_day uuid,p_scheduled date,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j jsonb; retry uuid; d public.business_days;
begin
 perform public.ops_actor(true);
 j:=jsonb_build_object('operation','SCHEDULE_TRIP','id',p_id,'driver',p_driver,'vehicle',p_vehicle,'day',p_day,'scheduled',p_scheduled,'notes',p_notes);
 retry:=public.ops_retry(p_key,j);if retry is not null then return retry;end if;
 select * into d from public.business_days where id=p_day and status='OPEN' for share;
 if not found then raise exception using errcode='22023',message='An OPEN business day is required.';end if;
 if p_scheduled is null or p_scheduled<d.date_label or p_scheduled<public.trip_nepal_date() then
  raise exception using errcode='22023',message='Schedule the trip for today or a future date.';end if;
 perform public.create_trip(p_id,p_driver,p_vehicle,p_day,'[]'::jsonb,p_notes,md5(p_key::text||':create')::uuid);
 update public.trips set scheduled_date=p_scheduled where id=p_id;
 return public.ops_finish(p_key,j,p_id,'TRIP_SCHEDULED','trips',null,jsonb_build_object('scheduled_date',p_scheduled),'Admin delivery schedule');
end $$;

alter function public.load_trip(uuid,jsonb,uuid) rename to load_trip_before_schedule;
revoke all on function public.load_trip_before_schedule(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.load_trip(p_trip uuid,p_items jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; t public.trips; d uuid; stamp timestamptz; was_draft boolean;
begin
 perform public.ops_actor(true);
 select status='DRAFT' into was_draft from public.trips where id=p_trip;
 result:=public.load_trip_before_schedule(p_trip,p_items,p_key);
 -- Stamp new confirmations only. Legacy load retries must not invent an admin.
 select * into t from public.trips where id=p_trip;
 if was_draft and t.loaded_at is null and t.status='LOADED' then
  select business_day_id,created_at into d,stamp from public.stock_movements where trip_id=p_trip and movement_type='TRIP_LOAD' order by created_at,id limit 1;
  update public.trips set loading_business_day_id=d,loaded_at=stamp,loaded_by=auth.uid() where id=p_trip;
 end if;
 return result;
end $$;

create or replace function public.transition_trip(p_trip uuid,p_action text,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j jsonb; retry uuid; t public.trips; old_t public.trips; d public.business_days;
begin
 perform public.ops_actor(p_action in ('REVIEW','CANCEL'));
 if p_action is null or p_action not in ('START','REVIEW','CANCEL','CONTINUE') or p_reason is null or length(p_reason)>500 then
  raise exception using errcode='22023',message='Invalid trip action.';end if;
 j:=jsonb_build_object('operation','TRANSITION','trip',p_trip,'action',p_action,'reason',p_reason);
 retry:=public.ops_retry(p_key,j);if retry is not null then return retry;end if;
 -- Match device registration/upload: round before trip, including activation.
 -- The advisory lock also serializes registration when no round exists yet.
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 perform 1 from public.driver_offline_rounds where trip_id=p_trip for update;
 if p_action='CONTINUE' then
  select * into t from public.trips where id=p_trip and (driver_id=auth.uid() or public.is_active_admin()) for update;
  if not found then raise exception using errcode='42501',message='Assigned trip access required.';end if;
  old_t:=t;
  select * into d from public.business_days where status='OPEN' for share;
  if d.id is null or not exists(select 1 from public.business_days where id=t.business_day_id and status='CLOSED') or t.status<>'ACTIVE' or
   not exists(select 1 from public.trip_carryovers where trip_id=p_trip and from_day_id=t.business_day_id and resumed_at is null) then
   raise exception using errcode='22023',message='Close the carried day and open the next day before resuming this trip.';end if;
  update public.trip_carryovers set resumed_day_id=d.id,resumed_at=clock_timestamp() where trip_id=p_trip and from_day_id=t.business_day_id and resumed_at is null;
  update public.trips set business_day_id=d.id,version=version+1 where id=p_trip returning * into t;
  update public.driver_offline_rounds set phase='ACTIVE' where trip_id=p_trip and phase='PAUSED';
 else
  t:=public.ops_trip(p_trip);select * into old_t from public.trips where id=p_trip;
  select * into strict d from public.business_days where id=t.business_day_id;
  if p_action='START' and t.status='LOADED' then
   if t.scheduled_date>d.date_label or t.scheduled_date>public.trip_nepal_date() then
    raise exception using errcode='22023',message='This prepared trip cannot start before its scheduled delivery date.';end if;
   update public.trips set status='ACTIVE',started_at=clock_timestamp(),business_day_id=d.id,version=version+1 where id=p_trip returning * into t;
   update public.driver_offline_rounds set phase='ACTIVE' where trip_id=p_trip and phase='PREPARED';
  elsif p_action='REVIEW' and t.status in ('SUBMITTED','DISCREPANCY') then
   update public.trips set status='UNDER_REVIEW',version=version+1 where id=p_trip returning * into t;
  elsif p_action='CANCEL' and t.status='DRAFT' and length(btrim(p_reason))>=3 then
   update public.trips set status='CLOSED',cancelled=true,closed_at=clock_timestamp(),closed_by=auth.uid(),close_reason=btrim(p_reason),version=version+1 where id=p_trip returning * into t;
  else raise exception using errcode='22023',message='Trip action is not allowed in its current state.';end if;
 end if;
 return public.ops_finish(p_key,j,p_trip,'TRIP_'||p_action,'trips',to_jsonb(old_t),to_jsonb(t),coalesce(nullif(btrim(p_reason),''),'Authorized trip transition'));
end $$;

create function public.trip_preparation_command(p_trip uuid,p_action text,p_scheduled date,p_reason text,p_counts jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.trips; old_t public.trips; d public.business_days; j jsonb; retry uuid; x record; vehicle uuid; warehouse uuid; line integer:=0;
begin
 perform public.ops_actor(true);
 if p_action is null or p_action not in ('RESCHEDULE','UNLOAD_CANCEL','CARRYOVER') or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
  raise exception using errcode='22023',message='Select a trip action and enter its specific reason.';end if;
 j:=jsonb_build_object('operation','TRIP_PREPARATION','trip',p_trip,'action',p_action,'scheduled',p_scheduled,'reason',p_reason,'counts',p_counts);
 retry:=public.ops_retry(p_key,j);if retry is not null then return retry;end if;
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 perform 1 from public.driver_offline_rounds where trip_id=p_trip for update;
 t:=public.ops_trip(p_trip);select * into old_t from public.trips where id=p_trip;
 select * into strict d from public.business_days where id=t.business_day_id;
 if p_action='RESCHEDULE' then
  if t.status not in ('DRAFT','LOADED') or p_scheduled is null or p_scheduled<d.date_label or p_scheduled<public.trip_nepal_date() then
   raise exception using errcode='22023',message='Only an unstarted trip can be rescheduled to today or a future date.';end if;
  update public.trips set scheduled_date=p_scheduled,version=version+1 where id=p_trip returning * into t;
 elsif p_action='CARRYOVER' then
  if t.status<>'ACTIVE' then raise exception using errcode='22023',message='Only an active trip can be authorized for overnight carryover.';end if;
  -- An online zero pending count does not prove an offline phone has no journal.
  -- Retain the existing checkpoint safeguard, never waive it with a reason.
  if exists(select 1 from public.driver_offline_rounds where trip_id=p_trip and (phase<>'PAUSED' or reported_pending<>0)) or exists(select 1 from public.driver_offline_operations where trip_id=p_trip and status<>'CONFIRMED') then
   raise exception using errcode='22023',message='Synchronize and confirm the driver pause checkpoint before authorizing carryover.';end if;
  insert into public.trip_carryovers(trip_id,from_day_id,reason,authorized_by) values(p_trip,t.business_day_id,btrim(p_reason),auth.uid());
 else
  if t.status<>'LOADED' or p_counts is null then raise exception using errcode='22023',message='Confirm physical unloading counts for an unstarted prepared trip.';end if;
  perform public.ops_counts(t,p_counts);
  select location_id into strict vehicle from public.vehicles where id=t.vehicle_id;
  select id into strict warehouse from public.stock_locations where code='MAIN' and kind='WAREHOUSE';
  -- Lock and verify every assigned vehicle balance before any transfer.
  for x in select * from jsonb_to_recordset(p_counts) as c(product_id uuid,stock_kind public.stock_kind,quantity integer) order by product_id,stock_kind loop
   perform 1 from public.inventory_balances b where b.location_id=vehicle and b.product_id=x.product_id and b.stock_kind=x.stock_kind and b.quantity=x.quantity for update;
   if not found then raise exception using errcode='22023',message='Unloading counts do not match vehicle stock. Resolve the discrepancy before cancelling.';end if;
  end loop;
  for x in select * from jsonb_to_recordset(p_counts) as c(product_id uuid,stock_kind public.stock_kind,quantity integer) order by product_id,stock_kind loop
   if x.quantity>0 then line:=line+1;perform public.ops_move(t,x.product_id,x.stock_kind,x.quantity,'TRIP_UNLOAD',vehicle,warehouse,null,p_key,line);end if;
  end loop;
  update public.trips set status='CLOSED',cancelled=true,closed_at=clock_timestamp(),closed_by=auth.uid(),close_reason=btrim(p_reason),version=version+1 where id=p_trip returning * into t;
  update public.driver_offline_rounds set phase='SEALED',checkpoint_at=clock_timestamp() where trip_id=p_trip and phase='PREPARED';
 end if;
 return public.ops_finish(p_key,j,p_trip,'TRIP_'||p_action,'trips',to_jsonb(old_t),to_jsonb(t)||jsonb_build_object('counts',p_counts,'reason',p_reason),p_reason);
end $$;

-- Replace only the trip and vehicle-stock tests. All finance, custody, movement
-- reconciliation and registered offline-writer blockers remain in the core.
alter function public.day_blockers(uuid) rename to day_blockers_before_schedule;
revoke all on function public.day_blockers_before_schedule(uuid) from public,anon,authenticated,service_role;
create function public.trip_can_carry(p_trip uuid,p_day uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.trips t where t.id=p_trip and (
  (t.status='LOADED' and t.scheduled_date>(select date_label from public.business_days where id=p_day)) or
  (t.status='ACTIVE' and exists(select 1 from public.trip_carryovers c where c.trip_id=t.id and c.from_day_id=p_day and c.resumed_at is null)
   and not exists(select 1 from public.driver_offline_rounds r where r.trip_id=t.id and (r.phase<>'PAUSED' or r.reported_pending<>0))
   and not exists(select 1 from public.driver_offline_operations o where o.trip_id=t.id and o.status<>'CONFIRMED'))));
$$;
create function public.day_blockers(p_day uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_agg(b) from jsonb_array_elements(public.day_blockers_before_schedule(p_day)) b where b->>'code' not in ('TRIP','VEHICLE_STOCK')),'[]'::jsonb)||
 coalesce((select jsonb_agg(jsonb_build_object('code','TRIP','message','Trip #'||t.trip_number||' is '||t.status::text||'; reconcile or cancel an unladen draft.','href','/admin/trips/'||t.id))
  from public.trips t where t.status<>'CLOSED' and t.scheduled_date<=(select date_label from public.business_days where id=p_day) and not public.trip_can_carry(t.id,p_day)),'[]'::jsonb)||
 coalesce((select jsonb_agg(jsonb_build_object('code','VEHICLE_STOCK','message','Vehicle '||v.plate_number||' still holds stock; reconcile its trip.','href','/admin/vehicles/'||v.id))
  from public.vehicles v where exists(select 1 from public.inventory_balances b where b.location_id=v.location_id and b.quantity<>0)
   and not exists(select 1 from public.trips t where t.vehicle_id=v.id and t.status<>'CLOSED' and public.trip_can_carry(t.id,p_day))),'[]'::jsonb);
$$;

revoke all on function public.trip_schedule_defaults(),public.trip_can_carry(uuid,uuid),public.trip_nepal_date() from public,anon,authenticated,service_role;
revoke all on function public.schedule_trip(uuid,uuid,uuid,uuid,date,text,uuid),public.trip_preparation_command(uuid,text,date,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.schedule_trip(uuid,uuid,uuid,uuid,date,text,uuid),public.trip_preparation_command(uuid,text,date,text,jsonb,uuid) to authenticated;
revoke all on function public.load_trip(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.load_trip(uuid,jsonb,uuid) to authenticated;
-- Replaced private helpers keep private grants; public wrappers keep their own
-- ops_actor checks. No table write grants or RLS bypass are introduced.
revoke all on function public.day_blockers(uuid) from public,anon,authenticated,service_role;

-- Keep this reader SECURITY INVOKER: assigned trip and stock RLS still apply.
create or replace function public.operations_workspace(p_trip uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'driver_workflow',true,'customer_details',true,
  'customers',public.delivery_customer_directory(),
  'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.plate_number) from public.vehicles v),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_active',p.is_active,'version',p.version) order by p.name) from public.profiles p where p.role='DRIVER'),'[]'::jsonb),
  'products',coalesce((select jsonb_agg((to_jsonb(p)-'default_price')||jsonb_build_object('default_price',p.default_price::text,'reference_price',coalesce(p.reference_price,p.default_price)::text) order by p.name) from public.products p),'[]'::jsonb),
  'locations',coalesce((select jsonb_agg(to_jsonb(l)) from public.stock_locations l),'[]'::jsonb),
  'balances',coalesce((select jsonb_agg(to_jsonb(b)) from public.inventory_balances b),'[]'::jsonb),
  'custody',coalesce((select jsonb_agg(to_jsonb(b)) from public.jar_custody_balances b),'[]'::jsonb),
  'days',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'date_label',d.date_label,'status',d.status)) from public.business_days d where d.status<>'CLOSED'),'[]'::jsonb),
  'trips',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select t.*,v.plate_number,p.name as driver_name,t.scheduled_date as date_label,d.date_label as posting_date,exists(select 1 from public.trip_carryovers c where c.trip_id=t.id and c.resumed_at is null) as carryover_pending from public.trips t
    join public.vehicles v on v.id=t.vehicle_id join public.profiles p on p.id=t.driver_id join public.business_days d on d.id=t.business_day_id
    where (p_trip is null and (t.status<>'CLOSED' or t.id in(select id from public.trips where status='CLOSED' order by created_at desc limit 100))) or t.id=p_trip
  ) x),'[]'::jsonb),
  'loads',coalesce((select jsonb_agg(to_jsonb(l)) from public.trip_load_items l where l.trip_id=p_trip),'[]'::jsonb),
  'route',coalesce((select jsonb_agg(to_jsonb(r)) from public.trip_customers r where r.trip_id=p_trip),'[]'::jsonb),
  'visits',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('value_snapshot',s.value::text) order by v.created_at desc) from public.trip_visits v join public.delivery_value_snapshots s on s.visit_id=v.id where v.trip_id=p_trip),'[]'::jsonb),
  'items',coalesce((select jsonb_agg((to_jsonb(i)-'unit_price_snapshot')||jsonb_build_object('unit_price_snapshot',i.unit_price_snapshot::text,'reference_price_snapshot',i.reference_price_snapshot::text,'free_value_snapshot',i.free_value_snapshot::text)) from public.visit_items i join public.trip_visits v on v.id=i.visit_id where v.trip_id=p_trip),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg((to_jsonb(i)-'reported_amount')||jsonb_build_object('reported_amount',i.reported_amount::text)) from public.delivery_payment_intents i join public.trip_visits v on v.id=i.visit_id where v.trip_id=p_trip),'[]'::jsonb),
  'declarations',coalesce((select jsonb_agg(to_jsonb(d)) from public.trip_return_declarations d where d.trip_id=p_trip),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc,m.line_number) from public.stock_movements m where m.trip_id=p_trip),'[]'::jsonb),
  'checks',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.trip_return_checks c where c.trip_id=p_trip),'[]'::jsonb),
  'check_items',coalesce((select jsonb_agg(to_jsonb(i)) from public.trip_return_check_items i join public.trip_return_checks c on c.id=i.check_id where c.trip_id=p_trip),'[]'::jsonb),
  'discrepancies',coalesce((select jsonb_agg(to_jsonb(i)) from public.trip_discrepancies i join public.trip_return_checks c on c.id=i.check_id where c.trip_id=p_trip),'[]'::jsonb),
  'custody_history',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.jar_custody_entries e where public.is_active_admin() or exists(select 1 from public.trip_visits v where v.id=e.visit_id and v.trip_id=p_trip)),'[]'::jsonb)
 );
$$;

create function public.trip_in_period(p_trip uuid,p_day uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.trips t join public.business_days d on d.id=p_day where t.id=p_trip and not t.cancelled and t.scheduled_date<=d.date_label and
  (t.business_day_id=p_day or (t.status in ('DRAFT','LOADED') and t.scheduled_date=d.date_label) or exists(select 1 from public.trip_visits v where v.trip_id=t.id and v.business_day_id=p_day)
   or exists(select 1 from public.stock_movements m where m.trip_id=t.id and m.business_day_id=p_day and m.movement_type='TRIP_RETURN')));
$$;
alter function public.day_report_data(uuid) rename to day_report_data_before_schedule;
revoke all on function public.day_report_data_before_schedule(uuid) from public,anon,authenticated,service_role;
create function public.day_report_data(p_day uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jsonb; trips jsonb; prepared jsonb; carryovers jsonb; d public.business_days;
begin
 select * into strict d from public.business_days where id=p_day;
 j:=public.day_report_data_before_schedule(p_day);
 -- Report each visit and invoice only in its actual posting period, even when a
 -- single carried trip has deliveries in two days. Existing archives stay intact.
 select coalesce(jsonb_agg(to_jsonb(x) order by trip_number),'[]'::jsonb) into trips from (
  select t.id,t.trip_number,t.driver_id,p.name as driver_name,t.vehicle_id,v.plate_number,t.status,t.scheduled_date,t.close_reason,t.closed_at,
   coalesce((select sum(i.full_jars) from public.visit_items i join public.trip_visits tv on tv.id=i.visit_id where tv.trip_id=t.id and tv.business_day_id=p_day),0) as full_jars,
   coalesce((select sum(i.empty_jars) from public.visit_items i join public.trip_visits tv on tv.id=i.visit_id where tv.trip_id=t.id and tv.business_day_id=p_day),0) as empty_jars,
   coalesce((select sum(i.cartons) from public.visit_items i join public.trip_visits tv on tv.id=i.visit_id where tv.trip_id=t.id and tv.business_day_id=p_day),0) as cartons,
   coalesce((select sum(i.subtotal) from public.invoices i join public.sales s on s.id=i.sale_id where s.trip_id=t.id and s.business_day_id=p_day),0)::text as sales,
   exists(select 1 from public.trip_carryovers c where c.trip_id=t.id and c.from_day_id=p_day) as carried_over,
   coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(ci)) from public.trip_return_check_items ci where ci.check_id=c.id),'[]'::jsonb))) from public.trip_return_checks c where c.trip_id=t.id and
     c.created_at>=d.opened_at and c.created_at<=coalesce(d.closed_at,'infinity'::timestamptz)),'[]'::jsonb) as checks
  from public.trips t join public.profiles p on p.id=t.driver_id join public.vehicles v on v.id=t.vehicle_id where public.trip_in_period(t.id,p_day)
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by scheduled_date,trip_number),'[]'::jsonb) into prepared from (
  select t.id,t.trip_number,t.scheduled_date,t.driver_id,p.name as driver_name,t.vehicle_id,v.plate_number,t.loaded_at,t.loaded_by,t.loading_business_day_id,
   coalesce((select sum(quantity) from public.trip_load_items where trip_id=t.id and stock_kind='FULL_JAR'),0) as full_jars,
   coalesce((select sum(quantity) from public.trip_load_items where trip_id=t.id and stock_kind='BOTTLE_CARTON'),0) as cartons
  from public.trips t join public.profiles p on p.id=t.driver_id join public.vehicles v on v.id=t.vehicle_id where t.status='LOADED' and t.scheduled_date>d.date_label
 ) x;
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('trip_number',t.trip_number,'driver_name',p.name,'plate_number',v.plate_number)),'[]'::jsonb) into carryovers
  from public.trip_carryovers c join public.trips t on t.id=c.trip_id join public.profiles p on p.id=t.driver_id join public.vehicles v on v.id=t.vehicle_id where c.from_day_id=p_day;
 j:=jsonb_set(j,'{trips}',trips);
 j:=jsonb_set(j,'{totals}',j->'totals'||jsonb_build_object('trips',jsonb_array_length(trips),
  'completed_trips',(select count(*) from jsonb_array_elements(trips) t where t->>'status'='CLOSED'),
  'pending_trips',(select count(*) from jsonb_array_elements(trips) t where t->>'status'<>'CLOSED')));
 return j||jsonb_build_object('prepared_trips',prepared,'carryovers',carryovers,'vehicle_stock',coalesce((select jsonb_agg(to_jsonb(x)) from (
  select b.location_id,b.product_id,b.stock_kind,b.quantity,v.plate_number from public.inventory_balances b join public.vehicles v on v.location_id=b.location_id where b.quantity<>0) x),'[]'::jsonb));
end $$;
revoke all on function public.trip_in_period(uuid,uuid),public.day_report_data(uuid) from public,anon,authenticated,service_role;

-- Moving an operational trip to a later day must not move earlier customer
-- visits into that day. Explicit authorization guards the private HOUSE reader.
alter function public.customer_delivery_history(uuid) rename to customer_delivery_history_before_schedule;
revoke all on function public.customer_delivery_history_before_schedule(uuid) from public,anon,authenticated,service_role;
create function public.customer_delivery_history(p_customer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jsonb;
begin
 if not public.has_operational_access() or not public.can_read_customer(p_customer) then
  raise exception using errcode='42501',message='Assigned customer access required.';end if;
 j:=public.customer_delivery_history_before_schedule(p_customer);
 return coalesce((select jsonb_agg(x||jsonb_build_object('business_day_id',v.business_day_id,'date_label',d.date_label) order by x->>'created_at' desc)
  from jsonb_array_elements(j) x join public.trip_visits v on v.id=(x->>'id')::uuid join public.business_days d on d.id=v.business_day_id),'[]'::jsonb);
end $$;
revoke all on function public.customer_delivery_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_delivery_history(uuid) to authenticated;
-- A PAUSE is an acknowledged journal checkpoint, not a return or settlement.
create or replace function public.offline_post(p_trip uuid,p_device uuid,p_token text,p_id uuid,p_sequence integer,p_kind text,p_occurred timestamptz,p_payload text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; o public.driver_offline_operations; j jsonb; v_result uuid; v_customer uuid; x jsonb; v_custody integer; v_message text; v_state text;
begin
 perform public.ops_actor(false);r:=public.offline_device(p_trip,p_device,p_token);
 if p_id is null or p_sequence is null or p_sequence<1 or p_kind is null or p_kind not in ('CUSTOMER','CONTACT','DELIVERY','PAYMENT','SUBMIT','PAUSE')
  or p_payload is null or length(p_payload)>60000 or public.offline_hash(p_payload) is distinct from p_fingerprint or p_occurred is null then
  raise exception using errcode='22023',message='Invalid offline record.';end if;
 perform pg_advisory_xact_lock(hashtextextended('offline-op:'||p_id::text,0));
 select * into o from public.driver_offline_operations where id=p_id for update;
 if found then
  if o.driver_id<>auth.uid() or o.trip_id<>p_trip or o.fingerprint<>p_fingerprint or o.payload<>p_payload or o.kind<>p_kind or o.sequence<>p_sequence or o.occurred_at<>p_occurred then
   insert into public.driver_offline_reviews(operation_id,trip_id,actor_id,action,details,reason)
    values(p_id,p_trip,auth.uid(),'IDEMPOTENCY_CONFLICT',jsonb_build_object('fingerprint',p_fingerprint),'Original offline operation preserved');
   return jsonb_build_object('id',p_id,'trip',p_trip,'sequence',p_sequence,'fingerprint',p_fingerprint,'status','NEEDS_REVIEW','result',null,'message','Idempotency conflict. Contact the warehouse admin.','processedAt',now());
  end if;
  if o.status<>'RETRYABLE' then return public.offline_receipt(p_id);end if;
 else
  if p_sequence<>r.confirmed_sequence+1 then raise exception using errcode='22023',message='Synchronize earlier records before this operation.';end if;
  insert into public.driver_offline_operations(id,trip_id,driver_id,device_id,sequence,kind,payload,fingerprint,occurred_at,status)
   values(p_id,p_trip,auth.uid(),p_device,p_sequence,p_kind,p_payload,p_fingerprint,p_occurred,'RETRYABLE') returning * into o;
 end if;
 begin
  if r.phase<>'ACTIVE' then raise exception using errcode='22023',message='This load is sealed or under an admin exception. Keep this record for review.';end if;
  if p_sequence<>r.confirmed_sequence+1 then raise exception using errcode='22023',message='Synchronize earlier records before this operation.';end if;
  if p_occurred<r.registered_at-interval '5 minutes' or p_occurred>clock_timestamp()+interval '5 minutes' then raise exception using errcode='22023',message='The device clock needs review. Original occurrence time is preserved.';end if;
  if exists(select 1 from public.trip_carryovers c where c.trip_id=p_trip and c.resumed_at is not null and p_occurred<c.resumed_at-interval '5 minutes') then
   raise exception using errcode='22023',message='This record predates the carryover resume checkpoint. Preserve it for admin review.';end if;
  perform public.delivery_trip(p_trip);
  perform set_config('mk.offline.device',p_device::text,true);perform set_config('mk.offline.occurred',p_occurred::text,true);
  j:=p_payload::jsonb;
  if p_kind in ('CUSTOMER','CONTACT') then
   if p_kind='CUSTOMER' and coalesce((j->>'version')::integer,-1)<>0 then raise exception using errcode='22023',message='Invalid new customer version.';end if;
   if p_kind='CUSTOMER' and o.resolution_customer is not null then
    v_result:=o.resolution_customer;perform 1 from public.customers where id=v_result and is_active;
    if not found then raise exception using errcode='22023',message='Matched customer is unavailable.';end if;
   else
    v_customer:=(j->>'id')::uuid;
    if p_kind='CONTACT' then select coalesce(customer_id,v_customer) into v_customer from (select customer_id from public.driver_offline_operations where trip_id=p_trip and kind='CUSTOMER' and status='CONFIRMED' and payload::jsonb->>'id'=j->>'id' limit 1) m right join (select 1) guard on true;end if;
    v_result:=public.save_customer_contact(p_trip,v_customer,j->>'name',j->>'shop_name',j->>'phone',j->>'address',(j->>'version')::integer,false,p_id,case when j ? 'supply_type' then jsonb_build_object('contact_person',coalesce(j->>'contact_person',''),'customer_type',coalesce(j->>'customer_type',''),'delivery_notes',coalesce(j->>'delivery_notes',''),'supply_type',j->>'supply_type') else null end);
   end if;v_customer:=v_result;
  elsif p_kind='DELIVERY' then
   if jsonb_typeof(j->'items') is distinct from 'array' or jsonb_typeof(j->'prices') is distinct from 'array' or jsonb_typeof(j->'custody') is distinct from 'array'
    or jsonb_array_length(j->'prices')<>jsonb_array_length(j->'items')
    or exists(select 1 from jsonb_array_elements(j->'items') i where not exists(select 1 from jsonb_array_elements(j->'prices') p where p->>'product_id'=i->>'product_id')) then
    raise exception using errcode='22023',message='Cached price and jar-balance evidence is required.';end if;
   v_customer:=nullif(j->>'customer','')::uuid;
   -- Resolve a locally-created UUID only through its acknowledged customer operation.
   select coalesce(customer_id,v_customer) into v_customer from (select customer_id from public.driver_offline_operations
     where trip_id=p_trip and kind='CUSTOMER' and status='CONFIRMED' and (payload::jsonb->>'id')::uuid=v_customer limit 1) m
     right join (select 1) guard on true;
   perform public.finance_lock(v_customer);
   if v_customer is not null and exists(select 1 from jsonb_array_elements(j->'items') i join public.products p on p.id=(i->>'product_id')::uuid where p.kind='FULL_JAR'
     and not exists(select 1 from jsonb_array_elements(j->'custody') c where c->>'product_id'=p.id::text)) then
    raise exception using errcode='22023',message='Cached price and jar-balance evidence is required.';end if;
   perform 1 from public.customers where id=v_customer for share;
   perform 1 from public.products p join jsonb_array_elements(j->'items') i on p.id=(i->>'product_id')::uuid order by p.id for share of p;
   if j ? 'house' then
    if not o.resolution_house and (v_customer is null or not exists(select 1 from public.customers c where c.id=v_customer and c.supply_type='HOUSE' and c.house_status='APPROVED' and c.house_version=(j->'house'->>'version')::integer)) then
      raise exception using errcode='22023',message='HOUSE approval changed while offline. Free delivery is preserved for admin review.';end if;
    if jsonb_typeof(j->'house'->'products') is distinct from 'array' or jsonb_array_length(j->'house'->'products')<>jsonb_array_length(j->'items') or exists(select 1 from jsonb_array_elements(j->'items') i where not exists(select 1 from jsonb_array_elements(j->'house'->'products') h where h->>'product_id'=i->>'product_id')) then raise exception using errcode='22023',message='Confirmed HOUSE product evidence is required.';end if;
    for x in select value from jsonb_array_elements(j->'house'->'products') loop
      if not o.resolution_house and not exists(select 1 from public.products p where p.id=(x->>'product_id')::uuid and p.house_version=(x->>'version')::integer and p.house_eligible=(x->>'eligible')::boolean and coalesce(p.reference_price,p.default_price)=(x->>'reference_price')::numeric) then
        raise exception using errcode='22023',message='HOUSE product eligibility or reference price changed while offline. Review the original delivery.';end if;
    end loop;
   elsif exists(select 1 from public.customers c where c.id=v_customer and c.supply_type='HOUSE' and c.house_status='APPROVED') and exists(select 1 from jsonb_array_elements(j->'items') i join public.products p on p.id=(i->>'product_id')::uuid where p.house_eligible and coalesce((i->>'full_jars')::integer,0)+coalesce((i->>'cartons')::integer,0)>0) then
    raise exception using errcode='22023',message='HOUSE approval changed while offline. Review the original delivery classification.';
   end if;
   for x in select value from jsonb_array_elements(j->'prices') loop
    if (case when j ? 'house' and case when o.resolution_house then coalesce((public.house_snapshot_override(p_id,p_trip,v_customer,(x->>'product_id')::uuid)->>'eligible')::boolean,false) else (select house_eligible from public.products where id=(x->>'product_id')::uuid) end then 0 else public.finance_price(v_customer,(x->>'product_id')::uuid) end) is distinct from (x->>'price')::numeric then
     raise exception using errcode='22023',message='Customer pricing changed. The recorded payment needs admin review.';end if;
   end loop;
   for x in select value from jsonb_array_elements(j->'custody') loop
    select coalesce((select quantity from public.jar_custody_balances where customer_id=v_customer and product_id=(x->>'product_id')::uuid),0) into v_custody;
    if not o.resolution_accept_custody and v_custody<>(x->>'quantity')::integer then raise exception using errcode='22023',message='Customer jar balance changed on another device. Review the return allocation.';end if;
   end loop;
   v_result:=public.post_driver_delivery(p_trip,v_customer,coalesce(j->>'walk_name',''),coalesce(j->>'walk_phone',''),j->'items',j->>'status',j->>'received',coalesce(j->>'notes',''),p_id);
   if j->>'status'<>'RETURN_ONLY' and (select i.total from public.invoices i join public.sales s on s.id=i.sale_id where s.visit_id=v_result) is distinct from (j->>'total')::numeric then
    raise exception using errcode='22023',message='Invoice total changed. Review the recorded amount.';end if;
  elsif p_kind='PAYMENT' then
   v_customer:=(j->>'customer')::uuid;
   select coalesce(customer_id,v_customer) into v_customer from (select customer_id from public.driver_offline_operations where trip_id=p_trip and kind='CUSTOMER' and status='CONFIRMED' and payload::jsonb->>'id'=j->>'customer' limit 1) m right join (select 1) guard on true;
   if coalesce((j->>'current_amount')::numeric,0)<>0 then raise exception using errcode='22023',message='Collections cannot silently settle a new invoice.';end if;
   v_result:=public.finance_command('PAYMENT',j||jsonb_build_object('customer',v_customer,'trip',p_trip),p_id);
  elsif p_kind='PAUSE' then
   if jsonb_typeof(j->'manifest') is distinct from 'array' or jsonb_array_length(j->'manifest')<>r.confirmed_sequence
    or exists(select 1 from public.driver_offline_operations q where q.trip_id=p_trip and q.id<>p_id and
      (q.status<>'CONFIRMED' or not exists(select 1 from jsonb_array_elements(j->'manifest') m where m->>'id'=q.id::text and m->>'fingerprint'=q.fingerprint))) then
    raise exception using errcode='22023',message='Pause requires the complete device manifest and all server confirmations.';end if;
   update public.driver_offline_rounds set phase='PAUSED',checkpoint_at=clock_timestamp() where trip_id=p_trip;
   v_result:=p_trip;
  else
   if exists(select 1 from public.driver_offline_operations where trip_id=p_trip and id<>p_id and status<>'CONFIRMED')
    or jsonb_array_length(j->'manifest')<>r.confirmed_sequence or exists(select 1 from public.driver_offline_operations q
      where q.trip_id=p_trip and q.id<>p_id and not exists(select 1 from jsonb_array_elements(j->'manifest') m where m->>'id'=q.id::text and m->>'fingerprint'=q.fingerprint)) then
    raise exception using errcode='22023',message='Return requires the device manifest and all server confirmations.';end if;
   v_result:=public.submit_trip_online_core(p_trip,j->'counts',p_id);
   update public.driver_offline_rounds set phase='SEALED',checkpoint_at=now() where trip_id=p_trip;
  end if;
  update public.driver_offline_operations set status='CONFIRMED',result_id=v_result,customer_id=v_customer,processed_at=now(),message=null where id=p_id;
  update public.driver_offline_rounds set confirmed_sequence=p_sequence,last_seen_at=now(),reported_pending=greatest(0,reported_pending-1) where trip_id=p_trip;
 exception when others then
  get stacked diagnostics v_message=message_text,v_state=returned_sqlstate;
  if left(v_state,2) in ('40','53','57','08') and v_message<>'Customer changed; reload the contact details before saving.' then raise;end if;
  update public.driver_offline_operations set status='NEEDS_REVIEW',message=case when v_state in ('22023','42501','40001') and length(v_message)<250 then v_message else 'This record needs admin review. No business changes were posted.' end,processed_at=now() where id=p_id;
 end;
 perform set_config('mk.offline.device','',true);perform set_config('mk.offline.occurred','',true);
 return public.offline_receipt(p_id);
end $$;
-- A paused delivery round is still assigned stock, not a removable sealed round.
create or replace function public.trusted_device_revoke(p_device uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.driver_trusted_devices;
begin
 perform public.ops_actor(false);
 select * into d from public.driver_trusted_devices where device_id=p_device for update;
 if not found or (not public.is_active_admin() and d.driver_id<>auth.uid()) then raise exception using errcode='42501',message='Not authorized to revoke this device.'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Enter a reason between 3 and 500 characters.'; end if;
 if not public.is_active_admin() and exists(select 1 from public.driver_offline_rounds where device_id=p_device and (phase in ('PREPARED','ACTIVE','PAUSED') or reported_pending>0)) then raise exception using errcode='22023',message='Sync and seal the delivery round before removing this device.'; end if;
 if d.revoked_at is null then
  update public.driver_trusted_devices set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_reason) where device_id=p_device;
  insert into public.audit_events(actor_user_id,action,entity,entity_id,after_json,reason) values(auth.uid(),'TRUSTED_DEVICE_REVOKED','driver_trusted_devices',p_device,jsonb_build_object('records_preserved',true),btrim(p_reason));
 end if;
 return p_device;
end $$;
-- Prepared snapshots permit encrypted stock viewing, never delivery writes.
create or replace function public.offline_register_round_core(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.trips; r public.driver_offline_rounds;
begin
 perform public.ops_actor(false);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='DRIVER') or p_device is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='An approved driver and a secure device identity are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 select * into r from public.driver_offline_rounds where trip_id=p_trip for update;
 t:=public.ops_trip(p_trip);
 if t.status not in ('LOADED','ACTIVE') then raise exception using errcode='22023',message='A confirmed prepared or active load is required.';end if;
 if r.trip_id is not null then
  if r.device_id<>p_device or r.driver_id<>auth.uid() or r.token_hash<>public.offline_hash(p_token) then
   raise exception using errcode='42501',message='Another device already owns this delivery round. Contact the warehouse admin.'; end if;
 else
  insert into public.driver_offline_rounds(trip_id,driver_id,device_id,token_hash,phase) values(p_trip,auth.uid(),p_device,public.offline_hash(p_token),case when t.status='LOADED' then 'PREPARED' else 'ACTIVE' end) returning * into r;
  insert into public.audit_events(actor_user_id,action,entity,entity_id,after_json,reason)
   values(auth.uid(),'OFFLINE_DEVICE_REGISTERED','trips',p_trip,jsonb_build_object('device',p_device),'Driver opted into a single offline writer');
 end if;
 return to_jsonb(r)-array['token_hash','exception_reason','exception_by','exception_at'];
end $$;
notify pgrst, 'reload schema';
