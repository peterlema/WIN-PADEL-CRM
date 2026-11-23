-- WIN Gestión: calendario de canchas y reservas (2026-11-24).
-- Depende de: 20261123_win_private_username_pin_accounts.sql y de public.win_pin_session(p_token)
-- (sesión por usuario + PIN, devuelve account_id, display_name, role, expires_at).
-- Acceso: sólo service_role (Edge Function win-api). El navegador no tiene permisos directos.
-- No toca las tablas ni funciones de caja (win_cash_*).

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create table if not exists public.win_court_bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  court text not null check (court in ('C1','C2','C3','C4')),
  business_date date not null,
  start_time time not null check (extract(minute from start_time) in (0,30) and extract(second from start_time) = 0),
  duration_min integer not null check (duration_min between 30 and 720 and duration_min % 30 = 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null check (kind in ('RESERVA','CLASE','EVENTO','BLOQUEO')),
  holder text not null check (length(btrim(holder)) between 1 and 120),
  note text not null default '' check (length(note) <= 400),
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','CANCELLED')),
  created_by uuid not null references win_auth.login_accounts(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references win_auth.login_accounts(id),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 400),
  constraint win_court_bookings_range check (ends_at = starts_at + make_interval(mins => duration_min)),
  constraint win_court_bookings_cancel check (
    (status = 'CONFIRMED' and cancelled_at is null and cancelled_by is null)
    or (status = 'CANCELLED' and cancelled_at is not null and cancelled_by is not null and length(btrim(coalesce(cancel_reason,''))) > 0)
  ),
  -- Una cancha no puede tener dos reservas confirmadas superpuestas.
  constraint win_court_bookings_no_overlap exclude using gist (
    court with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'CONFIRMED')
);
create index if not exists win_court_bookings_day_idx on public.win_court_bookings (business_date, court);

