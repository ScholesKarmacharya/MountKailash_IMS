-- Forward only: no operation, review, round, stock, or financial history is deleted.
alter table public.driver_offline_rounds
 add column offline_device_reset_pending boolean not null default false,
 add column offline_device_reset_at timestamptz,
 add column offline_device_reset_by uuid references public.profiles(id),
 add column offline_device_reset_reason text,
 add column offline_device_reset_id uuid;

-- Also fence legacy devices that predate driver_trusted_devices immediately.
create or replace function public.offline_device(p_trip uuid,p_device uuid,p_token text) returns public.driver_offline_rounds
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; d public.driver_trusted_devices;
begin
 select * into r from public.driver_offline_rounds where trip_id=p_trip and driver_id=auth.uid()
  and device_id=p_device and token_hash=public.offline_hash(p_token) for update;
 if not found or r.offline_device_reset_pending then
  raise exception using errcode='42501',message='This device is not the authorized writer for this load.';
 end if;
 select * into d from public.driver_trusted_devices where device_id=p_device for update;
 if d.device_id is not null and (d.revoked_at is not null or d.driver_id<>auth.uid() or d.token_hash<>public.offline_hash(p_token)) then
  raise exception using errcode='42501',message='Trusted device access was revoked. Keep saved records for admin review.';
 end if;
 update public.driver_trusted_devices set last_seen_at=now() where device_id=p_device and driver_id=auth.uid();
 return r;
end $$;

