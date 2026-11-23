-- WIN Gestión: datos modificables desde la web (25/11/2026)
-- Productos de Bar y Tienda, profesores (porcentaje WIN) y listas de precios (cancha y clases),
-- editables desde la pantalla «Configuración» sin tocar SQL.
-- Depende de: 20261123_* (cuentas, sesiones, RBAC) y 20261124_win_courts_v2/v3_* (win_price_list con duration_min).
-- Seguridad: RLS activado y sin acceso del navegador; sólo service_role (Edge Function win-api).
-- Permisos (win_can_access): productos de Bar = BAR/MANAGE; productos de Tienda = SHOP/MANAGE;
-- profesores = ACADEMY/MANAGE; precios = USERS/MANAGE (en la matriz actual, sólo ADMIN).
-- Los precios nunca se editan hacia atrás: cada cambio crea una vigencia desde hoy o una fecha futura,
-- así los cobros ya registrados conservan el importe con que se cobraron.
-- Idempotente: se puede aplicar dos veces.

-- ---------------------------------------------------------------- 1. Productos (Bar y Tienda)
create table if not exists public.win_catalog_items (
  id uuid primary key default gen_random_uuid(),
  unit text not null check (unit in ('CAFE_BAR','SHOP')),
  name text not null check (length(btrim(name)) between 2 and 80),
  category text not null default '' check (length(category) <= 60),
  price numeric(14,2) not null check (price >= 0 and price <= 100000000),
  active boolean not null default true,
  created_by uuid references win_auth.login_accounts(id),
  created_at timestamptz not null default now(),
  updated_by uuid references win_auth.login_accounts(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists win_catalog_items_name_uq on public.win_catalog_items (unit, lower(btrim(name)));

-- ---------------------------------------------------------------- 2. Profesores
create table if not exists public.win_coaches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 60),
  win_pct numeric(5,2) not null default 60 check (win_pct >= 0 and win_pct <= 100),  -- parte de WIN; el profesor cobra el resto
  active boolean not null default true,
  created_by uuid references win_auth.login_accounts(id),
  created_at timestamptz not null default now(),
  updated_by uuid references win_auth.login_accounts(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists win_coaches_name_uq on public.win_coaches (lower(btrim(name)));

-- Profesores y porcentajes que usa hoy el Apps Script de recepción (60 % WIN por defecto; Chino 55 %).
insert into public.win_coaches (name, win_pct) values
  ('Leo', 60), ('Alejo', 60), ('Pablo', 60), ('Pablo Corsiglia', 60), ('Chino', 55), ('Fede', 60)
on conflict do nothing;

-- ---------------------------------------------------------------- 3. Precios: cancha (60, 90 y 120 min) y clases por cantidad de alumnos
-- La clave de cada precio es (código, duración, vigente desde). Las clases se guardan con duración 60.
alter table public.win_price_list drop constraint if exists win_price_list_code_check;
alter table public.win_price_list add constraint win_price_list_code_check
  check (code in ('COURT_TURN','CLASS_1','CLASS_2','CLASS_3','CLASS_4'));
-- Tarifas de clase del Apps Script (mismo importe en efectivo y transferencia).
insert into public.win_price_list (code, duration_min, amount_cash, amount_transfer, valid_from) values
  ('CLASS_1', 60, 60000, 60000, date '2020-01-01'), ('CLASS_2', 60, 70000, 70000, date '2020-01-01'),
  ('CLASS_3', 60, 90000, 90000, date '2020-01-01'), ('CLASS_4', 60, 100000, 100000, date '2020-01-01')
on conflict (code, duration_min, valid_from) do nothing;

-- ---------------------------------------------------------------- 4. Auditoría de cambios
create table if not exists public.win_config_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references win_auth.login_accounts(id),
  occurred_at timestamptz not null default now(),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb
);

-- ---------------------------------------------------------------- 5. Permisos de tablas
alter table public.win_catalog_items enable row level security;
alter table public.win_coaches enable row level security;
alter table public.win_config_audit enable row level security;
revoke all on public.win_catalog_items, public.win_coaches, public.win_config_audit from public, anon, authenticated;
revoke all on sequence public.win_config_audit_id_seq from public, anon, authenticated;
grant select, insert, update on public.win_catalog_items, public.win_coaches to service_role;
grant select, insert on public.win_config_audit to service_role;
grant usage, select on sequence public.win_config_audit_id_seq to service_role;

-- ---------------------------------------------------------------- 6. Funciones
create or replace function public.win_config_today_()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- Lectura completa para la pantalla. Requiere al menos un permiso de configuración.
create or replace function public.win_config_list(p_token text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare a uuid; can_bar boolean; can_shop boolean; can_coach boolean; can_price boolean; v_today date := public.win_config_today_();
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  can_bar := public.win_can_access(a, 'BAR', 'MANAGE');
  can_shop := public.win_can_access(a, 'SHOP', 'MANAGE');
  can_coach := public.win_can_access(a, 'ACADEMY', 'MANAGE');
  can_price := public.win_can_access(a, 'USERS', 'MANAGE');
  if not (can_bar or can_shop or can_coach or can_price) then raise exception 'NOT_AUTHORIZED'; end if;
  return jsonb_build_object(
    'hoy', v_today,
    'permisos', jsonb_build_object('bar', can_bar, 'tienda', can_shop, 'profesores', can_coach, 'precios', can_price),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'unidad', i.unit, 'nombre', i.name,
        'categoria', i.category, 'precio', i.price, 'activo', i.active, 'actualizado', i.updated_at)
        order by i.unit, i.active desc, lower(i.category), lower(i.name))
      from public.win_catalog_items i
      where (i.unit = 'CAFE_BAR' and can_bar) or (i.unit = 'SHOP' and can_shop)), '[]'::jsonb),
    'profesores', case when can_coach then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.name,
        'porcentajeWin', c.win_pct, 'activo', c.active, 'actualizado', c.updated_at)
        order by c.active desc, lower(c.name)) from public.win_coaches c), '[]'::jsonb) else '[]'::jsonb end,
    -- Precio vigente hoy y cambios ya programados para fechas futuras, por código y duración.
    'precios', coalesce((select jsonb_agg(jsonb_build_object('codigo', p.code, 'duracion', p.duration_min, 'efectivo', p.amount_cash,
        'transferencia', p.amount_transfer, 'desde', p.valid_from, 'futuro', p.valid_from > v_today)
        order by p.code, p.duration_min, p.valid_from)
      from public.win_price_list p
      where p.valid_from > v_today
         or p.valid_from = (select max(x.valid_from) from public.win_price_list x
                            where x.code = p.code and x.duration_min = p.duration_min and x.valid_from <= v_today)), '[]'::jsonb)
  );
