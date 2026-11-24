alter table public.win_products alter column unit_cost type numeric(20,8);
-- M06: one stock ledger. Historical purchasing is evidence, never a receipt or cash entry.
alter table public.win_products add column stock_min integer check(stock_min>=0);
alter table public.win_products add column stock_configured boolean not null default false;
alter table public.win_bar_stock_movements alter column order_item_id drop not null;
alter table public.win_bar_stock_movements drop constraint win_bar_stock_movements_quantity_change_check;
alter table public.win_bar_stock_movements add constraint bar_quantity_nonzero check(quantity_change<>0);
alter table public.win_bar_stock_movements add column kind text not null default 'SALE' check(kind in ('SALE','OPENING','RECEIPT','WASTE','INTERNAL','COMPLIMENTARY','ADJUSTMENT'));
alter table public.win_bar_stock_movements add column source_key text unique;
alter table public.win_bar_stock_movements add column note text not null default '';
alter table public.win_bar_stock_movements add column unit_cost numeric check(unit_cost>=0);
alter table public.win_bar_order_items add column unit_cost numeric check(unit_cost>=0);

create table public.win_bar_access (
 account_id uuid primary key references win_auth.login_accounts(id),
 granted_by uuid not null references win_auth.login_accounts(id),granted_at timestamptz not null default now()
);
create function public.win_bar_allowed(uid uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from win_auth.login_accounts a where a.id=uid and a.enabled and
 (a.role in ('ADMIN','BAR') or exists(select 1 from public.win_bar_access g where g.account_id=a.id)))
$$;
create table public.win_bar_inventory_requests (
 request_id uuid primary key,actor_id uuid not null references win_auth.login_accounts(id),
 action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create table public.win_bar_inventory_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references win_auth.login_accounts(id),
 action text not null,reference_id uuid,before_record jsonb,after_record jsonb,created_at timestamptz not null default now()
);
create table public.win_bar_purchases (
 id uuid primary key default gen_random_uuid(),source_key text unique,
 kind text not null check(kind in ('HISTORICAL','OPERATIONAL')),
 status text not null check(status in ('RECORDED','ORDERED','PARTIAL','RECEIVED')),
 supplier text check(length(btrim(supplier)) between 2 and 160),purchase_date date,
 total numeric(14,2) check(total>=0),cost_groups jsonb not null default '[]',note text not null default '',
 payment_status text not null default 'UNCONFIRMED' check(payment_status in ('UNCONFIRMED','UNPAID','PARTIAL','PAID')),
 created_by uuid not null references win_auth.login_accounts(id),created_at timestamptz not null default now()
);
create table public.win_bar_purchase_lines (
 id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.win_bar_purchases(id),
 product_id uuid references public.win_products(id),label text not null,
 quantity integer not null check(quantity>0),received_quantity integer not null default 0 check(received_quantity>=0 and received_quantity<=quantity),
 total_cost numeric(14,2) check(total_cost>=0),cost_group text,
 unique(purchase_id,product_id)
);
create table public.win_bar_stock_counts (
 id uuid primary key default gen_random_uuid(),source_key text not null unique,business_date date not null,
 recorded_by uuid not null references win_auth.login_accounts(id),recorded_at timestamptz not null default now(),note text not null
);
create table public.win_bar_stock_count_lines (
 count_id uuid not null references public.win_bar_stock_counts(id),product_id uuid not null references public.win_products(id),
 quantity integer not null check(quantity>=0),primary key(count_id,product_id)
);
create table public.win_bar_reconciliation (
 id uuid primary key default gen_random_uuid(),count_id uuid not null references public.win_bar_stock_counts(id),
 purchase_id uuid not null references public.win_bar_purchases(id),group_name text not null,
 purchased integer not null,physical integer not null,potential_value numeric(14,2) not null,
 status text not null default 'PENDING' check(status in ('PENDING','EXPLAINED')),
 explanation text,unique(count_id,group_name)
);
-- Separate cash ledger; no opening balance or banking details are inferred.
create table public.win_bar_cash_shifts (
 id uuid primary key default gen_random_uuid(),opened_by uuid not null references win_auth.login_accounts(id),
 opened_at timestamptz not null default now(),opening_cash numeric(14,2) not null check(opening_cash>=0),
 status text not null default 'OPEN' check(status in ('OPEN','CLOSED')),
 closed_by uuid references win_auth.login_accounts(id),closed_at timestamptz,counted_cash numeric(14,2),note text
);
create unique index win_bar_one_open_shift on public.win_bar_cash_shifts(status) where status='OPEN';
create table public.win_bar_bank_config (
 singleton boolean primary key default true check(singleton),account_label text not null check(length(btrim(account_label)) between 5 and 200),
 updated_by uuid not null references win_auth.login_accounts(id),updated_at timestamptz not null default now()
);
create table public.win_bar_cash_movements (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,
 shift_id uuid not null references public.win_bar_cash_shifts(id),recorded_by uuid not null references win_auth.login_accounts(id),
 occurred_at timestamptz not null default now(),kind text not null check(kind in ('SALE','PURCHASE_PAYMENT')),
 payment_method text not null check(payment_method in ('CASH','TRANSFER','CARD')),amount_signed numeric(14,2) not null check(amount_signed<>0),
 order_id uuid references public.win_bar_orders(id),purchase_id uuid references public.win_bar_purchases(id),
 bank_account_snapshot text,note text not null default '',
 check((kind='SALE' and amount_signed>0 and order_id is not null and purchase_id is null) or
 (kind='PURCHASE_PAYMENT' and amount_signed<0 and purchase_id is not null and order_id is null))
);
alter table public.win_bar_order_payments alter column cash_movement_id drop not null;
alter table public.win_bar_order_payments add column bar_cash_movement_id uuid unique references public.win_bar_cash_movements(id);
alter table public.win_bar_order_payments add constraint bar_payment_one_ledger check(num_nonnulls(cash_movement_id,bar_cash_movement_id)=1);

