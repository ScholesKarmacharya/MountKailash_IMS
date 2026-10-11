begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@test.example'),
  ('00000000-0000-0000-0000-000000000002', 'driver@test.example'),
  ('00000000-0000-0000-0000-000000000003', 'disabled@test.example');
insert into public.profiles (id, name, role, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'TEST Admin', 'ADMIN', true),
  ('00000000-0000-0000-0000-000000000002', 'TEST Driver', 'DRIVER', true),
  ('00000000-0000-0000-0000-000000000003', 'TEST Disabled', 'ADMIN', false);
insert into public.business_days (date_label, opened_by) values
  ('2026-10-11', '00000000-0000-0000-0000-000000000001');

select throws_ok($$insert into public.business_days (date_label,opened_by) values ('2026-10-12','00000000-0000-0000-0000-000000000001')$$, '23505', null, 'Only one active day');
update public.business_days set status = 'CLOSING_REVIEW';
select throws_ok($$insert into public.business_days (date_label,opened_by) values ('2026-10-12','00000000-0000-0000-0000-000000000001')$$, '23505', null, 'Review blocks a second active day');
select throws_ok($$update public.business_days set status = 'CLOSED'$$, '23514', null, 'Closed days require closing metadata');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.profiles), 1, 'Driver reads only self');
select is((select count(*)::integer from public.business_days), 0, 'Driver cannot read admin days');
select throws_ok($$update public.profiles set role='ADMIN'$$, '42501', null, 'Driver cannot self-promote');
select throws_ok($$insert into public.business_days (date_label,opened_by) values ('2026-10-12','00000000-0000-0000-0000-000000000002')$$, '42501', null, 'Driver cannot open day');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.profiles where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003')), 3, 'Admin reads profiles');
select is((select count(*)::integer from public.business_days), 1, 'Admin reads active day');
select throws_ok($$update public.business_days set status='CLOSED'$$, '42501', null, 'Direct lifecycle writes deferred, even for admin');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.business_days), 0, 'Disabled admin cannot read days');
select is((select count(*)::integer from public.profiles), 1, 'Disabled admin has no global profile read');
select * from finish();
rollback;
