-- Run only in a disposable staging/local database via Supabase pgTAP.
-- All fixtures and changes roll back. Never reset Cloud to run this file.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','inventory-admin@test.example'),
 ('10000000-0000-0000-0000-000000000002','inventory-driver@test.example'),
 ('10000000-0000-0000-0000-000000000003','inventory-disabled@test.example');
insert into public.profiles(id,name,role,is_active) values
 ('10000000-0000-0000-0000-000000000001','TEST Inventory admin','ADMIN',true),
 ('10000000-0000-0000-0000-000000000002','TEST Inventory driver','DRIVER',true),
 ('10000000-0000-0000-0000-000000000003','TEST Inventory disabled','ADMIN',false);
-- Disposable database must have no operational day. This test never removes one.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.save_product('10000000-0000-0000-0000-000000000011','TEST-JAR','TEST 20L jar','FULL_JAR','jar','123.45',true,0,'Test catalog','10000000-0000-0000-0000-000000000021')$$,'Admin creates product');
select lives_ok($$select public.open_inventory_business_day('10000000-0000-0000-0000-000000000022')$$,'Admin opens Nepal day');
select is((select default_price::text from public.products where sku='TEST-JAR'),'123.45','Exact NUMERIC price');
select is((select count(*)::integer from public.inventory_balances where product_id='10000000-0000-0000-0000-000000000011'),2,'Separate jar full/empty states');
select lives_ok($$select public.adjust_warehouse_stock('10000000-0000-0000-0000-000000000011','FULL_JAR',10,'Opening count','',(select id from public.business_days where status='OPEN'),'10000000-0000-0000-0000-000000000023')$$,'Posts stock');
select lives_ok($$select public.adjust_warehouse_stock('10000000-0000-0000-0000-000000000011','FULL_JAR',10,'Opening count','',(select id from public.business_days where status='OPEN'),'10000000-0000-0000-0000-000000000023')$$,'Retry is safe');
select is((select quantity from public.inventory_balances where product_id='10000000-0000-0000-0000-000000000011' and stock_kind='FULL_JAR'),10,'Retry does not double stock');
select is((select count(*)::integer from public.stock_movements where product_id='10000000-0000-0000-0000-000000000011'),1,'One immutable movement');
select throws_ok($$select public.adjust_warehouse_stock('10000000-0000-0000-0000-000000000011','FULL_JAR',11,'Opening count','',(select id from public.business_days where status='OPEN'),'10000000-0000-0000-0000-000000000023')$$,'22023','Idempotency key already used for a different request.','Changed payload denied');
select throws_ok($$select public.adjust_warehouse_stock('10000000-0000-0000-0000-000000000011','FULL_JAR',-11,'Count correction','',(select id from public.business_days where status='OPEN'),'10000000-0000-0000-0000-000000000024')$$,'22023','Insufficient stock; balance cannot be negative.','Negative stock denied');
select throws_ok($$update public.inventory_balances set quantity=999$$,'42501',null,'Admin direct balance update denied');
select throws_ok($$delete from public.stock_movements$$,'42501',null,'Admin cannot delete history');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.inventory_balances),0,'Driver cannot read warehouse');
select is((select count(*)::integer from public.products),0,'No unassigned catalog exposed');
select is((select count(*)::integer from public.audit_events),0,'Driver cannot read audit');
select throws_ok($$select public.adjust_warehouse_stock('10000000-0000-0000-0000-000000000011','FULL_JAR',1,'Forged adjustment','','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000025')$$,'42501','Active admin required.','Driver RPC denied before mutation');
select throws_ok($$select public.save_product('10000000-0000-0000-0000-000000000011','TEST-JAR','Forgery','FULL_JAR','jar','1',true,1,'Forged change','10000000-0000-0000-0000-000000000026')$$,'42501','Active admin required.','Driver product mutation denied');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.open_inventory_business_day('10000000-0000-0000-0000-000000000027')$$,'42501','Active admin required.','Disabled admin denied');
reset role;
select throws_ok($$delete from public.stock_adjustments$$,'42501','Journal entries are immutable; append a correction.','Privileged journal deletion blocked');
select throws_ok($$truncate public.stock_movements cascade$$,'42501','Journal entries are immutable; append a correction.','Privileged truncate blocked');
select * from finish();
rollback;
