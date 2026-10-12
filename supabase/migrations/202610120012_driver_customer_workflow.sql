-- Confirmed driver-selected destinations. Forward-only; historical associations and journals remain intact.
alter table public.customers add column created_by uuid references public.profiles(id);
create index customers_creator on public.customers(created_by);
create index customers_phone_lookup on public.customers(regexp_replace(phone,'[^0-9]','','g')) where phone<>'';
create function public.stamp_customer_creator() returns trigger language plpgsql security definer set search_path='' as $$
begin new.created_by:=auth.uid(); return new; end $$;
create trigger customer_creator before insert on public.customers for each row execute function public.stamp_customer_creator();
revoke all on function public.stamp_customer_creator() from public,anon,authenticated,service_role;

create function public.can_search_delivery_customers() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.trips t on t.driver_id=p.id
   join public.business_days d on d.id=t.business_day_id where p.id=auth.uid() and p.role='DRIVER' and p.is_active
   and t.status='ACTIVE' and d.status='OPEN');
$$;
revoke all on function public.can_search_delivery_customers() from public,anon,authenticated,service_role;

-- Searchable contacts are projected through an authorized RPC. Raw customer RLS
-- stays scoped to historical/served customers; private admin notes are not shared.
create function public.delivery_customer_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_admin boolean;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception using errcode='42501',message='Active account required.'; end if;
 v_admin:=public.is_active_admin();
 return coalesce((select jsonb_agg(case when v_admin then to_jsonb(c)||jsonb_build_object('created_by_name',(select name from public.profiles where id=c.created_by))
   else jsonb_build_object('id',c.id,'name',c.name,'shop_name',c.shop_name,'phone',c.phone,'address',c.address,'is_active',c.is_active,'version',c.version,'notes','') end order by c.name,c.id)
   from public.customers c where v_admin or public.can_read_customer(c.id) or (c.is_active and public.can_search_delivery_customers())),'[]'::jsonb);
end $$;
revoke all on function public.delivery_customer_directory() from public,anon,authenticated,service_role;
grant execute on function public.delivery_customer_directory() to authenticated;

