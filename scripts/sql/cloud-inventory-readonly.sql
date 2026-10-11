-- Read-only inventory/identity snapshot. Prints counts, totals and checks only.
begin read only;
select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.products) as products,
  (select count(*) from public.business_days) as business_days,
  (select count(*) from public.stock_movements) as movements,
  (select count(*) from public.stock_adjustments) as adjustments,
  (select count(*) from public.audit_events) as audit_events,
  (select count(*) from public.operation_requests) as operation_requests,
  (select coalesce(sum(quantity),0) from public.inventory_balances where stock_kind='FULL_JAR') as full_jars,
  (select coalesce(sum(quantity),0) from public.inventory_balances where stock_kind='EMPTY_JAR') as empty_jars,
  (select coalesce(sum(quantity),0) from public.inventory_balances where stock_kind='BOTTLE_CARTON') as water_cartons,
  not exists (select 1 from public.inventory_balances where quantity<0) as nonnegative,
  not exists (select 1 from public.stock_adjustments a left join public.stock_movements m on m.id=a.stock_movement_id
    left join public.audit_events e on e.entity='stock_adjustments' and e.entity_id=a.id and e.action='STOCK_ADJUSTED'
    where m.id is null or e.id is null or a.quantity_after::bigint<>a.quantity_before::bigint+a.delta::bigint) as adjustment_audit_integrity;
rollback;
