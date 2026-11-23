-- WIN Gestión: reservas v3 (24/11/2026)
-- 1) El método de pago (efectivo o transferencia) ya no se elige al reservar: se marca al cobrar el turno.
--    La reserva sólo exige nombre completo y WhatsApp. El importe lo fija el método elegido al cobrar.
-- 2) El cobro se marca cuando TERMINA el turno (Administración puede adelantarlo).
-- 3) Duraciones: reservas y abonos de 60, 90 o 120 min (90 por defecto); clase particular 60; clase partido 90.
--    El precio depende de la duración (win_price_list.duration_min). Hoy sólo está cargado el de 90 min:
--    cobrar un turno de 60 o 120 min da PRICE_MISSING hasta cargar esos precios.
-- Aplicar después de 20261124_win_courts_v2_pricing_payments_abonos.sql. Es repetible.
-- Los parámetros p_method de reservar y de crear abono se conservan por compatibilidad, pero se ignoran.

alter table public.win_court_bookings drop constraint if exists win_court_bookings_reserva_data;
alter table public.win_court_bookings add constraint win_court_bookings_reserva_data check (
  kind <> 'RESERVA' or (customer_name is not null and customer_whatsapp is not null)) not valid;
alter table public.win_court_abonos alter column expected_method drop not null;

-- Precios por duración
alter table public.win_price_list add column if not exists duration_min integer not null default 90;
alter table public.win_price_list drop constraint if exists win_price_list_duration_check;
alter table public.win_price_list add constraint win_price_list_duration_check check (duration_min in (60, 90, 120));
alter table public.win_price_list drop constraint if exists win_price_list_code_valid_from_key;
alter table public.win_price_list drop constraint if exists win_price_list_code_dur_from_key;
alter table public.win_price_list add constraint win_price_list_code_dur_from_key unique (code, duration_min, valid_from);

-- La versión sin duración informa el precio del turno de 90 minutos.
create or replace function public.win_court_price_(p_date date, p_method text)
returns numeric language sql stable set search_path = '' as $$
  select case p_method when 'CASH' then amount_cash when 'TRANSFER' then amount_transfer end
  from public.win_price_list where code = 'COURT_TURN' and duration_min = 90 and valid_from <= p_date
  order by valid_from desc limit 1
$$;

create or replace function public.win_court_price_(p_date date, p_method text, p_duration integer)
returns numeric language sql stable set search_path = '' as $$
  select case p_method when 'CASH' then amount_cash when 'TRANSFER' then amount_transfer end
  from public.win_price_list where code = 'COURT_TURN' and duration_min = p_duration and valid_from <= p_date
  order by valid_from desc limit 1
$$;

-- Abonos de 60, 90 o 120 minutos
alter table public.win_court_abonos drop constraint if exists win_court_abonos_duration_min_check;
alter table public.win_court_abonos add constraint win_court_abonos_duration_min_check check (duration_min in (60, 90, 120));

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
    'precios', (select jsonb_object_agg(d::text, jsonb_build_object(
        'efectivo', public.win_court_price_(p_date, 'CASH', d), 'transferencia', public.win_court_price_(p_date, 'TRANSFER', d)))
      from unnest(array[60, 90, 120]) as d),
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
          'montoPrevisto', null, 'nota', a.note, 'estado', 'CONFIRMED',
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
  v_holder text;
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CREATE') then raise exception 'NOT_AUTHORIZED'; end if;

  if v_kind = 'RESERVA' and (v_name !~ '^\S+ \S+' or v_wpp !~ '^[0-9]{8,15}$') then
    raise exception 'CUSTOMER_REQUIRED';
  end if;
  v_holder := case when v_kind = 'RESERVA' then v_name else btrim(coalesce(p_holder, '')) end;
  if p_request_id is null or p_date is null or coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):(00|30)$'
     or p_court is null or p_court not in ('C1','C2','C3','C4')
     or v_kind not in ('RESERVA','CLASE','EVENTO','BLOQUEO')
     or length(v_holder) not between 1 and 120 or length(v_note) > 400 then
    raise exception 'BOOKING_INVALID';
  end if;
  -- Reserva: 60, 90 o 120 (90 por defecto). Clase particular: 60. Clase partido: 90.
  if (v_kind = 'RESERVA' and p_duration not in (60, 90, 120))
     or (v_kind = 'CLASE' and p_duration not in (60, 90))
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

  begin
    insert into public.win_court_bookings
      (request_id, court, business_date, start_time, duration_min, starts_at, ends_at, kind, holder, note, created_by,
       customer_name, customer_whatsapp)
    values
      (p_request_id, p_court, p_date, v_start, p_duration, v_starts, v_starts + make_interval(mins => p_duration),
       v_kind, v_holder, v_note, v_actor.account_id,
       case when v_kind = 'RESERVA' then v_name end, case when v_kind = 'RESERVA' then v_wpp end)
    returning * into v_new;
  exception
    when exclusion_violation then raise exception 'COURT_TAKEN';
    when unique_violation then raise exception 'REQUEST_ID_REUSED';
  end;

  insert into public.win_court_booking_events (booking_id, actor_id, action, detail)
  values (v_new.id, v_actor.account_id, 'CREATE', public.win_courts_json_(v_new));
  return public.win_courts_json_(v_new);
