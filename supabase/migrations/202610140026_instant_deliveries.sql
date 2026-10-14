-- Lightweight references share the established customer/FIFO/finance ledgers.
alter table public.customers add column is_one_time boolean not null default false;
create table public.instant_deliveries (
 id uuid primary key, customer_id uuid not null unique references public.customers(id),
 visit_id uuid not null unique references public.trip_visits(id), trip_id uuid not null references public.trips(id),
 created_by uuid not null references public.profiles(id),
 event_name text not null, phone text not null, location text not null, notes text not null,
 created_at timestamptz not null default now()
);
alter table public.instant_deliveries enable row level security;
revoke all on public.instant_deliveries from public,anon,authenticated,service_role;
grant select on public.instant_deliveries to authenticated;
create policy instant_read on public.instant_deliveries for select to authenticated using(public.has_operational_access() and public.can_read_customer(customer_id));
create trigger instant_immutable before update or delete on public.instant_deliveries for each row execute function public.reject_journal_mutation();
create trigger instant_no_truncate before truncate on public.instant_deliveries for each statement execute function public.reject_journal_mutation();

create function public.post_instant_delivery(p_trip uuid,p_id uuid,p_name text,p_phone text,p_location text,p_items jsonb,p_status text,p_received text,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j jsonb; retry uuid; visit uuid; customer uuid; t public.trips;
begin
 perform public.ops_actor(false);perform public.offline_gate(p_trip);
 if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_phone is null or length(p_phone)>40
  or p_location is null or length(btrim(p_location)) not between 1 and 500 or p_notes is null or length(p_notes)>2000
  or p_status is null or p_status not in ('PAID','CREDIT') or p_items is null or jsonb_typeof(p_items)<>'array' then
  raise exception using errcode='22023',message='Enter valid event contact and delivery details.';end if;
 if not exists(select 1 from jsonb_to_recordset(p_items) as x(full_jars integer,cartons integer) where coalesce(full_jars,0)+coalesce(cartons,0)>0) then
  raise exception using errcode='22023',message='Enter a delivered quantity for this event.';end if;
 if (p_status='CREDIT' or exists(select 1 from jsonb_to_recordset(p_items) as x(full_jars integer,empty_jars integer) where full_jars>empty_jars))
  and (p_phone!~'^[+0-9() -]+$' or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 7 and 15) then
  raise exception using errcode='22023',message='A contact name and valid phone number are required for outstanding jars or credit.';end if;
 j:=jsonb_build_object('operation','INSTANT_DELIVERY','trip',p_trip,'id',p_id,'name',p_name,'phone',p_phone,'location',p_location,'items',p_items,'status',p_status,'received',p_received,'notes',p_notes);
 retry:=public.ops_retry(p_key,j);if retry is not null then return retry;end if;
 t:=public.delivery_trip(p_trip);
 if exists(select 1 from public.customers where id=p_id) then raise exception using errcode='22023',message='This event reference already exists. Open it to collect returns or payment.';end if;
 -- Repeated phone numbers identify separate events, not duplicate regular accounts.
 customer:=public.save_delivery_customer(p_trip,p_id,p_name,'',p_phone,p_location,0,true,md5(p_key::text||':contact')::uuid);
 update public.customers set is_one_time=true where id=customer;
 visit:=public.post_driver_delivery(p_trip,customer,'','',p_items,p_status,p_received,p_notes,md5(p_key::text||':delivery')::uuid);
 insert into public.instant_deliveries(id,customer_id,visit_id,trip_id,created_by,event_name,phone,location,notes,created_at)
 values(p_id,customer,visit,p_trip,auth.uid(),btrim(p_name),btrim(p_phone),btrim(p_location),btrim(p_notes),coalesce(nullif(current_setting('mk.offline.occurred',true),'')::timestamptz,clock_timestamp()));
 return public.ops_finish(p_key,j,p_id,'INSTANT_DELIVERY_POSTED','instant_deliveries',null,jsonb_build_object('customer_id',customer,'visit_id',visit,'trip_id',p_trip),'One-time event delivery using existing ledgers');
end $$;

create function public.convert_instant_customer(p_id uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j jsonb; retry uuid; v_customer public.customers;
begin
 perform public.ops_actor(true);
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='Enter a reason for converting this customer.';end if;
 j:=jsonb_build_object('operation','CONVERT_INSTANT','id',p_id,'reason',p_reason);retry:=public.ops_retry(p_key,j);if retry is not null then return retry;end if;
 select c.* into v_customer from public.customers c join public.instant_deliveries i on i.customer_id=c.id where i.id=p_id for update of c;
 if not found or not v_customer.is_one_time then raise exception using errcode='22023',message='Select a one-time customer to convert.';end if;
 update public.customers set is_one_time=false,version=version+1,updated_at=now() where id=v_customer.id;
 return public.ops_finish(p_key,j,v_customer.id,'INSTANT_CUSTOMER_CONVERTED','customers',to_jsonb(v_customer),jsonb_build_object('is_one_time',false),p_reason);
end $$;

-- Existing customer directory callers keep their signatures and permissions.
alter function public.delivery_customer_directory() rename to delivery_customer_directory_before_instant;
revoke all on function public.delivery_customer_directory_before_instant() from public,anon,authenticated,service_role;
create function public.delivery_customer_directory() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x||jsonb_build_object('is_one_time',c.is_one_time) order by c.name,c.id),'[]'::jsonb)
 from jsonb_array_elements(public.delivery_customer_directory_before_instant()) x join public.customers c on c.id=(x->>'id')::uuid
