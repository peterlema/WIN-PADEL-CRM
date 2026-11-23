-- WIN Bar: product catalog (each flavor is a sellable SKU). No invented price, cost, size or stock.
create table if not exists public.win_products (
 id uuid primary key default gen_random_uuid(),
 business_unit text not null default 'CAFE_BAR' check(business_unit in ('CAFE_BAR','SHOP')),
 name text not null check(length(btrim(name)) between 2 and 120),
 variant text not null default '' check(length(variant)<=90),
 category text not null default 'Bebidas' check(length(btrim(category)) between 2 and 80),
 barcode text check(barcode is null or length(btrim(barcode)) between 3 and 60),
 sale_price numeric(14,2) check(sale_price is null or sale_price>=0),
 unit_cost numeric(14,2) check(unit_cost is null or unit_cost>=0),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid references win_auth.login_accounts(id),
 updated_by uuid references win_auth.login_accounts(id)
);
create unique index if not exists win_products_unique_variant
 on public.win_products (business_unit,lower(btrim(name)),lower(btrim(variant)));
create unique index if not exists win_products_unique_barcode
 on public.win_products (barcode) where barcode is not null;
create index if not exists win_products_unit_active_idx on public.win_products (business_unit,active,name);
alter table public.win_products enable row level security;
revoke all on public.win_products from public,anon,authenticated;
grant select,insert,update on public.win_products to service_role;

create table if not exists public.win_product_audit(
 id bigint generated always as identity primary key,
 product_id uuid not null references public.win_products(id),
 actor_id uuid not null references win_auth.login_accounts(id),
 occurred_at timestamptz not null default now(),
 action text not null check(action in ('CREATE','UPDATE')),
 old_record jsonb,
 new_record jsonb not null
);
alter table public.win_product_audit enable row level security;
revoke all on public.win_product_audit from public,anon,authenticated;
grant select,insert on public.win_product_audit to service_role;
grant usage,select on sequence public.win_product_audit_id_seq to service_role;

-- Seed exactly user-supplied labels. This is an idempotent seed; no stock/price invented.
insert into public.win_products(business_unit,name,variant,category) values
 ('CAFE_BAR','Villa Manaos','','Agua'),
 ('CAFE_BAR','Gatorade','Azul','Isotónicas'),
 ('CAFE_BAR','Gatorade','Roja','Isotónicas'),
 ('CAFE_BAR','Powerade','','Isotónicas'),
 ('CAFE_BAR','Coca común','','Gaseosas'),
 ('CAFE_BAR','Coca Zero','','Gaseosas'),
 ('CAFE_BAR','Stella','','Cervezas'),
 ('CAFE_BAR','Patagonia','IPA','Cervezas'),
 ('CAFE_BAR','Patagonia','Amber','Cervezas'),
 ('CAFE_BAR','Patagonia','Del Sur','Cervezas')
on conflict do nothing;

create or replace function public.win_bar_products_list(p_token text)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; r text; items jsonb;
begin
 select s.account_id,s.role into uid,r from public.win_pin_session(p_token) s;
 if uid is null then raise exception 'SESSION_INVALID'; end if;
 if not public.win_can_access(uid,'BAR','VIEW') then raise exception 'NOT_AUTHORIZED'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'name',p.name,'variant',p.variant,'category',p.category,
  'barcode',p.barcode,'salePrice',p.sale_price,'unitCost',case when r='ADMIN' then p.unit_cost else null end,
  'active',p.active,'stockKnown',false
 ) order by p.category,p.name,p.variant),'[]'::jsonb)
 into items from public.win_products p
 where p.business_unit='CAFE_BAR' and (p.active or r='ADMIN');
 return jsonb_build_object('products',items,'canEdit',r='ADMIN','stockConfigured',false);
end;$fn$;

create or replace function public.win_bar_product_save(
 p_token text,p_product_id uuid,p_name text,p_variant text,p_category text,
 p_price numeric,p_cost numeric,p_barcode text,p_active boolean
) returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare uid uuid; r text; previous public.win_products%rowtype; current_record public.win_products%rowtype;
begin
 select s.account_id,s.role into uid,r from public.win_pin_session(p_token) s;
 if uid is null then raise exception 'SESSION_INVALID'; end if;
 if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED'; end if;
 if p_name is null or length(btrim(p_name)) not between 2 and 120
    or length(coalesce(p_variant,''))>90
    or p_category is null or length(btrim(p_category)) not between 2 and 80
    or (p_price is not null and (p_price<0 or p_price>1000000000 or p_price<>round(p_price,2)))
    or (p_cost is not null and (p_cost<0 or p_cost>1000000000 or p_cost<>round(p_cost,2)))
    or (p_barcode is not null and length(btrim(p_barcode)) not between 3 and 60)
    then raise exception 'PRODUCT_INVALID'; end if;
 if p_product_id is null then
   insert into public.win_products(business_unit,name,variant,category,sale_price,unit_cost,barcode,active,created_by,updated_by)
   values('CAFE_BAR',btrim(p_name),btrim(coalesce(p_variant,'')),btrim(p_category),
     p_price,p_cost,nullif(btrim(coalesce(p_barcode,'')),''),coalesce(p_active,true),uid,uid)
   returning * into current_record;
 else
   select * into previous from public.win_products where id=p_product_id and business_unit='CAFE_BAR' for update;
   if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
   update public.win_products set name=btrim(p_name),variant=btrim(coalesce(p_variant,'')),
     category=btrim(p_category),sale_price=p_price,unit_cost=p_cost,
     barcode=nullif(btrim(coalesce(p_barcode,'')),''),active=coalesce(p_active,true),
     updated_at=now(),updated_by=uid
     where id=p_product_id returning * into current_record;
 end if;
 insert into public.win_product_audit(product_id,actor_id,action,old_record,new_record)
 values(current_record.id,uid,case when p_product_id is null then 'CREATE' else 'UPDATE' end,
 case when p_product_id is null then null else to_jsonb(previous) end,to_jsonb(current_record));
 return jsonb_build_object('id',current_record.id,'name',current_record.name,'variant',current_record.variant,
 'salePrice',current_record.sale_price,'unitCost',current_record.unit_cost,'active',current_record.active);
end;$fn$;
revoke all on function public.win_bar_products_list(text),public.win_bar_product_save(text,uuid,text,text,text,numeric,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.win_bar_products_list(text),public.win_bar_product_save(text,uuid,text,text,text,numeric,numeric,text,boolean) to service_role;
