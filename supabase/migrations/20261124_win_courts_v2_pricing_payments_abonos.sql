-- WIN Gestión: reservas v2 (24/11/2026)
-- Precio de cancha, datos del cliente, cobro por turno jugado, abonos fijos semanales,
-- comprobantes de transferencia y quién recibió el efectivo (con horarios por persona).
-- Depende de: 20261123_* (cuentas, sesiones, RBAC) y 20261124_win_court_bookings.sql.
-- Seguridad: todo con RLS y sin acceso del navegador; sólo service_role (Edge Function win-courts).
-- Respeta la matriz de permisos de win_can_access (COURTS VIEW/CREATE/CANCEL; USERS MANAGE).
-- No toca las tablas ni funciones de caja (win_cash_*).

-- ---------------------------------------------------------------- 1. Precios
create table if not exists public.win_price_list (
  id bigint generated always as identity primary key,
  code text not null check (code in ('COURT_TURN')),
  amount_cash numeric(14,2) not null check (amount_cash > 0),
  amount_transfer numeric(14,2) not null check (amount_transfer > 0),
  valid_from date not null,
  created_by uuid references win_auth.login_accounts(id),
  created_at timestamptz not null default now(),
  unique (code, valid_from)
);
-- Turno de cancha de 90 minutos: $ 90.000 en efectivo o $ 100.000 por transferencia.
insert into public.win_price_list (code, amount_cash, amount_transfer, valid_from)
values ('COURT_TURN', 90000, 100000, date '2020-01-01') on conflict (code, valid_from) do nothing;

create or replace function public.win_court_price_(p_date date, p_method text)
returns numeric language sql stable set search_path = '' as $$
  select case p_method when 'CASH' then amount_cash when 'TRANSFER' then amount_transfer end
  from public.win_price_list where code = 'COURT_TURN' and valid_from <= p_date
  order by valid_from desc limit 1
$$;

-- ---------------------------------------------------------------- 2. Datos del cliente en la reserva
alter table public.win_court_bookings
  add column if not exists customer_name text,
  add column if not exists customer_whatsapp text,
  add column if not exists expected_method text check (expected_method in ('CASH','TRANSFER')),
  add column if not exists expected_amount numeric(14,2);
alter table public.win_court_bookings drop constraint if exists win_court_bookings_reserva_data;
alter table public.win_court_bookings add constraint win_court_bookings_reserva_data check (
  kind <> 'RESERVA' or (customer_name is not null and customer_whatsapp is not null
                        and expected_method is not null and expected_amount is not null)) not valid;

-- ---------------------------------------------------------------- 3. Abonos fijos semanales
create table if not exists public.win_court_abonos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  court text not null check (court in ('C1','C2','C3','C4')),
  weekday smallint not null check (weekday between 1 and 7),            -- 1 = lunes … 7 = domingo (de la jornada)
  start_time time not null check (extract(minute from start_time) in (0,30) and extract(second from start_time) = 0),
  duration_min integer not null default 90 check (duration_min = 90),
  customer_name text not null check (length(btrim(customer_name)) between 3 and 120),
  customer_whatsapp text not null check (customer_whatsapp ~ '^[0-9]{8,15}$'),
  expected_method text not null check (expected_method in ('CASH','TRANSFER')),
  starts_on date not null,
  ends_on date,                                                          -- null = vigente sin fecha de fin
  note text not null default '' check (length(note) <= 400),
  created_by uuid not null references win_auth.login_accounts(id),
  created_at timestamptz not null default now(),
  ended_by uuid references win_auth.login_accounts(id),
  ended_at timestamptz,
  end_reason text check (end_reason is null or length(end_reason) <= 400),
  constraint win_court_abonos_range check (ends_on is null or ends_on >= starts_on - 1)
);
create index if not exists win_court_abonos_slot_idx on public.win_court_abonos (court, weekday);

create table if not exists public.win_court_abono_skips (
  abono_id uuid not null references public.win_court_abonos(id),
  skip_date date not null,
  reason text not null check (length(btrim(reason)) between 1 and 400),
  created_by uuid not null references win_auth.login_accounts(id),
  created_at timestamptz not null default now(),
  primary key (abono_id, skip_date)
);

