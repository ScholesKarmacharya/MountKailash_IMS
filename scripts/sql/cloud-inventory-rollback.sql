-- Cloud acceptance check. ONE connection/transaction; all fixtures roll back.
-- No credentials, auth.users inserts, operational resets or COMMIT.
-- Never split statements across requests or remove the final ROLLBACK.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $$
declare v_admin uuid; v_driver uuid;
begin
  select p.id into strict v_admin from public.profiles p join auth.users u on u.id=p.id
    where u.email='admin@mount-kailash.example' and p.role='ADMIN' and p.is_active;
  select p.id into strict v_driver from public.profiles p join auth.users u on u.id=p.id
    where u.email='driver@mount-kailash.example' and p.role='DRIVER' and p.is_active;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.verify.driver',v_driver::text,true);
end;
$$;
set local role authenticated;
do $$
declare
  v_admin uuid := auth.uid();
  v_day uuid; v_day_key uuid := gen_random_uuid();
  v_jar uuid := gen_random_uuid(); v_carton uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid(); v_first uuid; v_retry uuid;
  v_rejected boolean; v_count integer;
begin
  -- Never change an existing operational day, even temporarily.
  select id into v_day from public.business_days where status='OPEN';
  if v_day is null then
    if exists(select 1 from public.business_days where status='CLOSING_REVIEW') then
      raise exception 'Acceptance requires an OPEN day or no active day; existing review was preserved.';
    end if;
    v_day := public.open_inventory_business_day(v_day_key);
    if public.open_inventory_business_day(v_day_key) <> v_day then raise exception 'Day retry failed.'; end if;
    if not exists(select 1 from public.business_days where id=v_day and status='OPEN'
      and date_label=(now() at time zone 'Asia/Kathmandu')::date) then raise exception 'Nepal day opening failed.'; end if;
    if not exists(select 1 from public.audit_events where entity_id=v_day and action='DAY_OPENED') then raise exception 'Day audit missing.'; end if;
  end if;
  v_rejected := false;
  begin perform public.open_inventory_business_day(gen_random_uuid());
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'Second active day was permitted.'; end if;

  perform public.save_product(v_jar,'VERIFY_'||upper(replace(v_jar::text,'-','')),'ROLLBACK ONLY 20L jar','FULL_JAR','jar','123.45',true,0,'Rollback-only acceptance',gen_random_uuid());
  perform public.save_product(v_carton,'VERIFY_'||upper(replace(v_carton::text,'-','')),'ROLLBACK ONLY carton','BOTTLE_CARTON','carton','234.56',true,0,'Rollback-only acceptance',gen_random_uuid());
  if (select count(*) from public.inventory_balances where product_id in(v_jar,v_carton) and quantity=0) <> 3 then raise exception 'Zero opening balances failed.'; end if;

  v_first := public.adjust_warehouse_stock(v_jar,'FULL_JAR',20,'Rollback-only increase','',v_day,v_key);
  v_retry := public.adjust_warehouse_stock(v_jar,'FULL_JAR',20,'Rollback-only increase','',v_day,v_key);
  if v_first <> v_retry then raise exception 'Adjustment retry failed.'; end if;
  v_rejected := false;
  begin perform public.adjust_warehouse_stock(v_jar,'FULL_JAR',21,'Rollback-only increase','',v_day,v_key);
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'Changed retry payload was permitted.'; end if;
  perform public.adjust_warehouse_stock(v_jar,'FULL_JAR',-5,'Rollback-only decrease','',v_day,gen_random_uuid());
  perform public.adjust_warehouse_stock(v_jar,'EMPTY_JAR',7,'Rollback-only increase','',v_day,gen_random_uuid());
  perform public.adjust_warehouse_stock(v_jar,'EMPTY_JAR',-3,'Rollback-only decrease','',v_day,gen_random_uuid());
  perform public.adjust_warehouse_stock(v_carton,'BOTTLE_CARTON',3,'Rollback-only increase','',v_day,gen_random_uuid());
  perform public.adjust_warehouse_stock(v_carton,'BOTTLE_CARTON',-1,'Rollback-only decrease','',v_day,gen_random_uuid());
  if (select quantity from public.inventory_balances where product_id=v_jar and stock_kind='FULL_JAR') <> 15
    or (select quantity from public.inventory_balances where product_id=v_jar and stock_kind='EMPTY_JAR') <> 4
    or (select quantity from public.inventory_balances where product_id=v_carton and stock_kind='BOTTLE_CARTON') <> 2 then raise exception 'Stock increase/decrease failed.'; end if;
  v_rejected := false;
  begin perform public.adjust_warehouse_stock(v_jar,'FULL_JAR',-16,'Rollback-only shortfall','',v_day,gen_random_uuid());
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'Negative stock was permitted.'; end if;
  v_rejected := false;
  begin perform public.adjust_warehouse_stock(v_jar,'FULL_JAR',1,'','',v_day,gen_random_uuid());
  exception when invalid_parameter_value then v_rejected := true; end;
  if not v_rejected then raise exception 'Blank reason was permitted.'; end if;
  select count(*) into v_count from public.stock_adjustments a
    join public.stock_movements m on m.id=a.stock_movement_id
    join public.audit_events e on e.entity='stock_adjustments' and e.entity_id=a.id and e.action='STOCK_ADJUSTED'
    where m.product_id in(v_jar,v_carton) and m.actor_user_id=v_admin and m.business_day_id=v_day
      and a.quantity_after::bigint=a.quantity_before::bigint+a.delta::bigint
      and m.quantity=abs(a.delta) and length(btrim(a.reason))>=3;
  if v_count <> 6 then raise exception 'Adjustment/movement/audit integrity failed.'; end if;

  v_rejected := false;
  begin update public.inventory_balances set quantity=99 where product_id=v_jar;
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Direct balance write was permitted.'; end if;
  v_rejected := false;
  begin delete from public.stock_adjustments where id=v_first;
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'History deletion was permitted.'; end if;

  perform set_config('request.jwt.claim.sub',current_setting('request.verify.driver'),true);
  if exists(select 1 from public.inventory_balances) or exists(select 1 from public.stock_movements)
    or exists(select 1 from public.audit_events) then raise exception 'Driver can read global warehouse data.'; end if;
  v_rejected := false;
  begin perform public.adjust_warehouse_stock(v_jar,'FULL_JAR',1,'Forbidden driver change','',v_day,gen_random_uuid());
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Driver adjustment was permitted.'; end if;
  v_rejected := false;
  begin perform public.open_inventory_business_day(gen_random_uuid());
  exception when insufficient_privilege then v_rejected := true; end;
  if not v_rejected then raise exception 'Driver day opening was permitted.'; end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
end;
$$;
rollback;
select true as rollback_completed, true as cloud_inventory_checks_passed;
