-- WIN Gestion: foundational private financial model (2026-11-23)
-- Not production-ready. All direct frontend access denied.
create table if not exists public.win_staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role text not null check (role in ('ADMIN','MANAGER','RECEPTION','BAR')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.win_cash_shifts (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.win_staff(user_id),
  opened_at timestamptz not null default now(),
  business_date date not null,
  opening_cash numeric(14,2) not null check (opening_cash >= 0),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  closed_by uuid references public.win_staff(user_id),
  closed_at timestamptz,
  counted_cash numeric(14,2) check (counted_cash >= 0),
  note text not null default '',
  constraint win_cash_close_consistency check (
    (status='OPEN' and closed_at is null and closed_by is null and counted_cash is null)
    or (status='CLOSED' and closed_at is not null and closed_by is not null and counted_cash is not null and closed_at>=opened_at)
  )
);
-- Single shared physical cash drawer at a time; reconsider if independent drawers are introduced.
create unique index if not exists win_only_one_open_cash_shift
on public.win_cash_shifts (status) where status='OPEN';

create table if not exists public.win_cash_movements (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  shift_id uuid not null references public.win_cash_shifts(id),
  recorded_by uuid not null references public.win_staff(user_id),
  occurred_at timestamptz not null default now(),
  kind text not null check(kind in ('SALE','EXPENSE','WITHDRAWAL','DEPOSIT','REFUND','ADJUSTMENT')),
  business_unit text not null check(business_unit in ('COURTS','ACADEMY','EVENTS','CAFE_BAR','SHOP','GENERAL')),
  payment_method text not null check(payment_method in ('CASH','TRANSFER','CARD','OTHER')),
  amount_signed numeric(14,2) not null check(amount_signed<>0),
  reference_type text,
  reference_id text,
  note text not null default '',
  reversal_of uuid unique references public.win_cash_movements(id),
  constraint win_cash_reference_pair check ((reference_type is null)=(reference_id is null)),
  constraint win_cash_sign check(
    (kind in ('SALE','DEPOSIT') and amount_signed>0)
    or (kind in ('EXPENSE','WITHDRAWAL','REFUND') and amount_signed<0)
    or kind='ADJUSTMENT'
  ),
  constraint win_cash_reversal_different check(reversal_of is null or reversal_of<>id)
);
create index if not exists win_cash_movements_shift_idx on public.win_cash_movements(shift_id,occurred_at);
create index if not exists win_cash_movements_unit_idx on public.win_cash_movements(business_unit,occurred_at);

create table if not exists public.win_cash_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.win_staff(user_id),
  occurred_at timestamptz not null default now(),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail)='object')
);

-- Explicitly forbid browser roles. Only trusted server logic may access these tables.
alter table public.win_staff enable row level security;
alter table public.win_cash_shifts enable row level security;
alter table public.win_cash_movements enable row level security;
alter table public.win_cash_audit enable row level security;
revoke all on public.win_staff, public.win_cash_shifts, public.win_cash_movements, public.win_cash_audit from anon, authenticated;
revoke all on sequence public.win_cash_audit_id_seq from anon, authenticated;
grant select, insert, update, delete on public.win_staff, public.win_cash_shifts, public.win_cash_movements, public.win_cash_audit to service_role;
grant usage, select on sequence public.win_cash_audit_id_seq to service_role;
-- No RLS policies until authorization rules/endpoint are implemented.
