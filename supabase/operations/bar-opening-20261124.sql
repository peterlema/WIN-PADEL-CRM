-- Authorized opening evidence from Pedro Lema, 24/11/2026. Run in one transaction.
-- Purchase date, supplier, payments and variant allocations were NOT provided.
do $seed$
declare actor uuid;purchase uuid;count_ uuid;pid uuid;spec jsonb;before_ jsonb;after_ jsonb;cost numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('WIN-BAR-OPENING-20261124',0));
 select id into actor from win_auth.login_accounts where username_key='pedro' and role='ADMIN' and enabled;
 if actor is null then raise exception 'OPENING_ACTOR_REQUIRED';end if;
 if exists(select 1 from public.win_bar_stock_counts where source_key='WIN-BAR-OPENING-20261124') then
  if not exists(select 1 from public.win_bar_purchases where source_key='WIN-BAR-FIRST-PURCHASE') or
   (select sum(l.quantity) from public.win_bar_stock_count_lines l join public.win_bar_stock_counts c on c.id=l.count_id where c.source_key='WIN-BAR-OPENING-20261124')<>393 then raise exception 'OPENING_REVIEW_REQUIRED';end if;
  return;
 end if;
 perform 1 from public.win_products where business_unit='CAFE_BAR' order by id for update;
 if exists(select 1 from public.win_bar_stock_movements) or exists(select 1 from public.win_bar_purchases) or exists(select 1 from public.win_bar_stock_counts) then raise exception 'OPENING_REVIEW_REQUIRED';end if;
 insert into public.win_bar_purchases(source_key,kind,status,total,cost_groups,note,created_by)
 values('WIN-BAR-FIRST-PURCHASE','HISTORICAL','RECORDED',822800,
 '[{"group":"Agua Manaos","total":54800,"allocation":"SINGLE_PRODUCT"},{"group":"Coca común y Zero","total":136000,"allocation":"PENDING"},{"group":"Gatorade y Powerade","total":152000,"allocation":"PENDING"},{"group":"Stella y Patagonia","total":480000,"allocation":"PENDING"}]',
 'Compra original informada por Pedro. Proveedor, fecha de compra y pagos sin confirmar. Cantidades por sabor de Gatorade y variedad de Patagonia sin confirmar. No suma stock ni genera caja.',actor) returning id into purchase;
 insert into public.win_bar_stock_counts(source_key,business_date,recorded_by,note)
 values('WIN-BAR-OPENING-20261124','2026-11-24',actor,'Conteo físico informado por Pedro. Hora del conteo no informada. Inventario único del Bar, incluyendo depósito y heladeras. Base operativa de 393 unidades; no representa una compra o venta.') returning id into count_;
 for spec in select value from jsonb_array_elements('[
 {"name":"Agua Manaos","oldName":"Villa Manaos","variant":"","oldVariant":"","qty":92,"price":2000,"group":"Agua","purchased":132,"costGroup":"Agua Manaos","totalCost":54800},
 {"name":"Coca Zero","variant":"","qty":37,"price":3000,"purchased":48,"costGroup":"Coca común y Zero"},
 {"name":"Coca común","variant":"","qty":41,"price":3000,"purchased":48,"costGroup":"Coca común y Zero"},
 {"name":"Gatorade","variant":"Azul","qty":21,"price":4000},
 {"name":"Gatorade","variant":"Rojo","oldVariant":"Roja","qty":14,"price":4000},
 {"name":"Gatorade","variant":"Violeta","qty":1,"price":4000,"new":true},
 {"name":"Powerade","variant":"","qty":23,"price":4000,"purchased":24,"costGroup":"Gatorade y Powerade"},
 {"name":"Patagonia","variant":"Lager del Sur","oldVariant":"Del Sur","qty":22,"price":5500},
 {"name":"Patagonia","variant":"Amber Lager","oldVariant":"Amber","qty":41,"price":5500},
 {"name":"Patagonia","variant":"IPA 24/7","oldVariant":"IPA","qty":37,"price":5500},
 {"name":"Stella","variant":"","qty":64,"price":5500,"purchased":96,"costGroup":"Stella y Patagonia"}
 ]') loop
  select id,to_jsonb(p) into pid,before_ from public.win_products p where business_unit='CAFE_BAR'
   and name in(spec->>'name',coalesce(spec->>'oldName',spec->>'name'))
   and variant in(spec->>'variant',coalesce(spec->>'oldVariant',spec->>'variant'));
  if pid is null then
   if coalesce((spec->>'new')::boolean,false) is not true then raise exception 'OPENING_PRODUCT_MISSING: %',spec;end if;
   insert into public.win_products(name,variant,category,sale_price,created_by,updated_by)
    values(spec->>'name',spec->>'variant','Isotónicas',(spec->>'price')::numeric,actor,actor) returning id into pid;
  end if;
  update public.win_products set name=spec->>'name',variant=spec->>'variant',sale_price=(spec->>'price')::numeric,
   updated_by=actor,updated_at=now() where id=pid returning to_jsonb(win_products.*) into after_;
  insert into public.win_product_audit(product_id,actor_id,action,old_record,new_record)
   values(pid,actor,case when before_ is null then 'CREATE' else 'UPDATE' end,before_,after_);
  insert into public.win_bar_stock_count_lines(count_id,product_id,quantity) values(count_,pid,(spec->>'qty')::integer);
  cost=case when spec->>'name'='Agua Manaos' then 54800::numeric/132 else null end;
  insert into public.win_bar_stock_movements(product_id,quantity_change,recorded_by,kind,source_key,note,unit_cost)
   values(pid,(spec->>'qty')::integer,actor,'OPENING','WIN-BAR-OPENING-20261124:'||pid,'Conteo físico del 24/11/2026. No es recepción de compra.',cost);
  if spec ? 'purchased' then
   insert into public.win_bar_purchase_lines(purchase_id,product_id,label,quantity,total_cost,cost_group)
    values(purchase,pid,(spec->>'name')||case when spec->>'variant'<>'' then ' '||(spec->>'variant') else '' end,
    (spec->>'purchased')::integer,(spec->>'totalCost')::numeric,spec->>'costGroup');
  end if;
 end loop;
 insert into public.win_bar_purchase_lines(purchase_id,label,quantity,cost_group) values
  (purchase,'Gatorade · sabores iniciales pendientes',72,'Gatorade y Powerade'),
  (purchase,'Patagonia · variedades iniciales pendientes',120,'Stella y Patagonia');
 insert into public.win_bar_reconciliation(count_id,purchase_id,group_name,purchased,physical,potential_value) values
  (count_,purchase,'Agua',132,92,80000),(count_,purchase,'Coca común y Zero',96,78,54000),
  (count_,purchase,'Gatorade',72,36,144000),(count_,purchase,'Powerade',24,23,4000),
  (count_,purchase,'Patagonia',120,100,110000),(count_,purchase,'Stella',96,64,176000);
 insert into public.win_bar_inventory_audit(actor_id,action,reference_id,after_record) values
  (actor,'HISTORICAL_PURCHASE',purchase,jsonb_build_object('units',540,'total',822800,'paymentStatus','UNCONFIRMED','stockEffect',0)),
  (actor,'OPENING_COUNT',count_,jsonb_build_object('physicalUnits',393,'historicalDifference',147,'potentialValue',568000,'cashEffect',0));
 if (select sum(quantity_change) from public.win_bar_stock_movements)<>393 or
  (select sum(quantity) from public.win_bar_purchase_lines where purchase_id=purchase)<>540 then raise exception 'OPENING_TOTAL_MISMATCH';end if;
end;$seed$;
