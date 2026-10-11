-- Sprint 0: identity and business-day read model only.
-- No client writes. Lifecycle operations and audited RPCs are deferred to Sprint 4.
create type public.account_role as enum ('ADMIN', 'DRIVER');
create type public.business_day_status as enum ('OPEN', 'CLOSING_REVIEW', 'CLOSED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  role public.account_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_days (
  id uuid primary key default gen_random_uuid(),
  date_label date not null,
  opened_at timestamptz not null default now(),
  opened_by uuid not null references public.profiles(id),
  status public.business_day_status not null default 'OPEN',
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  constraint valid_close_metadata check (
    (status = 'CLOSED' and closed_at is not null and closed_by is not null and closed_at >= opened_at)
    or (status <> 'CLOSED' and closed_at is null and closed_by is null)
  )
);

-- Provisional single operating unit, explicitly extensible when confirmed.
-- Include review status: starting review must not permit a second active day.
create unique index one_active_business_day on public.business_days ((true))
  where status in ('OPEN', 'CLOSING_REVIEW');

create function public.is_active_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid())
    and role = 'ADMIN' and is_active);
$$;
revoke all on function public.is_active_admin() from public, anon;
grant execute on function public.is_active_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.business_days enable row level security;
revoke all on public.profiles, public.business_days from anon, authenticated;
grant select on public.profiles, public.business_days to authenticated;
grant all on public.profiles, public.business_days to service_role;

create policy profiles_read_self_or_admin on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_active_admin()));
create policy business_days_read_admin on public.business_days for select to authenticated
  using ((select public.is_active_admin()));

comment on table public.profiles is 'Provisioned by trusted admin tooling, never by signup metadata. No authenticated writes in Sprint 0.';
comment on table public.business_days is 'Manual lifecycle; date_label is a Nepal business-day label, not a transaction calendar date. No automatic close or stock reset.';
