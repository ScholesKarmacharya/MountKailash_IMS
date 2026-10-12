-- Add only a checked entry point for the simplified driver form. Existing
-- tables, RPCs, RLS, historical payments, partial/Fonepay and admin flows remain.
-- All checks and existing posting execute in one transaction; failure rolls
-- back inventory, custody, invoices, receipts, credit and request/audit rows.
create function public.post_driver_delivery(
  p_trip uuid,p_customer uuid,p_walk_name text,p_walk_phone text,p_items jsonb,
  p_status text,p_received text,p_notes text,p_key uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_received numeric(14,2):=0; v_payment jsonb; v_visit uuid;
  v_invoice public.invoices; v_sale boolean;
begin
  perform public.ops_actor(false);
  if p_status is null or p_status not in ('PAID','CREDIT','RETURN_ONLY') then
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
  v_payment:=jsonb_build_object('selection',case when p_status='CREDIT' then 'UNPAID' else 'CASH' end,
    'reported_amount',null,'reference','','driver_status',p_status,'received',v_received::text,
    'payments',case when v_received>0 then jsonb_build_array(jsonb_build_object(
      'method','CASH','amount',v_received::text,'current_amount',v_received::text,
      'deposit_amount','0.00','reference','','allocations','[]'::jsonb)) else '[]'::jsonb end);
  v_visit:=public.post_trip_visit(p_trip,p_customer,p_walk_name,p_walk_phone,p_items,v_payment,p_notes,p_key);
  select i.* into v_invoice from public.invoices i join public.sales s on s.id=i.sale_id where s.visit_id=v_visit;
  if p_status='PAID' and (v_invoice.id is null or v_invoice.total<>v_received) then
    raise exception using errcode='22023',message='Total amount received must equal the payable total.';
  end if;
  return v_visit;
end $$;
revoke all on function public.post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid) to authenticated;
