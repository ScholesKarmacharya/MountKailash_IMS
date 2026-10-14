-- Forward-only, opt-in offline rounds. Existing online trips/accounts/data stay intact.
create table public.driver_offline_rounds (
 trip_id uuid primary key references public.trips(id) on delete restrict,
 driver_id uuid not null references public.profiles(id) on delete restrict,
 device_id uuid not null, token_hash text not null,
 phase text not null default 'ACTIVE' check(phase in ('ACTIVE','SEALED','EXCEPTION')),
 confirmed_sequence integer not null default 0 check(confirmed_sequence>=0),
 registered_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 reported_pending integer not null default 0 check(reported_pending>=0), checkpoint_at timestamptz,
 exception_reason text, exception_by uuid references public.profiles(id), exception_at timestamptz
);
create table public.driver_offline_operations (
 id uuid primary key, trip_id uuid not null references public.driver_offline_rounds(trip_id),
 driver_id uuid not null references public.profiles(id), device_id uuid not null,
 sequence integer not null check(sequence>0), kind text not null check(kind in ('CUSTOMER','CONTACT','DELIVERY','PAYMENT','SUBMIT')),
 payload text not null check(length(payload)<=60000), fingerprint text not null check(length(fingerprint)=64),
 occurred_at timestamptz not null, processed_at timestamptz not null default now(),
 status text not null check(status in ('CONFIRMED','NEEDS_REVIEW','RETRYABLE','REJECTED')),
 result_id uuid, customer_id uuid references public.customers(id), message text,
 resolution_customer uuid references public.customers(id), resolution_accept_custody boolean not null default false, unique(trip_id,sequence)
);
create table public.driver_offline_reviews (
 id uuid primary key default gen_random_uuid(), operation_id uuid references public.driver_offline_operations(id),
 trip_id uuid not null references public.driver_offline_rounds(trip_id), actor_id uuid not null references public.profiles(id),
 action text not null, details jsonb not null, reason text not null, created_at timestamptz not null default now()
);
alter table public.driver_offline_rounds enable row level security;
alter table public.driver_offline_operations enable row level security;
alter table public.driver_offline_reviews enable row level security;
revoke all on public.driver_offline_rounds,public.driver_offline_operations,public.driver_offline_reviews from public,anon,authenticated,service_role;
grant select on public.driver_offline_operations,public.driver_offline_reviews to authenticated;
grant select(trip_id,driver_id,device_id,phase,confirmed_sequence,registered_at,last_seen_at,reported_pending,checkpoint_at) on public.driver_offline_rounds to authenticated;
create policy offline_round_read on public.driver_offline_rounds for select to authenticated using(public.has_operational_access() and (public.is_active_admin() or driver_id=auth.uid()));
create policy offline_operation_read on public.driver_offline_operations for select to authenticated using(public.has_operational_access() and (public.is_active_admin() or driver_id=auth.uid()));
create policy offline_review_read on public.driver_offline_reviews for select to authenticated using(public.is_active_admin());
create function public.offline_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or tg_table_name='driver_offline_reviews' then raise exception using errcode='42501',message='Offline evidence is immutable.';end if;
 if old.status='CONFIRMED' or
  (to_jsonb(old)-array['status','message','resolution_customer','resolution_accept_custody','result_id','customer_id','processed_at']) is distinct from
  (to_jsonb(new)-array['status','message','resolution_customer','resolution_accept_custody','result_id','customer_id','processed_at']) then
  raise exception using errcode='42501',message='Offline evidence is immutable.';
 end if; return new;
end $$;

create function public.offline_admin_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_admin() then raise exception using errcode='42501',message='Admin access required.';end if;
 return jsonb_build_object('rounds',coalesce((select jsonb_agg((to_jsonb(r)-'token_hash')||jsonb_build_object('driver_name',p.name,'trip_number',t.trip_number))
   from public.driver_offline_rounds r join public.profiles p on p.id=r.driver_id join public.trips t on t.id=r.trip_id),'[]'::jsonb),
  'operations',coalesce((select jsonb_agg(to_jsonb(o) order by o.processed_at desc) from public.driver_offline_operations o where o.status<>'CONFIRMED'),'[]'::jsonb),
  'reviews',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.driver_offline_reviews e),'[]'::jsonb));
