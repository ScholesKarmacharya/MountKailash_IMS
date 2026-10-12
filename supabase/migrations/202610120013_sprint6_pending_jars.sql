-- Additive FIFO read model. Existing custody, stock, finance and archived reports are never rewritten.
create table public.custody_event_order (
 entry_id uuid primary key references public.jar_custody_entries(id),
 sequence bigint generated always as identity unique
);
create table public.return_only_visits (visit_id uuid primary key references public.trip_visits(id));
alter table public.custody_event_order enable row level security;
alter table public.return_only_visits enable row level security;
revoke all on public.custody_event_order,public.return_only_visits from public,anon,authenticated,service_role;
grant select on public.custody_event_order,public.return_only_visits to authenticated;
create policy custody_order_read on public.custody_event_order for select to authenticated using(public.is_active_admin());
create policy return_visit_read on public.return_only_visits for select to authenticated using(exists(select 1 from public.trip_visits v where v.id=visit_id and public.can_read_trip(v.trip_id)));
create trigger immutable before update or delete on public.custody_event_order for each row execute function public.reject_journal_mutation();
create trigger no_truncate before truncate on public.custody_event_order execute function public.reject_journal_mutation();
create trigger immutable before update or delete on public.return_only_visits for each row execute function public.reject_journal_mutation();
create trigger no_truncate before truncate on public.return_only_visits execute function public.reject_journal_mutation();

-- For legacy entries sharing an exact timestamp, original intra-transaction order is
-- unavailable: positive entries precede returns, then UUID provides a stable tie-break.
-- Original journal dates and quantities remain untouched. New entries capture actual posting order.
insert into public.custody_event_order(entry_id)
 select id from public.jar_custody_entries order by created_at,case when delta>0 then 0 else 1 end,id;
create function public.record_custody_order() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.custody_event_order(entry_id) values(new.id); return new; end $$;
revoke all on function public.record_custody_order() from public,anon,authenticated,service_role;
create trigger custody_posting_order after insert on public.jar_custody_entries for each row execute function public.record_custody_order();

create function public.pending_jar_rows(p_customer uuid default null,p_cutoff timestamptz default 'infinity') returns jsonb
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
  'business_date',b.date_label,'source',case when x.visit_id is null then 'Admin custody correction' else 'Delivery' end)
  order by x.sequence),'[]'::jsonb)
 from outstanding x join public.customers c on c.id=x.customer_id join public.products p on p.id=x.product_id
 join public.business_days b on b.id=x.business_day_id where x.pending>0;
$$;

-- Allocations are derived exactly from immutable posting intervals, not a mutable balance/date.
create function public.jar_return_allocations(p_customer uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with positives as (
  select e.*,sum(e.delta::bigint) over(partition by e.product_id order by o.sequence rows unbounded preceding) as edge
  from public.jar_custody_entries e join public.custody_event_order o on o.entry_id=e.id where e.customer_id=p_customer and e.delta>0
 ), negatives as (
  select e.*,o.sequence,sum(-e.delta::bigint) over(partition by e.product_id order by o.sequence rows unbounded preceding) as edge
  from public.jar_custody_entries e join public.custody_event_order o on o.entry_id=e.id where e.customer_id=p_customer and e.delta<0
 ), allocations as (
  select n.id as return_entry_id,p.id as delivery_entry_id,n.product_id,n.sequence,p.created_at as original_date,n.created_at as returned_at,
   case when n.visit_id is null then 'Admin custody correction' else 'Empty collection' end as source,
   least(p.edge,n.edge)-greatest(p.edge-p.delta,n.edge+n.delta) as quantity
  from positives p join negatives n on p.product_id=n.product_id and p.edge>n.edge+n.delta and n.edge>p.edge-p.delta
 ) select coalesce(jsonb_agg(to_jsonb(x)-'sequence' order by x.sequence,x.original_date,x.delivery_entry_id),'[]'::jsonb) from allocations x;
$$;
revoke all on function public.pending_jar_rows(uuid,timestamptz),public.jar_return_allocations(uuid) from public,anon,authenticated,service_role;

create function public.pending_jar_workspace(p_trip uuid default null,p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception using errcode='42501',message='Active account required.'; end if;
 if not public.is_active_admin() then
  -- Stable read authorization: no mutation/locking is needed for a directory snapshot.
  if not exists(select 1 from public.trips t join public.business_days d on d.id=t.business_day_id
    where t.id=p_trip and t.driver_id=auth.uid() and t.status='ACTIVE' and d.status='OPEN') then
   raise exception using errcode='42501',message='An ACTIVE assigned trip on an OPEN day is required.'; end if;
 end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x) from jsonb_array_elements(public.pending_jar_rows(p_customer)) x
   where public.is_active_admin() or exists(select 1 from public.customers c where c.id=(x->>'customer_id')::uuid and c.is_active)),'[]'::jsonb));
