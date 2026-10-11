-- Report calculations are private; the public readers below independently require admin identity.
create function public.day_blockers(p_day uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'message',message,'href',href) order by code,message),'[]'::jsonb) from (
  select 'TRIP' as code,'Trip #'||trip_number||' is '||status::text||'; reconcile or cancel an unladen draft.' as message,
    '/admin/trips/'||id as href from public.trips where business_day_id=p_day and status<>'CLOSED'
  union all
  select 'VEHICLE_STOCK','Vehicle '||v.plate_number||' still holds stock; reconcile its trip.','/admin/vehicles/'||v.id
    from public.inventory_balances b join public.vehicles v on v.location_id=b.location_id where b.quantity<>0
  union all
  select 'FONEPAY','Receipt MK-P-'||p.number||' awaits Fonepay reconciliation.','/admin/payments/'||p.id
    from public.payments p where p.business_day_id=p_day and public.finance_state(p.id)='PENDING'
  union all
  select 'UNPOSTED_VISIT','A legacy visit has no posted sale/invoice; financial review is required.','/admin/trips/'||v.trip_id
    from public.trip_visits v where v.business_day_id=p_day and not exists(select 1 from public.sales s where s.visit_id=v.id)
  union all
  select 'INVOICE','A sale is missing its invoice or item total is inconsistent.','/admin/trips/'||s.trip_id
    from public.sales s left join public.invoices i on i.sale_id=s.id where s.business_day_id=p_day and
    (i.id is null or i.subtotal<>coalesce((select sum(total) from public.sale_items where sale_id=s.id),0))
  union all
  select 'PAYMENT','A receipt is missing status or its allocations/deposit do not equal its amount.','/admin/payments/'||p.id
    from public.payments p where p.business_day_id=p_day and (public.finance_state(p.id) is null or
    p.amount<>p.deposit_amount+coalesce((select sum(amount) from public.payment_allocations where payment_id=p.id),0))
  union all
  select 'WALK_IN_CREDIT','A walk-in invoice remains unpaid; resolve or document an authorized credit adjustment before closing.','/admin/invoices/'||i.id
    from public.invoices i join public.sales s on s.id=i.sale_id where s.business_day_id=p_day and s.customer_id is null
      and public.finance_invoice_balance(i.id,false)>0
  union all
  select 'DEPOSIT_POSTING','Deposit liability journal differs from the refundable deposit ledger.','/admin/credit'
    where coalesce((select sum(amount) from public.deposit_transactions),0)<>
      -coalesce((select sum(amount) from public.finance_journal where account='DEPOSIT_LIABILITY'),0)
  union all
  select 'PAYMENT_POSTING','A receipt has duplicate settlement events or incomplete recognized postings.','/admin/payments/'||p.id
    from public.payments p where p.business_day_id=p_day and (
      (select count(*) from public.payment_verification_events where payment_id=p.id and status='CONFIRMED')>1 or
      (select count(*) from public.payment_verification_events where payment_id=p.id and status='REVERSED')>1 or
      (public.finance_state(p.id) in ('CONFIRMED','REVERSED') and p.amount<>coalesce((select sum(amount) from public.finance_journal
        where source_id=p.id and kind='PAYMENT' and account=p.method),0)))
  union all
  select 'RECEIVABLE_POSTING','Receivable journal totals do not match invoice balances; financial review is required.','/admin/credit'
    where coalesce((select sum(amount) from public.finance_journal where account='RECEIVABLE'),0)<>
      coalesce((select sum(public.finance_invoice_balance(id,false)) from public.invoices),0)
  union all
  select 'JOURNAL','A financial posting is unbalanced; contact the administrator.','/admin/payments'
    from public.finance_journal where business_day_id=p_day group by posting_id having sum(amount)<>0
  union all
  select 'RECEIVABLE','An invoice has a negative receivable; investigate its corrections.','/admin/invoices/'||id
    from public.invoices where public.finance_invoice_balance(id,false)<0
  union all
  select 'DEPOSIT','A customer has a negative deposit liability.','/admin/customers/'||customer_id
    from public.deposit_transactions group by customer_id having sum(amount)<0
  union all
  select 'STOCK_LEDGER','A stock balance differs from its immutable movement ledger.','/admin/inventory'
    from public.inventory_balances b where b.quantity<>coalesce((select sum(
      case when m.to_location_id=b.location_id then m.quantity::bigint else 0 end-
      case when m.from_location_id=b.location_id then m.quantity::bigint else 0 end)
      from public.stock_movements m where m.product_id=b.product_id and m.stock_kind=b.stock_kind
        and (m.from_location_id=b.location_id or m.to_location_id=b.location_id)),0)
  union all
  select 'CUSTODY_LEDGER','Customer jar custody differs from its ledger.','/admin/customers/'||b.customer_id
    from public.jar_custody_balances b where b.quantity<>coalesce((select sum(delta) from public.jar_custody_entries
      where customer_id=b.customer_id and product_id=b.product_id),0)
 ) issues;
