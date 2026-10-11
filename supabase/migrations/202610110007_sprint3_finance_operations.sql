-- Internal helpers are revoked below. Public mutations authenticate independently.
create function public.finance_money(p_value text) returns numeric language plpgsql immutable set search_path='' as $$
begin
  if p_value is null or p_value !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception using errcode='22023',message='Enter a nonnegative amount with at most two decimals.'; end if;
  return p_value::numeric(14,2);
end $$;
create function public.finance_day(p_day uuid) returns void language plpgsql set search_path='' as $$
begin
  perform 1 from public.business_days where id=p_day and status='OPEN' for share;
  if not found then raise exception using errcode='22023',message='An OPEN business day is required.'; end if;
end $$;
create function public.finance_lock(p_customer uuid) returns void language plpgsql set search_path='' as $$
begin
  if p_customer is not null then perform pg_advisory_xact_lock(hashtextextended('finance-customer:'||p_customer::text,0)); end if;
end $$;
create function public.finance_state(p_payment uuid) returns text language sql stable set search_path='' as $$
 select status from public.payment_verification_events where payment_id=p_payment order by sequence desc limit 1;
$$;
create function public.finance_invoice_balance(p_invoice uuid,p_pending boolean) returns numeric language sql stable set search_path='' as $$
 select i.total+coalesce((select sum(subtotal_delta+tax_delta) from public.invoice_adjustments where invoice_id=i.id),0)
 -coalesce((select sum(a.amount) from public.payment_allocations a where a.invoice_id=i.id
   and (public.finance_state(a.payment_id)='CONFIRMED' or (p_pending and public.finance_state(a.payment_id)='PENDING'))),0)
 from public.invoices i where i.id=p_invoice;
$$;
create function public.finance_post(p_kind text,p_source uuid,p_day uuid,p_lines jsonb) returns void language plpgsql set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_account text; v_amount text;
begin
  if (select sum(value::numeric) from jsonb_each_text(p_lines))<>0 then raise exception 'Unbalanced finance posting'; end if;
  for v_account,v_amount in select * from jsonb_each_text(p_lines) loop
    if v_amount::numeric<>0 then insert into public.finance_journal(posting_id,source_id,kind,account,amount,business_day_id,actor_user_id)
      values(v_id,p_source,p_kind,v_account,v_amount::numeric,p_day,auth.uid()); end if;
  end loop;
end $$;
create function public.finance_price(p_customer uuid,p_product uuid) returns numeric language sql stable set search_path='' as $$
 select coalesce((select price from public.customer_prices where customer_id=p_customer and product_id=p_product and active),p.default_price)
 from public.products p where id=p_product;
$$;
create function public.finance_recognize(p_payment uuid,p_day uuid,p_reverse boolean) returns void language plpgsql set search_path='' as $$
declare v_p public.payments; v_a record; v_alloc numeric; v_sign integer:=case when p_reverse then -1 else 1 end;
  v_kind text:=case when p_reverse then 'REVERSAL' else 'PAYMENT' end;
begin
 select * into strict v_p from public.payments where id=p_payment;
 select coalesce(sum(amount),0) into v_alloc from public.payment_allocations where payment_id=p_payment;
 for v_a in select * from public.payment_allocations where payment_id=p_payment loop
   if v_p.customer_id is not null then
     insert into public.customer_ledger(customer_id,invoice_id,source_id,kind,amount,business_day_id,actor_user_id)
       values(v_p.customer_id,v_a.invoice_id,p_payment,v_kind,-v_sign*v_a.amount,p_day,auth.uid());
   end if;
 end loop;
 if v_p.deposit_amount>0 then
   if p_reverse and coalesce((select sum(amount) from public.deposit_transactions where customer_id=v_p.customer_id),0)<v_p.deposit_amount then
     raise exception using errcode='22023',message='Deposit already refunded; resolve it before reversing this receipt.';
   end if;
   insert into public.deposit_transactions(customer_id,payment_id,source_id,kind,amount,reason,business_day_id,actor_user_id)
     values(v_p.customer_id,p_payment,p_payment,case when p_reverse then 'REVERSAL' else 'RECEIPT' end,
       v_sign*v_p.deposit_amount,case when p_reverse then 'Receipt reversed' else 'Explicit refundable deposit received' end,p_day,auth.uid());
 end if;
 perform public.finance_post(v_kind,p_payment,p_day,jsonb_build_object(v_p.method,v_sign*v_p.amount,'RECEIVABLE',-v_sign*v_alloc,'DEPOSIT_LIABILITY',-v_sign*v_p.deposit_amount));