end $$;

-- La función de alta de abono cambia de firma (suma p_duration): se elimina la anterior para evitar ambigüedad.
drop function if exists public.win_courts_abono_create(text, uuid, text, date, text, text, text, text, text);

create or replace function public.win_courts_abono_create(
  p_token text, p_request_id uuid, p_court text, p_date date, p_start text,
  p_customer_name text, p_customer_whatsapp text, p_method text default null, p_note text default '',
  p_duration integer default 90)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_actor record;
  v_existing public.win_court_abonos;
  v_new public.win_court_abonos;
  v_start time;
  v_wd int;
  v_name text := btrim(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g'));
  v_wpp text := regexp_replace(coalesce(p_customer_whatsapp, ''), '[^0-9]', '', 'g');
  v_note text := btrim(coalesce(p_note, ''));
  v_dur integer := coalesce(p_duration, 90);
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id, 'COURTS', 'CREATE') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_request_id is null or p_date is null or coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):(00|30)$'
     or p_court is null or p_court not in ('C1','C2','C3','C4') or length(v_note) > 400 or v_dur not in (60, 90, 120) then
    raise exception 'BOOKING_INVALID';
  end if;
  if v_name !~ '^\S+ \S+' or v_wpp !~ '^[0-9]{8,15}$' then raise exception 'CUSTOMER_REQUIRED'; end if;

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
               and public.win_abono_minutes_(a.start_time) < public.win_abono_minutes_(v_start) + v_dur
               and public.win_abono_minutes_(v_start) < public.win_abono_minutes_(a.start_time) + a.duration_min)
     or exists (select 1 from public.win_court_bookings b
                where b.status = 'CONFIRMED' and b.court = p_court and b.business_date >= p_date
                  and extract(isodow from b.business_date)::int = v_wd
                  and public.win_abono_minutes_(b.start_time) < public.win_abono_minutes_(v_start) + v_dur
                  and public.win_abono_minutes_(v_start) < public.win_abono_minutes_(b.start_time) + b.duration_min) then
    raise exception 'ABONO_CONFLICT';
  end if;

  insert into public.win_court_abonos
    (request_id, court, weekday, start_time, duration_min, customer_name, customer_whatsapp, starts_on, note, created_by)
  values (p_request_id, p_court, v_wd, v_start, v_dur, v_name, v_wpp, p_date, v_note, v_actor.account_id)
  returning * into v_new;

  insert into public.win_court_audit (actor_id, action, entity_type, entity_id, detail)
  values (v_actor.account_id, 'ABONO_CREATE', 'ABONO', v_new.id::text,
          jsonb_build_object('cancha', p_court, 'diaSemana', v_wd, 'inicio', p_start, 'duracion', v_dur, 'desde', p_date, 'titular', v_name));
  return jsonb_build_object('id', v_new.id, 'cancha', v_new.court, 'diaSemana', v_new.weekday, 'inicio', p_start, 'duracion', v_new.duration_min, 'desde', v_new.starts_on);
end $$;

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
  v_dur integer;
  v_end timestamptz;
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
    v_date := v_bk.business_date; v_end := v_bk.ends_at; v_dur := v_bk.duration_min;
  else
    select * into v_ab from public.win_court_abonos where id = p_abono_id for update;
    if not found or p_date is null
       or extract(isodow from p_date)::int <> v_ab.weekday or p_date < v_ab.starts_on
       or (v_ab.ends_on is not null and p_date > v_ab.ends_on)
       or exists (select 1 from public.win_court_abono_skips s where s.abono_id = p_abono_id and s.skip_date = p_date) then
      raise exception 'BOOKING_NOT_FOUND';
    end if;
    v_date := p_date; v_dur := v_ab.duration_min;
    v_end := public.win_courts_starts_at_(p_date, v_ab.start_time) + make_interval(mins => v_ab.duration_min);
  end if;

  -- El cobro se marca cuando termina el turno (Administración puede adelantarlo).
  if v_actor.role <> 'ADMIN' and v_end > now() then raise exception 'PAY_TOO_EARLY'; end if;

  v_amount := public.win_court_price_(v_date, v_method, v_dur);
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