$$;

create function public.day_report_data(p_day uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.business_days; v_stock jsonb; v_totals jsonb; v_trips jsonb; v_cutoff timestamptz;
begin
 select * into strict d from public.business_days where id=p_day;
 v_cutoff:=coalesce(d.closed_at,'infinity'::timestamptz);
 -- New closes read current balances under the exclusive day lock. Legacy CLOSED days
 -- (if externally closed before Sprint 4) are explicitly reconstructed, never labeled verified.
 select coalesce(jsonb_agg(to_jsonb(x) order by location_kind,name,stock_kind),'[]'::jsonb) into v_stock from (
  select b.product_id,p.name,p.sku,p.unit,b.stock_kind,b.location_id,l.name as location_name,l.kind as location_kind,
    (case when d.status<>'CLOSED' then b.quantity::bigint else coalesce((select sum(
       case when m.to_location_id=b.location_id then m.quantity::bigint else 0 end-
       case when m.from_location_id=b.location_id then m.quantity::bigint else 0 end)
       from public.stock_movements m where m.product_id=b.product_id and m.stock_kind=b.stock_kind and m.created_at<=v_cutoff),0) end) as closing,
    (case when d.status<>'CLOSED' then b.quantity::bigint else coalesce((select sum(
       case when m.to_location_id=b.location_id then m.quantity::bigint else 0 end-
       case when m.from_location_id=b.location_id then m.quantity::bigint else 0 end)
       from public.stock_movements m where m.product_id=b.product_id and m.stock_kind=b.stock_kind and m.created_at<=v_cutoff),0) end)-
       coalesce((select sum(case when m.to_location_id=b.location_id then m.quantity::bigint else 0 end-
         case when m.from_location_id=b.location_id then m.quantity::bigint else 0 end)
         from public.stock_movements m where m.product_id=b.product_id and m.stock_kind=b.stock_kind and m.business_day_id=p_day),0) as opening
  from public.inventory_balances b join public.products p on p.id=b.product_id
  join public.stock_locations l on l.id=b.location_id where l.kind in ('WAREHOUSE','DAMAGE')
 ) x;
 select jsonb_build_object(
  'trips',(select count(*) from public.trips where business_day_id=p_day),
  'completed_trips',(select count(*) from public.trips where business_day_id=p_day and status='CLOSED'),
  'pending_trips',(select count(*) from public.trips where business_day_id=p_day and status<>'CLOSED'),
  'full_jars',coalesce((select sum(i.full_jars) from public.visit_items i join public.trip_visits v on v.id=i.visit_id where v.business_day_id=p_day),0),
  'empty_jars',coalesce((select sum(i.empty_jars) from public.visit_items i join public.trip_visits v on v.id=i.visit_id where v.business_day_id=p_day),0),
  'cartons',coalesce((select sum(i.cartons) from public.visit_items i join public.trip_visits v on v.id=i.visit_id where v.business_day_id=p_day),0),
  'sales',(-coalesce((select sum(amount) from public.finance_journal where business_day_id=p_day and account='SALES'),0))::text,
  'gross_sales',(-coalesce((select sum(amount) from public.finance_journal where business_day_id=p_day and account in ('SALES','TAX_PAYABLE')),0))::text,
  'tax',(-coalesce((select sum(amount) from public.finance_journal where business_day_id=p_day and account='TAX_PAYABLE'),0))::text,
  'cash',coalesce((select sum(amount) from public.finance_journal where business_day_id=p_day and account='CASH' and kind in ('PAYMENT','REVERSAL')),0)::text,
  'fonepay',coalesce((select sum(amount) from public.finance_journal where business_day_id=p_day and account='FONEPAY' and kind in ('PAYMENT','REVERSAL')),0)::text,
  'collections',coalesce((select sum(amount) from public.finance_journal where business_day_id=p_day and account in ('CASH','FONEPAY') and kind in ('PAYMENT','REVERSAL')),0)::text,
  'cash_net',coalesce((select sum(amount) from public.finance_journal where business_day_id=p_day and account='CASH'),0)::text,
  'pending_fonepay',coalesce((select sum(p.amount) from public.payments p where p.business_day_id=p_day and public.finance_state(p.id)='PENDING'),0)::text,
  'new_credit',coalesce((select sum(c.amount) from public.credit_issued c join public.invoices i on i.id=c.invoice_id
    join public.sales s on s.id=i.sale_id where s.business_day_id=p_day),0)::text,
  'old_credit_recovered',coalesce((select sum(a.amount*case when e.status='REVERSED' then -1 else 1 end)
    from public.payment_verification_events e join public.payments p on p.id=e.payment_id join public.payment_allocations a on a.payment_id=p.id
    join public.invoices i on i.id=a.invoice_id join public.sales s on s.id=i.sale_id
    where e.business_day_id=p_day and e.status in ('CONFIRMED','REVERSED') and s.business_day_id<>p_day),0)::text,
  'outstanding',coalesce((select sum(amount) from public.finance_journal where account='RECEIVABLE' and created_at<=v_cutoff),0)::text,
  'deposits_received',coalesce((select sum(amount) from public.deposit_transactions where business_day_id=p_day and kind='RECEIPT'),0)::text,
  'deposits_refunded',(-coalesce((select sum(amount) from public.deposit_transactions where business_day_id=p_day and kind='REFUND'),0))::text,
  'deposits_reversed',(-coalesce((select sum(amount) from public.deposit_transactions where business_day_id=p_day and kind='REVERSAL'),0))::text,
  'deposit_liability',coalesce((select sum(amount) from public.deposit_transactions where created_at<=v_cutoff),0)::text,
  'refilled',coalesce((select sum(quantity) from public.warehouse_processing where business_day_id=p_day and operation='REFILL'),0),
  'damaged',coalesce((select sum(quantity) from public.warehouse_processing where business_day_id=p_day and operation='DAMAGE'),0)
 ) into v_totals;
 select coalesce(jsonb_agg(to_jsonb(x) order by trip_number),'[]'::jsonb) into v_trips from (
  select t.id,t.trip_number,t.driver_id,p.name as driver_name,t.vehicle_id,v.plate_number,t.status,t.close_reason,t.closed_at,t.closed_by,
   coalesce((select sum(i.full_jars) from public.visit_items i join public.trip_visits tv on tv.id=i.visit_id where tv.trip_id=t.id),0) as full_jars,
   coalesce((select sum(i.empty_jars) from public.visit_items i join public.trip_visits tv on tv.id=i.visit_id where tv.trip_id=t.id),0) as empty_jars,
   coalesce((select sum(i.cartons) from public.visit_items i join public.trip_visits tv on tv.id=i.visit_id where tv.trip_id=t.id),0) as cartons,
   coalesce((select sum(i.subtotal) from public.invoices i join public.sales s on s.id=i.sale_id where s.trip_id=t.id),0)::text as sales,
   coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(ci)) from public.trip_return_check_items ci where ci.check_id=c.id),'[]'::jsonb)) order by c.created_at)
     from public.trip_return_checks c where c.trip_id=t.id),'[]'::jsonb) as checks
  from public.trips t join public.profiles p on p.id=t.driver_id join public.vehicles v on v.id=t.vehicle_id where t.business_day_id=p_day
 ) x;
 return jsonb_build_object(
  'schema_version',1,'source',case when d.status='CLOSED' then 'LEGACY_RECONSTRUCTED' else 'LIVE' end,
  'day',to_jsonb(d)||jsonb_build_object('opened_by_name',(select name from public.profiles where id=d.opened_by),
    'closed_by_name',(select name from public.profiles where id=d.closed_by)),
  'company',public.finance_json((select to_jsonb(c) from public.billing_company c)),
  'totals',v_totals,'stock',v_stock,'trips',v_trips,
  'products',coalesce((select jsonb_agg(to_jsonb(x) order by name) from (
    select i.product_id,max(p.name) as name,max(p.unit) as unit,sum(i.full_jars) as full_jars,sum(i.empty_jars) as empty_jars,sum(i.cartons) as cartons,
     sum((i.full_jars::numeric+i.cartons::numeric)*i.unit_price_snapshot)::text as sales
    from public.visit_items i join public.trip_visits v on v.id=i.visit_id join public.products p on p.id=i.product_id
    where v.business_day_id=p_day group by i.product_id) x),'[]'::jsonb),
  'customers',coalesce((select jsonb_agg(to_jsonb(x) order by name,created_at) from (
    select v.id,v.trip_id,t.trip_number,v.customer_id,coalesce(i.customer->>'name',c.name,v.walk_in_name) as name,v.created_at,i.id as invoice_id,i.number::text as invoice_number,
     coalesce(i.subtotal,0)::text as sales,coalesce(i.tax,0)::text as tax,
     sum(vi.full_jars) as full_jars,sum(vi.empty_jars) as empty_jars,sum(vi.cartons) as cartons
    from public.trip_visits v join public.trips t on t.id=v.trip_id join public.visit_items vi on vi.visit_id=v.id
     left join public.customers c on c.id=v.customer_id left join public.sales s on s.visit_id=v.id left join public.invoices i on i.sale_id=s.id
    where v.business_day_id=p_day group by v.id,t.id,c.id,i.id) x),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(public.finance_json(to_jsonb(x)) order by created_at) from (
    select p.*,public.finance_state(p.id) as status,t.driver_id,a.name as driver_name,t.vehicle_id,v.plate_number,
      coalesce((select jsonb_agg(jsonb_build_object('invoice_id',i.id,'number',i.number::text,'date_label',i.date_label,'amount',pa.amount::text))
        from public.payment_allocations pa join public.invoices i on i.id=pa.invoice_id where pa.payment_id=p.id),'[]'::jsonb) as allocations
    from public.payments p join public.trips t on t.id=p.trip_id join public.profiles a on a.id=t.driver_id join public.vehicles v on v.id=t.vehicle_id
    where p.business_day_id=p_day or exists(
      select 1 from public.payment_verification_events e where e.payment_id=p.id and e.business_day_id=p_day)) x),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by sequence) from public.payment_verification_events e where e.business_day_id=p_day),'[]'::jsonb),
  'deposits',coalesce((select jsonb_agg(public.finance_json(to_jsonb(e))) from public.deposit_transactions e where e.business_day_id=p_day),'[]'::jsonb),
  'journal',coalesce((select jsonb_agg(public.finance_json(to_jsonb(j)) order by created_at,id) from public.finance_journal j where j.business_day_id=p_day),'[]'::jsonb),
  'processing',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('product_name',p.name,'actor_name',a.name) order by r.created_at)
    from public.warehouse_processing r join public.products p on p.id=r.product_id join public.profiles a on a.id=r.actor_user_id where r.business_day_id=p_day),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(to_jsonb(m) order by created_at,line_number,id) from public.stock_movements m where m.business_day_id=p_day),'[]'::jsonb),
  'adjustments',coalesce((select jsonb_agg(to_jsonb(a)) from public.stock_adjustments a join public.stock_movements m on m.id=a.stock_movement_id where m.business_day_id=p_day),'[]'::jsonb),
  'invoice_adjustments',coalesce((select jsonb_agg(public.finance_json(to_jsonb(a))) from public.invoice_adjustments a where a.business_day_id=p_day),'[]'::jsonb),
  'discrepancies',coalesce((select jsonb_agg(to_jsonb(e)) from public.trip_discrepancies e join public.trip_return_checks c on c.id=e.check_id join public.trips t on t.id=c.trip_id where t.business_day_id=p_day),'[]'::jsonb),
  'custody',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.customer_id,c.name,e.product_id,p.name as product_name,sum(e.delta) as quantity
    from public.jar_custody_entries e join public.customers c on c.id=e.customer_id join public.products p on p.id=e.product_id where e.created_at<=v_cutoff group by e.customer_id,c.name,e.product_id,p.name) x),'[]'::jsonb),
  'credit',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.customer_id,c.name,sum(e.amount)::text as outstanding
    from public.customer_ledger e join public.customers c on c.id=e.customer_id where e.created_at<=v_cutoff group by e.customer_id,c.name) x),'[]'::jsonb),
  'deposit_balances',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.customer_id,c.name,sum(e.amount)::text as liability
    from public.deposit_transactions e join public.customers c on c.id=e.customer_id where e.created_at<=v_cutoff group by e.customer_id,c.name) x),'[]'::jsonb)
 );