create function public.offline_admin_reset_device(p_trip uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; t public.trips; j jsonb; retry uuid; owner_id uuid;
begin
 perform public.ops_actor(true);
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
  raise exception using errcode='22023',message='Enter a reason between 3 and 500 characters.';
 end if;
 j:=jsonb_build_object('operation','OFFLINE_DEVICE_RESET','trip',p_trip,'reason',p_reason);
 retry:=public.ops_retry(p_key,j); if retry is not null then return retry; end if;
 select driver_id into owner_id from public.trips where id=p_trip;
 -- Registration takes the same locks, preventing competing transfers.
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||owner_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 select * into r from public.driver_offline_rounds where trip_id=p_trip for update;
 select * into t from public.trips where id=p_trip for update;
 if r.trip_id is null or t.status not in ('LOADED','ACTIVE') or r.phase not in ('PREPARED','ACTIVE') then
  raise exception using errcode='22023',message='Only a loaded or active delivery trip can replace its offline device.';
 end if;
 update public.driver_trusted_devices set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=btrim(p_reason)
  where device_id=r.device_id and driver_id=r.driver_id and revoked_at is null;
 update public.driver_offline_rounds set offline_device_reset_pending=true,
  offline_device_reset_at=now(),offline_device_reset_by=auth.uid(),
  offline_device_reset_reason=btrim(p_reason),offline_device_reset_id=p_key where trip_id=p_trip;
 insert into public.driver_offline_reviews(trip_id,actor_id,action,details,reason)
  values(p_trip,auth.uid(),'DEVICE_RESET',jsonb_build_object('reset_id',p_key,'previous_device',r.device_id,
   'confirmed_sequence',r.confirmed_sequence,'reported_pending',r.reported_pending,
   'unreported_local_records','unknown; preserve old phone data'),btrim(p_reason));
 return public.ops_finish(p_key,j,p_trip,'OFFLINE_DEVICE_RESET','trips',
  jsonb_build_object('device',r.device_id),jsonb_build_object('reset_id',p_key,'records_preserved',true),p_reason);
end $$;

create or replace function public.offline_register(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.driver_offline_rounds; t public.trips;
begin
 perform public.ops_actor(false);
 if p_device is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='A secure device identity is required.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('trusted-driver:'||auth.uid()::text,0));
 if exists(select 1 from public.driver_trusted_devices where device_id=p_device and
   (revoked_at is not null or driver_id<>auth.uid() or token_hash<>public.offline_hash(p_token))) or
   exists(select 1 from public.driver_trusted_devices where driver_id=auth.uid() and revoked_at is null and device_id<>p_device) then
  raise exception using errcode='42501',message='Use the approved trusted device for this driver.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('offline-round:'||p_trip::text,0));
 select * into r from public.driver_offline_rounds where trip_id=p_trip for update;
 if r.trip_id is not null and r.device_id<>p_device then
  select * into t from public.trips where id=p_trip and driver_id=auth.uid() for update;
  if not r.offline_device_reset_pending or r.driver_id<>auth.uid() or t.id is null or
    t.status not in ('LOADED','ACTIVE') or r.phase not in ('PREPARED','ACTIVE') or
    not exists(select 1 from public.driver_trusted_devices where device_id=p_device and driver_id=auth.uid()
      and revoked_at is null and token_hash=public.offline_hash(p_token)) then
   raise exception using errcode='42501',message='An explicit admin device reset is required for this trip.';
  end if;
  update public.driver_offline_rounds set device_id=p_device,token_hash=public.offline_hash(p_token),
   offline_device_reset_pending=false,last_seen_at=now() where trip_id=p_trip;
  insert into public.driver_offline_reviews(trip_id,actor_id,action,details,reason)
   values(p_trip,auth.uid(),'DEVICE_TRANSFER',jsonb_build_object('reset_id',r.offline_device_reset_id,
    'previous_device',r.device_id,'replacement_device',p_device,'confirmed_sequence',r.confirmed_sequence,
    'previous_reported_pending',r.reported_pending),r.offline_device_reset_reason);
  insert into public.audit_events(actor_user_id,action,entity,entity_id,before_json,after_json,reason)
   values(auth.uid(),'OFFLINE_DEVICE_TRANSFERRED','trips',p_trip,jsonb_build_object('device',r.device_id),
    jsonb_build_object('device',p_device,'reset_id',r.offline_device_reset_id),r.offline_device_reset_reason);
 end if;
 perform public.offline_register_round_core(p_trip,p_device,p_token);
 return to_jsonb(public.offline_device(p_trip,p_device,p_token))-array['token_hash','exception_reason','exception_by','exception_at'];
end $$;
revoke all on function public.offline_admin_reset_device(uuid,text,uuid),public.offline_register(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.offline_admin_reset_device(uuid,text,uuid),public.offline_register(uuid,uuid,text) to authenticated;

-- A replacement inherits exact received envelopes, including review status.
-- They retain their original UUIDs, sequence, hash, occurrence and device rows.
create function public.offline_device_journal(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.ops_actor(false);
 perform public.offline_device(p_trip,p_device,p_token);
 return coalesce((select jsonb_agg(jsonb_build_object('version',1,'id',id,'trip',trip_id,
  'sequence',sequence,'kind',kind,'occurredAt',occurred_at,'payload',payload,'fingerprint',fingerprint) order by sequence)
  from public.driver_offline_operations where trip_id=p_trip and status<>'CONFIRMED'),'[]'::jsonb);
end $$;
revoke all on function public.offline_device_journal(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.offline_device_journal(uuid,uuid,text) to authenticated;

-- Extend the same validated delivery entry point with pending Fonepay. Existing
-- cash, credit, HOUSE rules and idempotent posting remain in the original core.
alter function public.post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid) rename to post_driver_delivery_before_fonepay;
revoke all on function public.post_driver_delivery_before_fonepay(uuid,uuid,text,text,jsonb,text,text,text,uuid) from public,anon,authenticated,service_role;
create function public.post_driver_delivery(p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,
 p_status text,p_received text,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare visit uuid; invoice public.invoices; payment jsonb;
begin
 if p_status is distinct from 'FONEPAY' then
  return public.post_driver_delivery_before_fonepay(p_trip,p_customer,p_walk_name,p_walk_phone,p_items,p_status,p_received,p_notes,p_key);
 end if;
 perform public.ops_actor(false);
 if p_received is null or p_received !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' or p_received::numeric<=0 then
  raise exception using errcode='22023',message='Enter the total amount received.';
 end if;
 payment:=jsonb_build_object('selection','FONEPAY','reported_amount',p_received,'reference','',
  'payments',jsonb_build_array(jsonb_build_object('method','FONEPAY','amount',p_received,
   'current_amount',p_received,'deposit_amount','0.00','reference','','allocations','[]'::jsonb)));
 visit:=public.post_trip_visit(p_trip,p_customer,p_walk_name,p_walk_phone,p_items,payment,p_notes,p_key);
 select i.* into invoice from public.invoices i join public.sales s on s.id=i.sale_id where s.visit_id=visit;
 if invoice.id is null or invoice.total<>p_received::numeric then
  raise exception using errcode='22023',message='Total amount received must equal the payable total.';
 end if;
 return visit;
end $$;
revoke all on function public.post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid) to authenticated;

-- Preparation downloads the same customer context for an assigned LOADED trip.
-- Delivery writers still require ACTIVE and retain every existing stock check.
alter function public.offline_contexts(uuid) rename to offline_contexts_active_core;
revoke all on function public.offline_contexts_active_core(uuid) from public,anon,authenticated,service_role;
create function public.offline_contexts(p_trip uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.trips; c public.customers; result jsonb:='[]'::jsonb;
begin
 perform public.ops_actor(false);
 select * into t from public.trips where id=p_trip and driver_id=auth.uid();
 if t.id is null then raise exception using errcode='42501',message='Assigned trip access required.'; end if;
 if t.status<>'LOADED' then return public.offline_contexts_active_core(p_trip); end if;
 for c in select * from public.customers where is_active loop
  result:=result||jsonb_build_array(jsonb_build_object(
   'customer',to_jsonb(c)||jsonb_build_object('notes',''),
   'billing',(select to_jsonb(b) from public.customer_billing b where customer_id=c.id),
   'prices',coalesce((select jsonb_agg(public.finance_json(to_jsonb(p))) from public.customer_prices p where customer_id=c.id),'[]'::jsonb),
   'credit',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number::text,'customer_id',s.customer_id,'date_label',i.date_label,
    'due_date',i.due_date,'outstanding',public.finance_invoice_balance(i.id,false)::text,'available',public.finance_invoice_balance(i.id,true)::text))
    from public.invoices i join public.sales s on s.id=i.sale_id where s.customer_id=c.id and public.finance_invoice_balance(i.id,false)>0),'[]'::jsonb),
   'custody',coalesce((select jsonb_agg(to_jsonb(b)) from public.jar_custody_balances b where customer_id=c.id),'[]'::jsonb),
   'custody_history',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,product_id,delta,resulting_balance,reason,created_at
    from public.jar_custody_entries where customer_id=c.id order by created_at desc,id limit 50) x),'[]'::jsonb),
   'credit_history',coalesce((select jsonb_agg(public.finance_json(to_jsonb(x))) from (select id,kind,amount,created_at,business_day_id
    from public.customer_ledger where customer_id=c.id order by created_at desc,id limit 50) x),'[]'::jsonb),
   'pending_jars',public.pending_jar_rows(c.id),'jar_allocations',public.jar_return_allocations(c.id),
   'house_products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'house_eligible',p.house_eligible,'house_version',p.house_version,
    'reference_price',coalesce(p.reference_price,p.default_price)::text)) from public.products p),'[]'::jsonb),
   'free_deliveries',public.house_delivery_rows(c.id,null,null,null,null)));
 end loop;
 return result;
end $$;
revoke all on function public.offline_contexts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.offline_contexts(uuid) to authenticated;
notify pgrst, 'reload schema';