$$;

create function public.instant_row(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(i)||jsonb_build_object('driver',pr.name,'vehicle',v.plate_number,'driver_id',t.driver_id,'trip_number',t.trip_number,'business_date',d.date_label,
  'is_one_time',c.is_one_time,'invoice_id',inv.id,'invoice_number',inv.number,'total',coalesce(inv.total,0)::text,
  'outstanding',coalesce(public.finance_invoice_balance(inv.id,false),0)::text,
  'available',coalesce(public.finance_invoice_balance(inv.id,true),0)::text,
  'collected',coalesce((select sum(a.amount) from public.payment_allocations a where a.invoice_id=inv.id and public.finance_state(a.payment_id)='CONFIRMED'),0)::text,
  'items',coalesce((select jsonb_agg(to_jsonb(it)||jsonb_build_object('name',p.name,'unit_price_snapshot',it.unit_price_snapshot::text,
    'pending',coalesce((select sum((r->>'pending')::bigint) from jsonb_array_elements(public.pending_jar_rows(c.id)) r join public.jar_custody_entries e on e.id=(r->>'entry_id')::uuid where e.visit_id=i.visit_id and e.product_id=it.product_id),0),
    'returned',coalesce((select sum((r->>'quantity')::bigint) from jsonb_array_elements(public.jar_return_allocations(c.id)) r join public.jar_custody_entries e on e.id=(r->>'delivery_entry_id')::uuid where e.visit_id=i.visit_id and e.product_id=it.product_id and r->>'source'='Empty collection'),0)) order by p.name) from public.visit_items it join public.products p on p.id=it.product_id where it.visit_id=i.visit_id),'[]'::jsonb),
  'pending',coalesce((select sum((r->>'pending')::bigint) from jsonb_array_elements(public.pending_jar_rows(c.id)) r join public.jar_custody_entries e on e.id=(r->>'entry_id')::uuid where e.visit_id=i.visit_id),0),
  'returned',coalesce((select sum((r->>'quantity')::bigint) from jsonb_array_elements(public.jar_return_allocations(c.id)) r join public.jar_custody_entries e on e.id=(r->>'delivery_entry_id')::uuid where e.visit_id=i.visit_id and r->>'source'='Empty collection'),0))
 from public.instant_deliveries i join public.customers c on c.id=i.customer_id join public.trips t on t.id=i.trip_id
 join public.profiles pr on pr.id=t.driver_id join public.vehicles v on v.id=t.vehicle_id
 join public.trip_visits original on original.id=i.visit_id join public.business_days d on d.id=original.business_day_id
 left join public.sales s on s.visit_id=i.visit_id left join public.invoices inv on inv.sale_id=s.id where i.id=p_id
$$;
create function public.instant_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operational_access() then raise exception using errcode='42501',message='Authorized account required.';end if;
 return jsonb_build_object('records',coalesce((select jsonb_agg(public.instant_row(i.id) order by i.created_at desc,i.id) from public.instant_deliveries i where public.can_read_customer(i.customer_id)),'[]'::jsonb));
end $$;
create function public.instant_history(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.instant_deliveries; inv uuid;
begin
 if not public.has_operational_access() then raise exception using errcode='42501',message='Authorized account required.';end if;
 select * into i from public.instant_deliveries where id=p_id and public.can_read_customer(customer_id);
 if not found then raise exception using errcode='42501',message='Instant delivery access required.';end if;
 select n.id into inv from public.invoices n join public.sales s on s.id=n.sale_id where s.visit_id=i.visit_id;
 return jsonb_build_object('record',public.instant_row(p_id),
  'jars',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'product',p.name,'delta',e.delta,'balance',e.resulting_balance,'reason',e.reason,'at',coalesce(v.offline_occurred_at,e.created_at),'trip',t.trip_number,'driver',pr.name) order by o.sequence)
   from public.jar_custody_entries e join public.custody_event_order o on o.entry_id=e.id join public.products p on p.id=e.product_id
   left join public.trip_visits v on v.id=e.visit_id left join public.trips t on t.id=v.trip_id left join public.profiles pr on pr.id=t.driver_id where e.customer_id=i.customer_id),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'amount',a.amount::text,'method',p.method,'status',public.finance_state(p.id),'at',p.created_at) order by p.created_at)
   from public.payment_allocations a join public.payments p on p.id=a.payment_id where a.invoice_id=inv),'[]'::jsonb),
  'adjustments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('subtotal_delta',a.subtotal_delta::text,'tax_delta',a.tax_delta::text) order by a.created_at) from public.invoice_adjustments a where a.invoice_id=inv),'[]'::jsonb));