end $$;

create function public.business_day_report(p_day uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_report jsonb; v_day public.business_days;
begin
 perform public.ops_actor(true);
 -- A shared lock gives live preview one coherent statement snapshot and serializes with close.
 select * into v_day from public.business_days where id=p_day for share;
 if not found then raise exception using errcode='22023',message='Business day not found.'; end if;
 select report into v_report from public.business_day_closings where business_day_id=p_day;
 if v_report is null then v_report:=public.day_report_data(p_day); end if;
 return jsonb_build_object('report',v_report,'blockers',case when v_day.status='CLOSED' then '[]'::jsonb else public.day_blockers(p_day) end,
  'amendments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_name',p.name,'posting_date',d.date_label) order by a.created_at,a.id)
    from public.business_day_amendments a join public.profiles p on p.id=a.actor_user_id join public.business_days d on d.id=a.posting_day_id where a.original_day_id=p_day),'[]'::jsonb));
end $$;
create function public.business_day_history(p_from date default null,p_to date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.ops_actor(true);
 if p_from>p_to then raise exception using errcode='22023',message='Start date must precede end date.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('totals',coalesce(c.report->'totals',public.day_report_data(d.id)->'totals'),
   'archived',c.business_day_id is not null,'closed_by_name',p.name) order by d.opened_at desc,d.id)
  from public.business_days d left join public.business_day_closings c on c.business_day_id=d.id left join public.profiles p on p.id=d.closed_by
  where (p_from is null or d.date_label>=p_from) and (p_to is null or d.date_label<=p_to)),'[]'::jsonb);
end $$;
revoke all on function public.day_blockers(uuid),public.day_report_data(uuid) from public,anon,authenticated,service_role;
revoke all on function public.business_day_report(uuid),public.business_day_history(date,date) from public,anon,authenticated,service_role;
grant execute on function public.business_day_report(uuid),public.business_day_history(date,date) to authenticated;
