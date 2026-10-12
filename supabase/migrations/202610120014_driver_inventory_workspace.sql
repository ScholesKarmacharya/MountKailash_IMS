-- Driver inventory workspace: additive contacts and authorized read-only lookup.
-- No stock, payment, Auth, trip, journal or archived report rows are rewritten.
alter table public.customers add column contact_person text not null default '' check(length(contact_person)<=120);
alter table public.customers add column customer_type text not null default '' check(length(customer_type)<=80);
alter table public.customers add column delivery_notes text not null default '' check(length(delivery_notes)<=2000);
comment on column public.customers.customer_type is 'Informational free-text classification; never changes billing, pricing, credit or deposit policy.';
comment on column public.customers.delivery_notes is 'Ordinary operational notes; private admin notes remain in the existing notes column.';

-- Permit active staff to search contacts while waiting for a warehouse load.
-- Do not broaden raw customer, inventory or finance RLS.
-- Raw customer rows contain private admin notes; use the projected directory.
alter policy customer_route_read on public.customers using(public.is_active_admin());
create or replace function public.can_search_delivery_customers() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='DRIVER' and is_active);
$$;
create or replace function public.delivery_customer_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_admin boolean;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception using errcode='42501',message='Active account required.'; end if;
 v_admin:=public.is_active_admin();
 return coalesce((select jsonb_agg(case when v_admin then to_jsonb(c)||jsonb_build_object('created_by_name',(select name from public.profiles where id=c.created_by))
   else jsonb_build_object('id',c.id,'name',c.name,'shop_name',c.shop_name,'phone',c.phone,'address',c.address,'contact_person',c.contact_person,
     'customer_type',c.customer_type,'delivery_notes',c.delivery_notes,'is_active',c.is_active,'version',c.version,'notes','') end order by c.name,c.id)
   from public.customers c where v_admin or (c.is_active and public.can_search_delivery_customers()) or public.can_read_customer(c.id)),'[]'::jsonb);