create function public.win_bar_cash_guard() returns trigger language plpgsql set search_path='' as $$
declare sh public.win_bar_cash_shifts%rowtype; bank text;
begin
 select * into sh from public.win_bar_cash_shifts where id=new.shift_id for update;
 if not found or sh.status<>'OPEN' then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
 if not public.win_bar_allowed(new.recorded_by) then raise exception 'NOT_AUTHORIZED';end if;
 if new.payment_method='TRANSFER' then
  select account_label into bank from public.win_bar_bank_config;
  if bank is null then raise exception 'BAR_BANK_REQUIRED';end if;
  new.bank_account_snapshot=bank;
 end if;
 return new;
end;$$;
create trigger bar_cash_guard before insert on public.win_bar_cash_movements for each row execute function public.win_bar_cash_guard();
create function public.win_bar_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'BAR_IMMUTABLE';end;$$;
create trigger bar_cash_immutable before update or delete on public.win_bar_cash_movements for each row execute function public.win_bar_immutable();
create trigger bar_stock_immutable before update or delete on public.win_bar_stock_movements for each row execute function public.win_bar_immutable();
create trigger bar_audit_immutable before update or delete on public.win_bar_inventory_audit for each row execute function public.win_bar_immutable();

-- Product locks serialize receipts, sales and adjustments. Unknown inventory cost remains NULL until depleted.
create function public.win_bar_stock_guard() returns trigger language plpgsql set search_path='' as $$
declare p public.win_products%rowtype; qty bigint;
begin
 select * into p from public.win_products where id=new.product_id and business_unit='CAFE_BAR' for update;
 if not found or not public.win_bar_allowed(new.recorded_by) then raise exception 'NOT_AUTHORIZED';end if;
 select coalesce(sum(quantity_change),0) into qty from public.win_bar_stock_movements where product_id=p.id;
 if new.kind<>'OPENING' and not p.stock_configured then raise exception 'BAR_COUNT_REQUIRED';end if;
 if new.kind='OPENING' and (p.stock_configured or qty<>0 or new.quantity_change<0) then raise exception 'BAR_OPENING_EXISTS';end if;
 if qty+new.quantity_change<0 then raise exception 'BAR_STOCK_INSUFFICIENT';end if;
 if new.kind in ('SALE','WASTE','INTERNAL','COMPLIMENTARY') and new.quantity_change>0 then raise exception 'BAR_STOCK_INVALID';end if;
 if new.kind='RECEIPT' and new.quantity_change<0 then raise exception 'BAR_STOCK_INVALID';end if;
 if new.quantity_change<0 then
  new.unit_cost=p.unit_cost;
  if new.order_item_id is not null then update public.win_bar_order_items set unit_cost=p.unit_cost where id=new.order_item_id;end if;
 else
  update public.win_products set unit_cost=case
   when qty=0 then new.unit_cost
   when unit_cost is null or new.unit_cost is null then null
   else (qty*unit_cost+new.quantity_change*new.unit_cost)/(qty+new.quantity_change) end,
   stock_configured=true,updated_by=new.recorded_by,updated_at=now() where id=p.id;
 end if;
 return new;