end $$;

-- The new envelope kind reuses the existing device, journal, sequence, receipt
-- and review machinery. All earlier kinds continue through the unchanged core.
alter table public.driver_offline_operations drop constraint driver_offline_operations_kind_check;
alter table public.driver_offline_operations add constraint driver_offline_operations_kind_check check(kind in ('CUSTOMER','CONTACT','DELIVERY','PAYMENT','SUBMIT','PAUSE','INSTANT'));
alter function public.offline_post(uuid,uuid,text,uuid,integer,text,timestamptz,text,text) rename to offline_post_before_instant;
revoke all on function public.offline_post_before_instant(uuid,uuid,text,uuid,integer,text,timestamptz,text,text) from public,anon,authenticated,service_role;
create function public.offline_post(p_trip uuid,p_device uuid,p_token text,p_id uuid,p_sequence integer,p_kind text,p_occurred timestamptz,p_payload text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; o public.driver_offline_operations; j jsonb; result uuid; x jsonb; v_message text; v_code text;
begin
 if p_kind is distinct from 'INSTANT' then return public.offline_post_before_instant(p_trip,p_device,p_token,p_id,p_sequence,p_kind,p_occurred,p_payload,p_fingerprint);end if;
 perform public.ops_actor(false);r:=public.offline_device(p_trip,p_device,p_token);
 if p_id is null or p_sequence is null or p_sequence<1 or p_payload is null or length(p_payload)>60000 or public.offline_hash(p_payload) is distinct from p_fingerprint or p_occurred is null then raise exception using errcode='22023',message='Invalid offline record.';end if;
 perform pg_advisory_xact_lock(hashtextextended('offline-op:'||p_id::text,0));
 select * into o from public.driver_offline_operations where id=p_id for update;
 if found then
  if o.driver_id<>auth.uid() or o.trip_id<>p_trip or o.fingerprint<>p_fingerprint or o.payload<>p_payload or o.kind<>p_kind or o.sequence<>p_sequence or o.occurred_at<>p_occurred then
   insert into public.driver_offline_reviews(operation_id,trip_id,actor_id,action,details,reason) values(p_id,p_trip,auth.uid(),'IDEMPOTENCY_CONFLICT',jsonb_build_object('fingerprint',p_fingerprint),'Original offline operation preserved');
   return jsonb_build_object('id',p_id,'trip',p_trip,'sequence',p_sequence,'fingerprint',p_fingerprint,'status','NEEDS_REVIEW','result',null,'message','Idempotency conflict. Contact the warehouse admin.','processedAt',now());
  end if;
  if o.status<>'RETRYABLE' then return public.offline_receipt(p_id);end if;
 else
  if p_sequence<>r.confirmed_sequence+1 then raise exception using errcode='22023',message='Synchronize earlier records before this operation.';end if;
  insert into public.driver_offline_operations(id,trip_id,driver_id,device_id,sequence,kind,payload,fingerprint,occurred_at,status) values(p_id,p_trip,auth.uid(),p_device,p_sequence,p_kind,p_payload,p_fingerprint,p_occurred,'RETRYABLE');
 end if;
 begin
  if r.phase<>'ACTIVE' then raise exception using errcode='22023',message='This load is sealed or under an admin exception. Keep this record for review.';end if;
  if p_sequence<>r.confirmed_sequence+1 then raise exception using errcode='22023',message='Synchronize earlier records before this operation.';end if;
  if p_occurred<r.registered_at-interval '5 minutes' or p_occurred>clock_timestamp()+interval '5 minutes' or exists(select 1 from public.trip_carryovers c where c.trip_id=p_trip and c.resumed_at is not null and p_occurred<c.resumed_at-interval '5 minutes') then raise exception using errcode='22023',message='The device clock needs review. Original occurrence time is preserved.';end if;
  perform public.delivery_trip(p_trip);perform set_config('mk.offline.device',p_device::text,true);perform set_config('mk.offline.occurred',p_occurred::text,true);
  j:=p_payload::jsonb;
  if jsonb_typeof(j->'prices') is distinct from 'array' or jsonb_array_length(j->'prices')<>jsonb_array_length(j->'items')
   or exists(select 1 from jsonb_array_elements(j->'items') it where not exists(select 1 from jsonb_array_elements(j->'prices') pr where pr->>'product_id'=it->>'product_id')) then raise exception using errcode='22023',message='Cached price and jar-balance evidence is required.';end if;
  for x in select value from jsonb_array_elements(j->'prices') loop
   if public.finance_price(null,(x->>'product_id')::uuid) is distinct from (x->>'price')::numeric then raise exception using errcode='22023',message='Customer pricing changed. The recorded payment needs admin review.';end if;
  end loop;
  if j->>'customer' is distinct from j->'instant'->>'id' then raise exception using errcode='22023',message='Invalid one-time customer reference.';end if;
  result:=public.post_instant_delivery(p_trip,(j->'instant'->>'id')::uuid,j->'instant'->>'name',j->'instant'->>'phone',j->'instant'->>'location',j->'items',j->>'status',j->>'received',j->>'notes',p_id);
  if (select inv.total from public.invoices inv join public.sales s on s.id=inv.sale_id join public.instant_deliveries i on i.visit_id=s.visit_id where i.id=result) is distinct from (j->>'total')::numeric then raise exception using errcode='22023',message='Invoice total changed. Review the recorded amount.';end if;
  update public.driver_offline_operations set status='CONFIRMED',result_id=result,customer_id=result,processed_at=now(),message=null where id=p_id;
  update public.driver_offline_rounds set confirmed_sequence=p_sequence,last_seen_at=now(),reported_pending=greatest(0,reported_pending-1) where trip_id=p_trip;
 exception when others then
  get stacked diagnostics v_message=message_text,v_code=returned_sqlstate;
  if left(v_code,2) in ('40','53','57','08') then raise;end if;
  update public.driver_offline_operations set status='NEEDS_REVIEW',message=case when v_code in ('22023','42501') and length(v_message)<250 then v_message else 'This record needs admin review. No business changes were posted.' end,processed_at=now() where id=p_id;
 end;
 perform set_config('mk.offline.device','',true);perform set_config('mk.offline.occurred','',true);
 return public.offline_receipt(p_id);
end $$;
revoke all on function public.post_instant_delivery(uuid,uuid,text,text,text,jsonb,text,text,text,uuid),public.convert_instant_customer(uuid,text,uuid),public.instant_row(uuid),public.instant_workspace(),public.instant_history(uuid),public.delivery_customer_directory(),public.offline_post(uuid,uuid,text,uuid,integer,text,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.post_instant_delivery(uuid,uuid,text,text,text,jsonb,text,text,text,uuid),public.convert_instant_customer(uuid,text,uuid),public.instant_workspace(),public.instant_history(uuid),public.delivery_customer_directory(),public.offline_post(uuid,uuid,text,uuid,integer,text,timestamptz,text,text) to authenticated;