end $$;
revoke all on function public.pending_jar_workspace(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pending_jar_workspace(uuid,uuid) to authenticated;

alter function public.delivery_customer_context(uuid,uuid) rename to delivery_customer_context_core;
revoke all on function public.delivery_customer_context_core(uuid,uuid) from public,anon,authenticated,service_role;
create function public.delivery_customer_context(p_trip uuid,p_customer uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb;
begin
 v_context:=public.delivery_customer_context_core(p_trip,p_customer);
 return v_context||jsonb_build_object('pending_jars',public.pending_jar_rows(p_customer),'jar_allocations',public.jar_return_allocations(p_customer));
end $$;
revoke all on function public.delivery_customer_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delivery_customer_context(uuid,uuid) to authenticated;

-- A return-only visit remains a physical/audit event, without manufacturing a new sale/invoice.
alter function public.finance_issue_visit(uuid,jsonb,uuid) rename to finance_issue_visit_core;
revoke all on function public.finance_issue_visit_core(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.finance_issue_visit(p_visit uuid,p_payment jsonb,p_key uuid) returns uuid language plpgsql set search_path='' as $$
declare v_visit public.trip_visits; v_trip public.trips; v_pay jsonb;
begin
 if exists(select 1 from public.visit_items where visit_id=p_visit and full_jars+cartons>0) then
  return public.finance_issue_visit_core(p_visit,p_payment,p_key);
 end if;
 select * into strict v_visit from public.trip_visits where id=p_visit;
 select * into strict v_trip from public.trips where id=v_visit.trip_id;
 if p_payment ? 'payments' then
  if jsonb_typeof(p_payment->'payments')<>'array' or jsonb_array_length(p_payment->'payments')>10 then
   raise exception using errcode='22023',message='Invalid payment list.'; end if;
  for v_pay in select value from jsonb_array_elements(p_payment->'payments') loop
   if public.finance_money(coalesce(v_pay->>'current_amount','0'))<>0 then raise exception using errcode='22023',message='A return-only visit has no new invoice to pay.'; end if;
   perform public.finance_payment(v_trip,v_visit.customer_id,v_pay,p_key,null);
  end loop;
 elsif coalesce(public.finance_money(coalesce(p_payment->>'reported_amount','0')),0)>0 then
  raise exception using errcode='22023',message='Allocate collections to previous credit or deposits explicitly.';
 end if;
 insert into public.return_only_visits(visit_id) values(p_visit);
 return null;
end $$;
revoke all on function public.finance_issue_visit(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

-- Future closing snapshots include original pending dates. Existing archives stay byte-for-byte intact.
alter function public.day_report_data(uuid) rename to day_report_data_core;
revoke all on function public.day_report_data_core(uuid) from public,anon,authenticated,service_role;
create function public.day_report_data(p_day uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_report jsonb; v_cutoff timestamptz;
begin
 v_report:=public.day_report_data_core(p_day);
 select coalesce(closed_at,'infinity'::timestamptz) into strict v_cutoff from public.business_days where id=p_day;
 return v_report||jsonb_build_object('pending_jars',public.pending_jar_rows(null,v_cutoff));
end $$;
revoke all on function public.day_report_data(uuid) from public,anon,authenticated,service_role;

-- Explicit return-only markers prevent false legacy-finance blockers; all other checks are retained.
-- Report calculations are private; the public readers below independently require admin identity.
create or replace function public.day_blockers(p_day uuid) returns jsonb
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
    from public.trip_visits v where v.business_day_id=p_day and not exists(select 1 from public.sales s where s.visit_id=v.id) and not exists(select 1 from public.return_only_visits r where r.visit_id=v.id)
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