end;$$;
create trigger bar_stock_guard before insert on public.win_bar_stock_movements for each row execute function public.win_bar_stock_guard();

create or replace function public.win_bar_products_list(p_token text) returns jsonb language plpgsql stable set search_path='' as $$
declare uid uuid;r text;items jsonb;
begin
 select s.account_id,s.role into uid,r from public.win_pin_session(p_token) s;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(uid) then raise exception 'NOT_AUTHORIZED';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'variant',p.variant,'category',p.category,
 'barcode',p.barcode,'salePrice',p.sale_price,'unitCost',case when r='ADMIN' then p.unit_cost end,
 'active',p.active,'stockKnown',p.stock_configured,'stock',case when p.stock_configured then coalesce(s.qty,0) end,
 'stockMin',p.stock_min,'lowStock',p.stock_configured and p.stock_min is not null and coalesce(s.qty,0)<=p.stock_min)
 order by p.category,p.name,p.variant),'[]') into items from public.win_products p left join
 (select product_id,sum(quantity_change) qty from public.win_bar_stock_movements group by product_id) s on s.product_id=p.id
 where p.business_unit='CAFE_BAR' and (p.active or r='ADMIN');
 return jsonb_build_object('products',items,'canEdit',r='ADMIN','stockConfigured',exists(select 1 from public.win_bar_stock_counts));
end;$$;

create function public.win_bar_inventory_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;r text;req uuid;saved public.win_bar_inventory_requests%rowtype;result_ jsonb;
 target uuid;product public.win_products%rowtype;pur public.win_bar_purchases%rowtype;line public.win_bar_purchase_lines%rowtype;
 sh public.win_bar_cash_shifts%rowtype;item jsonb;pid uuid;qty integer;cost numeric;total_ numeric;paid numeric;balance numeric;note_ text;method_ text;bank text;
