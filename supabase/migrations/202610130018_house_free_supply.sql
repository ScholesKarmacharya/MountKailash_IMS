-- Forward-only HOUSE / free supply. No historical journals or approval data are inferred.
alter table public.customers add column supply_type text not null default 'REGULAR' check(supply_type in ('REGULAR','HOUSE'));
alter table public.customers add column house_status text not null default 'NONE' check(house_status in ('NONE','PENDING','APPROVED','SUSPENDED'));
alter table public.customers add column house_version integer not null default 1;
alter table public.customers add constraint house_status_type check((supply_type='REGULAR' and house_status='NONE') or (supply_type='HOUSE' and house_status<>'NONE'));
alter table public.products add column house_eligible boolean not null default false;
alter table public.products add column reference_price numeric(14,2) check(reference_price>=0);
alter table public.products add column house_version integer not null default 1;
-- Only recognizable 20L jar products start eligible; cartons remain opt-in.
update public.products set house_eligible=true where kind='FULL_JAR' and (name||' '||sku) ~* '20[ _-]*l';
update public.products set reference_price=default_price;
alter table public.visit_items add column supply_classification text not null default 'SALE' check(supply_classification in ('SALE','FREE_SUPPLY','RETURN_ONLY'));
alter table public.visit_items add column reference_price_snapshot numeric(14,2) not null default 0 check(reference_price_snapshot>=0);
alter table public.visit_items add column free_value_snapshot numeric(14,2) generated always as (case when supply_classification='FREE_SUPPLY' then (full_jars::numeric+cartons::numeric)*reference_price_snapshot else 0 end) stored;
alter table public.visit_items add constraint free_supply_zero_price check(supply_classification<>'FREE_SUPPLY' or unit_price_snapshot=0);
alter table public.sales add column supply_classification text not null default 'SALE' check(supply_classification in ('SALE','FREE_SUPPLY','MIXED'));
alter table public.driver_offline_operations add column resolution_house boolean not null default false;
alter table public.sale_items add column supply_classification text not null default 'SALE' check(supply_classification in ('SALE','FREE_SUPPLY'));
alter table public.sale_items add column reference_price_snapshot numeric(14,2) not null default 0;
alter table public.delivery_payment_intents drop constraint delivery_payment_intents_selection_check;
alter table public.delivery_payment_intents add constraint delivery_payment_intents_selection_check check(selection in ('CASH','FONEPAY','UNPAID','PARTIAL','FREE_SUPPLY'));

create function public.house_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='customers' then
  if tg_op='UPDATE' and (old.supply_type,old.house_status) is distinct from (new.supply_type,new.house_status) then new.house_version:=old.house_version+1;end if;
 else
  if tg_op='INSERT' then new.reference_price:=coalesce(new.reference_price,new.default_price);new.house_eligible:=new.house_eligible or (new.kind='FULL_JAR' and (new.name||' '||new.sku) ~* '20[ _-]*l');
  elsif (old.house_eligible,old.reference_price) is distinct from (new.house_eligible,new.reference_price) then new.house_version:=old.house_version+1;end if;
 end if;return new;
end $$;
create trigger house_customer_revision before update on public.customers for each row execute function public.house_revision();
create trigger house_product_revision before insert or update on public.products for each row execute function public.house_revision();
revoke all on function public.house_revision() from public,anon,authenticated,service_role;

create function public.save_house_customer(p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_notes text,p_active boolean,p_version integer,p_reason text,p_key uuid,p_contact_person text,p_supply_type text,p_house_status text) returns uuid
language plpgsql security definer set search_path='' as $$
declare j jsonb; r uuid; old_row public.customers; new_row public.customers;
begin
 perform public.ops_actor(true);
 if p_supply_type is null or p_supply_type not in ('REGULAR','HOUSE') or p_house_status is null or
  (p_supply_type='REGULAR' and p_house_status<>'NONE') or (p_supply_type='HOUSE' and p_house_status not in ('PENDING','APPROVED','SUSPENDED')) or p_contact_person is null or length(p_contact_person)>120 then
  raise exception using errcode='22023',message='Choose a valid customer type and approval status.';end if;
 j:=jsonb_build_object('operation','HOUSE_CUSTOMER','id',p_id,'name',p_name,'shop',p_shop,'phone',p_phone,'address',p_address,'notes',p_notes,'active',p_active,'version',p_version,'reason',p_reason,'contact',p_contact_person,'type',p_supply_type,'status',p_house_status);
 r:=public.ops_retry(p_key,j);if r is not null then return r;end if;
 select * into old_row from public.customers where id=p_id for update;
 perform public.save_customer(p_id,p_name,p_shop,p_phone,p_address,p_notes,p_active,p_version,p_reason,md5(p_key::text||':contact')::uuid);
 update public.customers set contact_person=btrim(p_contact_person),supply_type=p_supply_type,house_status=p_house_status where id=p_id returning * into new_row;
 return public.ops_finish(p_key,j,p_id,'HOUSE_PRIVILEGES_SAVED','customers',to_jsonb(old_row),to_jsonb(new_row),p_reason);
