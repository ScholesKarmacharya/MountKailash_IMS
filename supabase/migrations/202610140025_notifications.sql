-- Recipient inbox. Creation is atomic with the existing audited business writer.
-- This installation has one warehouse account and no organization/tenant table.
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 recipient_id uuid not null references public.profiles(id),
 event_key text not null,
 type text not null check(type in ('TRIP_ASSIGNED','STOCK_LOADED','TRIP_UPDATED','TRIP_CANCELLED','RETURN_SUBMITTED','RETURN_CONFIRMED','STOCK_DISCREPANCY','SYNC_REVIEW','TRANSACTION_REVIEW')),
 entity_type text not null check(entity_type in ('trip','offline_operation')),
 entity_id uuid not null,
 trip_id uuid not null references public.trips(id),
 payload jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 read_at timestamptz,
 unique(recipient_id,event_key,type)
);
create index notifications_recipient_sequence on public.notifications(recipient_id,sequence desc);
create index notifications_unread on public.notifications(recipient_id) where read_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated,service_role;
grant select on public.notifications to authenticated;
create policy notification_recipient_read on public.notifications for select to authenticated
 using(recipient_id=(select auth.uid()) and (select public.has_operational_access()));

-- Private helpers: never executable by a browser or an ordinary Auth user.
create function public.notification_trip_payload(p_trip uuid,p_counts jsonb default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('trip_number',t.trip_number,'driver',p.name,'vehicle',v.plate_number,
  'scheduled_date',t.scheduled_date,'assigned_not_ready',t.status='DRAFT',
  'counts',coalesce((select jsonb_agg(jsonb_build_object('product',pr.name,'stock_kind',x.stock_kind,'quantity',x.quantity) order by pr.name,x.stock_kind)
   from jsonb_to_recordset(case when jsonb_typeof(p_counts)='array' then p_counts else '[]'::jsonb end) as x(product_id uuid,stock_kind text,quantity integer)
   join public.products pr on pr.id=x.product_id),'[]'::jsonb))
 from public.trips t join public.profiles p on p.id=t.driver_id join public.vehicles v on v.id=t.vehicle_id where t.id=p_trip
$$;
create function public.notification_emit(p_event text,p_type text,p_trip uuid,p_payload jsonb,p_driver boolean,p_admin boolean,p_entity uuid default null) returns void
language sql security definer set search_path='' as $$
 insert into public.notifications(recipient_id,event_key,type,entity_type,entity_id,trip_id,payload)
 select p.id,p_event,p_type,case when p_entity is null then 'trip' else 'offline_operation' end,coalesce(p_entity,p_trip),p_trip,p_payload
 from public.profiles p join public.trips t on t.id=p_trip
 where p.is_active and ((p_driver and p.id=t.driver_id and p.role='DRIVER' and p.approval_status='APPROVED') or (p_admin and p.role='ADMIN'))
 on conflict(recipient_id,event_key,type) do nothing
$$;

create function public.notification_audit_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text; data jsonb; driver boolean:=false; admins boolean:=false;
begin
 if new.entity='trips' then
  kind:=case new.action when 'TRIP_CREATED' then 'TRIP_ASSIGNED' when 'TRIP_LOADED' then 'STOCK_LOADED'
   when 'TRIP_RESCHEDULE' then 'TRIP_UPDATED' when 'TRIP_CARRYOVER' then 'TRIP_UPDATED'
   when 'TRIP_CANCEL' then 'TRIP_CANCELLED' when 'TRIP_UNLOAD_CANCEL' then 'TRIP_CANCELLED'
   when 'TRIP_SUBMITTED' then 'RETURN_SUBMITTED' when 'TRIP_CLOSED' then 'RETURN_CONFIRMED'
   when 'TRIP_DISCREPANCY' then 'STOCK_DISCREPANCY' else null end;
  -- schedule_trip calls the existing create_trip writer first. Correct that
  -- one assignment's date in the SAME transaction; do not send it twice.
  if new.action='TRIP_SCHEDULED' then
   update public.notifications set payload=public.notification_trip_payload(new.entity_id)
    where trip_id=new.entity_id and type='TRIP_ASSIGNED';
   return new;
  end if;
  if kind is null then return new;end if;
  if new.action='TRIP_RESCHEDULE' and new.before_json->>'scheduled_date' is not distinct from new.after_json->>'scheduled_date' then return new;end if;
  data:=public.notification_trip_payload(new.entity_id,case when kind='STOCK_LOADED' then new.after_json->'items' else new.after_json->'counts' end)
   ||jsonb_build_object('action',new.action,'submitted_at',new.after_json->>'submitted_at');
  driver:=kind<>'RETURN_SUBMITTED';admins:=kind in ('RETURN_SUBMITTED','STOCK_DISCREPANCY');
  perform public.notification_emit('audit:'||new.id,kind,new.entity_id,data,driver,admins);
 elsif new.action='OFFLINE_REVIEWED' and new.after_json->>'action'='REJECT' then
  select public.notification_trip_payload(o.trip_id)||jsonb_build_object('operation_kind',o.kind) into data from public.driver_offline_operations o where o.id=new.entity_id;
  perform public.notification_emit('rejection:'||new.entity_id,'TRANSACTION_REVIEW',
   (select trip_id from public.driver_offline_operations where id=new.entity_id),data,true,false,new.entity_id);
 end if;
 return new;
end $$;
create trigger notification_from_audit after insert on public.audit_events for each row execute function public.notification_audit_event();

-- Only a committed review record generates a failure/conflict alert. SQL
-- exceptions that roll back never create notifications or stock confirmations.
create function public.notification_offline_attention() returns trigger
language plpgsql security definer set search_path='' as $$
declare op public.driver_offline_operations; kind text; data jsonb;
begin
 if tg_table_name='driver_offline_operations' then
  if new.status<>'NEEDS_REVIEW' then return new;end if;
  if tg_op='UPDATE' then if old.status='NEEDS_REVIEW' then return new;end if;end if;
  op:=new;
 else
  if new.action<>'IDEMPOTENCY_CONFLICT' then return new;end if;
  -- A malicious replay can name a known UUID from another trip. The existing
  -- review journal records it, but it must not alert that other trip's driver.
  select * into op from public.driver_offline_operations where id=new.operation_id and trip_id=new.trip_id and driver_id=new.actor_id;
  if not found then return new;end if;
 end if;
 kind:=case when tg_table_name='driver_offline_reviews' then 'SYNC_REVIEW' when op.kind in ('SUBMIT','PAYMENT') then 'TRANSACTION_REVIEW' else 'SYNC_REVIEW' end;
 data:=public.notification_trip_payload(op.trip_id)||jsonb_build_object('operation_kind',op.kind);
 perform public.notification_emit('offline:'||op.id,kind,op.trip_id,data,true,true,op.id);
 return new;
end $$;
create trigger notification_from_offline after insert or update on public.driver_offline_operations for each row execute function public.notification_offline_attention();
create trigger notification_from_conflict after insert on public.driver_offline_reviews for each row execute function public.notification_offline_attention();

create function public.notification_feed(p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operational_access() then raise exception using errcode='42501',message='Not authorized for notifications.';end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(n) order by n.sequence desc) from
  (select * from public.notifications where recipient_id=auth.uid() and (p_before is null or sequence<p_before) order by sequence desc limit 50) n),'[]'::jsonb),
  'unread',(select count(*) from public.notifications where recipient_id=auth.uid() and read_at is null),
  'fetched_at',clock_timestamp());