end $$;
create function public.finance_payment(p_trip public.trips,p_customer uuid,p_data jsonb,p_key uuid,p_current uuid default null) returns uuid
language plpgsql set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_amount numeric:=public.finance_money(p_data->>'amount');
  v_deposit numeric:=public.finance_money(coalesce(p_data->>'deposit_amount','0')); v_method text:=p_data->>'method';
  v_alloc jsonb:=coalesce(p_data->'allocations','[]'::jsonb); v_item record; v_owner uuid; v_total numeric:=0; v_current numeric;
begin
 if v_method is null or v_method not in ('CASH','FONEPAY') or v_amount<=0 or v_deposit>v_amount
   or length(coalesce(p_data->>'reference',''))>200 or jsonb_typeof(v_alloc)<>'array' or jsonb_array_length(v_alloc)>200 then
   raise exception using errcode='22023',message='Invalid payment details.'; end if;
 perform public.finance_lock(p_customer);
 if p_current is not null then
   v_current:=public.finance_money(coalesce(p_data->>'current_amount','0'));
   if v_current>0 then v_alloc:=v_alloc||jsonb_build_array(jsonb_build_object('invoice_id',p_current,'amount',v_current::text)); end if;
 end if;
 if exists(select 1 from jsonb_to_recordset(v_alloc) as x(invoice_id uuid) group by invoice_id having count(*)>1) then
   raise exception using errcode='22023',message='Allocate each invoice once.'; end if;
 for v_item in select * from jsonb_to_recordset(v_alloc) as x(invoice_id uuid,amount text) order by invoice_id loop
   if public.finance_money(v_item.amount)<=0 then raise exception using errcode='22023',message='Allocation must be positive.'; end if;
   select s.customer_id into v_owner from public.invoices i join public.sales s on s.id=i.sale_id where i.id=v_item.invoice_id for update of i;
   if not found or v_owner is distinct from p_customer or (p_customer is null and v_item.invoice_id is distinct from p_current) then
     raise exception using errcode='42501',message='Invoice does not belong to this customer.'; end if;
   if public.finance_money(v_item.amount)>public.finance_invoice_balance(v_item.invoice_id,true) then
     raise exception using errcode='22023',message='Payment exceeds available invoice balance, including pending reservations.'; end if;
   v_total:=v_total+public.finance_money(v_item.amount);
 end loop;
 if v_total+v_deposit<>v_amount then raise exception using errcode='22023',message='Payment must exactly equal invoice allocations plus deposit.'; end if;
 if v_deposit>0 and (p_customer is null or not exists(select 1 from public.customer_billing where customer_id=p_customer and deposit_mode='MANUAL')) then
   raise exception using errcode='22023',message='Admin must configure a manual deposit arrangement first.'; end if;
 insert into public.payments(id,customer_id,trip_id,current_invoice_id,company_snapshot,customer_snapshot,business_day_id,actor_user_id,method,amount,deposit_amount,reference,request_key)
   values(v_id,p_customer,p_trip.id,p_current,(select to_jsonb(c.*)||jsonb_build_object('tax_rate',c.tax_rate::text) from public.billing_company c),
     coalesce((select jsonb_build_object('name',name,'shop_name',shop_name,'phone',phone,'address',address) from public.customers where id=p_customer),
       (select customer from public.invoices where id=p_current)),
     p_trip.business_day_id,auth.uid(),v_method,v_amount,v_deposit,coalesce(p_data->>'reference',''),p_key);
 insert into public.payment_allocations(payment_id,invoice_id,amount) select v_id,x.invoice_id,public.finance_money(x.amount) from jsonb_to_recordset(v_alloc) as x(invoice_id uuid,amount text);
 insert into public.payment_verification_events(payment_id,status,source,reference,evidence,business_day_id,actor_user_id)
   values(v_id,case when v_method='CASH' then 'CONFIRMED' else 'PENDING' end,case when v_method='CASH' then 'CASH_RECORDED' else 'AWAITING_PROVIDER' end,
     coalesce(p_data->>'reference',''),case when v_method='CASH' then 'Cash receipt recorded by authorized operator' else 'Reference is unverified; confirmation required' end,p_trip.business_day_id,auth.uid());
 if v_method='CASH' then perform public.finance_recognize(v_id,p_trip.business_day_id,false); end if;
 return v_id;