begin
 select s.account_id,s.role into actor,r from public.win_pin_session(p_token) s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if p_action='access' then return jsonb_build_object('allowed',public.win_bar_allowed(actor));end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 if p_action='cash.state' then
  select * into sh from public.win_bar_cash_shifts where status='OPEN';
  return jsonb_build_object('shift',case when sh.id is not null then to_jsonb(sh) end,
   'cashExpected',coalesce(sh.opening_cash,0)+coalesce((select sum(amount_signed) from public.win_bar_cash_movements where shift_id=sh.id and payment_method='CASH'),0),
   'bankConfigured',exists(select 1 from public.win_bar_bank_config),'bankAccount',(select account_label from public.win_bar_bank_config),
   'shifts',coalesce((select jsonb_agg(to_jsonb(t) order by t.opened_at desc) from (select b.*,a.display_name responsible from public.win_bar_cash_shifts b join win_auth.login_accounts a on a.id=b.opened_by order by b.opened_at desc limit 50) t),'[]'),
   'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at desc) from
    (select * from public.win_bar_cash_movements order by occurred_at desc limit 100) x),'[]'));
 end if;
 if p_action='snapshot' then
  return jsonb_build_object('canEdit',r='ADMIN',
   'counts',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('recordedByName',a.display_name,'total',(select sum(quantity) from public.win_bar_stock_count_lines where count_id=c.id))) from public.win_bar_stock_counts c join win_auth.login_accounts a on a.id=c.recorded_by),'[]'),
   'reconciliation',coalesce((select jsonb_agg(to_jsonb(x) order by x.group_name) from public.win_bar_reconciliation x),'[]'),
   'purchases',case when r='ADMIN' then coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(l)) from public.win_bar_purchase_lines l where l.purchase_id=q.id),'[]')) order by q.created_at desc) from public.win_bar_purchases q),'[]') else '[]'::jsonb end,
   'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at desc) from
    (select m.id,m.product_id,m.quantity_change,m.kind,m.note,m.occurred_at,a.display_name recorded_by_name from public.win_bar_stock_movements m join win_auth.login_accounts a on a.id=m.recorded_by order by m.occurred_at desc,m.id limit 250) x),'[]'),
   'sales',case when r='ADMIN' then (select jsonb_build_object('revenue',coalesce(sum(amount),0),
     'knownCostRevenue',coalesce(sum(amount) filter(where unit_cost is not null),0),
     'cogs',sum(quantity*unit_cost),'margin',sum(amount-quantity*unit_cost) filter(where unit_cost is not null),
     'unknownCostUnits',coalesce(sum(quantity) filter(where unit_cost is null),0)) from public.win_bar_order_items) end);
 end if;
 -- Every mutation stores the exact request and response; double-clicks and retries cannot repeat a movement.
 req=(p->>'requestId')::uuid;
 if req is null then raise exception 'BAR_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-request:'||req::text,0));
 select * into saved from public.win_bar_inventory_requests where request_id=req;
 if found then
  if saved.actor_id<>actor or saved.action<>p_action or saved.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;
 note_=btrim(coalesce(p->>'note',''));
 if length(note_)>1000 then raise exception 'BAR_DATA_INVALID';end if;
 if p_action='cash.open' then
  cost=(p->>'openingCash')::numeric;
  if cost is null or cost<0 or cost<>round(cost,2) then raise exception 'BAR_DATA_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('bar-shift',0));
  if exists(select 1 from public.win_bar_cash_shifts where status='OPEN') then raise exception 'SHIFT_ALREADY_OPEN';end if;
  insert into public.win_bar_cash_shifts(opened_by,opening_cash) values(actor,cost) returning id into target;
 elsif p_action='cash.close' then
  select * into sh from public.win_bar_cash_shifts where id=(p->>'shiftId')::uuid for update;
  if not found or sh.status<>'OPEN' then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
  if sh.opened_by<>actor and r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  cost=(p->>'countedCash')::numeric;
  select sh.opening_cash+coalesce(sum(amount_signed) filter(where payment_method='CASH'),0) into balance from public.win_bar_cash_movements where shift_id=sh.id;
  if cost is null or cost<0 or cost<>round(cost,2) or (cost<>balance and length(note_)<5) then raise exception 'BAR_CLOSE_INVALID';end if;
  update public.win_bar_cash_shifts set status='CLOSED',closed_by=actor,closed_at=now(),counted_cash=cost,note=note_ where id=sh.id;
  target=sh.id;
 else
  if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  if p_action='bank.save' then
   bank=btrim(p->>'accountLabel');
   if bank is null or length(bank) not between 5 and 200 then raise exception 'BAR_DATA_INVALID';end if;
   select to_jsonb(c) into result_ from public.win_bar_bank_config c;
   insert into public.win_bar_inventory_audit(actor_id,action,before_record,after_record) values(actor,p_action,result_,jsonb_build_object('accountLabel',bank));
   insert into public.win_bar_bank_config(account_label,updated_by) values(bank,actor) on conflict(singleton) do update set account_label=excluded.account_label,updated_by=actor,updated_at=now();
  elsif p_action='minimum.set' then
   pid=(p->>'productId')::uuid;qty=(p->>'quantity')::integer;
   if qty<0 then raise exception 'BAR_DATA_INVALID';end if;
   select * into product from public.win_products where id=pid and business_unit='CAFE_BAR' for update;
   if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
   update public.win_products set stock_min=qty,updated_at=now(),updated_by=actor where id=pid;
   insert into public.win_bar_inventory_audit(actor_id,action,reference_id,before_record,after_record) values(actor,p_action,pid,to_jsonb(product),jsonb_build_object('stockMin',qty));
   target=pid;
  elsif p_action='stock.out' then
   pid=(p->>'productId')::uuid;qty=(p->>'quantity')::integer;
   if qty is null or qty<1 or p->>'kind' is null or p->>'kind' not in ('WASTE','INTERNAL','COMPLIMENTARY') or length(note_)<5 then raise exception 'BAR_DATA_INVALID';end if;
   insert into public.win_bar_stock_movements(product_id,quantity_change,recorded_by,kind,source_key,note)
    values(pid,-qty,actor,p->>'kind','out:'||req,note_) returning id into target;
  elsif p_action='purchase.create' then
   if length(btrim(coalesce(p->>'supplier','')))<2 or nullif(p->>'purchaseDate','') is null or
    jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 50 then raise exception 'BAR_PURCHASE_INVALID';end if;
   insert into public.win_bar_purchases(kind,status,supplier,purchase_date,note,created_by,payment_status)
    values('OPERATIONAL','ORDERED',btrim(p->>'supplier'),(p->>'purchaseDate')::date,note_,actor,'UNPAID') returning id into target;
   total_=0;
   for item in select value from jsonb_array_elements(p->'lines') loop
    pid=(item->>'productId')::uuid;qty=(item->>'quantity')::integer;cost=(item->>'totalCost')::numeric;
    if qty is null or qty<1 or cost<0 or cost<>round(cost,2) then raise exception 'BAR_PURCHASE_INVALID';end if;
    select * into product from public.win_products where id=pid and active and business_unit='CAFE_BAR';
    if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
    insert into public.win_bar_purchase_lines(purchase_id,product_id,label,quantity,total_cost)
      values(target,pid,product.name||' '||product.variant,qty,cost);
    total_=total_+cost;
   end loop;
   update public.win_bar_purchases set total=total_ where id=target;
  elsif p_action='purchase.receive' then
   target=(p->>'purchaseId')::uuid;
   select * into pur from public.win_bar_purchases where id=target for update;
   if not found or pur.kind<>'OPERATIONAL' or pur.status not in ('ORDERED','PARTIAL') then raise exception 'BAR_RECEIPT_INVALID';end if;
   if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines')=0 then raise exception 'BAR_RECEIPT_INVALID';end if;
   perform 1 from public.win_products where id in(select product_id from public.win_bar_purchase_lines where purchase_id=target) order by id for update;
   for item in select value from jsonb_array_elements(p->'lines') loop
    select * into line from public.win_bar_purchase_lines where id=(item->>'lineId')::uuid and purchase_id=target for update;
    qty=(item->>'quantity')::integer;
    if line.id is null or qty is null or qty<1 or qty>line.quantity-line.received_quantity or line.product_id is null then raise exception 'BAR_RECEIPT_INVALID';end if;
    insert into public.win_bar_stock_movements(product_id,quantity_change,recorded_by,kind,source_key,note,unit_cost)
     values(line.product_id,qty,actor,'RECEIPT','receipt:'||req||':'||line.id,note_,line.total_cost/line.quantity);
    update public.win_bar_purchase_lines set received_quantity=received_quantity+qty where id=line.id;
   end loop;
   update public.win_bar_purchases set status=case when exists(select 1 from public.win_bar_purchase_lines where purchase_id=target and received_quantity<quantity) then 'PARTIAL' else 'RECEIVED' end where id=target;
  elsif p_action='purchase.pay' then
   target=(p->>'purchaseId')::uuid;
   select * into pur from public.win_bar_purchases where id=target for update;
   -- Historical payment is unknown and cannot be reconstructed as a current payment.
   if not found or pur.kind<>'OPERATIONAL' or pur.total is null then raise exception 'BAR_PURCHASE_INVALID';end if;
   cost=(p->>'amount')::numeric;method_=p->>'method';
   select coalesce(-sum(amount_signed),0) into paid from public.win_bar_cash_movements where purchase_id=target;
   if cost is null or cost<=0 or cost<>round(cost,2) or cost>pur.total-paid or method_ is null or method_ not in ('CASH','TRANSFER','CARD') then raise exception 'PAYMENT_INVALID';end if;
   select * into sh from public.win_bar_cash_shifts where status='OPEN' for update;
   if not found then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
   insert into public.win_bar_cash_movements(request_id,shift_id,recorded_by,kind,payment_method,amount_signed,purchase_id,note)
    values(req,sh.id,actor,'PURCHASE_PAYMENT',method_,-cost,target,note_);
   update public.win_bar_purchases set payment_status=case when paid+cost=total then 'PAID' else 'PARTIAL' end where id=target;
  else raise exception 'BAR_ACTION_INVALID';end if;
 end if;
 result_=jsonb_build_object('ok',true,'id',target);
 insert into public.win_bar_inventory_audit(actor_id,action,reference_id,after_record) values(actor,p_action,target,p);
 insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result) values(req,actor,p_action,p,result_);
 return result_;
