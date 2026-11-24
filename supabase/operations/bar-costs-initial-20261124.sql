-- Authorized initial reference costs from Pedro, 24/11/2026. No stock/financial writes.
do $seed$
declare actor uuid;spec jsonb;pid uuid;version_ bigint;before_ jsonb;after_ jsonb;request_ uuid:=md5('WIN-BAR-PROVISIONAL-COSTS-20261124')::uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('bar-request:'||request_::text,0));
 if exists(select 1 from public.win_bar_inventory_requests where request_id=request_) then return;end if;
 select id into actor from win_auth.login_accounts where username_key='pedro' and role='ADMIN' and enabled;
 if actor is null then raise exception 'COST_ACTOR_REQUIRED';end if;
 if (select sum(l.quantity) from public.win_bar_stock_count_lines l join public.win_bar_stock_counts c on c.id=l.count_id where c.source_key='WIN-BAR-OPENING-20261124') is distinct from 393::bigint then raise exception 'BAR_COUNT_REVIEW_REQUIRED';end if;
 if not exists(select 1 from public.win_bar_purchases where source_key='WIN-BAR-FIRST-PURCHASE' and total=822800) then raise exception 'BAR_PURCHASE_REVIEW_REQUIRED';end if;
 perform 1 from public.win_products where business_unit='CAFE_BAR' order by id for update;
 select jsonb_build_object(
 'stock',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_stock_movements t),
 'purchases',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_purchases t),
 'lines',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_purchase_lines t),
 'sales',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_order_items t),
 'barCash',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_cash_movements t),
 'cash',(select jsonb_agg(to_jsonb(t) order by id) from public.win_cash_movements t),
 'prices',(select jsonb_agg(jsonb_build_array(id,sale_price) order by id) from public.win_products)
 ) into before_;
 for spec in select value from jsonb_array_elements('[
 {"name":"Agua Manaos","variant":"","cost":415.15},
 {"name":"Coca común","variant":"","cost":1435},
 {"name":"Coca Zero","variant":"","cost":1435},
 {"name":"Gatorade","variant":"Azul","cost":1585},
 {"name":"Gatorade","variant":"Rojo","cost":1585},
 {"name":"Gatorade","variant":"Violeta","cost":1585},
 {"name":"Powerade","variant":"","cost":1585},
 {"name":"Patagonia","variant":"Amber Lager","cost":2410},
 {"name":"Patagonia","variant":"Lager del Sur","cost":2410},
 {"name":"Patagonia","variant":"IPA 24/7","cost":2410},
 {"name":"Stella","variant":"","cost":2000}
 ]') loop
  if (select count(*) from public.win_products where business_unit='CAFE_BAR' and name=spec->>'name' and variant=spec->>'variant')<>1 then raise exception 'COST_PRODUCT_REVIEW_REQUIRED: %',spec;end if;
  select id,cost_version into pid,version_ from public.win_products where business_unit='CAFE_BAR' and name=spec->>'name' and variant=spec->>'variant';
  perform public.win_bar_initial_cost_set(actor,pid,(spec->>'cost')::numeric,'Costo unitario de referencia informado por Pedro el 24/11/2026. Provisional manual; redondeos y distribución de compra pendientes de conciliación.',version_);
 end loop;
 select jsonb_build_object(
 'stock',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_stock_movements t),
 'purchases',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_purchases t),
 'lines',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_purchase_lines t),
 'sales',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_order_items t),
 'barCash',(select jsonb_agg(to_jsonb(t) order by id) from public.win_bar_cash_movements t),
 'cash',(select jsonb_agg(to_jsonb(t) order by id) from public.win_cash_movements t),
 'prices',(select jsonb_agg(jsonb_build_array(id,sale_price) order by id) from public.win_products)
 ) into after_;
 if before_ is distinct from after_ then raise exception 'COST_SEED_CHANGED_OPERATIONS';end if;
 insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result)
 values(request_,actor,'cost.seed','{"source":"WIN-BAR-PROVISIONAL-COSTS-20261124"}','{"ok":true,"products":11,"stockEffect":0,"cashEffect":0}');
end;$seed$;