end $$;
create function public.finance_issue_visit(p_visit uuid,p_payment jsonb,p_key uuid) returns uuid language plpgsql set search_path='' as $$
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
 insert into public.sales(id,visit_id,customer_id,trip_id,driver_id,vehicle_id,business_day_id,actor_user_id)
   values(v_sale,p_visit,v_v.customer_id,v_t.id,v_t.driver_id,v_t.vehicle_id,v_t.business_day_id,auth.uid());
 insert into public.sale_items(sale_id,product_id,name,sku,unit,quantity,unit_price,total)
   select v_sale,p.id,p.name,p.sku,p.unit,i.full_jars+i.cartons,i.unit_price_snapshot,(i.full_jars::numeric+i.cartons::numeric)*i.unit_price_snapshot
   from public.visit_items i join public.products p on p.id=i.product_id where i.visit_id=p_visit and i.full_jars+i.cartons>0;
 select coalesce(sum(total),0) into v_subtotal from public.sale_items where sale_id=v_sale;
 v_tax:=case when v_company.tax_mode='EXPLICIT' then round(v_subtotal*v_company.tax_rate/100,2) else 0 end;v_total:=v_subtotal+v_tax;
 insert into public.invoices(id,sale_id,company,customer,date_label,due_date,subtotal,tax,total)
   values(v_invoice,v_sale,to_jsonb(v_company)||jsonb_build_object('tax_rate',v_company.tax_rate::text),v_customer,v_date,v_due,v_subtotal,v_tax,v_total);
 if v_v.customer_id is not null then insert into public.customer_ledger(customer_id,invoice_id,source_id,kind,amount,business_day_id,actor_user_id)
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
 insert into public.credit_issued(invoice_id,amount) values(v_invoice,public.finance_invoice_balance(v_invoice,false));
 return v_invoice;