-- ---------------------------------------------------------------- 4. Cobros (uno por turno jugado) y comprobantes
create table if not exists public.win_court_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  booking_id uuid references public.win_court_bookings(id),
  abono_id uuid references public.win_court_abonos(id),
  occurrence_date date,
  method text not null check (method in ('CASH','TRANSFER')),
  amount numeric(14,2) not null check (amount > 0),
  received_by uuid references win_auth.login_accounts(id),               -- quién recibió el efectivo
  receipt_path text check (receipt_path is null or receipt_path ~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  paid_at timestamptz not null default now(),
  recorded_by uuid not null references win_auth.login_accounts(id),
  constraint win_court_payments_target check (
    (booking_id is not null and abono_id is null and occurrence_date is null)
    or (booking_id is null and abono_id is not null and occurrence_date is not null)),
  constraint win_court_payments_cash_receiver check (method <> 'CASH' or received_by is not null),
  constraint win_court_payments_receipt_method check (receipt_path is null or method = 'TRANSFER')
);
create unique index if not exists win_court_payments_booking_uq on public.win_court_payments (booking_id) where booking_id is not null;
create unique index if not exists win_court_payments_abono_uq on public.win_court_payments (abono_id, occurrence_date) where abono_id is not null;

-- ---------------------------------------------------------------- 5. Horarios de quien recibe el efectivo
create table if not exists public.win_receiver_schedule (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references win_auth.login_accounts(id),
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,                                                -- si es menor que el inicio, cruza la medianoche
  created_by uuid references win_auth.login_accounts(id),
  created_at timestamptz not null default now(),
  constraint win_receiver_schedule_diff check (start_time <> end_time)
);
create index if not exists win_receiver_schedule_idx on public.win_receiver_schedule (weekday, account_id);

create table if not exists public.win_court_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references win_auth.login_accounts(id),
  occurred_at timestamptz not null default now(),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

-- ---------------------------------------------------------------- 6. Permisos de tablas
alter table public.win_price_list enable row level security;
alter table public.win_court_abonos enable row level security;
alter table public.win_court_abono_skips enable row level security;
alter table public.win_court_payments enable row level security;
alter table public.win_receiver_schedule enable row level security;
alter table public.win_court_audit enable row level security;
revoke all on public.win_price_list, public.win_court_abonos, public.win_court_abono_skips, public.win_court_payments,
  public.win_receiver_schedule, public.win_court_audit from public, anon, authenticated;
revoke all on sequence public.win_price_list_id_seq, public.win_court_audit_id_seq from public, anon, authenticated;
grant select, insert, update on public.win_price_list, public.win_court_abonos to service_role;
grant select, insert, delete on public.win_court_abono_skips to service_role;
grant select, insert on public.win_court_payments, public.win_court_audit to service_role;
grant select, insert, update, delete on public.win_receiver_schedule to service_role;
grant usage, select on sequence public.win_price_list_id_seq, public.win_court_audit_id_seq to service_role;

-- ---------------------------------------------------------------- 7. Funciones auxiliares
create or replace function public.win_abono_minutes_(p_start time)
returns integer language sql immutable set search_path = '' as $$
  select extract(hour from p_start)::int * 60 + extract(minute from p_start)::int
         + case when p_start < time '06:00' then 1440 else 0 end
$$;

-- ¿Hay un abono vigente (no salteado) que ocupe esa cancha y horario ese día?
create or replace function public.win_court_abono_conflict_(p_court text, p_date date, p_start time, p_duration integer)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.win_court_abonos a
    where a.court = p_court and a.weekday = extract(isodow from p_date)::int
      and a.starts_on <= p_date and (a.ends_on is null or p_date <= a.ends_on)
      and not exists (select 1 from public.win_court_abono_skips s where s.abono_id = a.id and s.skip_date = p_date)
      and public.win_abono_minutes_(a.start_time) < public.win_abono_minutes_(p_start) + p_duration
      and public.win_abono_minutes_(p_start) < public.win_abono_minutes_(a.start_time) + a.duration_min)
$$;

