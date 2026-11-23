-- Configuración → Productos → Bar / Buffet edita el mismo catálogo que usa la venta del Bar (public.win_products).
-- Antes leía public.win_catalog_items, una tabla aparte: los productos del Bar no aparecían en Configuración
-- y un precio cambiado ahí no llegaba a la pantalla de venta.
-- Tienda (SHOP) sigue en win_catalog_items, sin cambios.
-- Cambios de Bar quedan en win_product_audit (misma auditoría que Stock). Requiere BAR/MANAGE (en la matriz actual, ADMIN).
-- Orden de despliegue: primero esta migración, después win-api (p_variant tiene valor por defecto, así que
-- la versión anterior de win-api sigue funcionando mientras tanto).

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
    'productos', coalesce((select jsonb_agg(x.j order by x.unit, x.active desc, lower(x.category), lower(x.name), lower(x.variant)) from (
        select p.business_unit as unit, p.active, p.category, p.name, p.variant,
          jsonb_build_object('id', p.id, 'unidad', 'CAFE_BAR', 'nombre', p.name, 'variante', p.variant,
            'categoria', p.category, 'precio', p.sale_price, 'activo', p.active, 'actualizado', p.updated_at) as j
        from public.win_products p where p.business_unit = 'CAFE_BAR' and can_bar
        union all
        select i.unit, i.active, i.category, i.name, '' as variant,
          jsonb_build_object('id', i.id, 'unidad', i.unit, 'nombre', i.name, 'variante', '',
            'categoria', i.category, 'precio', i.price, 'activo', i.active, 'actualizado', i.updated_at)
        from public.win_catalog_items i where i.unit = 'SHOP' and can_shop
      ) x), '[]'::jsonb),
    'profesores', case when can_coach then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.name,
        'porcentajeWin', c.win_pct, 'activo', c.active, 'actualizado', c.updated_at)
        order by c.active desc, lower(c.name)) from public.win_coaches c), '[]'::jsonb) else '[]'::jsonb end,
    'precios', coalesce((select jsonb_agg(jsonb_build_object('codigo', p.code, 'duracion', p.duration_min, 'efectivo', p.amount_cash,
        'transferencia', p.amount_transfer, 'desde', p.valid_from, 'futuro', p.valid_from > v_today)
        order by p.code, p.duration_min, p.valid_from)
      from public.win_price_list p
      where p.valid_from > v_today
         or p.valid_from = (select max(x.valid_from) from public.win_price_list x
                            where x.code = p.code and x.duration_min = p.duration_min and x.valid_from <= v_today)), '[]'::jsonb)
  );
end;$$;

drop function if exists public.win_config_item_save(text, uuid, text, text, text, numeric, boolean);
create or replace function public.win_config_item_save(p_token text, p_id uuid, p_unit text, p_name text,
  p_category text, p_price numeric, p_active boolean, p_variant text default '')
returns jsonb language plpgsql set search_path = '' as $$
declare a uuid; v_before public.win_catalog_items%rowtype; v_row public.win_catalog_items%rowtype;
  p_before public.win_products%rowtype; p_row public.win_products%rowtype;
  v_name text := btrim(coalesce(p_name, '')); v_cat text := btrim(coalesce(p_category, ''));
  v_var text := btrim(coalesce(p_variant, ''));
begin
  select s.account_id into a from public.win_pin_session(p_token) s;
  if a is null then raise exception 'SESSION_INVALID'; end if;
  if p_unit not in ('CAFE_BAR','SHOP') then raise exception 'CONFIG_INVALID'; end if;
  if not public.win_can_access(a, case p_unit when 'CAFE_BAR' then 'BAR' else 'SHOP' end, 'MANAGE') then raise exception 'NOT_AUTHORIZED'; end if;
  if length(v_name) not between 2 and 80 or length(v_cat) > 60 or length(v_var) > 90 or p_active is null
     or p_price is null or p_price < 0 or p_price > 100000000 or p_price <> round(p_price, 2) then raise exception 'CONFIG_INVALID'; end if;

  if p_unit = 'CAFE_BAR' then
    -- win_products exige categoría de 2 a 80 caracteres.
    if length(v_cat) < 2 then v_cat := 'Bebidas'; end if;
    if p_id is not null then
      select * into p_before from public.win_products where id = p_id and business_unit = 'CAFE_BAR' for update;
      if not found then
        -- Un producto de Tienda no se pasa a Bar: la unidad no cambia.
        if exists (select 1 from public.win_catalog_items where id = p_id) then raise exception 'CONFIG_INVALID'; end if;
        raise exception 'CONFIG_NOT_FOUND';
      end if;
    end if;
    if exists (select 1 from public.win_products where business_unit = 'CAFE_BAR'
               and lower(btrim(name)) = lower(v_name) and lower(btrim(variant)) = lower(v_var) and id is distinct from p_id) then
      raise exception 'NAME_TAKEN'; end if;
    if p_id is null then
      insert into public.win_products (business_unit, name, variant, category, sale_price, active, created_by, updated_by)
      values ('CAFE_BAR', v_name, v_var, v_cat, p_price, p_active, a, a) returning * into p_row;
    else
      -- Costo y código de barras no se editan desde Configuración: se conservan.
      update public.win_products set name = v_name, variant = v_var, category = v_cat, sale_price = p_price,
        active = p_active, updated_by = a, updated_at = now() where id = p_id returning * into p_row;
    end if;
    insert into public.win_product_audit (product_id, actor_id, action, old_record, new_record)
    values (p_row.id, a, case when p_id is null then 'CREATE' else 'UPDATE' end,
      case when p_id is null then null else to_jsonb(p_before) end, to_jsonb(p_row));
    return jsonb_build_object('id', p_row.id);
  end if;

  -- Tienda: igual que antes, en win_catalog_items.
  if p_id is not null then
    select * into v_before from public.win_catalog_items where id = p_id for update;
    if not found then
      -- Un producto de Bar no se pasa a Tienda: la unidad no cambia.
      if exists (select 1 from public.win_products where id = p_id) then raise exception 'CONFIG_INVALID'; end if;
      raise exception 'CONFIG_NOT_FOUND';
    end if;
    if v_before.unit <> p_unit then raise exception 'CONFIG_INVALID'; end if;
  end if;
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

revoke all on function public.win_config_list(text) from public, anon, authenticated;
grant execute on function public.win_config_list(text) to service_role;
revoke all on function public.win_config_item_save(text, uuid, text, text, text, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.win_config_item_save(text, uuid, text, text, text, numeric, boolean, text) to service_role;