end $$;
-- One authenticated command boundary, with explicit operation allowlist and server-owned actor/day.
create function public.finance_command(p_operation text,p_data jsonb,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_retry uuid; v_payload jsonb:=jsonb_build_object('operation','FINANCE_'||p_operation,'data',p_data);
  v_id uuid; v_day uuid; v_customer uuid; v_trip public.trips; v_payment public.payments; v_invoice public.invoices;
  v_company public.billing_company; v_old jsonb; v_new jsonb; v_reason text; v_amount numeric; v_sub numeric; v_tax numeric; v_state text;
begin
 if p_operation is null or p_operation not in ('PAYMENT','VERIFY','REVERSE','REFUND','ADJUST','COMPANY','BILLING','PRICE')
   or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception using errcode='22023',message='Invalid finance operation.'; end if;
 perform public.ops_actor(p_operation<>'PAYMENT');
 v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
 v_reason:=coalesce(p_data->>'reason','');
 if p_operation<>'PAYMENT' and length(btrim(v_reason)) not between 3 and 500 then raise exception using errcode='22023',message='A specific reason is required.'; end if;
 if p_operation='PAYMENT' then
   v_trip:=public.ops_trip((p_data->>'trip')::uuid);v_customer:=(p_data->>'customer')::uuid;
   if v_trip.status<>'ACTIVE' then raise exception using errcode='22023',message='ACTIVE trip required for collection.'; end if;
   -- A rejected walk-in Fonepay receipt can be replaced only on its original ACTIVE trip.
   if v_customer is null then
     select i.* into v_invoice from public.invoices i join public.sales s on s.id=i.sale_id
       where i.id=(p_data->>'invoice')::uuid and s.customer_id is null and s.trip_id=v_trip.id;
     if not found then raise exception using errcode='42501',message='Walk-in collection requires its original trip invoice.';end if;
   end if;
   if v_customer is not null and not public.is_active_admin() and not exists(select 1 from public.trip_customers where trip_id=v_trip.id and customer_id=v_customer) then
     raise exception using errcode='42501',message='Customer is not assigned to this route.'; end if;
   v_id:=public.finance_payment(v_trip,v_customer,p_data,p_key,case when v_customer is null then v_invoice.id else null end);
 elsif p_operation in ('VERIFY','REVERSE') then
   select * into v_payment from public.payments where id=(p_data->>'payment')::uuid;
   if not found then raise exception using errcode='22023',message='Payment not found.'; end if;
   perform public.finance_lock(v_payment.customer_id);
   perform 1 from public.payments where id=v_payment.id for update;
   v_day:=(p_data->>'day')::uuid; perform public.finance_day(v_day);v_state:=public.finance_state(v_payment.id);v_id:=v_payment.id;
   if p_operation='VERIFY' then
     if v_payment.method<>'FONEPAY' or v_state<>'PENDING' or coalesce(p_data->>'decision','') not in ('CONFIRM','REJECT') then
       raise exception using errcode='22023',message='Only pending Fonepay can be reconciled.'; end if;
     if p_data->>'decision'='CONFIRM' and length(btrim(coalesce(p_data->>'reference',''))) not between 1 and 200 then
       raise exception using errcode='22023',message='Confirmed transaction reference is required.'; end if;
     insert into public.payment_verification_events(payment_id,status,source,reference,evidence,business_day_id,actor_user_id)
       values(v_id,case when p_data->>'decision'='CONFIRM' then 'CONFIRMED' else 'REJECTED' end,'ADMIN_MANUAL',btrim(coalesce(p_data->>'reference','')),v_reason,v_day,auth.uid());
     if p_data->>'decision'='CONFIRM' then perform public.finance_recognize(v_id,v_day,false); end if;
   else
     if v_state<>'CONFIRMED' then raise exception using errcode='22023',message='Only confirmed receipts can be reversed.'; end if;
     perform public.finance_recognize(v_id,v_day,true);
     insert into public.payment_verification_events(payment_id,status,source,evidence,business_day_id,actor_user_id)
       values(v_id,'REVERSED','ADMIN_REVERSAL',v_reason,v_day,auth.uid());
   end if;
 elsif p_operation='REFUND' then
   v_customer:=(p_data->>'customer')::uuid;perform public.finance_lock(v_customer);
   v_day:=(p_data->>'day')::uuid;perform public.finance_day(v_day);v_amount:=public.finance_money(p_data->>'amount');v_id:=gen_random_uuid();
   if v_amount<=0 or v_amount>coalesce((select sum(amount) from public.deposit_transactions where customer_id=v_customer),0) then
     raise exception using errcode='22023',message='Refund exceeds refundable deposit liability.'; end if;
   insert into public.deposit_transactions(id,customer_id,source_id,kind,amount,reason,business_day_id,actor_user_id)
     values(v_id,v_customer,v_id,'REFUND',-v_amount,v_reason,v_day,auth.uid());
   perform public.finance_post('DEPOSIT_REFUND',v_id,v_day,jsonb_build_object('DEPOSIT_LIABILITY',v_amount,'CASH',-v_amount));
 elsif p_operation='ADJUST' then
   select * into v_invoice from public.invoices where id=(p_data->>'invoice')::uuid;
   if not found then raise exception using errcode='22023',message='Invoice not found.'; end if;
   select customer_id into v_customer from public.sales where id=v_invoice.sale_id;
   perform public.finance_lock(v_customer);perform 1 from public.invoices where id=v_invoice.id for update;
   v_day:=(p_data->>'day')::uuid;perform public.finance_day(v_day);v_id:=gen_random_uuid();
   v_sub:=public.finance_money(p_data->>'subtotal_amount');v_tax:=public.finance_money(p_data->>'tax_amount');
   if coalesce(p_data->>'direction','') not in ('CREDIT','DEBIT') or v_sub+v_tax=0 then raise exception using errcode='22023',message='Invalid invoice adjustment.'; end if;
   if p_data->>'direction'='CREDIT' then v_sub:=-v_sub;v_tax:=-v_tax;end if;
   if v_invoice.subtotal+coalesce((select sum(subtotal_delta) from public.invoice_adjustments where invoice_id=v_invoice.id),0)+v_sub<0
     or v_invoice.tax+coalesce((select sum(tax_delta) from public.invoice_adjustments where invoice_id=v_invoice.id),0)+v_tax<0
     or public.finance_invoice_balance(v_invoice.id,true)+v_sub+v_tax<0 then
     raise exception using errcode='22023',message='Adjustment exceeds unsettled value; reverse receipts first.'; end if;
   insert into public.invoice_adjustments(id,invoice_id,subtotal_delta,tax_delta,reason,business_day_id,actor_user_id)
     values(v_id,v_invoice.id,v_sub,v_tax,v_reason,v_day,auth.uid());
   if v_customer is not null then insert into public.customer_ledger(customer_id,invoice_id,source_id,kind,amount,business_day_id,actor_user_id)
     values(v_customer,v_invoice.id,v_id,'ADJUSTMENT',v_sub+v_tax,v_day,auth.uid());end if;
   perform public.finance_post('ADJUSTMENT',v_id,v_day,jsonb_build_object('RECEIVABLE',v_sub+v_tax,'SALES',-v_sub,'TAX_PAYABLE',-v_tax));
 elsif p_operation='COMPANY' then
   select * into strict v_company from public.billing_company where id for update;v_old:=to_jsonb(v_company);
   if (p_data->>'version')::integer is distinct from v_company.version then raise exception using errcode='40001',message='Settings changed; refresh before saving.';end if;
   if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 120 or length(coalesce(p_data->>'address',''))>500
     or length(coalesce(p_data->>'phone',''))>40 or length(coalesce(p_data->>'registration',''))>120
     or coalesce(p_data->>'tax_mode','') not in ('UNCONFIGURED','NO_TAX','EXPLICIT')
     or length(coalesce(p_data->>'tax_label',''))>100 or public.finance_money(p_data->>'tax_rate')>100
     or (p_data->>'tax_mode'='EXPLICIT' and length(btrim(coalesce(p_data->>'tax_label','')))=0) then
     raise exception using errcode='22023',message='Invalid company or confirmed tax settings.';end if;
   update public.billing_company set name=btrim(p_data->>'name'),address=coalesce(p_data->>'address',''),phone=coalesce(p_data->>'phone',''),registration=coalesce(p_data->>'registration',''),
     tax_mode=p_data->>'tax_mode',tax_label=coalesce(p_data->>'tax_label',''),tax_rate=case when p_data->>'tax_mode'='EXPLICIT' then public.finance_money(p_data->>'tax_rate') else 0 end,
     version=version+1 where id returning to_jsonb(billing_company.*) into v_new;
   v_id:=p_key;
 elsif p_operation='BILLING' then
   v_customer:=(p_data->>'customer')::uuid;perform public.finance_lock(v_customer);
   select to_jsonb(b.*) into v_old from public.customer_billing b where customer_id=v_customer;
   if coalesce((v_old->>'version')::integer,0) is distinct from (p_data->>'version')::integer then raise exception using errcode='40001',message='Settings changed; refresh before saving.';end if;
   if coalesce(p_data->>'account_type','') not in ('STANDARD','MONTHLY_CREDIT') or coalesce(p_data->>'deposit_mode','') not in ('NONE','MANUAL') then raise exception using errcode='22023',message='Invalid customer billing arrangement.';end if;
   insert into public.customer_billing(customer_id,account_type,due_days,deposit_mode) values(v_customer,p_data->>'account_type',nullif(p_data->>'due_days','')::integer,p_data->>'deposit_mode')
     on conflict(customer_id) do update set account_type=excluded.account_type,due_days=excluded.due_days,deposit_mode=excluded.deposit_mode,version=customer_billing.version+1
     returning to_jsonb(customer_billing.*) into v_new;v_id:=v_customer;
 else
   v_customer:=(p_data->>'customer')::uuid;perform public.finance_lock(v_customer);
   select to_jsonb(p.*) into v_old from public.customer_prices p where customer_id=v_customer and product_id=(p_data->>'product')::uuid;
   if coalesce((v_old->>'version')::integer,0) is distinct from (p_data->>'version')::integer then raise exception using errcode='40001',message='Price changed; refresh before saving.';end if;
   insert into public.customer_prices(customer_id,product_id,price,active) values(v_customer,(p_data->>'product')::uuid,public.finance_money(p_data->>'price'),(p_data->>'active')::boolean)
     on conflict(customer_id,product_id) do update set price=excluded.price,active=excluded.active,version=customer_prices.version+1
     returning to_jsonb(customer_prices.*) into v_new;v_id:=v_customer;
 end if;
 return public.ops_finish(p_key,v_payload,v_id,'FINANCE_'||p_operation,'finance',v_old,coalesce(v_new,p_data),case when p_operation='PAYMENT' then 'Authorized trip collection' else v_reason end);
end $$;
do $$ declare f regprocedure; begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'finance_%' loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $$;
grant execute on function public.finance_customer_access(uuid),public.finance_command(text,jsonb,uuid) to authenticated;