-- Personas de turno en un momento dado (horario de Argentina).
create or replace function public.win_receivers_on_duty_(p_at timestamptz)
returns setof uuid language sql stable set search_path = '' as $$
  with l as (
    select (p_at at time zone 'America/Argentina/Buenos_Aires') as ts
  ), x as (
    select extract(isodow from ts)::int as dow, ts::time as t,
           case when extract(isodow from ts)::int = 1 then 7 else extract(isodow from ts)::int - 1 end as prev
    from l
  )
  select distinct s.account_id
  from public.win_receiver_schedule s
  join win_auth.login_accounts a on a.id = s.account_id and a.enabled
  cross join x
  where (s.weekday = x.dow and ((s.start_time < s.end_time and x.t >= s.start_time and x.t < s.end_time)
                                or (s.start_time > s.end_time and x.t >= s.start_time)))
     or (s.weekday = x.prev and s.start_time > s.end_time and x.t < s.end_time)
$$;

create or replace function public.win_courts_identity_(p_token text)
returns table (account_id uuid, display_name text, role text)
language plpgsql stable set search_path = '' as $$
begin
  return query select s.account_id, s.display_name, s.role from public.win_pin_session(p_token) s limit 1;
  if not found then raise exception 'SESSION_INVALID'; end if;
  if not public.win_can_access((select s.account_id from public.win_pin_session(p_token) s limit 1), 'COURTS', 'VIEW') then
    raise exception 'NOT_AUTHORIZED';
  end if;
end $$;

create or replace function public.win_courts_pay_json_(p public.win_court_payments)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'metodo', p.method, 'monto', p.amount, 'recibio', p.received_by,
    'comprobante', p.receipt_path is not null, 'ruta', p.receipt_path, 'fecha', p.paid_at)
$$;

create or replace function public.win_courts_json_(b public.win_court_bookings, p_names jsonb default '{}'::jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'cancha', b.court, 'fecha', b.business_date,
    'inicio', to_char(b.start_time, 'HH24:MI'),
    'fin', to_char(b.start_time + make_interval(mins => b.duration_min), 'HH24:MI'),
    'duracion', b.duration_min, 'tipo', b.kind, 'titular', b.holder, 'nota', b.note,
    'estado', b.status, 'creadoPor', coalesce(p_names ->> b.created_by::text, ''), 'creadoPorId', b.created_by,
    'nombreCompleto', b.customer_name, 'whatsapp', b.customer_whatsapp,
    'metodoPrevisto', b.expected_method, 'montoPrevisto', b.expected_amount,
    'pago', (select public.win_courts_pay_json_(p) from public.win_court_payments p where p.booking_id = b.id))
$$;

-- ---------------------------------------------------------------- 8. Lectura: día y mes (reservas + abonos)
create or replace function public.win_courts_day(p_token text, p_date date)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_names jsonb;
begin
  perform public.win_courts_identity_(p_token);
  if p_date is null then raise exception 'BOOKING_INVALID'; end if;
  select coalesce(jsonb_object_agg(a.id::text, a.display_name), '{}'::jsonb) into v_names from win_auth.login_accounts a;
  return jsonb_build_object(
    'fecha', p_date,
    'canchas', jsonb_build_array('C1','C2','C3','C4'),
    'precio', jsonb_build_object('efectivo', public.win_court_price_(p_date, 'CASH'), 'transferencia', public.win_court_price_(p_date, 'TRANSFER')),
    'reservas', coalesce((
      select jsonb_agg(j.o order by j.m, j.court) from (
        select public.win_courts_json_(b, v_names) as o, public.win_abono_minutes_(b.start_time) as m, b.court
        from public.win_court_bookings b
        where b.business_date = p_date and b.status = 'CONFIRMED'
        union all
        select jsonb_build_object(
          'id', a.id, 'abonoId', a.id, 'cancha', a.court, 'fecha', p_date,
          'inicio', to_char(a.start_time, 'HH24:MI'),
          'fin', to_char(a.start_time + make_interval(mins => a.duration_min), 'HH24:MI'),
          'duracion', a.duration_min, 'tipo', 'ABONO', 'titular', a.customer_name, 'nombreCompleto', a.customer_name,
          'whatsapp', a.customer_whatsapp, 'metodoPrevisto', a.expected_method,
          'montoPrevisto', public.win_court_price_(p_date, a.expected_method), 'nota', a.note, 'estado', 'CONFIRMED',
          'creadoPorId', a.created_by, 'creadoPor', coalesce(v_names ->> a.created_by::text, ''), 'desde', a.starts_on,
          'pago', (select public.win_courts_pay_json_(p) from public.win_court_payments p
                   where p.abono_id = a.id and p.occurrence_date = p_date)),
          public.win_abono_minutes_(a.start_time), a.court
        from public.win_court_abonos a
        where a.weekday = extract(isodow from p_date)::int and a.starts_on <= p_date
          and (a.ends_on is null or p_date <= a.ends_on)
          and not exists (select 1 from public.win_court_abono_skips s where s.abono_id = a.id and s.skip_date = p_date)
      ) j), '[]'::jsonb));