create table if not exists public.win_court_booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.win_court_bookings(id),
  actor_id uuid not null references win_auth.login_accounts(id),
  occurred_at timestamptz not null default now(),
  action text not null check (action in ('CREATE','CANCEL')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index if not exists win_court_booking_events_booking_idx on public.win_court_booking_events (booking_id);

alter table public.win_court_bookings enable row level security;
alter table public.win_court_booking_events enable row level security;
revoke all on public.win_court_bookings, public.win_court_booking_events from public, anon, authenticated;
revoke all on sequence public.win_court_booking_events_id_seq from public, anon, authenticated;
grant select, insert, update on public.win_court_bookings, public.win_court_booking_events to service_role;
grant usage, select on sequence public.win_court_booking_events_id_seq to service_role;

-- Jornada comercial: los turnos que empiezan antes de las 06:00 pertenecen a la jornada anterior
-- (igual que la carga de madrugada del Apps Script). Ej.: jornada 24/11, 00:30 = 25/11 00:30.
create or replace function public.win_courts_starts_at_(p_date date, p_start time)
returns timestamptz language sql immutable set search_path = '' as $$
  select ((p_date + case when p_start < time '06:00' then 1 else 0 end) + p_start)
         at time zone 'America/Argentina/Buenos_Aires'
$$;

create or replace function public.win_courts_identity_(p_token text)
returns table (account_id uuid, display_name text, role text)
language plpgsql stable set search_path = '' as $$
begin
  return query select s.account_id, s.display_name, s.role from public.win_pin_session(p_token) s limit 1;
  if not found then raise exception 'SESSION_INVALID'; end if;
end $$;

create or replace function public.win_courts_json_(b public.win_court_bookings, p_names jsonb default '{}'::jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'cancha', b.court, 'fecha', b.business_date,
    'inicio', to_char(b.start_time, 'HH24:MI'),
    'fin', to_char(b.start_time + make_interval(mins => b.duration_min), 'HH24:MI'),
    'duracion', b.duration_min, 'tipo', b.kind, 'titular', b.holder, 'nota', b.note,
    'estado', b.status, 'creadoPor', coalesce(p_names ->> b.created_by::text, ''),
    'creadoPorId', b.created_by)
$$;

-- Ocupación del día: reservas confirmadas de la jornada.
create or replace function public.win_courts_day(p_token text, p_date date)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_names jsonb;
begin
  perform public.win_courts_identity_(p_token);
  if p_date is null then raise exception 'BOOKING_INVALID'; end if;
  select coalesce(jsonb_object_agg(a.id::text, a.display_name), '{}'::jsonb) into v_names
  from win_auth.login_accounts a
  where a.id in (select created_by from public.win_court_bookings where business_date = p_date);
  return jsonb_build_object(
    'fecha', p_date,
    'canchas', jsonb_build_array('C1','C2','C3','C4'),
    'reservas', coalesce((
      select jsonb_agg(public.win_courts_json_(b, v_names) order by b.start_time < time '06:00', b.start_time, b.court)
      from public.win_court_bookings b
      where b.business_date = p_date and b.status = 'CONFIRMED'), '[]'::jsonb));
end $$;

-- Resumen del mes para el calendario: minutos reservados por día.
create or replace function public.win_courts_month(p_token text, p_month date)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  perform public.win_courts_identity_(p_token);
  if p_month is null then raise exception 'BOOKING_INVALID'; end if;
  return jsonb_build_object(
    'mes', to_char(v_from, 'YYYY-MM'),
    'dias', coalesce((
      select jsonb_object_agg(d.business_date::text, jsonb_build_object('reservas', d.n, 'minutos', d.minutos))
      from (
        select business_date, count(*) as n, sum(duration_min) as minutos
        from public.win_court_bookings
        where business_date >= v_from and business_date < v_to and status = 'CONFIRMED'
        group by business_date) d), '{}'::jsonb));
end $$;

create or replace function public.win_courts_book(
  p_token text, p_request_id uuid, p_court text, p_date date, p_start text,
  p_duration integer, p_kind text, p_holder text, p_note text default '')
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_start time;
  v_starts timestamptz;
  v_existing public.win_court_bookings;
  v_new public.win_court_bookings;
  v_kind text := upper(btrim(coalesce(p_kind, '')));
  v_holder text := btrim(coalesce(p_holder, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if v_actor.role not in ('ADMIN','MANAGER','RECEPTION') then raise exception 'NOT_AUTHORIZED'; end if;

  if p_request_id is null or p_date is null or coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):(00|30)$'
     or p_court is null or p_court not in ('C1','C2','C3','C4')
     or v_kind not in ('RESERVA','CLASE','EVENTO','BLOQUEO')
     or length(v_holder) not between 1 and 120 or length(v_note) > 400 then
    raise exception 'BOOKING_INVALID';
  end if;
  if (v_kind in ('RESERVA','CLASE') and p_duration not in (60, 90, 120))
     or (v_kind in ('EVENTO','BLOQUEO') and (p_duration is null or p_duration not between 30 and 720 or p_duration % 30 <> 0)) then
    raise exception 'DURATION_INVALID';
  end if;

  v_start := p_start::time;
  v_starts := public.win_courts_starts_at_(p_date, v_start);

  -- Idempotencia: el mismo request_id devuelve la reserva ya creada si los datos coinciden.
  select * into v_existing from public.win_court_bookings where request_id = p_request_id;
  if found then
    if v_existing.court = p_court and v_existing.business_date = p_date and v_existing.start_time = v_start
       and v_existing.duration_min = p_duration and v_existing.kind = v_kind and v_existing.holder = v_holder then
      return public.win_courts_json_(v_existing);
    end if;
    raise exception 'REQUEST_ID_REUSED';
  end if;

  -- Sólo Administración puede cargar reservas que ya terminaron.
  if v_actor.role <> 'ADMIN' and v_starts + make_interval(mins => p_duration) < now() then
    raise exception 'BOOKING_IN_PAST';
  end if;

  begin
    insert into public.win_court_bookings
      (request_id, court, business_date, start_time, duration_min, starts_at, ends_at, kind, holder, note, created_by)
    values
      (p_request_id, p_court, p_date, v_start, p_duration, v_starts, v_starts + make_interval(mins => p_duration),
       v_kind, v_holder, v_note, v_actor.account_id)
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
  if length(v_reason) not between 1 and 400 then raise exception 'REASON_REQUIRED'; end if;

  select * into v_booking from public.win_court_bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'CONFIRMED' then raise exception 'BOOKING_NOT_FOUND'; end if;
  -- Cancela quien la creó o Administración / encargado.
  if v_actor.role not in ('ADMIN','MANAGER') and v_booking.created_by <> v_actor.account_id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.win_court_bookings
     set status = 'CANCELLED', cancelled_by = v_actor.account_id, cancelled_at = now(), cancel_reason = v_reason
   where id = p_booking_id
  returning * into v_booking;

  insert into public.win_court_booking_events (booking_id, actor_id, action, detail)
  values (v_booking.id, v_actor.account_id, 'CANCEL', jsonb_build_object('motivo', v_reason));
  return public.win_courts_json_(v_booking);
end $$;

revoke all on function public.win_courts_starts_at_(date, time) from public, anon, authenticated;
revoke all on function public.win_courts_identity_(text) from public, anon, authenticated;
revoke all on function public.win_courts_json_(public.win_court_bookings, jsonb) from public, anon, authenticated;
revoke all on function public.win_courts_day(text, date) from public, anon, authenticated;
revoke all on function public.win_courts_month(text, date) from public, anon, authenticated;
revoke all on function public.win_courts_book(text, uuid, text, date, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.win_courts_cancel(text, uuid, text) from public, anon, authenticated;
grant execute on function public.win_courts_starts_at_(date, time) to service_role;
grant execute on function public.win_courts_identity_(text) to service_role;
grant execute on function public.win_courts_json_(public.win_court_bookings, jsonb) to service_role;
grant execute on function public.win_courts_day(text, date) to service_role;
grant execute on function public.win_courts_month(text, date) to service_role;
grant execute on function public.win_courts_book(text, uuid, text, date, text, integer, text, text, text) to service_role;
grant execute on function public.win_courts_cancel(text, uuid, text) to service_role;