end;$$;

-- Alta (p_id null) o modificación de un producto. No se borran: se desactivan.
create or replace function public.win_config_item_save(p_token text, p_id uuid, p_unit text, p_name text,
  p_category text, p_price numeric, p_active boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare a uuid; v_before public.win_catalog_items%rowtype; v_row public.win_catalog_items%rowtype;
  v_name text := btrim(coalesce(p_name, '')); v_cat text := btrim(coalesce(p_category, ''));
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  if p_unit not in ('CAFE_BAR','SHOP') then raise exception 'CONFIG_INVALID'; end if;
  if p_id is not null then
    select * into v_before from public.win_catalog_items where id = p_id for update;
    if not found then raise exception 'CONFIG_NOT_FOUND'; end if;
    if v_before.unit <> p_unit then raise exception 'CONFIG_INVALID'; end if;
  end if;
  if not public.win_can_access(a, case p_unit when 'CAFE_BAR' then 'BAR' else 'SHOP' end, 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  if length(v_name) not between 2 and 80 or length(v_cat) > 60 or p_active is null
     or p_price is null or p_price < 0 or p_price > 100000000 or p_price <> round(p_price, 2) then raise exception 'CONFIG_INVALID'; end if;
  if exists (select 1 from public.win_catalog_items where unit = p_unit and lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then
    raise exception 'NAME_TAKEN'; end if;
  if p_id is null then
    insert into public.win_catalog_items (unit, name, category, price, active, created_by, updated_by)
    values (p_unit, v_name, v_cat, p_price, p_active, a, a) returning * into v_row;
  else
    update public.win_catalog_items set name = v_name, category = v_cat, price = p_price, active = p_active,
      updated_by = a, updated_at = now() where id = p_id returning * into v_row;
  end if;
  insert into public.win_config_audit (actor_id, action, entity_type, entity_id, before, after)
  values (a, case when p_id is null then 'CREATE' else 'UPDATE' end, 'CATALOG_ITEM', v_row.id::text,
    case when p_id is null then null else to_jsonb(v_before) end, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id);
end;$$;

-- Alta o modificación de un profesor.
create or replace function public.win_config_coach_save(p_token text, p_id uuid, p_name text, p_win_pct numeric, p_active boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare a uuid; v_before public.win_coaches%rowtype; v_row public.win_coaches%rowtype; v_name text := btrim(coalesce(p_name, ''));
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  if not public.win_can_access(a, 'ACADEMY', 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  if length(v_name) not between 2 and 60 or p_active is null
     or p_win_pct is null or p_win_pct < 0 or p_win_pct > 100 or p_win_pct <> round(p_win_pct, 2) then raise exception 'CONFIG_INVALID'; end if;
  if p_id is not null then
    select * into v_before from public.win_coaches where id = p_id for update;
    if not found then raise exception 'CONFIG_NOT_FOUND'; end if;
  end if;
  if exists (select 1 from public.win_coaches where lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then
    raise exception 'NAME_TAKEN'; end if;
  if p_id is null then
    insert into public.win_coaches (name, win_pct, active, created_by, updated_by)
    values (v_name, p_win_pct, p_active, a, a) returning * into v_row;
  else
    update public.win_coaches set name = v_name, win_pct = p_win_pct, active = p_active, updated_by = a, updated_at = now()
    where id = p_id returning * into v_row;
  end if;
  insert into public.win_config_audit (actor_id, action, entity_type, entity_id, before, after)
  values (a, case when p_id is null then 'CREATE' else 'UPDATE' end, 'COACH', v_row.id::text,
    case when p_id is null then null else to_jsonb(v_before) end, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id);
end;$$;

-- Nuevo precio vigente desde hoy o una fecha futura. Si ya había un cambio para esa misma fecha, se reemplaza.
drop function if exists public.win_config_price_set(text, text, numeric, numeric, date);
drop function if exists public.win_config_price_cancel(text, text, date);
create or replace function public.win_config_price_set(p_token text, p_code text, p_duration integer, p_cash numeric, p_transfer numeric, p_valid_from date)
returns jsonb language plpgsql set search_path = '' as $$
declare a uuid; v_before public.win_price_list%rowtype; v_row public.win_price_list%rowtype;
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  if not public.win_can_access(a, 'USERS', 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  if not ((p_code = 'COURT_TURN' and p_duration in (60, 90, 120)) or (p_code in ('CLASS_1','CLASS_2','CLASS_3','CLASS_4') and p_duration = 60))
     or p_cash is null or p_cash <= 0 or p_cash > 100000000 or p_cash <> round(p_cash, 2)
     or p_transfer is null or p_transfer <= 0 or p_transfer > 100000000 or p_transfer <> round(p_transfer, 2)
     or p_valid_from is null then raise exception 'CONFIG_INVALID'; end if;
  if p_valid_from < public.win_config_today_() then raise exception 'PRICE_DATE_PAST'; end if;
  select * into v_before from public.win_price_list where code = p_code and duration_min = p_duration and valid_from = p_valid_from for update;
  insert into public.win_price_list (code, duration_min, amount_cash, amount_transfer, valid_from, created_by)
  values (p_code, p_duration, p_cash, p_transfer, p_valid_from, a)
  on conflict (code, duration_min, valid_from) do update set amount_cash = excluded.amount_cash,
    amount_transfer = excluded.amount_transfer, created_by = excluded.created_by, created_at = now()
  returning * into v_row;
  insert into public.win_config_audit (actor_id, action, entity_type, entity_id, before, after)
  values (a, case when v_before.id is null then 'CREATE' else 'UPDATE' end, 'PRICE', v_row.id::text,
    case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id);
end;$$;

-- Anular un cambio de precio programado a futuro (los vigentes o pasados no se pueden borrar).
create or replace function public.win_config_price_cancel(p_token text, p_code text, p_duration integer, p_valid_from date)
returns jsonb language plpgsql set search_path = '' as $$
declare a uuid; v_row public.win_price_list%rowtype;
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  if not public.win_can_access(a, 'USERS', 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_valid_from is null or p_valid_from <= public.win_config_today_() then raise exception 'PRICE_DATE_PAST'; end if;
  delete from public.win_price_list where code = p_code and duration_min = p_duration and valid_from = p_valid_from returning * into v_row;
  if v_row.id is null then raise exception 'CONFIG_NOT_FOUND'; end if;
  insert into public.win_config_audit (actor_id, action, entity_type, entity_id, before, after)
  values (a, 'DELETE', 'PRICE', v_row.id::text, to_jsonb(v_row), null);
  return jsonb_build_object('ok', true);
end;$$;
grant delete on public.win_price_list to service_role;

do $$ declare f text; begin
  foreach f in array array['win_config_today_()','win_config_list(text)',
    'win_config_item_save(text,uuid,text,text,text,numeric,boolean)','win_config_coach_save(text,uuid,text,numeric,boolean)',
    'win_config_price_set(text,text,integer,numeric,numeric,date)','win_config_price_cancel(text,text,integer,date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