end $$;

create or replace function public.win_courts_month(p_token text, p_month date)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  perform public.win_courts_identity_(p_token);
  if p_month is null then raise exception 'BOOKING_INVALID'; end if;
  return jsonb_build_object('mes', to_char(v_from, 'YYYY-MM'), 'dias', coalesce((
    select jsonb_object_agg(t.d::text, jsonb_build_object('reservas', t.n, 'minutos', t.m))
    from (
      select u.d, sum(u.n)::int as n, sum(u.m)::int as m from (
        select b.business_date as d, count(*) as n, sum(b.duration_min) as m
        from public.win_court_bookings b
        where b.business_date >= v_from and b.business_date < v_to and b.status = 'CONFIRMED' group by b.business_date
        union all
        select g.d::date, count(*), sum(a.duration_min)
        from generate_series(v_from::timestamp, (v_to - 1)::timestamp, interval '1 day') as g(d)
        join public.win_court_abonos a on a.weekday = extract(isodow from g.d)::int and a.starts_on <= g.d::date
          and (a.ends_on is null or g.d::date <= a.ends_on)
        where not exists (select 1 from public.win_court_abono_skips s where s.abono_id = a.id and s.skip_date = g.d::date)
        group by g.d
      ) u group by u.d) t), '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------- 9. Reserva (con datos del cliente)
drop function if exists public.win_courts_book(text, uuid, text, date, text, integer, text, text, text);
create or replace function public.win_courts_book(
  p_token text, p_request_id uuid, p_court text, p_date date, p_start text, p_duration integer,
  p_kind text, p_holder text, p_note text default '',
  p_customer_name text default null, p_customer_whatsapp text default null, p_method text default null)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_start time;
  v_starts timestamptz;
  v_existing public.win_court_bookings;
  v_new public.win_court_bookings;
  v_kind text := upper(btrim(coalesce(p_kind, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_name text := btrim(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g'));
  v_wpp text := regexp_replace(coalesce(p_customer_whatsapp, ''), '[^0-9]', '', 'g');
  v_method text := upper(btrim(coalesce(p_method, '')));
  v_holder text;
  v_amount numeric;
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CREATE') then raise exception 'NOT_AUTHORIZED'; end if;

  if v_kind = 'RESERVA' and (v_name !~ '^\S+ \S+' or v_wpp !~ '^[0-9]{8,15}$' or v_method not in ('CASH','TRANSFER')) then
    raise exception 'CUSTOMER_REQUIRED';
  end if;
  v_holder := case when v_kind = 'RESERVA' then v_name else btrim(coalesce(p_holder, '')) end;
  if p_request_id is null or p_date is null or coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):(00|30)$'
     or p_court is null or p_court not in ('C1','C2','C3','C4')
     or v_kind not in ('RESERVA','CLASE','EVENTO','BLOQUEO')
     or length(v_holder) not between 1 and 120 or length(v_note) > 400 then
    raise exception 'BOOKING_INVALID';
  end if;
  -- Los turnos de cancha son siempre de 90 minutos.
  if (v_kind = 'RESERVA' and p_duration is distinct from 90)
     or (v_kind = 'CLASE' and p_duration not in (60, 90, 120))
     or (v_kind in ('EVENTO','BLOQUEO') and (p_duration is null or p_duration not between 30 and 720 or p_duration % 30 <> 0)) then
    raise exception 'DURATION_INVALID';
  end if;

  v_start := p_start::time;
  v_starts := public.win_courts_starts_at_(p_date, v_start);

  select * into v_existing from public.win_court_bookings where request_id = p_request_id;
  if found then
    if v_existing.court = p_court and v_existing.business_date = p_date and v_existing.start_time = v_start
       and v_existing.duration_min = p_duration and v_existing.kind = v_kind and v_existing.holder = v_holder then
      return public.win_courts_json_(v_existing);
    end if;
    raise exception 'REQUEST_ID_REUSED';
  end if;

  if v_actor.role <> 'ADMIN' and v_starts + make_interval(mins => p_duration) < now() then raise exception 'BOOKING_IN_PAST'; end if;
  if public.win_court_abono_conflict_(p_court, p_date, v_start, p_duration) then raise exception 'COURT_TAKEN'; end if;

  v_amount := case when v_kind = 'RESERVA' then public.win_court_price_(p_date, v_method) end;
  if v_kind = 'RESERVA' and v_amount is null then raise exception 'PRICE_MISSING'; end if;

  begin
    insert into public.win_court_bookings
      (request_id, court, business_date, start_time, duration_min, starts_at, ends_at, kind, holder, note, created_by,
       customer_name, customer_whatsapp, expected_method, expected_amount)
    values
      (p_request_id, p_court, p_date, v_start, p_duration, v_starts, v_starts + make_interval(mins => p_duration),
       v_kind, v_holder, v_note, v_actor.account_id,
       case when v_kind = 'RESERVA' then v_name end, case when v_kind = 'RESERVA' then v_wpp end,
       case when v_kind = 'RESERVA' then v_method end, v_amount)
    returning * into v_new;
  exception
    when exclusion_violation then raise exception 'COURT_TAKEN';
    when unique_violation then raise exception 'REQUEST_ID_REUSED';
  end;

  insert into public.win_court_booking_events (booking_id, actor_id, action, detail)
  values (v_new.id, v_actor.account_id, 'CREATE', public.win_courts_json_(v_new));
  return public.win_courts_json_(v_new);
end $$;

create or replace function public.win_courts_cancel(p_token text, p_booking_id uuid, p_reason text)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_booking public.win_court_bookings;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CANCEL') then raise exception 'NOT_AUTHORIZED'; end if;
  if length(v_reason) not between 1 and 400 then raise exception 'REASON_REQUIRED'; end if;

  select * into v_booking from public.win_court_bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'CONFIRMED' then raise exception 'BOOKING_NOT_FOUND'; end if;
  if v_actor.role not in ('ADMIN','MANAGER') and v_booking.created_by <> v_actor.account_id then raise exception 'NOT_AUTHORIZED'; end if;
  if exists (select 1 from public.win_court_payments p where p.booking_id = p_booking_id) then raise exception 'BOOKING_PAID'; end if;

  update public.win_court_bookings
     set status = 'CANCELLED', cancelled_by = v_actor.account_id, cancelled_at = now(), cancel_reason = v_reason
   where id = p_booking_id returning * into v_booking;

  insert into public.win_court_booking_events (booking_id, actor_id, action, detail)
  values (v_booking.id, v_actor.account_id, 'CANCEL', jsonb_build_object('motivo', v_reason));
  return public.win_courts_json_(v_booking);
end $$;

-- ---------------------------------------------------------------- 10. Cobro del turno jugado
create or replace function public.win_courts_pay(
  p_token text, p_request_id uuid, p_booking_id uuid, p_abono_id uuid, p_date date, p_method text,
  p_received_by uuid default null, p_receipt_path text default null)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_method text := upper(btrim(coalesce(p_method, '')));
  v_existing public.win_court_payments;
  v_bk public.win_court_bookings;
  v_ab public.win_court_abonos;
  v_date date;
  v_start timestamptz;
  v_amount numeric;
  v_recv uuid;
  v_pay public.win_court_payments;
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CREATE') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_request_id is null or v_method not in ('CASH','TRANSFER') or ((p_booking_id is null) = (p_abono_id is null))
     or (p_receipt_path is not null and v_method <> 'TRANSFER') then
    raise exception 'PAYMENT_INVALID';
  end if;

  select * into v_existing from public.win_court_payments where request_id = p_request_id;
  if found then
    if v_existing.method = v_method and coalesce(v_existing.booking_id, v_existing.abono_id) = coalesce(p_booking_id, p_abono_id) then
      return public.win_courts_pay_json_(v_existing);
    end if;
    raise exception 'REQUEST_ID_REUSED';
  end if;

  if p_booking_id is not null then
    select * into v_bk from public.win_court_bookings where id = p_booking_id for update;
    if not found or v_bk.status <> 'CONFIRMED' or v_bk.kind <> 'RESERVA' then raise exception 'BOOKING_NOT_FOUND'; end if;
    v_date := v_bk.business_date; v_start := v_bk.starts_at;
  else
    select * into v_ab from public.win_court_abonos where id = p_abono_id for update;
    if not found or p_date is null
       or extract(isodow from p_date)::int <> v_ab.weekday or p_date < v_ab.starts_on
       or (v_ab.ends_on is not null and p_date > v_ab.ends_on)
       or exists (select 1 from public.win_court_abono_skips s where s.abono_id = p_abono_id and s.skip_date = p_date) then
      raise exception 'BOOKING_NOT_FOUND';
    end if;
    v_date := p_date; v_start := public.win_courts_starts_at_(p_date, v_ab.start_time);
  end if;

  -- El cobro se marca después de que empezó el turno (Administración puede adelantarlo).
  if v_actor.role <> 'ADMIN' and v_start > now() then raise exception 'PAY_TOO_EARLY'; end if;

  v_amount := public.win_court_price_(v_date, v_method);
  if v_amount is null then raise exception 'PRICE_MISSING'; end if;

  if v_method = 'CASH' then
    v_recv := coalesce(p_received_by, (select r from public.win_receivers_on_duty_(now()) r limit 1), v_actor.account_id);
    if not exists (select 1 from win_auth.login_accounts a where a.id = v_recv and a.enabled) then raise exception 'RECEIVER_INVALID'; end if;
  end if;

  begin
    insert into public.win_court_payments
      (request_id, booking_id, abono_id, occurrence_date, method, amount, received_by, receipt_path, recorded_by)
    values
      (p_request_id, p_booking_id, p_abono_id, case when p_abono_id is not null then v_date end, v_method, v_amount, v_recv,
       p_receipt_path, v_actor.account_id)
    returning * into v_pay;
  exception
    when unique_violation then raise exception 'ALREADY_PAID';
  end;

  insert into public.win_court_audit (actor_id, action, entity_type, entity_id, detail)
  values (v_actor.account_id, 'PAY', case when p_booking_id is not null then 'BOOKING' else 'ABONO' end,
          coalesce(p_booking_id, p_abono_id)::text, public.win_courts_pay_json_(v_pay) || jsonb_build_object('fechaTurno', v_date));
  return public.win_courts_pay_json_(v_pay);
end $$;

-- ---------------------------------------------------------------- 11. Abonos: alta, baja, salteo
create or replace function public.win_courts_abono_create(
  p_token text, p_request_id uuid, p_court text, p_date date, p_start text,
  p_customer_name text, p_customer_whatsapp text, p_method text, p_note text default '')
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_existing public.win_court_abonos;
  v_new public.win_court_abonos;
  v_start time;
  v_wd int;
  v_name text := btrim(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g'));
  v_wpp text := regexp_replace(coalesce(p_customer_whatsapp, ''), '[^0-9]', '', 'g');
  v_method text := upper(btrim(coalesce(p_method, '')));
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CREATE') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_request_id is null or p_date is null or coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):(00|30)$'
     or p_court is null or p_court not in ('C1','C2','C3','C4') or length(v_note) > 400 then
    raise exception 'BOOKING_INVALID';
  end if;
  if v_name !~ '^\S+ \S+' or v_wpp !~ '^[0-9]{8,15}$' or v_method not in ('CASH','TRANSFER') then raise exception 'CUSTOMER_REQUIRED'; end if;

  select * into v_existing from public.win_court_abonos where request_id = p_request_id;
  if found then
    if v_existing.court = p_court and v_existing.starts_on = p_date and v_existing.start_time = p_start::time and v_existing.customer_name = v_name then
      return jsonb_build_object('id', v_existing.id, 'cancha', v_existing.court, 'desde', v_existing.starts_on);
    end if;
    raise exception 'REQUEST_ID_REUSED';
  end if;

  v_start := p_start::time;
  v_wd := extract(isodow from p_date)::int;
  if v_actor.role <> 'ADMIN' and p_date < (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1 then raise exception 'BOOKING_IN_PAST'; end if;

  -- Contra otros abonos vigentes y contra reservas confirmadas desde la fecha de inicio.
  if exists (select 1 from public.win_court_abonos a
             where a.court = p_court and a.weekday = v_wd and (a.ends_on is null or a.ends_on >= p_date)
               and public.win_abono_minutes_(a.start_time) < public.win_abono_minutes_(v_start) + 90
               and public.win_abono_minutes_(v_start) < public.win_abono_minutes_(a.start_time) + a.duration_min)
     or exists (select 1 from public.win_court_bookings b
                where b.status = 'CONFIRMED' and b.court = p_court and b.business_date >= p_date
                  and extract(isodow from b.business_date)::int = v_wd
                  and public.win_abono_minutes_(b.start_time) < public.win_abono_minutes_(v_start) + 90
                  and public.win_abono_minutes_(v_start) < public.win_abono_minutes_(b.start_time) + b.duration_min) then
    raise exception 'ABONO_CONFLICT';
  end if;

  insert into public.win_court_abonos
    (request_id, court, weekday, start_time, customer_name, customer_whatsapp, expected_method, starts_on, note, created_by)
  values (p_request_id, p_court, v_wd, v_start, v_name, v_wpp, v_method, p_date, v_note, v_actor.account_id)
  returning * into v_new;

  insert into public.win_court_audit (actor_id, action, entity_type, entity_id, detail)
  values (v_actor.account_id, 'ABONO_CREATE', 'ABONO', v_new.id::text,
          jsonb_build_object('cancha', p_court, 'diaSemana', v_wd, 'inicio', p_start, 'desde', p_date, 'titular', v_name));
  return jsonb_build_object('id', v_new.id, 'cancha', v_new.court, 'diaSemana', v_new.weekday, 'inicio', p_start, 'desde', v_new.starts_on);
end $$;

-- Baja: el abono deja de aparecer desde p_from (las fechas anteriores y sus cobros se conservan).
create or replace function public.win_courts_abono_end(p_token text, p_abono_id uuid, p_from date, p_reason text)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_ab public.win_court_abonos;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CANCEL') then raise exception 'NOT_AUTHORIZED'; end if;
  if length(v_reason) not between 1 and 400 or p_from is null then raise exception 'REASON_REQUIRED'; end if;
  select * into v_ab from public.win_court_abonos where id = p_abono_id for update;
  if not found or (v_ab.ends_on is not null) then raise exception 'BOOKING_NOT_FOUND'; end if;
  update public.win_court_abonos
     set ends_on = greatest(p_from - 1, starts_on - 1), ended_by = v_actor.account_id, ended_at = now(), end_reason = v_reason
   where id = p_abono_id returning * into v_ab;
  insert into public.win_court_audit (actor_id, action, entity_type, entity_id, detail)
  values (v_actor.account_id, 'ABONO_END', 'ABONO', p_abono_id::text, jsonb_build_object('desde', p_from, 'motivo', v_reason));
  return jsonb_build_object('id', v_ab.id, 'terminaEl', v_ab.ends_on);
end $$;

create or replace function public.win_courts_abono_skip(p_token text, p_abono_id uuid, p_date date, p_reason text, p_undo boolean default false)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_ab public.win_court_abonos;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CANCEL') then raise exception 'NOT_AUTHORIZED'; end if;
  select * into v_ab from public.win_court_abonos where id = p_abono_id;
  if not found or p_date is null or extract(isodow from p_date)::int <> v_ab.weekday or p_date < v_ab.starts_on
     or (v_ab.ends_on is not null and p_date > v_ab.ends_on) then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if p_undo then
    delete from public.win_court_abono_skips where abono_id = p_abono_id and skip_date = p_date;
  else
    if length(v_reason) not between 1 and 400 then raise exception 'REASON_REQUIRED'; end if;
    if exists (select 1 from public.win_court_payments p where p.abono_id = p_abono_id and p.occurrence_date = p_date) then raise exception 'BOOKING_PAID'; end if;
    insert into public.win_court_abono_skips (abono_id, skip_date, reason, created_by)
    values (p_abono_id, p_date, v_reason, v_actor.account_id) on conflict do nothing;
  end if;
  insert into public.win_court_audit (actor_id, action, entity_type, entity_id, detail)
  values (v_actor.account_id, case when p_undo then 'ABONO_UNSKIP' else 'ABONO_SKIP' end, 'ABONO', p_abono_id::text,
          jsonb_build_object('fecha', p_date, 'motivo', v_reason));
  return jsonb_build_object('id', p_abono_id, 'fecha', p_date, 'salteado', not p_undo);
end $$;

-- ---------------------------------------------------------------- 12. Quién recibe el efectivo
create or replace function public.win_courts_receivers(p_token text, p_at timestamptz default now())
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  perform public.win_courts_identity_(p_token);
  return jsonb_build_object(
    'deTurno', coalesce((select jsonb_agg(r) from public.win_receivers_on_duty_(p_at) r), '[]'::jsonb),
    'personas', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.display_name, 'rol', a.role,
               'deTurno', a.id in (select public.win_receivers_on_duty_(p_at))) order by a.display_name)
      from win_auth.login_accounts a where a.enabled and a.role in ('ADMIN','MANAGER','RECEPTION')), '[]'::jsonb));
end $$;

create or replace function public.win_courts_schedule_list(p_token text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_actor record;
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'USERS', 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cuentaId', s.account_id, 'nombre', a.display_name,
      'diaSemana', s.weekday, 'desde', to_char(s.start_time, 'HH24:MI'), 'hasta', to_char(s.end_time, 'HH24:MI'))
      order by s.weekday, s.start_time)
    from public.win_receiver_schedule s join win_auth.login_accounts a on a.id = s.account_id), '[]'::jsonb);