-- This reader remains SECURITY INVOKER: other trips, warehouse and raw finance stay behind existing RLS.
create or replace function public.operations_workspace(p_trip uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'driver_workflow',true,
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

-- Reuse proven stock/finance posting implementations behind non-callable cores.
alter function public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid) rename to post_trip_visit_core;
alter function public.finance_command(text,jsonb,uuid) rename to finance_command_core;
alter function public.create_trip(uuid,uuid,uuid,uuid,jsonb,text,uuid) rename to create_trip_core;
revoke all on function public.post_trip_visit_core(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.finance_command_core(text,jsonb,uuid),public.create_trip_core(uuid,uuid,uuid,uuid,jsonb,text,uuid) from public,anon,authenticated,service_role;

create function public.delivery_trip(p_trip uuid) returns public.trips
language plpgsql security definer set search_path='' as $$
declare t public.trips;
begin
 perform public.ops_actor(false); t:=public.ops_trip(p_trip);
 if t.status<>'ACTIVE' then raise exception using errcode='22023',message='An ACTIVE assigned trip is required.'; end if;
 return t;
end $$;
revoke all on function public.delivery_trip(uuid) from public,anon,authenticated,service_role;

create function public.post_trip_visit(p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,p_payment jsonb,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_retry uuid; v_name text:=case when p_customer is null and btrim(p_walk_name)='' then 'Walk-in customer' else p_walk_name end;
begin
 perform public.ops_actor(false);
 v_retry:=public.ops_retry(p_key,jsonb_build_object('operation','VISIT','trip',p_trip,'customer',p_customer,'walk_name',v_name,
   'walk_phone',p_walk_phone,'items',p_items,'payment',p_payment,'notes',p_notes));
 if v_retry is not null then return v_retry; end if;
 perform public.delivery_trip(p_trip);
 if p_customer is not null then
   perform 1 from public.customers where id=p_customer and is_active for share;
   if not found then raise exception using errcode='22023',message='Customer is missing or inactive.'; end if;
   -- Association is made by a successful sale, never by admin route preassignment.
   -- An unsuccessful downstream posting rolls this back in the same transaction.
   insert into public.trip_customers(trip_id,customer_id) values(p_trip,p_customer) on conflict do nothing;
 end if;
 return public.post_trip_visit_core(p_trip,p_customer,v_name,p_walk_phone,p_items,p_payment,p_notes,p_key);
end $$;

create function public.finance_command(p_operation text,p_data jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_retry uuid; v_customer uuid; v_trip uuid;
begin
 perform public.ops_actor(p_operation<>'PAYMENT');
 v_retry:=public.ops_retry(p_key,jsonb_build_object('operation','FINANCE_'||p_operation,'data',p_data));
 if v_retry is not null then return v_retry; end if;
 if p_operation='PAYMENT' then
   v_trip:=(p_data->>'trip')::uuid; v_customer:=(p_data->>'customer')::uuid;
   perform public.delivery_trip(v_trip);
   if v_customer is not null then
     perform 1 from public.customers where id=v_customer and is_active for share;
     if not found then raise exception using errcode='22023',message='Customer is missing or inactive.'; end if;
     insert into public.trip_customers(trip_id,customer_id) values(v_trip,v_customer) on conflict do nothing;
   end if;
 end if;
 return public.finance_command_core(p_operation,p_data,p_key);
end $$;

create function public.create_trip(p_id uuid,p_driver uuid,p_vehicle uuid,p_day uuid,p_customers jsonb,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_retry uuid;
begin
 perform public.ops_actor(true);
 v_retry:=public.ops_retry(p_key,jsonb_build_object('operation','CREATE_TRIP','id',p_id,'driver',p_driver,'vehicle',p_vehicle,'day',p_day,'customers',p_customers,'notes',p_notes));
 if v_retry is not null then return v_retry; end if;
 if p_customers is distinct from '[]'::jsonb then raise exception using errcode='22023',message='Drivers choose customers during delivery; create trips without customer destinations.'; end if;
 return public.create_trip_core(p_id,p_driver,p_vehicle,p_day,p_customers,p_notes,p_key);
end $$;
create or replace function public.assign_trip_customer(p_trip uuid,p_customer uuid,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_retry uuid;
begin
 perform public.ops_actor(true);
 v_retry:=public.ops_retry(p_key,jsonb_build_object('operation','ROUTE_CUSTOMER','trip',p_trip,'customer',p_customer));
 if v_retry is not null then return v_retry; end if;
 raise exception using errcode='42501',message='Customer preassignment is disabled. Drivers choose delivery destinations.';
end $$;

create function public.save_delivery_customer(p_trip uuid,p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_version integer,p_duplicate_confirmed boolean,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_old public.customers; v_new public.customers; v_phone text; v_lock text; v_exists boolean;
begin
 perform public.ops_actor(false);
 if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 120 or p_shop is null or length(p_shop)>160
   or p_phone is null or length(p_phone)>40 or p_address is null or length(p_address)>500 or p_version is null or p_version<0
   or p_duplicate_confirmed is null then raise exception using errcode='22023',message='Enter valid customer contact details.'; end if;
 v_payload:=jsonb_build_object('operation','DELIVERY_CUSTOMER','trip',p_trip,'id',p_id,'name',p_name,'shop',p_shop,'phone',p_phone,
   'address',p_address,'version',p_version,'duplicate_confirmed',p_duplicate_confirmed);
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
 return public.ops_finish(p_key,v_payload,p_id,case when v_exists then 'CUSTOMER_CONTACT_UPDATED' else 'CUSTOMER_CREATED' end,'customers',
   case when v_exists then to_jsonb(v_old) end,to_jsonb(v_new)||jsonb_build_object('trip_id',p_trip,'duplicate_confirmed',p_duplicate_confirmed),
   case when v_exists then 'Contact updated during delivery' else 'Customer registered during delivery' end);
end $$;

-- Selected-customer operational context, without granting access to other drivers' raw invoices/trips.
create function public.delivery_customer_context(p_trip uuid,p_customer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.delivery_trip(p_trip);
 perform 1 from public.customers where id=p_customer and is_active for share;
 if not found then raise exception using errcode='22023',message='Customer is missing or inactive.'; end if;
 return jsonb_build_object(
   'customer',(select to_jsonb(c)||jsonb_build_object('notes',case when public.is_active_admin() then c.notes else '' end) from public.customers c where c.id=p_customer),
   'billing',(select to_jsonb(b) from public.customer_billing b where customer_id=p_customer),
   'prices',coalesce((select jsonb_agg(public.finance_json(to_jsonb(p))) from public.customer_prices p where customer_id=p_customer),'[]'::jsonb),
   'credit',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number::text,'customer_id',s.customer_id,'date_label',i.date_label,
     'due_date',i.due_date,'outstanding',public.finance_invoice_balance(i.id,false)::text,'available',public.finance_invoice_balance(i.id,true)::text))
     from public.invoices i join public.sales s on s.id=i.sale_id where s.customer_id=p_customer and public.finance_invoice_balance(i.id,false)>0),'[]'::jsonb),
   'custody',coalesce((select jsonb_agg(to_jsonb(b)) from public.jar_custody_balances b where customer_id=p_customer),'[]'::jsonb),
   'custody_history',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,product_id,delta,resulting_balance,reason,created_at
     from public.jar_custody_entries where customer_id=p_customer order by created_at desc,id limit 50) x),'[]'::jsonb),
   'credit_history',coalesce((select jsonb_agg(public.finance_json(to_jsonb(x))) from (select id,kind,amount,created_at,business_day_id
     from public.customer_ledger where customer_id=p_customer order by created_at desc,id limit 50) x),'[]'::jsonb)
 );
end $$;
revoke all on function public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.finance_command(text,jsonb,uuid),
 public.create_trip(uuid,uuid,uuid,uuid,jsonb,text,uuid),public.save_delivery_customer(uuid,uuid,text,text,text,text,integer,boolean,uuid),
 public.delivery_customer_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.post_trip_visit(uuid,uuid,text,text,jsonb,jsonb,text,uuid),public.finance_command(text,jsonb,uuid),
 public.create_trip(uuid,uuid,uuid,uuid,jsonb,text,uuid),public.save_delivery_customer(uuid,uuid,text,text,text,text,integer,boolean,uuid),
 public.delivery_customer_context(uuid,uuid) to authenticated;
comment on table public.trip_customers is 'Historical route assignments retained. New associations record customers actually served/collected by a driver; never restrict destination choice.';
