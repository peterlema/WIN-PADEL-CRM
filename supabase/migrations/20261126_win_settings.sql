-- WIN Gestión: ajustes numéricos editables desde Configuración (26/11/2026)
-- Valores que antes estaban fijos en el código y que el club puede cambiar sin programar:
--   GRID_OPEN_MIN             inicio de la grilla del calendario, en minutos de la jornada (480 = 08:00)
--   GRID_CLOSE_MIN            fin de la grilla; más de 1440 = después de medianoche (1500 = 01:00)
--   BOOKING_DEFAULT_DURATION  duración propuesta al cargar una reserva (60, 90 o 120 min)
--   COACH_DEFAULT_WIN_PCT     % WIN propuesto al dar de alta un profesor
-- La jornada comercial corta a las 06:00: la grilla va de 06:00 a 06:00 del día siguiente como máximo.
-- Lectura: cualquier sesión válida (el calendario la necesita). Escritura: USERS/MANAGE (sólo ADMIN), auditada.
-- Depende de: 20261125_win_config_catalog_coaches_prices.sql (win_config_audit). Idempotente.

create table if not exists public.win_settings (
  key text primary key check (key in ('GRID_OPEN_MIN','GRID_CLOSE_MIN','BOOKING_DEFAULT_DURATION','COACH_DEFAULT_WIN_PCT')),
  value numeric(10,2) not null,
  updated_by uuid references win_auth.login_accounts(id),
  updated_at timestamptz not null default now()
);
insert into public.win_settings (key, value) values
  ('GRID_OPEN_MIN', 480), ('GRID_CLOSE_MIN', 1500), ('BOOKING_DEFAULT_DURATION', 90), ('COACH_DEFAULT_WIN_PCT', 60)
on conflict (key) do nothing;

alter table public.win_settings enable row level security;
revoke all on public.win_settings from public, anon, authenticated;
grant select, update on public.win_settings to service_role;

create or replace function public.win_settings_get(p_token text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare a uuid;
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  return (select jsonb_object_agg(key, value) from public.win_settings);
end;$$;

create or replace function public.win_config_setting_set(p_token text, p_key text, p_value numeric)
returns jsonb language plpgsql set search_path = '' as $$
declare a uuid; v_before public.win_settings%rowtype; v_row public.win_settings%rowtype; v_open numeric; v_close numeric;
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  if not public.win_can_access(a, 'USERS', 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  select * into v_before from public.win_settings where key = p_key for update;
  if not found or p_value is null then raise exception 'CONFIG_INVALID'; end if;
  select value into v_open from public.win_settings where key = 'GRID_OPEN_MIN';
  select value into v_close from public.win_settings where key = 'GRID_CLOSE_MIN';
  if p_key = 'GRID_OPEN_MIN' then v_open := p_value; elsif p_key = 'GRID_CLOSE_MIN' then v_close := p_value; end if;
  if (p_key in ('GRID_OPEN_MIN','GRID_CLOSE_MIN') and (p_value % 30 <> 0 or v_open < 360 or v_close > 1800 or v_close - v_open < 60))
     or (p_key = 'BOOKING_DEFAULT_DURATION' and p_value not in (60, 90, 120))
     or (p_key = 'COACH_DEFAULT_WIN_PCT' and (p_value < 0 or p_value > 100 or p_value <> round(p_value, 2))) then
    raise exception 'CONFIG_INVALID';
  end if;
  update public.win_settings set value = p_value, updated_by = a, updated_at = now() where key = p_key returning * into v_row;
  insert into public.win_config_audit (actor_id, action, entity_type, entity_id, before, after)
  values (a, 'UPDATE', 'SETTING', p_key, to_jsonb(v_before), to_jsonb(v_row));
  return jsonb_build_object('key', p_key, 'value', v_row.value);
end;$$;

revoke all on function public.win_settings_get(text) from public, anon, authenticated;
revoke all on function public.win_config_setting_set(text, text, numeric) from public, anon, authenticated;
grant execute on function public.win_settings_get(text) to service_role;
grant execute on function public.win_config_setting_set(text, text, numeric) to service_role;