end $$;

create or replace function public.win_courts_schedule_set(p_token text, p_account_id uuid, p_weekday integer, p_from text, p_to text)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare v_actor record; v_id uuid;
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'USERS', 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_weekday not between 1 and 7 or coalesce(p_from, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_to, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or p_from = p_to or not exists (select 1 from win_auth.login_accounts a where a.id = p_account_id and a.enabled) then
    raise exception 'SCHEDULE_INVALID';
  end if;
  insert into public.win_receiver_schedule (account_id, weekday, start_time, end_time, created_by)
  values (p_account_id, p_weekday, p_from::time, p_to::time, v_actor.account_id) returning id into v_id;
  insert into public.win_court_audit (actor_id, action, entity_type, entity_id, detail)
  values (v_actor.account_id, 'SCHEDULE_SET', 'SCHEDULE', v_id::text, jsonb_build_object('cuentaId', p_account_id, 'diaSemana', p_weekday, 'desde', p_from, 'hasta', p_to));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.win_courts_schedule_delete(p_token text, p_id uuid)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare v_actor record;
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'USERS', 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  delete from public.win_receiver_schedule where id = p_id;
  insert into public.win_court_audit (actor_id, action, entity_type, entity_id) values (v_actor.account_id, 'SCHEDULE_DELETE', 'SCHEDULE', p_id::text);
  return jsonb_build_object('id', p_id);
end $$;

-- ---------------------------------------------------------------- 13. Comprobantes (archivos en Storage privado)
-- La Edge Function emite URLs firmadas de subida y de lectura; el navegador nunca tiene acceso directo al bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('win-comprobantes', 'win-comprobantes', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create or replace function public.win_courts_can_create(p_token text)
returns boolean language plpgsql stable set search_path = '' as $$
declare v_actor record;
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CREATE') then raise exception 'NOT_AUTHORIZED'; end if;
  return true;
end $$;

create or replace function public.win_courts_receipt_check(p_token text, p_path text)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  perform public.win_courts_identity_(p_token);
  if not exists (select 1 from public.win_court_payments p where p.receipt_path = p_path) then raise exception 'BOOKING_NOT_FOUND'; end if;
  return true;
end $$;

-- ---------------------------------------------------------------- 14. Permisos de funciones
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'win\_courts\_%' or p.proname in
      ('win_court_price_','win_abono_minutes_','win_court_abono_conflict_','win_receivers_on_duty_'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