end $$;

create function public.save_house_pricing(p_product uuid,p_price text,p_eligible boolean,p_reference text,p_version integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare old_row public.products; new_row public.products; j jsonb; r uuid; price numeric; ref numeric;
begin
 perform public.ops_actor(true);
 price:=public.finance_money(p_price);ref:=public.finance_money(p_reference);
 if p_eligible is null or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='A specific reason is required.';end if;
 j:=jsonb_build_object('operation','HOUSE_PRICING','product',p_product,'price',p_price,'eligible',p_eligible,'reference',p_reference,'version',p_version,'reason',p_reason);
 r:=public.ops_retry(p_key,j);if r is not null then return r;end if;
 select * into old_row from public.products where id=p_product for update;
 if old_row.id is null or p_version is distinct from old_row.version then raise exception using errcode='40001',message='Product changed; reload pricing before saving.';end if;
 update public.products set default_price=price,house_eligible=p_eligible,reference_price=ref,version=version+1,updated_at=now() where id=p_product returning * into new_row;
 return public.ops_finish(p_key,j,p_product,'HOUSE_PRICING_SAVED','products',to_jsonb(old_row),to_jsonb(new_row),p_reason);
end $$;

-- Corrections are additive reporting adjustments, never revenue or debt postings.
create table public.free_supply_adjustments (
 id uuid primary key default gen_random_uuid(), visit_id uuid not null references public.trip_visits(id),
 amount numeric(14,2) not null check(amount<>0),reason text not null check(length(btrim(reason)) between 3 and 500),
 business_day_id uuid not null references public.business_days(id),actor_user_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.free_supply_adjustments enable row level security;
revoke all on public.free_supply_adjustments from public,anon,authenticated,service_role;
grant select on public.free_supply_adjustments to authenticated;
create policy free_adjustment_read on public.free_supply_adjustments for select to authenticated using(public.is_active_admin());
create or replace function public.house_adjustment_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception using errcode='42501',message='Free supply adjustments are immutable.';end $$;
create trigger free_adjustment_immutable before update or delete on public.free_supply_adjustments for each row execute function public.house_adjustment_immutable();
create trigger free_adjustment_no_truncate before truncate on public.free_supply_adjustments execute function public.house_adjustment_immutable();
revoke all on function public.house_adjustment_immutable() from public,anon,authenticated,service_role;
create function public.adjust_free_supply(p_visit uuid,p_day uuid,p_amount text,p_direction text,p_reason text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare j jsonb; r uuid; a numeric; v_id uuid:=gen_random_uuid();
begin
 perform public.ops_actor(true);perform public.finance_day(p_day);a:=public.finance_money(p_amount);
 if p_direction not in ('INCREASE','DECREASE') or p_direction is null or a<=0 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 or not exists(select 1 from public.visit_items where visit_id=p_visit and supply_classification='FREE_SUPPLY') then raise exception using errcode='22023',message='Select a free delivery and document the correction.';end if;
 j:=jsonb_build_object('operation','FREE_ADJUSTMENT','visit',p_visit,'day',p_day,'amount',p_amount,'direction',p_direction,'reason',p_reason);r:=public.ops_retry(p_key,j);if r is not null then return r;end if;
 perform 1 from public.trip_visits where id=p_visit for update;
 if p_direction='DECREASE' then a:=-a;end if;
 if a+(select sum(free_value_snapshot) from public.visit_items where visit_id=p_visit)+coalesce((select sum(amount) from public.free_supply_adjustments where visit_id=p_visit),0)<0 then raise exception using errcode='22023',message='Correction exceeds the free supply reference value.';end if;
 insert into public.free_supply_adjustments(id,visit_id,business_day_id,amount,reason,actor_user_id) values(v_id,p_visit,p_day,a,btrim(p_reason),auth.uid());
 return public.ops_finish(p_key,j,v_id,'FREE_SUPPLY_ADJUSTED','free_supply_adjustments',null,jsonb_build_object('visit',p_visit,'amount',a),p_reason);
end $$;

create function public.house_delivery_rows(p_customer uuid,p_start timestamptz,p_end timestamptz,p_driver uuid,p_product uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('visit_id',v.id,'customer_id',c.id,'customer_name',c.name,'driver_id',t.driver_id,'driver_name',pr.name,'trip_id',t.id,'trip_number',t.trip_number,
  'occurred_at',coalesce(v.offline_occurred_at,v.created_at),'business_date',d.date_label,'product_id',p.id,'product_name',p.name,'kind',p.kind,'full_jars',i.full_jars,'cartons',i.cartons,'empty_jars',i.empty_jars,
  'reference_price',i.reference_price_snapshot::text,'reference_value',i.free_value_snapshot::text) order by coalesce(v.offline_occurred_at,v.created_at) desc),'[]'::jsonb)
 from public.visit_items i join public.trip_visits v on v.id=i.visit_id join public.customers c on c.id=v.customer_id join public.products p on p.id=i.product_id
 join public.trips t on t.id=v.trip_id join public.profiles pr on pr.id=t.driver_id join public.business_days d on d.id=v.business_day_id
 where i.supply_classification='FREE_SUPPLY' and (p_customer is null or c.id=p_customer) and (p_start is null or coalesce(v.offline_occurred_at,v.created_at)>=p_start) and (p_end is null or coalesce(v.offline_occurred_at,v.created_at)<p_end)
  and (p_driver is null or t.driver_id=p_driver) and (p_product is null or p.id=p_product);
$$;

create function public.house_workspace(p_start timestamptz,p_end timestamptz,p_customer uuid,p_driver uuid,p_product uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.ops_actor(true);
 if p_start is null or p_end is null or p_start>=p_end then raise exception using errcode='22023',message='Invalid business-date range.';end if;
 return jsonb_build_object('products',coalesce((select jsonb_agg((to_jsonb(p)-array['default_price','reference_price'])||jsonb_build_object('default_price',p.default_price::text,'reference_price',coalesce(p.reference_price,p.default_price)::text) order by p.name) from public.products p),'[]'::jsonb),
 'customers',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('jars_supplied',coalesce((select sum(i.full_jars) from public.visit_items i join public.trip_visits v on v.id=i.visit_id where v.customer_id=c.id and i.supply_classification='FREE_SUPPLY'),0),
 'unreturned_jars',coalesce((select sum(quantity) from public.jar_custody_balances where customer_id=c.id),0),'last_delivery',(select max(coalesce(v.offline_occurred_at,v.created_at)) from public.trip_visits v where v.customer_id=c.id)) order by c.name) from public.customers c where c.supply_type='HOUSE'),'[]'::jsonb),
 'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.profiles where role='DRIVER'),'[]'::jsonb),
 'rows',public.house_delivery_rows(p_customer,p_start,p_end,p_driver,p_product),
 'adjustments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text,'customer_name',c.name,'driver_name',pr.name)) from public.free_supply_adjustments a join public.trip_visits v on v.id=a.visit_id join public.customers c on c.id=v.customer_id join public.trips t on t.id=v.trip_id join public.profiles pr on pr.id=t.driver_id where a.created_at>=p_start and a.created_at<p_end and (p_customer is null or c.id=p_customer) and (p_driver is null or t.driver_id=p_driver) and (p_product is null or exists(select 1 from public.visit_items where visit_id=v.id and product_id=p_product and supply_classification='FREE_SUPPLY'))),'[]'::jsonb));
end $$;

revoke all on function public.house_delivery_rows(uuid,timestamptz,timestamptz,uuid,uuid),public.save_house_customer(uuid,text,text,text,text,text,boolean,integer,text,uuid,text,text,text),public.save_house_pricing(uuid,text,boolean,text,integer,text,uuid),public.adjust_free_supply(uuid,uuid,text,text,text,uuid),public.house_workspace(timestamptz,timestamptz,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_house_customer(uuid,text,text,text,text,text,boolean,integer,text,uuid,text,text,text),public.save_house_pricing(uuid,text,boolean,text,integer,text,uuid),public.adjust_free_supply(uuid,uuid,text,text,text,uuid),public.house_workspace(timestamptz,timestamptz,uuid,uuid,uuid) to authenticated;

-- A single-delivery authorization is stored by an admin in immutable review
-- evidence. It does not restore global privileges or change the device payload.
create function public.house_snapshot_override(p_key uuid,p_trip uuid,p_customer uuid,p_product uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select h from public.driver_offline_operations o cross join lateral jsonb_array_elements(o.payload::jsonb->'house'->'products') h
 where o.id=p_key and o.trip_id=p_trip and o.driver_id=auth.uid() and o.kind='DELIVERY' and o.status='RETRYABLE' and o.resolution_house
  and o.payload::jsonb->>'customer'=p_customer::text and o.device_id::text=current_setting('mk.offline.device',true) and h->>'product_id'=p_product::text;
$$;
revoke all on function public.house_snapshot_override(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Existing atomic stock and FIFO custody posting, with server-owned item pricing.
create or replace function public.post_trip_visit_core(p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,p_payment jsonb,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_trip public.trips; v_item record; v_product public.products; v_location uuid;
  v_visit uuid:=gen_random_uuid(); v_line integer:=0; v_move uuid; v_custody integer; v_after bigint;
  v_price numeric(14,2); v_invoice uuid; v_value numeric(14,2):=0; v_reported numeric(14,2); v_selection text; v_reference text; v_free boolean; v_ref numeric(14,2); v_class text; v_policy jsonb;
begin
  perform public.ops_actor(false);
  if p_walk_name is null or length(p_walk_name)>120 or p_walk_phone is null or length(p_walk_phone)>40 or p_notes is null or length(p_notes)>2000
    or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100
    or p_payment is null or jsonb_typeof(p_payment)<>'object' then raise exception using errcode='22023',message='Invalid delivery details.'; end if;
  v_selection:=p_payment->>'selection';v_reference:=coalesce(p_payment->>'reference','');
  if v_selection is null or v_selection not in ('CASH','FONEPAY','UNPAID','PARTIAL','FREE_SUPPLY') or length(v_reference)>200
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
  perform public.finance_lock(p_customer);
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
    v_policy:=public.house_snapshot_override(p_key,p_trip,p_customer,v_product.id);
    v_free:=v_item.full_jars+v_item.cartons>0 and case when v_policy is not null then coalesce((v_policy->>'eligible')::boolean,false) else v_product.house_eligible and exists(select 1 from public.customers c where c.id=p_customer and c.supply_type='HOUSE' and c.house_status='APPROVED') end;
    v_ref:=case when v_policy is not null then public.finance_money(v_policy->>'reference_price') else coalesce(v_product.reference_price,v_product.default_price) end;
    v_class:=case when v_item.full_jars+v_item.cartons=0 then 'RETURN_ONLY' when v_free then 'FREE_SUPPLY' else 'SALE' end;
    v_price:=case when v_free then 0 else public.finance_price(p_customer,v_product.id) end;
    insert into public.visit_items(visit_id,product_id,full_jars,empty_jars,cartons,unit_price_snapshot,supply_classification,reference_price_snapshot) values(v_visit,v_product.id,v_item.full_jars,v_item.empty_jars,v_item.cartons,v_price,v_class,case when v_free then v_ref else 0 end);
    v_value:=v_value+v_price*(v_item.full_jars::numeric+v_item.cartons::numeric);
  end loop;
  if not (p_payment ? 'payments') then
  if v_selection='UNPAID' and coalesce(v_reported,0)<>0 then raise exception using errcode='22023',message='Unpaid instructions cannot report a collected amount.'; end if;
  if v_selection='PARTIAL' and (v_reported is null or v_reported<=0 or v_reported>=v_value) then raise exception using errcode='22023',message='Partial amount must be greater than zero and less than delivery value.'; end if;
  if v_reported>v_value then raise exception using errcode='22023',message='Reported amount exceeds delivery value.'; end if;
  end if;
  -- Store the computed value without updating the immutable visit header.
  insert into public.delivery_value_snapshots(visit_id,value) values(v_visit,v_value);
  if v_value=0 and exists(select 1 from public.visit_items where visit_id=v_visit and supply_classification='FREE_SUPPLY') then
    if coalesce(v_reported,0)<>0 or (p_payment ? 'payments' and p_payment->'payments'<>'[]'::jsonb) then raise exception using errcode='22023',message='No payment required for free supply. Record separate collections separately.';end if;
    v_selection:='FREE_SUPPLY';
  elsif v_selection='FREE_SUPPLY' then raise exception using errcode='22023',message='Approved HOUSE status and eligible products are required for free delivery.';end if;
  insert into public.delivery_payment_intents(visit_id,selection,reported_amount,reference) values(v_visit,v_selection,v_reported,btrim(v_reference));
  v_invoice:=public.finance_issue_visit(v_visit,p_payment,p_key);
  return public.ops_finish(p_key,v_payload,v_visit,'DELIVERY_POSTED','trip_visits',null,jsonb_build_object('trip_id',p_trip,'items',p_items,'value',v_value,'invoice_id',v_invoice),'Atomic delivery, invoice and payment posting');
end;
$$;

-- Zero-value delivery documents create neither credit nor money receipts.
create or replace function public.finance_issue_visit_core(p_visit uuid,p_payment jsonb,p_key uuid) returns uuid language plpgsql set search_path='' as $$
declare v_v public.trip_visits; v_t public.trips; v_company public.billing_company; v_customer jsonb;
  v_sale uuid:=gen_random_uuid(); v_invoice uuid:=gen_random_uuid(); v_subtotal numeric; v_tax numeric; v_total numeric;
  v_date date; v_due date; v_pay jsonb; v_selection text:=p_payment->>'selection'; v_received numeric;
begin
 select * into strict v_v from public.trip_visits where id=p_visit;
 select * into strict v_t from public.trips where id=v_v.trip_id;
 perform public.finance_lock(v_v.customer_id);
 select * into strict v_company from public.billing_company where id for share;
 select date_label into strict v_date from public.business_days where id=v_t.business_day_id;
 if v_v.customer_id is null then v_customer:=jsonb_build_object('name',v_v.walk_in_name,'phone',v_v.walk_in_phone,'address','','shop_name','');
 else
   select jsonb_build_object('name',name,'shop_name',shop_name,'phone',phone,'address',address) into strict v_customer from public.customers where id=v_v.customer_id;
   select v_date+due_days into v_due from public.customer_billing where customer_id=v_v.customer_id;
 end if;
 insert into public.sales(id,visit_id,customer_id,trip_id,driver_id,vehicle_id,business_day_id,actor_user_id,supply_classification)
   values(v_sale,p_visit,v_v.customer_id,v_t.id,v_t.driver_id,v_t.vehicle_id,v_t.business_day_id,auth.uid(),case when exists(select 1 from public.visit_items where visit_id=p_visit and supply_classification='FREE_SUPPLY') then case when exists(select 1 from public.visit_items where visit_id=p_visit and supply_classification='SALE') then 'MIXED' else 'FREE_SUPPLY' end else 'SALE' end);
 insert into public.sale_items(sale_id,product_id,name,sku,unit,quantity,unit_price,total,supply_classification,reference_price_snapshot)
   select v_sale,p.id,p.name,p.sku,p.unit,i.full_jars+i.cartons,i.unit_price_snapshot,(i.full_jars::numeric+i.cartons::numeric)*i.unit_price_snapshot,i.supply_classification,i.reference_price_snapshot
   from public.visit_items i join public.products p on p.id=i.product_id where i.visit_id=p_visit and i.full_jars+i.cartons>0;
 select coalesce(sum(total),0) into v_subtotal from public.sale_items where sale_id=v_sale;
 v_tax:=case when v_company.tax_mode='EXPLICIT' then round(v_subtotal*v_company.tax_rate/100,2) else 0 end;v_total:=v_subtotal+v_tax;
 insert into public.invoices(id,sale_id,company,customer,date_label,due_date,subtotal,tax,total)
   values(v_invoice,v_sale,to_jsonb(v_company)||jsonb_build_object('tax_rate',v_company.tax_rate::text),v_customer,v_date,v_due,v_subtotal,v_tax,v_total);
 if v_v.customer_id is not null and v_total>0 then insert into public.customer_ledger(customer_id,invoice_id,source_id,kind,amount,business_day_id,actor_user_id)
   values(v_v.customer_id,v_invoice,v_invoice,'INVOICE',v_total,v_t.business_day_id,auth.uid()); end if;
 perform public.finance_post('INVOICE',v_invoice,v_t.business_day_id,jsonb_build_object('RECEIVABLE',v_total,'SALES',-v_subtotal,'TAX_PAYABLE',-v_tax));
 if p_payment ? 'payments' then
   if jsonb_typeof(p_payment->'payments')<>'array' or jsonb_array_length(p_payment->'payments')>10 then raise exception using errcode='22023',message='Invalid payment list.'; end if;
   for v_pay in select value from jsonb_array_elements(p_payment->'payments') loop
     perform public.finance_payment(v_t,v_v.customer_id,v_pay,p_key,v_invoice);
   end loop;
 else
   -- Legacy callers still work; cash defaults to the exact invoice total. Fonepay is always pending.
   v_received:=coalesce(public.finance_money(coalesce(p_payment->>'reported_amount',v_total::text)),0);
   if v_selection<>'UNPAID' and v_received>0 then
     perform public.finance_payment(v_t,v_v.customer_id,jsonb_build_object('method',case when v_selection='FONEPAY' then 'FONEPAY' else 'CASH' end,
       'amount',v_received::text,'current_amount',v_received::text,'reference',coalesce(p_payment->>'reference','')),p_key,v_invoice);
   end if;
 end if;
 if v_v.customer_id is null and public.finance_invoice_balance(v_invoice,true)>0 then raise exception using errcode='22023',message='Walk-in invoice must be fully covered by cash or pending Fonepay.'; end if;
 if public.finance_invoice_balance(v_invoice,false)>0 then insert into public.credit_issued(invoice_id,amount) values(v_invoice,public.finance_invoice_balance(v_invoice,false));end if;
 return v_invoice;
end $$;

create or replace function public.post_driver_delivery(
  p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,
  p_status text,p_received text,p_notes text,p_key uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_received numeric(14,2):=0; v_payment jsonb; v_visit uuid;
  v_invoice public.invoices; v_sale boolean;
begin
  perform public.ops_actor(false);
  if p_status is null or p_status not in ('PAID','CREDIT','RETURN_ONLY','FREE_SUPPLY') then
    raise exception using errcode='22023',message='Choose Paid or Credit.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception using errcode='22023',message='Invalid delivery details.';
  end if;
  select coalesce(bool_or(x.full_jars>0 or x.cartons>0),false) into v_sale
    from jsonb_to_recordset(p_items) as x(full_jars integer,cartons integer);
  if (p_status='RETURN_ONLY')=v_sale then
    raise exception using errcode='22023',message='Payment status does not match the delivery.';
  end if;
  if p_status='PAID' then
    if p_received is null or p_received !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
      raise exception using errcode='22023',message='Enter the total amount received.';
    end if;
    v_received:=p_received::numeric;
  elsif coalesce(p_received,'') not in ('','0','0.00') then
    raise exception using errcode='22023',message='Credit or return-only visits cannot collect a new payment.';
  end if;
  if p_status='CREDIT' and p_customer is null then
    raise exception using errcode='22023',message='Credit requires a registered customer.';
  end if;
  v_payment:=jsonb_build_object('selection',case when p_status='FREE_SUPPLY' then 'FREE_SUPPLY' when p_status='CREDIT' then 'UNPAID' else 'CASH' end,
    'reported_amount',null,'reference','','driver_status',p_status,'received',v_received::text,
    'payments',case when v_received>0 then jsonb_build_array(jsonb_build_object(
      'method','CASH','amount',v_received::text,'current_amount',v_received::text,
      'deposit_amount','0.00','reference','','allocations','[]'::jsonb)) else '[]'::jsonb end);
  v_visit:=public.post_trip_visit(p_trip,p_customer,p_walk_name,p_walk_phone,p_items,v_payment,p_notes,p_key);
  select i.* into v_invoice from public.invoices i join public.sales s on s.id=i.sale_id where s.visit_id=v_visit;
  if p_status='PAID' and (v_invoice.id is null or v_invoice.total<>v_received) then
    raise exception using errcode='22023',message='Total amount received must equal the payable total.';
  end if;
  if p_status='FREE_SUPPLY' and (v_invoice.id is null or v_invoice.total<>0 or not exists(select 1 from public.sales where visit_id=v_visit and supply_classification='FREE_SUPPLY')) then
    raise exception using errcode='22023',message='Approved HOUSE status and eligible products are required for free delivery.';end if;
  return v_visit;
end $$;

create or replace function public.save_customer_contact_online_core(p_trip uuid,p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_version integer,p_duplicate_confirmed boolean,p_key uuid,p_details jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_old public.customers; v_new public.customers; v_phone text; v_lock text; v_exists boolean;
begin
 perform public.ops_actor(false);
 if p_details is not null and (jsonb_typeof(p_details)<>'object' or p_details-array['contact_person','customer_type','delivery_notes','supply_type']<>'{}'::jsonb
   or jsonb_typeof(p_details->'contact_person') is distinct from 'string' or length(p_details->>'contact_person')>120
   or jsonb_typeof(p_details->'customer_type') is distinct from 'string' or length(p_details->>'customer_type')>80
   or jsonb_typeof(p_details->'delivery_notes') is distinct from 'string' or length(p_details->>'delivery_notes')>2000) then
   raise exception using errcode='22023',message='Enter valid customer contact details.'; end if;
 if p_details ? 'supply_type' and coalesce(p_details->>'supply_type','') not in ('REGULAR','HOUSE') then raise exception using errcode='22023',message='Choose Regular Customer or HOUSE.';end if;
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
 if p_details ? 'supply_type' then
   if v_exists and v_old.supply_type='HOUSE' and p_details->>'supply_type'<>'HOUSE' and not public.is_active_admin() then
     raise exception using errcode='42501',message='Only admin can change HOUSE privileges.';end if;
   update public.customers set supply_type=p_details->>'supply_type',house_status=case
     when p_details->>'supply_type'='REGULAR' then 'NONE'
     when not v_exists or v_old.supply_type<>'HOUSE' then 'PENDING' else v_old.house_status end where id=p_id returning * into v_new;
 end if;
 return public.ops_finish(p_key,v_payload,p_id,case when v_exists then 'CUSTOMER_CONTACT_UPDATED' else 'CUSTOMER_CREATED' end,'customers',
   case when v_exists then to_jsonb(v_old) end,to_jsonb(v_new)||jsonb_build_object('trip_id',p_trip,'duplicate_confirmed',p_duplicate_confirmed),
   case when v_exists then 'Contact updated during delivery' else 'Customer registered during delivery' end);
end $$;

create or replace function public.delivery_customer_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_admin boolean;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception using errcode='42501',message='Active account required.'; end if;
 v_admin:=public.is_active_admin();
 return coalesce((select jsonb_agg(case when v_admin then to_jsonb(c)||jsonb_build_object('created_by_name',(select name from public.profiles where id=c.created_by))
   else jsonb_build_object('id',c.id,'name',c.name,'shop_name',c.shop_name,'phone',c.phone,'address',c.address,'contact_person',c.contact_person,
     'customer_type',c.customer_type,'supply_type',c.supply_type,'house_status',c.house_status,'house_version',c.house_version,'delivery_notes',c.delivery_notes,'is_active',c.is_active,'version',c.version,'notes','') end order by c.name,c.id)
   from public.customers c where v_admin or (c.is_active and public.can_search_delivery_customers()) or public.can_read_customer(c.id)),'[]'::jsonb);
end $$;

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
    select t.*,v.plate_number,p.name as driver_name,d.date_label from public.trips t
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

create or replace function public.finance_json(p_row jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;
begin
  foreach k in array array['reference_price_snapshot','free_value_snapshot','price','unit_price','total','subtotal','tax','amount','deposit_amount','subtotal_delta','tax_delta','tax_rate'] loop
    if p_row ? k and p_row->>k is not null then p_row:=jsonb_set(p_row,array[k],to_jsonb(p_row->>k));end if;
  end loop;
  return p_row;
end $$;

alter function public.delivery_customer_context(uuid,uuid) rename to delivery_customer_context_before_house;
create function public.delivery_customer_context(p_trip uuid,p_customer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jsonb;
begin
 j:=public.delivery_customer_context_before_house(p_trip,p_customer);
 return j||jsonb_build_object('house_products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'house_eligible',p.house_eligible,'house_version',p.house_version,'reference_price',coalesce(p.reference_price,p.default_price)::text)) from public.products p),'[]'::jsonb),
 'free_deliveries',public.house_delivery_rows(p_customer,null,null,null,null));
end $$;
revoke all on function public.delivery_customer_context_before_house(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.delivery_customer_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delivery_customer_context(uuid,uuid) to authenticated;

-- Conflict evidence remains immutable; retries never convert free supply to paid.
create or replace function public.offline_post(p_trip uuid,p_device uuid,p_token text,p_id uuid,p_sequence integer,p_kind text,p_occurred timestamptz,p_payload text,p_fingerprint text) returns jsonb
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

create or replace function public.offline_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or tg_table_name='driver_offline_reviews' then raise exception using errcode='42501',message='Offline evidence is immutable.';end if;
 if old.status='CONFIRMED' or
  (to_jsonb(old)-array['resolution_house','status','message','resolution_customer','resolution_accept_custody','result_id','customer_id','processed_at']) is distinct from
  (to_jsonb(new)-array['resolution_house','status','message','resolution_customer','resolution_accept_custody','result_id','customer_id','processed_at']) then
  raise exception using errcode='42501',message='Offline evidence is immutable.';
 end if; return new;
end $$;

create or replace function public.offline_admin_review(p_id uuid,p_action text,p_customer uuid,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.driver_offline_operations; v_retry uuid; v_payload jsonb;
begin
 perform public.ops_actor(true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 or p_action is null or p_action not in ('RETRY','MATCH_CUSTOMER','REBASE_CUSTODY','AUTHORIZE_HOUSE','REJECT') then
  raise exception using errcode='22023',message='Select a review action and enter a reason.';end if;
 v_payload:=jsonb_build_object('operation','OFFLINE_REVIEW','id',p_id,'action',p_action,'customer',p_customer,'reason',p_reason);
 v_retry:=public.ops_retry(p_key,v_payload);if v_retry is not null then return v_retry;end if;
 select * into o from public.driver_offline_operations where id=p_id for update;
 if not found or o.status not in ('NEEDS_REVIEW','REJECTED') then raise exception using errcode='22023',message='Select an unresolved offline record.';end if;
 if p_action='AUTHORIZE_HOUSE' and (o.kind<>'DELIVERY' or jsonb_typeof(o.payload::jsonb->'house') is distinct from 'object') then raise exception using errcode='22023',message='Select an original HOUSE delivery for authorization.';end if;
 if p_action='REBASE_CUSTODY' and o.kind<>'DELIVERY' then raise exception using errcode='22023',message='Select a delivery for jar-balance review.';end if;
 if p_action='MATCH_CUSTOMER' then
  if o.kind<>'CUSTOMER' or not exists(select 1 from public.customers where id=p_customer and is_active) then raise exception using errcode='22023',message='Select an active matching customer.';end if;
 end if;
 update public.driver_offline_operations set status=case when p_action='REJECT' then 'REJECTED' else 'RETRYABLE' end,
  resolution_house=case when p_action='REJECT' then false else resolution_house or p_action='AUTHORIZE_HOUSE' end,
  resolution_customer=case when p_action='MATCH_CUSTOMER' then p_customer else resolution_customer end,
  resolution_accept_custody=resolution_accept_custody or p_action='REBASE_CUSTODY',
  message=case when p_action='REJECT' then 'Admin rejected this record. Preserve it for recovery.' else null end where id=p_id;
 insert into public.driver_offline_reviews(operation_id,trip_id,actor_id,action,details,reason) values(p_id,o.trip_id,auth.uid(),p_action,jsonb_build_object('customer',p_customer,'original_payload',o.payload,'accept_current_custody',p_action='REBASE_CUSTODY'),btrim(p_reason));
 return public.ops_finish(p_key,v_payload,p_id,'OFFLINE_REVIEWED','driver_offline_operations',to_jsonb(o),jsonb_build_object('action',p_action,'customer',p_customer),p_reason);
end $$;

-- Live daily reports and NEW closing archives include free supply separately.
-- Previously archived JSON is never changed.
alter function public.day_report_data(uuid) rename to day_report_data_before_house;
create function public.day_report_data(p_day uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jsonb; totals jsonb; free_rows jsonb;
begin
 j:=public.day_report_data_before_house(p_day);
 select jsonb_build_object('free_jars',coalesce(sum(i.full_jars),0),'free_cartons',coalesce(sum(i.cartons),0),'free_supply_value',coalesce(sum(i.free_value_snapshot),0)::text)
 into totals from public.visit_items i join public.trip_visits v on v.id=i.visit_id where v.business_day_id=p_day and i.supply_classification='FREE_SUPPLY';
 totals:=totals||jsonb_build_object('free_supply_adjustments',coalesce((select sum(amount) from public.free_supply_adjustments where business_day_id=p_day),0)::text,
 'paid_sales',coalesce((select sum(i.total-coalesce(ci.amount,0)) from public.invoices i join public.sales s on s.id=i.sale_id left join public.credit_issued ci on ci.invoice_id=i.id where s.business_day_id=p_day),0)::text);
 return jsonb_set(j,'{totals}',j->'totals'||totals);
end $$;
revoke all on function public.day_report_data_before_house(uuid),public.day_report_data(uuid) from public,anon,authenticated,service_role;

-- Extended driver request signature is additive; old clients retain contact-only semantics.
create function public.request_house_contact(p_trip uuid,p_id uuid,p_name text,p_shop text,p_phone text,p_address text,p_version integer,p_duplicate_confirmed boolean,p_key uuid,p_contact_person text,p_customer_type text,p_delivery_notes text,p_supply_type text) returns uuid
language sql security definer set search_path='' as $$
 select public.save_customer_contact(p_trip,p_id,p_name,p_shop,p_phone,p_address,p_version,p_duplicate_confirmed,p_key,jsonb_build_object('contact_person',p_contact_person,'customer_type',p_customer_type,'delivery_notes',p_delivery_notes,'supply_type',p_supply_type));
$$;
revoke all on function public.request_house_contact(uuid,uuid,text,text,text,text,integer,boolean,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_house_contact(uuid,uuid,text,text,text,text,integer,boolean,uuid,text,text,text,text) to authenticated;

alter function public.customer_delivery_history(uuid) rename to customer_delivery_history_before_house;
create function public.customer_delivery_history(p_customer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jsonb;
begin
 j:=public.customer_delivery_history_before_house(p_customer);
 return coalesce((select jsonb_agg(x||jsonb_build_object('supply_classification',coalesce(s.supply_classification,'RETURN_ONLY'),'free_value',coalesce((select sum(free_value_snapshot) from public.visit_items where visit_id=(x->>'id')::uuid),0)::text,'driver_name',pr.name,'created_at',coalesce(v.offline_occurred_at,v.created_at)) order by coalesce(v.offline_occurred_at,v.created_at) desc)
 from jsonb_array_elements(j) x join public.trip_visits v on v.id=(x->>'id')::uuid join public.trips t on t.id=v.trip_id join public.profiles pr on pr.id=t.driver_id left join public.sales s on s.visit_id=v.id),'[]'::jsonb);
end $$;
revoke all on function public.customer_delivery_history_before_house(uuid),public.customer_delivery_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_delivery_history(uuid) to authenticated;

-- Free reference corrections use their own audited ledger; financial adjustments
-- cannot manufacture a receivable on a fully free delivery document.
create or replace function public.finance_command(p_operation text,p_data jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if p_operation='ADJUST' and exists(select 1 from public.invoices i join public.sales s on s.id=i.sale_id where i.id=(p_data->>'invoice')::uuid and s.supply_classification='FREE_SUPPLY') then
  raise exception using errcode='22023',message='Use the audited free supply correction for reference values.';end if;
 if p_operation='PAYMENT' then perform public.offline_gate((p_data->>'trip')::uuid);end if;
 return public.finance_command_online_core(p_operation,p_data,p_key);
end $$;
