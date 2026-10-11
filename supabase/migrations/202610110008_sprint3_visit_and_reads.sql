-- Replace only the visit RPC; stock, custody, reconciliation and identities are preserved.
create or replace function public.post_trip_visit(p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,p_payment jsonb,p_notes text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_trip public.trips; v_item record; v_product public.products; v_location uuid;
  v_visit uuid:=gen_random_uuid(); v_line integer:=0; v_move uuid; v_custody integer; v_after bigint;
  v_price numeric(14,2); v_invoice uuid; v_value numeric(14,2):=0; v_reported numeric(14,2); v_selection text; v_reference text;
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
    v_price:=public.finance_price(p_customer,v_product.id);
    insert into public.visit_items(visit_id,product_id,full_jars,empty_jars,cartons,unit_price_snapshot) values(v_visit,v_product.id,v_item.full_jars,v_item.empty_jars,v_item.cartons,v_price);
    v_value:=v_value+v_price*(v_item.full_jars::numeric+v_item.cartons::numeric);
  end loop;
  if not (p_payment ? 'payments') then
  if v_selection='UNPAID' and coalesce(v_reported,0)<>0 then raise exception using errcode='22023',message='Unpaid instructions cannot report a collected amount.'; end if;
  if v_selection='PARTIAL' and (v_reported is null or v_reported<=0 or v_reported>=v_value) then raise exception using errcode='22023',message='Partial amount must be greater than zero and less than delivery value.'; end if;
  if v_reported>v_value then raise exception using errcode='22023',message='Reported amount exceeds delivery value.'; end if;
  end if;
  -- Store the computed value without updating the immutable visit header.
  insert into public.delivery_value_snapshots(visit_id,value) values(v_visit,v_value);
  insert into public.delivery_payment_intents(visit_id,selection,reported_amount,reference) values(v_visit,v_selection,v_reported,btrim(v_reference));
  v_invoice:=public.finance_issue_visit(v_visit,p_payment,p_key);
  return public.ops_finish(p_key,v_payload,v_visit,'DELIVERY_POSTED','trip_visits',null,jsonb_build_object('trip_id',p_trip,'items',p_items,'value',v_value,'invoice_id',v_invoice),'Atomic delivery, invoice and payment posting');
end;
$$;

-- Monetary values cross the JSON boundary as decimal strings, never JS floating-point numbers.
create function public.finance_json(p_row jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;
begin
  foreach k in array array['price','unit_price','total','subtotal','tax','amount','deposit_amount','subtotal_delta','tax_delta','tax_rate'] loop
    if p_row ? k and p_row->>k is not null then p_row:=jsonb_set(p_row,array[k],to_jsonb(p_row->>k));end if;
  end loop;
  return p_row;
end $$;
create function public.finance_credit(p_customer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.finance_customer_access(p_customer) then raise exception using errcode='42501',message='Customer credit is outside the assigned route.';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number::text,'customer_id',s.customer_id,
    'date_label',i.date_label,'due_date',i.due_date,'outstanding',public.finance_invoice_balance(i.id,false)::text,
    'available',public.finance_invoice_balance(i.id,true)::text)) from public.invoices i join public.sales s on s.id=i.sale_id
    where s.customer_id=p_customer and public.finance_invoice_balance(i.id,false)>0),'[]'::jsonb);
end $$;
create function public.finance_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_admin boolean; v_result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception using errcode='42501',message='Active account required.';end if;
  v_admin:=public.is_active_admin();
  select jsonb_build_object(
    'company',(select public.finance_json(to_jsonb(c.*)) from public.billing_company c),
    'billing',coalesce((select jsonb_agg(to_jsonb(b.*)) from public.customer_billing b where public.finance_customer_access(b.customer_id)),'[]'::jsonb),
    'prices',coalesce((select jsonb_agg(public.finance_json(to_jsonb(p.*))) from public.customer_prices p where public.finance_customer_access(p.customer_id)),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(to_jsonb(s.*)) from public.sales s where public.can_read_trip(s.trip_id)),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(public.finance_json(to_jsonb(si.*))) from public.sale_items si join public.sales s on s.id=si.sale_id where public.can_read_trip(s.trip_id)),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(public.finance_json(to_jsonb(i.*))||jsonb_build_object('number',i.number::text,
      'outstanding',public.finance_invoice_balance(i.id,false)::text,'available',public.finance_invoice_balance(i.id,true)::text))
      from public.invoices i join public.sales s on s.id=i.sale_id where public.can_read_trip(s.trip_id)),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(public.finance_json(to_jsonb(p.*))||jsonb_build_object('number',p.number::text,'status',public.finance_state(p.id)))
      from public.payments p where public.can_read_trip(p.trip_id)),'[]'::jsonb),
    'allocations',coalesce((select jsonb_agg(public.finance_json(to_jsonb(a.*))) from public.payment_allocations a join public.payments p on p.id=a.payment_id where public.can_read_trip(p.trip_id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e.*)) from public.payment_verification_events e join public.payments p on p.id=e.payment_id where public.can_read_trip(p.trip_id)),'[]'::jsonb),
    'adjustments',coalesce((select jsonb_agg(public.finance_json(to_jsonb(a.*))) from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id join public.sales s on s.id=i.sale_id where public.can_read_trip(s.trip_id)),'[]'::jsonb),
    'credit',coalesce((select jsonb_agg(x.item) from public.customers c cross join lateral jsonb_array_elements(case when public.finance_customer_access(c.id) then public.finance_credit(c.id) else '[]'::jsonb end) x(item) where public.finance_customer_access(c.id)),'[]'::jsonb),
    'deposits',coalesce((select jsonb_agg(public.finance_json(to_jsonb(d.*))) from public.deposit_transactions d where v_admin or exists(select 1 from public.payments p where p.id=d.payment_id and public.can_read_trip(p.trip_id))),'[]'::jsonb),
    'ledger',case when v_admin then coalesce((select jsonb_agg(public.finance_json(to_jsonb(l.*))) from public.customer_ledger l),'[]'::jsonb) else '[]'::jsonb end,
    'journal',case when v_admin then coalesce((select jsonb_agg(public.finance_json(to_jsonb(j.*))) from public.finance_journal j),'[]'::jsonb) else '[]'::jsonb end,
    'issued',coalesce((select jsonb_agg(public.finance_json(to_jsonb(c.*))) from public.credit_issued c join public.invoices i on i.id=c.invoice_id join public.sales s on s.id=i.sale_id where public.can_read_trip(s.trip_id)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.finance_json(jsonb),public.finance_credit(uuid),public.finance_workspace() from public,anon,authenticated,service_role;
grant execute on function public.finance_credit(uuid),public.finance_workspace() to authenticated;
-- post_trip_visit retains its original authenticated grant after CREATE OR REPLACE.

