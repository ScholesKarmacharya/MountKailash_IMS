-- Forward only. No accounts, balances or historical journals are reset/backfilled.
-- Sprint 0 granted trusted service-role day writes. Closing now goes through the
-- validated lifecycle RPC; account provisioning on profiles is unaffected.
revoke insert,update,delete,truncate,references,trigger on public.business_days from anon,authenticated,service_role;
create table public.business_day_closings (
  business_day_id uuid primary key references public.business_days(id),
  report jsonb not null check(jsonb_typeof(report)='object'),
  closed_by uuid not null references public.profiles(id),
  closed_at timestamptz not null,
  request_key uuid not null
);
create table public.business_day_amendments (
  id uuid primary key default gen_random_uuid(),
  original_day_id uuid not null references public.business_days(id),
  posting_day_id uuid not null references public.business_days(id),
  source_kind text not null check(source_kind in ('INVOICE_ADJUSTMENT','PAYMENT_REVERSAL','STOCK_CORRECTION')),
  source_id uuid not null, details jsonb not null, reason text not null,
  actor_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(source_kind,source_id), check(original_day_id<>posting_day_id)
);
create table public.warehouse_processing (
  id uuid primary key default gen_random_uuid(),
  business_day_id uuid not null references public.business_days(id),
  product_id uuid not null references public.products(id),
  operation text not null check(operation in ('REFILL','DAMAGE')),
  stock_kind public.stock_kind not null check(stock_kind in ('FULL_JAR','EMPTY_JAR')),
  quantity integer not null check(quantity between 1 and 1000000000),
  reason text not null check(length(btrim(reason)) between 3 and 500),
  actor_user_id uuid not null references public.profiles(id),
  request_key uuid not null, created_at timestamptz not null default now(),
  check(operation<>'REFILL' or stock_kind='EMPTY_JAR')
);
-- A location identity, not inventory: damaged jars cannot be loaded or refilled.
insert into public.stock_locations(code,name,kind) values('DAMAGED','Damaged jars','DAMAGE');
alter table public.stock_movements drop constraint stock_movement_type;
alter table public.stock_movements add constraint stock_movement_type check(movement_type in (
  'MANUAL_INCREASE','MANUAL_DECREASE','TRIP_LOAD','DELIVERY','EMPTY_COLLECTION','TRIP_RETURN','VARIANCE_LOSS','VARIANCE_GAIN',
  'REFILL_INPUT','REFILL_OUTPUT','WAREHOUSE_DAMAGE'));
alter table public.stock_movements drop constraint stock_movement_direction;
alter table public.stock_movements add constraint stock_movement_direction check(
  (movement_type in ('MANUAL_INCREASE','EMPTY_COLLECTION','VARIANCE_GAIN','REFILL_OUTPUT') and from_location_id is null and to_location_id is not null) or
  (movement_type in ('MANUAL_DECREASE','DELIVERY','VARIANCE_LOSS','REFILL_INPUT') and from_location_id is not null and to_location_id is null) or
  (movement_type in ('TRIP_LOAD','TRIP_RETURN','WAREHOUSE_DAMAGE') and from_location_id is not null and to_location_id is not null and from_location_id<>to_location_id));
alter table public.stock_movements drop constraint operational_movement_trip;
alter table public.stock_movements add constraint operational_movement_trip check(
  movement_type in ('MANUAL_INCREASE','MANUAL_DECREASE','REFILL_INPUT','REFILL_OUTPUT','WAREHOUSE_DAMAGE') or trip_id is not null);
alter table public.stock_movements add column processing_id uuid references public.warehouse_processing(id);
alter table public.stock_movements add constraint processing_reference check(
  (movement_type in ('REFILL_INPUT','REFILL_OUTPUT','WAREHOUSE_DAMAGE')) = (processing_id is not null));
create index amendments_original_day on public.business_day_amendments(original_day_id,created_at);
create index finance_journal_day on public.finance_journal(business_day_id,account);
create index verification_day on public.payment_verification_events(business_day_id);
create index custody_day on public.jar_custody_entries(business_day_id);
create index processing_day on public.warehouse_processing(business_day_id);
do $$ declare t text; begin
  foreach t in array array['business_day_closings','business_day_amendments','warehouse_processing'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy admin_read on public.%I for select to authenticated using(public.is_active_admin())',t);
    execute format('create trigger immutable before update or delete on public.%I for each row execute function public.reject_journal_mutation()',t);
    execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.reject_journal_mutation()',t);
  end loop;
end $$;
create function public.protect_closed_business_day() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='CLOSED' then raise exception using errcode='42501',message='Closed business days are immutable; post a correction on an open day.'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_closed before update or delete on public.business_days for each row execute function public.protect_closed_business_day();
create trigger no_truncate before truncate on public.business_days for each statement execute function public.reject_journal_mutation();
revoke all on function public.protect_closed_business_day() from public,anon,authenticated,service_role;
comment on table public.business_day_closings is 'Immutable version 1 archive. Later corrections post to a new OPEN day and are linked through amendments.';