end $$;
create function public.notification_read(p_ids uuid[],p_all boolean default false,p_through bigint default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.ops_actor();
 if p_all is null or (p_all and p_through is null) or (not p_all and (p_ids is null or cardinality(p_ids)>200)) then
  raise exception using errcode='22023',message='Invalid notification acknowledgement.';end if;
 -- Ownership is checked even for an empty inbox. Cross-user IDs are rejected.
 if exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.notifications n where n.id=x and n.recipient_id=auth.uid())) then
  raise exception using errcode='42501',message='Notification access denied.';end if;
 update public.notifications set read_at=clock_timestamp() where recipient_id=auth.uid() and read_at is null
  and ((p_all and sequence<=p_through) or (not p_all and id=any(p_ids)));
end $$;
revoke all on function public.notification_trip_payload(uuid,jsonb),public.notification_emit(text,text,uuid,jsonb,boolean,boolean,uuid),public.notification_audit_event(),public.notification_offline_attention(),public.notification_feed(bigint),public.notification_read(uuid[],boolean,bigint) from public,anon,authenticated,service_role;
grant execute on function public.notification_feed(bigint),public.notification_read(uuid[],boolean,bigint) to authenticated;
-- Add only this table; retain every existing Realtime publication member.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables)
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
  alter publication supabase_realtime add table public.notifications;
 end if;
end $$;
