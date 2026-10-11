-- Close takes ONLY the day row's exclusive lock, never a trip/customer/balance lock.
-- Existing stock/trip/finance writers take a shared OPEN-day lock until commit.
-- Read-only validation after this barrier avoids reversed lock order/deadlocks.
create function public.business_day_command(p_operation text,p_day uuid,p_data jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.business_days; v_payload jsonb; v_retry uuid; v_blockers jsonb; v_report jsonb;
  v_expected numeric; v_counted numeric; v_time timestamptz; v_source uuid; v_posting uuid;
begin
 perform public.ops_actor(true);
 if p_operation is null or p_operation not in ('REVIEW','RESUME','CLOSE','STOCK_CORRECTION') or p_day is null or p_data is null
   or jsonb_typeof(p_data)<>'object' then raise exception using errcode='22023',message='Invalid business-day action.'; end if;
 v_payload:=jsonb_build_object('operation','DAY_'||p_operation,'day',p_day,'data',p_data);
 v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
 if p_operation='STOCK_CORRECTION' then
   -- Original day is read, never reopened. The existing adjustment RPC locks the posting OPEN day.
   select * into d from public.business_days where id=p_day and status='CLOSED';
   if not found then raise exception using errcode='22023',message='Select a closed day for a linked correction.'; end if;
   v_posting:=(p_data->>'posting_day')::uuid;
   v_source:=public.adjust_warehouse_stock((p_data->>'product')::uuid,(p_data->>'stock_kind')::public.stock_kind,
     (p_data->>'delta')::integer,p_data->>'reason','Correction to closed day '||d.date_label,v_posting,
     md5(auth.uid()::text||p_key::text||':stock-correction')::uuid);
   insert into public.business_day_amendments(original_day_id,posting_day_id,source_kind,source_id,details,reason,actor_user_id)
     values(p_day,v_posting,'STOCK_CORRECTION',v_source,p_data,p_data->>'reason',auth.uid());
   return public.ops_finish(p_key,v_payload,v_source,'CLOSED_DAY_STOCK_CORRECTION','stock_adjustments',
     jsonb_build_object('original_day_id',p_day),p_data,p_data->>'reason');
 end if;
 select * into d from public.business_days where id=p_day for update;
 if not found then raise exception using errcode='22023',message='Business day not found.'; end if;
 if (p_data->>'version')::integer is distinct from d.version then
   raise exception using errcode='40001',message='Business day changed; refresh before continuing.'; end if;
 if d.status='CLOSED' then raise exception using errcode='22023',message='This day is already closed; view its archived report.'; end if;
 if p_operation='RESUME' then
   if d.status<>'CLOSING_REVIEW' or length(btrim(coalesce(p_data->>'reason',''))) not between 3 and 500 then
     raise exception using errcode='22023',message='Resume requires a closing review and a specific reason.'; end if;
   update public.business_days set status='OPEN',version=version+1 where id=p_day;
   return public.ops_finish(p_key,v_payload,p_day,'DAY_REVIEW_CANCELLED','business_days',to_jsonb(d),
     jsonb_build_object('status','OPEN'),p_data->>'reason');
 end if;
 if (p_operation='REVIEW' and d.status<>'OPEN') or (p_operation='CLOSE' and d.status<>'CLOSING_REVIEW') then
   raise exception using errcode='22023',message='Begin review before confirming the close.'; end if;
 v_blockers:=public.day_blockers(p_day);
 if jsonb_array_length(v_blockers)>0 then raise exception using errcode='22023',message='Closing is blocked. Refresh the checklist and resolve its linked records.'; end if;
 if p_operation='REVIEW' then
   update public.business_days set status='CLOSING_REVIEW',version=version+1 where id=p_day;
   return public.ops_finish(p_key,v_payload,p_day,'DAY_REVIEW_STARTED','business_days',to_jsonb(d),
     jsonb_build_object('status','CLOSING_REVIEW'),'Admin started closing review; normal writes frozen');
 end if;
 if p_data->>'cash_counted' is null or p_data->>'cash_counted' !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' then
   raise exception using errcode='22023',message='Enter the signed net cash handover with at most two decimals.'; end if;
 v_counted:=(p_data->>'cash_counted')::numeric(14,2);
 select coalesce(sum(amount),0) into v_expected from public.finance_journal where business_day_id=p_day and account='CASH';
 if v_counted<>v_expected then raise exception using errcode='22023',message='Net cash handover does not match recorded receipts less refunds. Resume operations and resolve the discrepancy.'; end if;
 if exists(select 1 from unnest(array['cash_checked','fonepay_checked','stock_checked','balances_checked','confirmed']) field
   where p_data->field is distinct from 'true'::jsonb) then
   raise exception using errcode='22023',message='Explicitly confirm cash, Fonepay, stock and carried balances before closing.'; end if;
 if length(btrim(coalesce(p_data->>'notes',''))) not between 3 and 2000 then
   raise exception using errcode='22023',message='Record the reconciliation evidence or closing notes.'; end if;
 v_report:=public.day_report_data(p_day);
 v_time:=clock_timestamp();
 update public.business_days set status='CLOSED',closed_at=v_time,closed_by=auth.uid(),version=version+1 where id=p_day;
 v_report:=jsonb_set(v_report,'{day}',v_report->'day'||jsonb_build_object('status','CLOSED','closed_at',v_time,
   'closed_by',auth.uid(),'closed_by_name',(select name from public.profiles where id=auth.uid()),'version',d.version+1));
 v_report:=v_report||jsonb_build_object('source','ARCHIVED','reconciliation',jsonb_build_object('cash_expected',v_expected::text,
   'cash_counted',v_counted::text,'cash_difference','0.00','cash_checked',true,'fonepay_checked',true,'stock_checked',true,
   'balances_checked',true,'notes',p_data->>'notes','checked_by',auth.uid(),'checked_at',v_time));
 insert into public.business_day_closings(business_day_id,report,closed_by,closed_at,request_key) values(p_day,v_report,auth.uid(),v_time,p_key);
 return public.ops_finish(p_key,v_payload,p_day,'DAY_CLOSED','business_days',to_jsonb(d),v_report->'day',p_data->>'notes');
end $$;

create function public.process_warehouse_jars(p_day uuid,p_product uuid,p_operation text,p_kind public.stock_kind,p_quantity integer,p_reason text,p_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_retry uuid; v_id uuid:=gen_random_uuid(); v_main uuid; v_damage uuid; v_location uuid; v_state public.stock_kind;
 v_before integer; v_empty integer; v_full integer; v_damaged integer;
begin
 perform public.ops_actor(true);
 if p_operation is null or p_operation not in ('REFILL','DAMAGE') or p_kind is null or p_kind not in ('FULL_JAR','EMPTY_JAR')
   or (p_operation='REFILL' and p_kind<>'EMPTY_JAR') or p_quantity is null or p_quantity not between 1 and 1000000000
   or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
   raise exception using errcode='22023',message='Enter valid jar quantities and a mandatory processing reason.'; end if;
 v_payload:=jsonb_build_object('operation','WAREHOUSE_'||p_operation,'day',p_day,'product',p_product,'kind',p_kind,'quantity',p_quantity,'reason',p_reason);
 v_retry:=public.ops_retry(p_key,v_payload); if v_retry is not null then return v_retry; end if;
 perform public.finance_day(p_day);
 perform 1 from public.products where id=p_product and kind='FULL_JAR' for share;
 if not found then raise exception using errcode='22023',message='Select a jar product.'; end if;
 select id into strict v_main from public.stock_locations where code='MAIN' and kind='WAREHOUSE';
 select id into strict v_damage from public.stock_locations where code='DAMAGED' and kind='DAMAGE';
 -- Same deterministic product/location/state order as trip reconciliation.
 for v_location,v_state in select x.location,x.state from (
   select v_main as location,'EMPTY_JAR'::public.stock_kind as state where p_operation='REFILL'
   union select v_main,'FULL_JAR'::public.stock_kind where p_operation='REFILL'
   union select v_main,p_kind where p_operation='DAMAGE'
   union select v_damage,p_kind where p_operation='DAMAGE') x order by location,state loop
   insert into public.inventory_balances(location_id,product_id,stock_kind) values(v_location,p_product,v_state) on conflict do nothing;
   select quantity into v_before from public.inventory_balances where location_id=v_location and product_id=p_product and stock_kind=v_state for update;
 end loop;
 select quantity into strict v_empty from public.inventory_balances where location_id=v_main and product_id=p_product and stock_kind=p_kind;
 if v_empty<p_quantity then raise exception using errcode='22023',message='Insufficient stock; balance cannot be negative.'; end if;
 insert into public.warehouse_processing(id,business_day_id,product_id,operation,stock_kind,quantity,reason,actor_user_id,request_key)
   values(v_id,p_day,p_product,p_operation,p_kind,p_quantity,btrim(p_reason),auth.uid(),p_key);
 if p_operation='REFILL' then
   select quantity into strict v_full from public.inventory_balances where location_id=v_main and product_id=p_product and stock_kind='FULL_JAR';
   if v_full::bigint+p_quantity>2147483647 then raise exception using errcode='22023',message='Stock quantity exceeds supported range.'; end if;
   update public.inventory_balances set quantity=quantity-p_quantity,version=version+1 where location_id=v_main and product_id=p_product and stock_kind='EMPTY_JAR';
   update public.inventory_balances set quantity=quantity+p_quantity,version=version+1 where location_id=v_main and product_id=p_product and stock_kind='FULL_JAR';
   insert into public.stock_movements(product_id,stock_kind,from_location_id,to_location_id,quantity,movement_type,business_day_id,actor_user_id,idempotency_key,line_number,processing_id,from_quantity_before,from_quantity_after,to_quantity_before,to_quantity_after)
   values(p_product,'EMPTY_JAR',v_main,null,p_quantity,'REFILL_INPUT',p_day,auth.uid(),p_key,1,v_id,v_empty,v_empty-p_quantity,null,null),
     (p_product,'FULL_JAR',null,v_main,p_quantity,'REFILL_OUTPUT',p_day,auth.uid(),p_key,2,v_id,null,null,v_full,v_full+p_quantity);
 else
   select quantity into strict v_damaged from public.inventory_balances where location_id=v_damage and product_id=p_product and stock_kind=p_kind;
   if v_damaged::bigint+p_quantity>2147483647 then raise exception using errcode='22023',message='Stock quantity exceeds supported range.'; end if;
   update public.inventory_balances set quantity=quantity-p_quantity,version=version+1 where location_id=v_main and product_id=p_product and stock_kind=p_kind;
   update public.inventory_balances set quantity=quantity+p_quantity,version=version+1 where location_id=v_damage and product_id=p_product and stock_kind=p_kind;
   insert into public.stock_movements(product_id,stock_kind,from_location_id,to_location_id,quantity,movement_type,business_day_id,actor_user_id,idempotency_key,line_number,processing_id,from_quantity_before,from_quantity_after,to_quantity_before,to_quantity_after)
     values(p_product,p_kind,v_main,v_damage,p_quantity,'WAREHOUSE_DAMAGE',p_day,auth.uid(),p_key,1,v_id,v_empty,v_empty-p_quantity,v_damaged,v_damaged+p_quantity);
 end if;
 return public.ops_finish(p_key,v_payload,v_id,'WAREHOUSE_'||p_operation,'warehouse_processing',null,v_payload,btrim(p_reason));
end $$;

-- Finance corrections already append to the current OPEN day; link them automatically to old archives.
create function public.link_closed_day_finance_correction() returns trigger language plpgsql security definer set search_path='' as $$
declare v_day uuid; v_kind text; v_details jsonb; v_reason text;
begin
 if tg_table_name='invoice_adjustments' then
   select s.business_day_id into v_day from public.invoices i join public.sales s on s.id=i.sale_id where i.id=new.invoice_id;
   v_kind:='INVOICE_ADJUSTMENT'; v_details:=public.finance_json(to_jsonb(new)); v_reason:=new.reason;
 else
   if new.status<>'REVERSED' then return new; end if;
   select business_day_id into v_day from public.payments where id=new.payment_id;
   v_kind:='PAYMENT_REVERSAL'; v_details:=to_jsonb(new); v_reason:=new.evidence;
 end if;
 if v_day<>new.business_day_id and exists(select 1 from public.business_days where id=v_day and status='CLOSED') then
   insert into public.business_day_amendments(original_day_id,posting_day_id,source_kind,source_id,details,reason,actor_user_id)
     values(v_day,new.business_day_id,v_kind,new.id,v_details,v_reason,new.actor_user_id);
 end if;
 return new;
end $$;
create trigger link_day_adjustment after insert on public.invoice_adjustments for each row execute function public.link_closed_day_finance_correction();
create trigger link_day_reversal after insert on public.payment_verification_events for each row execute function public.link_closed_day_finance_correction();
revoke all on function public.link_closed_day_finance_correction() from public,anon,authenticated,service_role;
revoke all on function public.business_day_command(text,uuid,jsonb,uuid),public.process_warehouse_jars(uuid,uuid,text,public.stock_kind,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.business_day_command(text,uuid,jsonb,uuid),public.process_warehouse_jars(uuid,uuid,text,public.stock_kind,integer,text,uuid) to authenticated;