end $$;
create function public.offline_admin_review(p_id uuid,p_action text,p_customer uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.driver_offline_operations; v_retry uuid; v_payload jsonb;
begin
 perform public.ops_actor(true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 or p_action is null or p_action not in ('RETRY','MATCH_CUSTOMER','REBASE_CUSTODY','REJECT') then
  raise exception using errcode='22023',message='Select a review action and enter a reason.';end if;
 v_payload:=jsonb_build_object('operation','OFFLINE_REVIEW','id',p_id,'action',p_action,'customer',p_customer,'reason',p_reason);
 v_retry:=public.ops_retry(p_key,v_payload);if v_retry is not null then return v_retry;end if;
 select * into o from public.driver_offline_operations where id=p_id for update;
 if not found or o.status not in ('NEEDS_REVIEW','REJECTED') then raise exception using errcode='22023',message='Select an unresolved offline record.';end if;
 if p_action='REBASE_CUSTODY' and o.kind<>'DELIVERY' then raise exception using errcode='22023',message='Select a delivery for jar-balance review.';end if;
 if p_action='MATCH_CUSTOMER' then
  if o.kind<>'CUSTOMER' or not exists(select 1 from public.customers where id=p_customer and is_active) then raise exception using errcode='22023',message='Select an active matching customer.';end if;
 end if;
 update public.driver_offline_operations set status=case when p_action='REJECT' then 'REJECTED' else 'RETRYABLE' end,
  resolution_customer=case when p_action='MATCH_CUSTOMER' then p_customer else resolution_customer end,
  resolution_accept_custody=resolution_accept_custody or p_action='REBASE_CUSTODY',
  message=case when p_action='REJECT' then 'Admin rejected this record. Preserve it for recovery.' else null end where id=p_id;
 insert into public.driver_offline_reviews(operation_id,trip_id,actor_id,action,details,reason) values(p_id,o.trip_id,auth.uid(),p_action,jsonb_build_object('customer',p_customer,'original_payload',o.payload,'accept_current_custody',p_action='REBASE_CUSTODY'),btrim(p_reason));
 return public.ops_finish(p_key,v_payload,p_id,'OFFLINE_REVIEWED','driver_offline_operations',to_jsonb(o),jsonb_build_object('action',p_action,'customer',p_customer),p_reason);
end $$;
create function public.offline_admin_exception(p_trip uuid,p_counts jsonb,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; t public.trips; v_retry uuid; v_payload jsonb;
begin
 perform public.ops_actor(true);
 if p_reason is null or length(btrim(p_reason)) not between 10 and 500 then raise exception using errcode='22023',message='Document missing-device evidence and the physical stock review.';end if;
 v_payload:=jsonb_build_object('operation','OFFLINE_EXCEPTION','trip',p_trip,'counts',p_counts,'reason',p_reason);
 v_retry:=public.ops_retry(p_key,v_payload);if v_retry is not null then return v_retry;end if;
 select * into r from public.driver_offline_rounds where trip_id=p_trip for update;
 if not found or r.phase<>'ACTIVE' then raise exception using errcode='22023',message='Select an active offline round.';end if;
 t:=public.ops_trip(p_trip);
 if t.status='ACTIVE' then perform public.submit_trip_online_core(p_trip,p_counts,md5(p_key::text||':exception-submit')::uuid);
 elsif t.status not in ('SUBMITTED','UNDER_REVIEW','DISCREPANCY') then raise exception using errcode='22023',message='This round cannot use a missing-device exception.';end if;
 update public.driver_offline_rounds set phase='EXCEPTION',exception_reason=btrim(p_reason),exception_by=auth.uid(),exception_at=now() where trip_id=p_trip;
 insert into public.driver_offline_reviews(trip_id,actor_id,action,details,reason) values(p_trip,auth.uid(),'MISSING_DEVICE_EXCEPTION',jsonb_build_object('counts',p_counts,'known_pending',r.reported_pending,'confirmed_sequence',r.confirmed_sequence),p_reason);
 return public.ops_finish(p_key,v_payload,p_trip,'OFFLINE_DEVICE_EXCEPTION','trips',to_jsonb(r),jsonb_build_object('phase','EXCEPTION','counts',p_counts),p_reason);
end $$;
alter function public.reconcile_trip(uuid,jsonb,text,boolean,uuid) rename to reconcile_trip_online_core;
create function public.reconcile_trip(p_trip uuid,p_counts jsonb,p_reason text,p_accept_variance boolean,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform public.ops_actor(true);
 if exists(select 1 from public.driver_offline_rounds where trip_id=p_trip and phase='ACTIVE') then raise exception using errcode='22023',message='Driver sync checkpoint is missing. Seal the device queue or review a missing-device exception.';end if;
 return public.reconcile_trip_online_core(p_trip,p_counts,p_reason,p_accept_variance,p_key);
end $$;
alter function public.day_blockers(uuid) rename to day_blockers_online_core;
create function public.day_blockers(p_day uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.day_blockers_online_core(p_day)||coalesce((select jsonb_agg(jsonb_build_object('code','OFFLINE_SYNC','message','Driver sync checkpoint is missing or unresolved. An offline phone may contain unreported records.','href','/admin/sync'))
 from public.driver_offline_rounds r join public.trips t on t.id=r.trip_id where t.business_day_id=p_day and
 (r.phase='ACTIVE' or (r.phase<>'EXCEPTION' and exists(select 1 from public.driver_offline_operations o where o.trip_id=r.trip_id and o.status<>'CONFIRMED')))),'[]'::jsonb);
$$;

create trigger offline_operation_immutable before update or delete on public.driver_offline_operations for each row execute function public.offline_immutable();
create trigger offline_review_immutable before update or delete on public.driver_offline_reviews for each row execute function public.offline_immutable();
create function public.offline_hash(p_value text) returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(p_value,'UTF8')),'hex')$$;
create function public.offline_receipt(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',id,'trip',trip_id,'sequence',sequence,'fingerprint',fingerprint,'status',status,
  'result',result_id,'customer',customer_id,'message',message,'processedAt',processed_at) from public.driver_offline_operations where id=p_id;
$$;
create function public.offline_gate(p_trip uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_admin() and exists(select 1 from public.driver_offline_rounds r where r.trip_id=p_trip
  and (r.phase<>'ACTIVE' or current_setting('mk.offline.device',true) is distinct from r.device_id::text)) then
  raise exception using errcode='42501',message='Use the registered offline device for this delivery round.';
 end if;
end $$;
create function public.offline_device(p_trip uuid,p_device uuid,p_token text) returns public.driver_offline_rounds
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds;
begin
 select * into r from public.driver_offline_rounds where trip_id=p_trip and driver_id=auth.uid() and device_id=p_device
   and token_hash=public.offline_hash(p_token) for update;
 if not found then raise exception using errcode='42501',message='This device is not the authorized writer for this load.'; end if;
 return r;
end $$;
create function public.offline_register(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.trips; r public.driver_offline_rounds;
begin
 perform public.ops_actor(false);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='DRIVER') or p_device is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='An approved driver and a secure device identity are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 select * into r from public.driver_offline_rounds where trip_id=p_trip for update;
 t:=public.delivery_trip(p_trip);
 if r.trip_id is not null then
  if r.device_id<>p_device or r.driver_id<>auth.uid() or r.token_hash<>public.offline_hash(p_token) then
   raise exception using errcode='42501',message='Another device already owns this delivery round. Contact the warehouse admin.'; end if;
 else
  insert into public.driver_offline_rounds(trip_id,driver_id,device_id,token_hash) values(p_trip,auth.uid(),p_device,public.offline_hash(p_token)) returning * into r;
  insert into public.audit_events(actor_user_id,action,entity,entity_id,after_json,reason)
   values(auth.uid(),'OFFLINE_DEVICE_REGISTERED','trips',p_trip,jsonb_build_object('device',p_device),'Driver opted into a single offline writer');
 end if;
 return to_jsonb(r)-array['token_hash','exception_reason','exception_by','exception_at'];
end $$;
create function public.offline_read_state(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds;
begin
 -- Own receipt lookup also permits a suspended identity to recover an ambiguous ACK.
 r:=public.offline_device(p_trip,p_device,p_token);
 return jsonb_build_object('round',to_jsonb(r)-array['token_hash','exception_reason','exception_by','exception_at'],
  'receipts',coalesce((select jsonb_agg(public.offline_receipt(id) order by sequence) from public.driver_offline_operations where trip_id=p_trip),'[]'::jsonb));
end $$;
create function public.offline_contexts(p_trip uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return coalesce((select jsonb_agg(public.delivery_customer_context(p_trip,(c->>'id')::uuid)) from jsonb_array_elements(public.delivery_customer_directory()) c where (c->>'is_active')::boolean),'[]'::jsonb);
end $$;
create function public.offline_checkin(p_trip uuid,p_device uuid,p_token text,p_pending integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds;
begin
 perform public.ops_actor(false);r:=public.offline_device(p_trip,p_device,p_token);
 if p_pending is null or p_pending not between 0 and 1000000 then raise exception using errcode='22023',message='Invalid pending count.'; end if;
 update public.driver_offline_rounds set last_seen_at=now(),reported_pending=p_pending where trip_id=p_trip;
 return public.offline_read_state(p_trip,p_device,p_token);
end $$;
-- Occurrence date is additional metadata for NEW offline visits, never a ledger rewrite.
alter table public.trip_visits add column offline_occurred_at timestamptz;
create function public.offline_visit_time() returns trigger language plpgsql set search_path='' as $$
begin
 if nullif(current_setting('mk.offline.occurred',true),'') is not null then new.offline_occurred_at:=current_setting('mk.offline.occurred',true)::timestamptz; end if;
 return new;
end $$;
create trigger offline_visit_time before insert on public.trip_visits for each row execute function public.offline_visit_time();
alter function public.pending_jar_rows(uuid,timestamptz) rename to pending_jar_rows_online_core;
create function public.pending_jar_rows(p_customer uuid default null,p_cutoff timestamptz default 'infinity') returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_set(x.value,'{original_date}',to_jsonb(coalesce(v.offline_occurred_at,e.created_at))) order by x.ordinality),'[]'::jsonb)
 from jsonb_array_elements(public.pending_jar_rows_online_core(p_customer,p_cutoff)) with ordinality x
 join public.jar_custody_entries e on e.id=(x.value->>'entry_id')::uuid left join public.trip_visits v on v.id=e.visit_id;
$$;
revoke all on function public.pending_jar_rows_online_core(uuid,timestamptz),public.pending_jar_rows(uuid,timestamptz) from public,anon,authenticated,service_role;

alter function public.jar_return_allocations(uuid) rename to jar_return_allocations_online_core;
create function public.jar_return_allocations(p_customer uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_set(jsonb_set(x.value,'{original_date}',to_jsonb(coalesce(v.offline_occurred_at,e.created_at))),'{returned_at}',to_jsonb(coalesce(vr.offline_occurred_at,er.created_at))) order by x.ordinality),'[]'::jsonb)
 from jsonb_array_elements(public.jar_return_allocations_online_core(p_customer)) with ordinality x
 join public.jar_custody_entries e on e.id=(x.value->>'delivery_entry_id')::uuid left join public.trip_visits v on v.id=e.visit_id
 join public.jar_custody_entries er on er.id=(x.value->>'return_entry_id')::uuid left join public.trip_visits vr on vr.id=er.visit_id;
$$;
revoke all on function public.jar_return_allocations_online_core(uuid),public.jar_return_allocations(uuid) from public,anon,authenticated,service_role;

-- Retain existing public signatures; registered loads require the checked gateway.
alter function public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid) rename to post_trip_visit_online_core;
create function public.post_trip_visit(p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,p_payment jsonb,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$begin perform public.offline_gate(p_trip);return public.post_trip_visit_online_core(p_trip,p_customer,p_walk_name,p_walk_phone,p_items,p_payment,p_notes,p_key);end $$;
alter function public.save_customer_contact(uuid,uuid,text,text,text,text,integer,boolean,uuid,jsonb) rename to save_customer_contact_online_core;
create function public.save_customer_contact(p_trip uuid,p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_version integer,p_duplicate_confirmed boolean,p_key uuid,p_details jsonb) returns uuid
language plpgsql security definer set search_path='' as $$begin perform public.offline_gate(p_trip);return public.save_customer_contact_online_core(p_trip,p_id,p_name,p_shop,p_phone,p_address,p_version,p_duplicate_confirmed,p_key,p_details);end $$;
alter function public.finance_command(text,jsonb,uuid) rename to finance_command_online_core;
create function public.finance_command(p_operation text,p_data jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$begin if p_operation='PAYMENT' then perform public.offline_gate((p_data->>'trip')::uuid);end if;return public.finance_command_online_core(p_operation,p_data,p_key);end $$;
alter function public.submit_trip(uuid,jsonb,uuid) rename to submit_trip_online_core;
create function public.submit_trip(p_trip uuid,p_counts jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$begin perform public.offline_gate(p_trip);return public.submit_trip_online_core(p_trip,p_counts,p_key);end $$;

create function public.offline_post(p_trip uuid,p_device uuid,p_token text,p_id uuid,p_sequence integer,p_kind text,p_occurred timestamptz,p_payload text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; o public.driver_offline_operations; j jsonb; v_result uuid; v_customer uuid; x jsonb; v_custody integer; v_message text; v_state text;
begin
 perform public.ops_actor(false);r:=public.offline_device(p_trip,p_device,p_token);
 if p_id is null or p_sequence is null or p_sequence<1 or p_kind is null or p_kind not in ('CUSTOMER','CONTACT','DELIVERY','PAYMENT','SUBMIT')
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
    v_result:=public.save_customer_contact(p_trip,v_customer,j->>'name',j->>'shop_name',j->>'phone',j->>'address',(j->>'version')::integer,false,p_id,null);
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
   for x in select value from jsonb_array_elements(j->'prices') loop
    if public.finance_price(v_customer,(x->>'product_id')::uuid) is distinct from (x->>'price')::numeric then
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

-- Public entry points are authenticated; underlying cores/device tokens are private.
revoke all on function public.offline_immutable(),public.offline_hash(text),public.offline_receipt(uuid),public.offline_gate(uuid),public.offline_device(uuid,uuid,text),public.offline_visit_time(),
 public.post_trip_visit_online_core(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.save_customer_contact_online_core(uuid,uuid,text,text,text,text,integer,boolean,uuid,jsonb),
 public.save_customer_contact(uuid,uuid,text,text,text,text,integer,boolean,uuid,jsonb),public.finance_command_online_core(text,jsonb,uuid),public.submit_trip_online_core(uuid,jsonb,uuid),
 public.reconcile_trip_online_core(uuid,jsonb,text,boolean,uuid),public.day_blockers_online_core(uuid),public.day_blockers(uuid) from public,anon,authenticated,service_role;
revoke all on function public.offline_register(uuid,uuid,text),public.offline_read_state(uuid,uuid,text),public.offline_contexts(uuid),public.offline_checkin(uuid,uuid,text,integer),
 public.offline_post(uuid,uuid,text,uuid,integer,text,timestamptz,text,text),public.offline_admin_workspace(),public.offline_admin_review(uuid,text,uuid,text,uuid),public.offline_admin_exception(uuid,jsonb,text,uuid),
 public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.finance_command(text,jsonb,uuid),public.submit_trip(uuid,jsonb,uuid),public.reconcile_trip(uuid,jsonb,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.offline_register(uuid,uuid,text),public.offline_read_state(uuid,uuid,text),public.offline_contexts(uuid),public.offline_checkin(uuid,uuid,text,integer),
 public.offline_post(uuid,uuid,text,uuid,integer,text,timestamptz,text,text),public.offline_admin_workspace(),public.offline_admin_review(uuid,text,uuid,text,uuid),public.offline_admin_exception(uuid,jsonb,text,uuid),
 public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.finance_command(text,jsonb,uuid),public.submit_trip(uuid,jsonb,uuid),public.reconcile_trip(uuid,jsonb,text,boolean,uuid) to authenticated;
