-- Match Instant Delivery reads to the established active-driver customer lookup
-- permission. Stock/payment writers and raw customer/finance RLS stay unchanged.
create function public.can_read_instant_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.has_operational_access() and exists(
  select 1 from public.instant_deliveries i join public.customers c on c.id=i.customer_id
  where c.id=p_customer and (public.can_read_customer(c.id) or
   (c.is_active and public.can_search_delivery_customers() and exists(
     select 1 from public.trips t join public.business_days d on d.id=t.business_day_id
     where t.driver_id=auth.uid() and t.status='ACTIVE' and d.status='OPEN'
      and exists(select 1 from public.trip_load_items l where l.trip_id=t.id and l.quantity>0)
      and not exists(select 1 from public.trip_carryovers carry where carry.trip_id=t.id and carry.resumed_at is null)))))
$$;
revoke all on function public.can_read_instant_customer(uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_read_instant_customer(uuid) to authenticated;
drop policy instant_read on public.instant_deliveries;
create policy instant_read on public.instant_deliveries for select to authenticated
 using(public.can_read_instant_customer(customer_id));

alter function public.instant_row(uuid) rename to instant_row_before_collection_access;
revoke all on function public.instant_row_before_collection_access(uuid) from public,anon,authenticated,service_role;
create function public.instant_row(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.instant_row_before_collection_access(i.id)||jsonb_build_object(
  'vehicle_id',t.vehicle_id,'documents_allowed',public.can_read_customer(i.customer_id))
 from public.instant_deliveries i join public.trips t on t.id=i.trip_id where i.id=p_id
$$;
revoke all on function public.instant_row(uuid) from public,anon,authenticated,service_role;

create or replace function public.instant_workspace() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operational_access() then raise exception using errcode='42501',message='Authorized account required.';end if;
 return jsonb_build_object('records',coalesce((select jsonb_agg(public.instant_row(i.id) order by i.created_at desc,i.id)
  from public.instant_deliveries i where public.can_read_instant_customer(i.customer_id)),'[]'::jsonb));
end $$;
create or replace function public.instant_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.instant_deliveries; inv uuid;
begin
 if not public.has_operational_access() then raise exception using errcode='42501',message='Authorized account required.';end if;
 select * into i from public.instant_deliveries where id=p_id and public.can_read_instant_customer(customer_id);
 if not found then raise exception using errcode='42501',message='Instant delivery access required.';end if;
 select n.id into inv from public.invoices n join public.sales s on s.id=n.sale_id where s.visit_id=i.visit_id;
 return jsonb_build_object('record',public.instant_row(p_id),
  'jars',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'product',p.name,'delta',e.delta,'balance',e.resulting_balance,'reason',e.reason,'at',coalesce(v.offline_occurred_at,e.created_at),'trip',t.trip_number,'driver',pr.name) order by o.sequence)
   from public.jar_custody_entries e join public.custody_event_order o on o.entry_id=e.id join public.products p on p.id=e.product_id
   left join public.trip_visits v on v.id=e.visit_id left join public.trips t on t.id=v.trip_id left join public.profiles pr on pr.id=t.driver_id where e.customer_id=i.customer_id),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'amount',a.amount::text,'method',p.method,'status',public.finance_state(p.id),'at',p.created_at) order by p.created_at)
   from public.payment_allocations a join public.payments p on p.id=a.payment_id where a.invoice_id=inv),'[]'::jsonb),
  'adjustments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('subtotal_delta',a.subtotal_delta::text,'tax_delta',a.tax_delta::text) order by a.created_at) from public.invoice_adjustments a where a.invoice_id=inv),'[]'::jsonb));
end $$;
revoke all on function public.instant_workspace(),public.instant_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.instant_workspace(),public.instant_history(uuid) to authenticated;
notify pgrst, 'reload schema';
