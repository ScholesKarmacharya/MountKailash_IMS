-- Forward only: no backfill of unverified Sprint 2 payment intents.
-- Deposit amounts and tax treatment remain explicit, administrator-confirmed settings.
create table public.billing_company (
  id boolean primary key default true check(id), name text not null,
  address text not null default '', phone text not null default '', registration text not null default '',
  tax_mode text not null default 'UNCONFIGURED' check(tax_mode in ('UNCONFIGURED','NO_TAX','EXPLICIT')),
  tax_label text not null default '', tax_rate numeric(5,2) not null default 0 check(tax_rate between 0 and 100),
  version integer not null default 1,
  check(tax_mode='EXPLICIT' or tax_rate=0)
);
insert into public.billing_company(name) values('Mount Kailash');
create table public.customer_billing (
  customer_id uuid primary key references public.customers(id),
  account_type text not null check(account_type in ('STANDARD','MONTHLY_CREDIT')),
  due_days integer check(due_days between 0 and 365),
  deposit_mode text not null check(deposit_mode in ('NONE','MANUAL')),
  version integer not null default 1
);
create table public.customer_prices (
  customer_id uuid references public.customers(id), product_id uuid references public.products(id),
  price numeric(14,2) not null check(price>=0), active boolean not null default true,
  version integer not null default 1, primary key(customer_id,product_id)
);
create table public.sales (
  id uuid primary key default gen_random_uuid(), visit_id uuid not null unique references public.trip_visits(id),
  customer_id uuid references public.customers(id), trip_id uuid not null references public.trips(id),
  driver_id uuid not null references public.profiles(id), vehicle_id uuid not null references public.vehicles(id),
  business_day_id uuid not null references public.business_days(id), actor_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id),
  product_id uuid not null references public.products(id), name text not null, sku text not null, unit text not null,
  quantity integer not null check(quantity>0), unit_price numeric(14,2) not null check(unit_price>=0),
  total numeric(14,2) not null check(total=quantity::numeric*unit_price), unique(sale_id,product_id)
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
  sale_id uuid not null unique references public.sales(id), company jsonb not null, customer jsonb not null,
  date_label date not null, due_date date,
  subtotal numeric(14,2) not null check(subtotal>=0), tax numeric(14,2) not null check(tax>=0),
  total numeric(14,2) not null check(total=subtotal+tax), created_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
  customer_id uuid references public.customers(id), trip_id uuid not null references public.trips(id),
  current_invoice_id uuid references public.invoices(id),
  company_snapshot jsonb not null, customer_snapshot jsonb not null,
  business_day_id uuid not null references public.business_days(id), actor_user_id uuid not null references public.profiles(id),
  method text not null check(method in ('CASH','FONEPAY')), amount numeric(14,2) not null check(amount>0),
  deposit_amount numeric(14,2) not null default 0 check(deposit_amount between 0 and amount),
  reference text not null default '', request_key uuid not null, created_at timestamptz not null default now()
);
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.payments(id),
  invoice_id uuid not null references public.invoices(id), amount numeric(14,2) not null check(amount>0),
  unique(payment_id,invoice_id)
);
create table public.payment_verification_events (
  id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
  payment_id uuid not null references public.payments(id),
  status text not null check(status in ('PENDING','CONFIRMED','REJECTED','REVERSED')),
  source text not null check(source in ('CASH_RECORDED','AWAITING_PROVIDER','ADMIN_MANUAL','ADMIN_REVERSAL')),
  reference text not null default '', evidence text not null,
  business_day_id uuid not null references public.business_days(id), actor_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index fonepay_confirmation_reference on public.payment_verification_events(lower(btrim(reference)))
  where status='CONFIRMED' and source='ADMIN_MANUAL';
create table public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id),
  subtotal_delta numeric(14,2) not null, tax_delta numeric(14,2) not null,
  reason text not null, business_day_id uuid not null references public.business_days(id),
  actor_user_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  check(subtotal_delta<>0 or tax_delta<>0)
);
create table public.customer_ledger (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
  invoice_id uuid not null references public.invoices(id), source_id uuid not null,
  kind text not null check(kind in ('INVOICE','PAYMENT','REVERSAL','ADJUSTMENT')),
  amount numeric(14,2) not null, business_day_id uuid not null references public.business_days(id),
  actor_user_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  unique(kind,source_id,invoice_id)
);
create table public.deposit_transactions (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
  payment_id uuid references public.payments(id), source_id uuid not null,
  kind text not null check(kind in ('RECEIPT','REFUND','REVERSAL')), amount numeric(14,2) not null check(amount<>0),
  reason text not null, business_day_id uuid not null references public.business_days(id),
  actor_user_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  unique(kind,source_id), check((kind='RECEIPT' and amount>0) or (kind<>'RECEIPT' and amount<0))
);
create table public.finance_journal (
  id uuid primary key default gen_random_uuid(), posting_id uuid not null, source_id uuid not null,
  kind text not null, account text not null check(account in ('RECEIVABLE','SALES','TAX_PAYABLE','CASH','FONEPAY','DEPOSIT_LIABILITY')),
  amount numeric(14,2) not null, business_day_id uuid not null references public.business_days(id),
  actor_user_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  unique(kind,source_id,account)
);
create table public.credit_issued (
  invoice_id uuid primary key references public.invoices(id), amount numeric(14,2) not null check(amount>=0)
);
-- A driver may read billing settings / aggregate prior credit only on a currently assigned live route.
create function public.finance_customer_access(p_customer uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_admin() or exists(select 1 from public.trip_customers r join public.trips t on t.id=r.trip_id
    join public.profiles p on p.id=auth.uid() where r.customer_id=p_customer and t.driver_id=auth.uid() and p.is_active
      and p.role='DRIVER' and t.status in ('DRAFT','LOADED','ACTIVE'));
$$;
revoke all on function public.finance_customer_access(uuid) from public,anon,service_role;
grant execute on function public.finance_customer_access(uuid) to authenticated;
do $$ declare t text; begin
  foreach t in array array['billing_company','customer_billing','customer_prices','sales','sale_items','invoices','payments',
    'payment_allocations','payment_verification_events','invoice_adjustments','customer_ledger','deposit_transactions','finance_journal','credit_issued'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    if t not in ('billing_company','customer_billing','customer_prices') then
      execute format('create trigger immutable before update or delete on public.%I for each row execute function public.reject_journal_mutation()',t);
      execute format('create trigger no_truncate before truncate on public.%I for each statement execute function public.reject_journal_mutation()',t);
    end if;
  end loop;
end $$;
create policy company_read on public.billing_company for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and is_active));
create policy billing_read on public.customer_billing for select to authenticated using(public.finance_customer_access(customer_id));
create policy prices_read on public.customer_prices for select to authenticated using(public.finance_customer_access(customer_id));
create policy sales_read on public.sales for select to authenticated using(public.can_read_trip(trip_id));
create policy items_read on public.sale_items for select to authenticated using(exists(select 1 from public.sales s where s.id=sale_id));
create policy invoice_read on public.invoices for select to authenticated using(exists(select 1 from public.sales s where s.id=sale_id));
create policy payments_read on public.payments for select to authenticated using(public.can_read_trip(trip_id));
create policy allocations_read on public.payment_allocations for select to authenticated using(exists(select 1 from public.payments p where p.id=payment_id));
create policy verification_read on public.payment_verification_events for select to authenticated using(exists(select 1 from public.payments p where p.id=payment_id));
create policy adjustments_read on public.invoice_adjustments for select to authenticated using(exists(select 1 from public.invoices i where i.id=invoice_id));
create policy ledger_read on public.customer_ledger for select to authenticated using(public.is_active_admin());
create policy deposits_read on public.deposit_transactions for select to authenticated using(public.is_active_admin() or exists(select 1 from public.payments p where p.id=payment_id));
create policy journal_read on public.finance_journal for select to authenticated using(public.is_active_admin());
create policy credit_read on public.credit_issued for select to authenticated using(exists(select 1 from public.invoices i where i.id=invoice_id));
create index sales_customer on public.sales(customer_id);
create index allocations_invoice on public.payment_allocations(invoice_id);
create index verification_payment on public.payment_verification_events(payment_id,sequence desc);
create index customer_ledger_customer on public.customer_ledger(customer_id);
create index deposits_customer on public.deposit_transactions(customer_id);