end;$$;

do $$declare tab text;begin
 foreach tab in array array['win_bar_access','win_bar_inventory_requests','win_bar_inventory_audit','win_bar_purchases','win_bar_purchase_lines','win_bar_stock_counts','win_bar_stock_count_lines','win_bar_reconciliation','win_bar_cash_shifts','win_bar_bank_config','win_bar_cash_movements'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select,insert,update on public.%I to service_role',tab);
 end loop;
end;$$;
revoke all on function public.win_bar_allowed(uuid),public.win_bar_stock_guard(),public.win_bar_cash_guard(),public.win_bar_immutable(),public.win_bar_inventory_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.win_bar_allowed(uuid),public.win_bar_stock_guard(),public.win_bar_cash_guard(),public.win_bar_immutable(),public.win_bar_inventory_api(text,text,jsonb) to service_role;

alter table public.win_bar_orders add column request_payload jsonb;
CREATE OR REPLACE FUNCTION public.win_bar_order_place(p_token text, p_request_id uuid, p_items jsonb, p_destination text, p_customer_id uuid, p_booking_id uuid, p_court text, p_court_date date, p_court_start time without time zone, p_note text, p_method text, p_client_unknown boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid; sh public.win_bar_cash_shifts%rowtype; book public.win_court_bookings%rowtype;
 o_id uuid; line jsonb; pid uuid; qty int; unit_price numeric; amount_sum numeric:=0;
 product public.win_products%rowtype; item_id uuid; item_count int:=0;
 found_existing public.win_bar_orders%rowtype; cashid uuid; holder_name text; move_request uuid;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(uid) then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'ORDER_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-order:'||p_request_id::text,0));
 select * into found_existing from public.win_bar_orders where request_id=p_request_id;
 if found then
 if found_existing.created_by<>uid or found_existing.request_payload is distinct from jsonb_build_object('items',p_items,'destination',p_destination,'customer',p_customer_id,'booking',p_booking_id,'court',p_court,'day',p_court_date,'start',p_court_start,'note',coalesce(p_note,''),'method',p_method,'unknown',coalesce(p_client_unknown,false)) then raise exception 'REQUEST_ID_REUSED';end if;
 return jsonb_build_object('id',found_existing.id,'total',found_existing.total,'status',found_existing.status,'replayed',true);end if;
 if p_destination not in ('IMMEDIATE','ACCOUNT','COURT') or length(coalesce(p_note,''))>400 then raise exception 'ORDER_INVALID';end if;
 -- Cobrar ahora: sin cuenta corriente; opcionalmente la cancha y el horario del cliente (para saber quién consume),
 -- o "No conozco cliente" (p_client_unknown). Nunca las dos cosas.
 if p_destination='IMMEDIATE' and (p_customer_id is not null or p_method is null or p_method not in ('CASH','TRANSFER','CARD')) then raise exception 'ORDER_INVALID';end if;
 if coalesce(p_client_unknown,false) and (p_destination<>'IMMEDIATE' or p_court is not null or p_booking_id is not null) then raise exception 'ORDER_INVALID';end if;
 if p_destination='IMMEDIATE' and p_court is null and p_booking_id is not null then raise exception 'COURT_INVALID';end if;
 if p_destination<>'IMMEDIATE' and p_method is not null then raise exception 'ORDER_INVALID';end if;
 if p_destination='ACCOUNT' and (p_customer_id is null or p_booking_id is not null or p_court is not null or not exists(select 1 from public.win_customers where id=p_customer_id)) then raise exception 'CUSTOMER_INVALID';end if;
 if p_destination='COURT' or (p_destination='IMMEDIATE' and p_court is not null) then
   if p_court not in ('C1','C2','C3','C4') or p_court_date is null or p_court_start is null then raise exception 'COURT_INVALID';end if;
   if p_booking_id is not null then
     select * into book from public.win_court_bookings where id=p_booking_id;
     if not found or book.status<>'CONFIRMED' or book.court<>p_court or book.business_date<>p_court_date or book.start_time<>p_court_start then raise exception 'COURT_INVALID';end if;
     holder_name=coalesce(nullif(book.customer_name,''),book.holder);
   else holder_name=null;end if;
 end if;
 select * into sh from public.win_bar_cash_shifts where status='OPEN' for update;
 if not found then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
 -- Lock products in deterministic order to obtain consistent prices while admin edits.
 perform 1 from public.win_products p where p.id in
  (select (value->>'id')::uuid from jsonb_array_elements(p_items) a(value))
  order by p.id for update;
 for line in select value from jsonb_array_elements(p_items) a(value) loop
   item_count=item_count+1;
   if jsonb_typeof(line) <> 'object' then raise exception 'ORDER_INVALID';end if;
   pid=(line->>'id')::uuid; qty=(line->>'quantity')::integer;
   if qty is null or qty<1 or qty>100 then raise exception 'ORDER_INVALID';end if;
   select * into product from public.win_products where id=pid and business_unit='CAFE_BAR' and active;
   if not found or product.sale_price is null or product.sale_price<=0 then raise exception 'PRICE_NOT_SET';end if;
   if (select count(*) from jsonb_array_elements(p_items) a(value) where value->>'id'=pid::text)>1 then raise exception 'ORDER_INVALID';end if;
   amount_sum=amount_sum+qty*product.sale_price;
 end loop;
 if amount_sum>1000000000 then raise exception 'ORDER_INVALID';end if;
 insert into public.win_bar_orders(request_id,created_by,status,destination,customer_id,booking_id,court,court_date,court_start,court_holder,client_unknown,note,total,request_payload)
 values(p_request_id,uid,case when p_destination='IMMEDIATE' then 'PAID' else 'OPEN' end,p_destination,p_customer_id,p_booking_id,p_court,p_court_date,p_court_start,holder_name,coalesce(p_client_unknown,false),coalesce(p_note,''),amount_sum,jsonb_build_object('items',p_items,'destination',p_destination,'customer',p_customer_id,'booking',p_booking_id,'court',p_court,'day',p_court_date,'start',p_court_start,'note',coalesce(p_note,''),'method',p_method,'unknown',coalesce(p_client_unknown,false)))
 returning id into o_id;
 for line in select value from jsonb_array_elements(p_items) a(value) loop
  pid=(line->>'id')::uuid;qty=(line->>'quantity')::integer;
  select * into product from public.win_products where id=pid;
  insert into public.win_bar_order_items(order_id,product_id,quantity,product_label,unit_price)
    values(o_id,pid,qty,product.name||case when product.variant<>'' then ' · '||product.variant else '' end,product.sale_price) returning id into item_id;
  insert into public.win_bar_stock_movements(order_item_id,product_id,quantity_change,recorded_by) values(item_id,pid,-qty,uid);
 end loop;
 if p_destination='IMMEDIATE' then
   insert into public.win_bar_cash_movements(request_id,shift_id,recorded_by,kind,payment_method,amount_signed,order_id,note)
   values(p_request_id,sh.id,uid,'SALE',p_method,amount_sum,o_id,coalesce(p_note,'')) returning id into cashid;
   insert into public.win_bar_order_payments(request_id,order_id,bar_cash_movement_id,paid_by,amount,method)
   values(p_request_id,o_id,cashid,uid,amount_sum,p_method);
 end if;
 return jsonb_build_object('id',o_id,'total',amount_sum,'status',case when p_destination='IMMEDIATE' then 'PAID' else 'OPEN' end,'replayed',false);
