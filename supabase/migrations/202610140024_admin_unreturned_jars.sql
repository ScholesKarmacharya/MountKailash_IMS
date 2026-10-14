-- Read-only admin projections of the existing custody ledger and FIFO helpers.
-- No new ledger, balance writes, inventory movements or posting function changes.
create function public.admin_jar_workspace(p_month_start timestamptz,p_month_end timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_pending jsonb; v_now timestamptz:=now();
begin
 if not public.is_active_admin() then raise exception using errcode='42501',message='Admin access required.'; end if;
 if p_month_start is null or p_month_end is null or not isfinite(p_month_start) or not isfinite(p_month_end)
    or p_month_end<=p_month_start or p_month_end-p_month_start>interval '33 days' then
  raise exception using errcode='22023',message='Invalid jar reporting month.';
 end if;
 v_pending:=public.pending_jar_rows();
 return (
 with activity as (
  select e.customer_id,
   max(coalesce(v.offline_occurred_at,e.created_at)) as last_activity,
   max(coalesce(v.offline_occurred_at,e.created_at)) filter(where e.visit_id is not null and e.delta>0) as last_delivery,
   coalesce(jsonb_agg(distinct t.driver_id) filter(where t.driver_id is not null),'[]'::jsonb) as driver_ids
  from public.jar_custody_entries e left join public.trip_visits v on v.id=e.visit_id
  left join public.trips t on t.id=v.trip_id group by e.customer_id
 ), returns as (
  select e.customer_id,e.product_id,sum(-e.delta::bigint) as quantity from public.jar_custody_entries e
  join public.trip_visits v on v.id=e.visit_id where e.delta<0
  and coalesce(v.offline_occurred_at,e.created_at)>=p_month_start and coalesce(v.offline_occurred_at,e.created_at)<p_month_end
  group by e.customer_id,e.product_id
 ), aged as (
  select (l->>'customer_id')::uuid as customer_id,(l->>'product_id')::uuid as product_id,
   min((l->>'original_date')::timestamptz) as oldest_outstanding,
   sum((l->>'pending')::bigint) filter(where
    (v_now at time zone 'Asia/Kathmandu')::date-((l->>'original_date')::timestamptz at time zone 'Asia/Kathmandu')::date>30) as overdue
  from jsonb_array_elements(v_pending) l group by (l->>'customer_id')::uuid,(l->>'product_id')::uuid
 ), balances as (
  select b.customer_id,jsonb_agg(jsonb_build_object('product_id',b.product_id,'quantity',b.quantity,
   'returned_this_month',coalesce(r.quantity,0),'overdue',coalesce(a.overdue,0),'oldest_outstanding',a.oldest_outstanding)
   order by b.product_id) as rows
  from public.jar_custody_balances b left join returns r using(customer_id,product_id)
  left join aged a using(customer_id,product_id) group by b.customer_id
 ) select jsonb_build_object('snapshot_at',v_now,'month_start',p_month_start,'month_end',p_month_end,
  'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
    from public.products where kind='FULL_JAR'),'[]'::jsonb),
  'drivers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
    from public.profiles where role='DRIVER'),'[]'::jsonb),
  'customers',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'phone',c.phone,'address',c.address,'supply_type',c.supply_type,'is_active',c.is_active,
    'last_delivery',a.last_delivery,'last_activity',a.last_activity,'driver_ids',coalesce(a.driver_ids,'[]'::jsonb),
    'balances',coalesce(b.rows,'[]'::jsonb)) order by c.name,c.id)
    from public.customers c left join activity a on a.customer_id=c.id left join balances b on b.customer_id=c.id),'[]'::jsonb)));
end $$;

create function public.admin_jar_history(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_customer public.customers; v_pending jsonb;
begin
 if not public.is_active_admin() then raise exception using errcode='42501',message='Admin access required.'; end if;
 select * into v_customer from public.customers where id=p_customer;
 if not found then raise exception using errcode='22023',message='Customer not found.'; end if;
 -- Keep the authoritative FIFO order. Add display metadata without reallocating returns.
 select coalesce(jsonb_agg(l||jsonb_build_object('driver_name',p.name,'trip_number',t.trip_number) order by x.ordinality),'[]'::jsonb)
 into v_pending from jsonb_array_elements(public.pending_jar_rows(p_customer)) with ordinality x(l,ordinality)
 join public.jar_custody_entries e on e.id=(l->>'entry_id')::uuid
 left join public.trip_visits v on v.id=e.visit_id left join public.trips t on t.id=v.trip_id
 left join public.profiles p on p.id=t.driver_id;
 return jsonb_build_object('customer',jsonb_build_object('id',v_customer.id,'name',v_customer.name,'phone',v_customer.phone,
    'address',v_customer.address,'supply_type',v_customer.supply_type),
  'balances',coalesce((select jsonb_agg(jsonb_build_object('product_id',b.product_id,'product_name',p.name,'quantity',b.quantity) order by p.name,b.product_id)
    from public.jar_custody_balances b join public.products p on p.id=b.product_id where b.customer_id=p_customer),'[]'::jsonb),
  'pending',v_pending,'allocations',public.jar_return_allocations(p_customer),
  'events',(
   with entries as (
    select e.*,o.sequence,coalesce(e.visit_id,e.id) as event_id from public.jar_custody_entries e
    join public.custody_event_order o on o.entry_id=e.id where e.customer_id=p_customer
   ), lines as (
    select event_id,product_id,max(sequence) as sequence,
      sum(case when visit_id is not null and delta>0 then delta else 0 end) as delivered,
      sum(case when visit_id is not null and delta<0 then -delta else 0 end) as returned,
      sum(case when visit_id is null then delta else 0 end) as adjustment,
      sum(delta) as net_change,(array_agg(resulting_balance order by sequence desc))[1] as product_balance
    from entries group by event_id,product_id
   ), events as (
    select event_id,max(sequence) as sequence,(array_agg(e.id order by sequence desc))[1] as last_entry,
      jsonb_agg(jsonb_build_object('product_id',l.product_id,'product_name',p.name,'delivered',l.delivered,'returned',l.returned,
        'adjustment',l.adjustment,'net_change',l.net_change,'product_balance',l.product_balance) order by p.name,l.product_id) as items
    from lines l join public.products p on p.id=l.product_id join entries e using(event_id,product_id,sequence)
    group by event_id
   ) select coalesce(jsonb_agg(jsonb_build_object('id',x.event_id,'items',x.items,
     'occurred_at',coalesce(v.offline_occurred_at,e.created_at),'confirmed_at',e.created_at,'offline',v.offline_occurred_at is not null,
     'driver_name',p.name,'actor_name',a.name,'trip_id',t.id,'trip_number',t.trip_number,'reason',e.reason,
     'correction',e.visit_id is null,'outstanding_after',(
       select coalesce(sum(latest.resulting_balance),0) from (
        select distinct on (product_id) product_id,resulting_balance from entries where sequence<=x.sequence order by product_id,sequence desc
       ) latest)) order by x.sequence desc),'[]'::jsonb)
   from events x join entries e on e.id=x.last_entry left join public.trip_visits v on v.id=e.visit_id
   left join public.trips t on t.id=v.trip_id left join public.profiles p on p.id=t.driver_id left join public.profiles a on a.id=e.actor_user_id
  ));
end $$;
revoke all on function public.admin_jar_workspace(timestamptz,timestamptz),public.admin_jar_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_jar_workspace(timestamptz,timestamptz),public.admin_jar_history(uuid) to authenticated;