end $$;
create or replace function public.operations_workspace(p_trip uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'driver_workflow',true,'customer_details',true,
  'customers',public.delivery_customer_directory(),
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

-- One shared contact implementation keeps original canonical retries compatible.
-- Extended details join the full request payload and the same atomic audit event.
create function public.save_customer_contact(p_trip uuid,p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_version integer,p_duplicate_confirmed boolean,p_key uuid,p_details jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_old public.customers; v_new public.customers; v_phone text; v_lock text; v_exists boolean;
begin
 perform public.ops_actor(false);
 if p_details is not null and (jsonb_typeof(p_details)<>'object' or p_details-array['contact_person','customer_type','delivery_notes']<>'{}'::jsonb
   or jsonb_typeof(p_details->'contact_person') is distinct from 'string' or length(p_details->>'contact_person')>120
   or jsonb_typeof(p_details->'customer_type') is distinct from 'string' or length(p_details->>'customer_type')>80
   or jsonb_typeof(p_details->'delivery_notes') is distinct from 'string' or length(p_details->>'delivery_notes')>2000) then
   raise exception using errcode='22023',message='Enter valid customer contact details.'; end if;
 if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_shop is null or length(p_shop)>160
   or p_phone is null or length(p_phone)>40 or p_address is null or length(p_address)>500 or p_version is null or p_version<0
   or p_duplicate_confirmed is null then raise exception using errcode='22023',message='Enter valid customer contact details.'; end if;
 v_payload:=jsonb_build_object('operation','DELIVERY_CUSTOMER','trip',p_trip,'id',p_id,'name',p_name,'shop',p_shop,'phone',p_phone,
   'address',p_address,'version',p_version,'duplicate_confirmed',p_duplicate_confirmed);
 if p_details is not null then v_payload:=v_payload||jsonb_build_object('details',p_details); end if;
 v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
 perform public.delivery_trip(p_trip);
 v_phone:=regexp_replace(p_phone,'[^0-9]','','g');
 -- Serialize duplicate checks for contacts created concurrently through this RPC.
 for v_lock in select x from unnest(array['customer-name:'||lower(btrim(p_name))||':'||lower(btrim(p_shop)),
    case when v_phone<>'' then 'customer-phone:'||v_phone end]) x where x is not null order by x loop
   perform pg_advisory_xact_lock(hashtextextended(v_lock,0));
 end loop;
 select * into v_old from public.customers where id=p_id for update; v_exists:=found;
 if v_exists then
   if not v_old.is_active then raise exception using errcode='22023',message='Inactive customers require admin review.'; end if;
   if v_old.version<>p_version then raise exception using errcode='40001',message='Customer changed; reload the contact details before saving.'; end if;
 elsif p_version<>0 then raise exception using errcode='22023',message='Customer not found.'; end if;
 if not p_duplicate_confirmed and exists(select 1 from public.customers c where c.id<>p_id and c.is_active and
   ((v_phone<>'' and regexp_replace(c.phone,'[^0-9]','','g')=v_phone) or
    (lower(btrim(c.name))=lower(btrim(p_name)) and lower(btrim(c.shop_name))=lower(btrim(p_shop))))) then
   raise exception using errcode='22023',message='A matching customer already exists. Search and select it, or explicitly confirm a separate customer.';
 end if;
 if v_exists then
   -- Contact fields only: active status, notes, pricing, balances and all journals remain unchanged.
   update public.customers set name=btrim(p_name),shop_name=btrim(p_shop),phone=btrim(p_phone),address=btrim(p_address),version=version+1,updated_at=now()
     where id=p_id returning * into v_new;
 else
   insert into public.customers(id,name,shop_name,phone,address) values(p_id,btrim(p_name),btrim(p_shop),btrim(p_phone),btrim(p_address)) returning * into v_new;
 end if;
 if p_details is not null then
   update public.customers set contact_person=btrim(p_details->>'contact_person'),customer_type=btrim(p_details->>'customer_type'),
     delivery_notes=btrim(p_details->>'delivery_notes') where id=p_id returning * into v_new;
 end if;
 return public.ops_finish(p_key,v_payload,p_id,case when v_exists then 'CUSTOMER_CONTACT_UPDATED' else 'CUSTOMER_CREATED' end,'customers',
   case when v_exists then to_jsonb(v_old) end,to_jsonb(v_new)||jsonb_build_object('trip_id',p_trip,'duplicate_confirmed',p_duplicate_confirmed),
   case when v_exists then 'Contact updated during delivery' else 'Customer registered during delivery' end);
end $$;
revoke all on function public.save_customer_contact(uuid,uuid,text,text,text,text,integer,boolean,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.save_delivery_customer(p_trip uuid,p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_version integer,p_duplicate_confirmed boolean,p_key uuid) returns uuid
language sql security definer set search_path='' as $$
 select public.save_customer_contact(p_trip,p_id,p_name,p_shop,p_phone,p_address,p_version,p_duplicate_confirmed,p_key,null);
$$;
create function public.save_delivery_contact(p_trip uuid,p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_version integer,p_duplicate_confirmed boolean,p_key uuid,
 p_contact_person text,p_customer_type text,p_delivery_notes text) returns uuid
language sql security definer set search_path='' as $$
 select public.save_customer_contact(p_trip,p_id,p_name,p_shop,p_phone,p_address,p_version,p_duplicate_confirmed,p_key,
   jsonb_build_object('contact_person',p_contact_person,'customer_type',p_customer_type,'delivery_notes',p_delivery_notes));
$$;
revoke all on function public.save_delivery_contact(uuid,uuid,text,text,text,text,integer,boolean,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_delivery_contact(uuid,uuid,text,text,text,text,integer,boolean,uuid,text,text,text) to authenticated;

-- Keep original delivery dates and FIFO arithmetic; add human-readable attribution.
create or replace function public.pending_jar_rows(p_customer uuid default null,p_cutoff timestamptz default 'infinity') returns jsonb
language sql stable security definer set search_path='' as $$
 with deliveries as (
  select e.*,o.sequence,sum(e.delta::bigint) over(partition by e.customer_id,e.product_id order by o.sequence rows unbounded preceding) as delivered
  from public.jar_custody_entries e join public.custody_event_order o on o.entry_id=e.id
  where e.delta>0 and e.created_at<=p_cutoff and (p_customer is null or e.customer_id=p_customer)
 ), returned as (
  select customer_id,product_id,-sum(delta::bigint) as quantity from public.jar_custody_entries
  where delta<0 and created_at<=p_cutoff and (p_customer is null or customer_id=p_customer) group by customer_id,product_id
 ), outstanding as (
  select d.*,greatest(0::bigint,least(d.delta::bigint,d.delivered-coalesce(r.quantity,0))) as pending
  from deliveries d left join returned r using(customer_id,product_id)
 )
 select coalesce(jsonb_agg(jsonb_build_object('entry_id',x.id,'customer_id',x.customer_id,'customer_name',c.name,
  'product_id',x.product_id,'product_name',p.name,'quantity',x.delta,'pending',x.pending,'original_date',x.created_at,
  'business_date',b.date_label,'driver_name',pr.name,'trip_number',t.trip_number,'source',case when x.visit_id is null then 'Admin custody correction' else 'Delivery' end)
  order by x.sequence),'[]'::jsonb)
 from outstanding x join public.customers c on c.id=x.customer_id join public.products p on p.id=x.product_id
 join public.business_days b on b.id=x.business_day_id
 left join public.trip_visits v on v.id=x.visit_id left join public.trips t on t.id=v.trip_id
 left join public.profiles pr on pr.id=x.actor_user_id where x.pending>0;
$$;
create function public.pending_jar_directory(p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception using errcode='42501',message='Active account required.'; end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x) from jsonb_array_elements(public.pending_jar_rows(p_customer)) x
   where public.is_active_admin() or exists(select 1 from public.customers c where c.id=(x->>'customer_id')::uuid and c.is_active)),'[]'::jsonb));
end $$;
revoke all on function public.pending_jar_directory(uuid) from public,anon,authenticated,service_role;
grant execute on function public.pending_jar_directory(uuid) to authenticated;
-- All previous public grants and private revocations survive CREATE OR REPLACE.