end;$function$;

CREATE OR REPLACE FUNCTION public.win_bar_order_pay(p_token text, p_request_id uuid, p_order_id uuid, p_amount numeric, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid; sh public.win_bar_cash_shifts%rowtype; o public.win_bar_orders%rowtype; prior public.win_bar_order_payments%rowtype; paid_total numeric; cmid uuid; can_sell boolean; can_reception boolean;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 can_sell=public.win_bar_allowed(uid);
 can_reception=false;
 if not can_sell and not can_reception then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_order_id is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_method not in ('CASH','TRANSFER','CARD') then raise exception 'PAYMENT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-payment:'||p_request_id::text,0));
 select * into prior from public.win_bar_order_payments where request_id=p_request_id;
 if found then
  if prior.order_id<>p_order_id or prior.amount<>p_amount or prior.method<>p_method then raise exception 'REQUEST_ID_REUSED';end if;
  return jsonb_build_object('orderId',p_order_id,'replayed',true);
 end if;
 select * into sh from public.win_bar_cash_shifts where status='OPEN' for update;
 if not found then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
 select * into o from public.win_bar_orders where id=p_order_id for update;
 if not found or o.status<>'OPEN' then raise exception 'ORDER_NOT_PENDING';end if;
 if not can_sell and (not can_reception or o.destination<>'COURT') then raise exception 'NOT_AUTHORIZED';end if;
 select coalesce(sum(amount),0) into paid_total from public.win_bar_order_payments where order_id=o.id;
 if p_amount>o.total-paid_total then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
 insert into public.win_bar_cash_movements(request_id,shift_id,recorded_by,kind,payment_method,amount_signed,order_id,note)
 values(p_request_id,sh.id,uid,'SALE',p_method,p_amount,o.id,'Cobro pendiente Bar') returning id into cmid;
 insert into public.win_bar_order_payments(request_id,order_id,bar_cash_movement_id,paid_by,amount,method)
 values(p_request_id,o.id,cmid,uid,p_amount,p_method);
 if paid_total+p_amount=o.total then update public.win_bar_orders set status='PAID' where id=o.id;end if;
 return jsonb_build_object('orderId',o.id,'remaining',o.total-paid_total-p_amount,'replayed',false);
end;$function$;

CREATE OR REPLACE FUNCTION public.win_bar_product_save(p_token text, p_product_id uuid, p_name text, p_variant text, p_category text, p_price numeric, p_cost numeric, p_barcode text, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid; r text; previous public.win_products%rowtype; current_record public.win_products%rowtype;
begin
 select s.account_id,s.role into uid,r from public.win_pin_session(p_token) s;
 if uid is null then raise exception 'SESSION_INVALID'; end if;
 if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED'; end if;
 if p_name is null or length(btrim(p_name)) not between 2 and 120
    or length(coalesce(p_variant,''))>90
    or p_category is null or length(btrim(p_category)) not between 2 and 80
    or (p_price is not null and (p_price<0 or p_price>1000000000 or p_price<>round(p_price,2)))
    or (p_cost is not null and (p_cost<0 or p_cost>1000000000 or p_cost<>round(p_cost,8)))
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
   if previous.stock_configured and p_cost is distinct from previous.unit_cost then raise exception 'BAR_COST_MANAGED';end if;
   update public.win_products set name=btrim(p_name),variant=btrim(coalesce(p_variant,'')),
     category=btrim(p_category),sale_price=p_price,unit_cost=p_cost,
     barcode=nullif(btrim(coalesce(p_barcode,'')),''),active=coalesce(p_active,true),
     updated_at=now(),updated_by=uid
     where id=p_product_id returning * into current_record;
 end if;
 if p_product_id is null and exists(select 1 from public.win_bar_stock_counts) then
 update public.win_products set stock_configured=true,unit_cost=null where id=current_record.id returning * into current_record;end if;
 insert into public.win_product_audit(product_id,actor_id,action,old_record,new_record)
 values(current_record.id,uid,case when p_product_id is null then 'CREATE' else 'UPDATE' end,
 case when p_product_id is null then null else to_jsonb(previous) end,to_jsonb(current_record));
 return jsonb_build_object('id',current_record.id,'name',current_record.name,'variant',current_record.variant,
 'salePrice',current_record.sale_price,'unitCost',current_record.unit_cost,'active',current_record.active);
end;$function$;


do $patch$
declare f record;definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('win_bar_customers','win_bar_customer_create','win_bar_court_choices','win_bar_pending','win_bar_court_pending','win_bar_court_day_pending') loop
  definition=pg_get_functiondef(f.oid);
  definition=replace(definition,'begin','begin
 if not exists(select 1 from public.win_pin_session(p_token) s where public.win_bar_allowed(s.account_id)) then raise exception ''NOT_AUTHORIZED'';end if;');
  execute definition;
 end loop;
end;$patch$;

create function public.win_bar_new_product() returns trigger language plpgsql set search_path='' as $$
begin
 if new.business_unit='CAFE_BAR' and exists(select 1 from public.win_bar_inventory_audit where action='OPENING_COUNT') then new.stock_configured=true;new.unit_cost=null;end if;
 return new;
end;$$;
create trigger bar_new_product before insert on public.win_products for each row execute function public.win_bar_new_product();
revoke all on function public.win_bar_new_product() from public,anon,authenticated;
grant execute on function public.win_bar_new_product() to service_role;
