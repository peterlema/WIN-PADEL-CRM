-- WIN Bar POS V1. A sellable item is one win_products row. Payment != sale != stock issue.
create table if not exists public.win_customers (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 2 and 120),
 phone text,
 created_at timestamptz not null default now(),
 created_by uuid not null references win_auth.login_accounts(id)
);
create unique index if not exists win_customers_name_unique on public.win_customers(lower(btrim(name)));
create table if not exists public.win_bar_orders (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 created_at timestamptz not null default now(),
 created_by uuid not null references win_auth.login_accounts(id),
 status text not null default 'OPEN' check(status in ('OPEN','PAID')),
 destination text not null check(destination in ('IMMEDIATE','ACCOUNT','COURT')),
 customer_id uuid references public.win_customers(id),
 booking_id uuid references public.win_court_bookings(id),
 court text check(court is null or court in ('C1','C2','C3','C4')),
 court_date date,
 court_start time,
 court_holder text,
 note text not null default '' check(length(note)<=400),
 total numeric(14,2) not null check(total>0),
 constraint bar_destination_check check (
  (destination='IMMEDIATE' and customer_id is null and booking_id is null and court is null)
  or (destination='ACCOUNT' and customer_id is not null and booking_id is null and court is null)
  or (destination='COURT' and court is not null and court_date is not null and court_start is not null and customer_id is null)
 )
);
create index if not exists win_bar_orders_pending_idx on public.win_bar_orders(status,destination,created_at desc);
create table if not exists public.win_bar_order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.win_bar_orders(id),
 product_id uuid not null references public.win_products(id),
 quantity integer not null check(quantity between 1 and 100),
 product_label text not null,
 unit_price numeric(14,2) not null check(unit_price>0),
 amount numeric(14,2) generated always as (quantity * unit_price) stored,
 unique(order_id,product_id)
);
create table if not exists public.win_bar_stock_movements (
 id uuid primary key default gen_random_uuid(),
 order_item_id uuid not null unique references public.win_bar_order_items(id),
 product_id uuid not null references public.win_products(id),
 quantity_change integer not null check(quantity_change<0),
 occurred_at timestamptz not null default now(),
 recorded_by uuid not null references win_auth.login_accounts(id)
);
create index if not exists win_bar_stock_by_product on public.win_bar_stock_movements(product_id,occurred_at);
create table if not exists public.win_bar_order_payments (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 order_id uuid not null references public.win_bar_orders(id),
 cash_movement_id uuid not null unique references public.win_cash_movements(id),
 paid_at timestamptz not null default now(),
 paid_by uuid not null references win_auth.login_accounts(id),
 amount numeric(14,2) not null check(amount>0),
 method text not null check(method in ('CASH','TRANSFER','CARD'))
);
create index if not exists win_bar_payments_order on public.win_bar_order_payments(order_id);
do $$
declare tab text;
begin
 foreach tab in array array['win_customers','win_bar_orders','win_bar_order_items','win_bar_stock_movements','win_bar_order_payments'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select,insert,update on public.%I to service_role',tab);
 end loop;
end;$$;

create or replace function public.win_bar_customers(p_token text)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; items jsonb;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'BAR','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb)
 into items from public.win_customers;
 return jsonb_build_object('customers',items);
end;$fn$;

create or replace function public.win_bar_customer_create(p_token text,p_name text)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare uid uuid; cid uuid; cleaned text;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'BAR','SALE') then raise exception 'NOT_AUTHORIZED';end if;
 cleaned=btrim(coalesce(p_name,''));
 if length(cleaned) not between 2 and 120 then raise exception 'CUSTOMER_INVALID';end if;
 insert into public.win_customers(name,created_by) values(cleaned,uid)
 on conflict do nothing returning id into cid;
 if cid is null then select id into cid from public.win_customers where lower(btrim(name))=lower(cleaned);end if;
 return jsonb_build_object('id',cid,'name',cleaned);
end;$fn$;

create or replace function public.win_bar_court_choices(p_token text,p_day date)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; items jsonb;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'BAR','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 if p_day is null or p_day<current_date-7 or p_day>current_date+14 then raise exception 'DATE_INVALID';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',b.id,'court',b.court,'date',b.business_date,'start',to_char(b.start_time,'HH24:MI'),
  'holder',coalesce(nullif(b.customer_name,''),b.holder),'kind',b.kind
 ) order by b.start_time,b.court),'[]'::jsonb)
 into items from public.win_court_bookings b where b.business_date=p_day and b.status='CONFIRMED';
 return jsonb_build_object('bookings',items);
end;$fn$;

create or replace function public.win_bar_order_place(
 p_token text,p_request_id uuid,p_items jsonb,p_destination text,
 p_customer_id uuid,p_booking_id uuid,p_court text,p_court_date date,p_court_start time,
 p_note text,p_method text
) returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare uid uuid; sh public.win_cash_shifts%rowtype; book public.win_court_bookings%rowtype;
 o_id uuid; line jsonb; pid uuid; qty int; unit_price numeric; amount_sum numeric:=0;
 product public.win_products%rowtype; item_id uuid; item_count int:=0;
 found_existing public.win_bar_orders%rowtype; cashid uuid; holder_name text; move_request uuid;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'BAR','SALE') then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'ORDER_INVALID';end if;
 select * into found_existing from public.win_bar_orders where request_id=p_request_id;
 if found then return jsonb_build_object('id',found_existing.id,'total',found_existing.total,'status',found_existing.status,'replayed',true);end if;
 if p_destination not in ('IMMEDIATE','ACCOUNT','COURT') or length(coalesce(p_note,''))>400 then raise exception 'ORDER_INVALID';end if;
 if p_destination='IMMEDIATE' and (p_customer_id is not null or p_booking_id is not null or p_court is not null or p_method not in ('CASH','TRANSFER','CARD')) then raise exception 'ORDER_INVALID';end if;
 if p_destination<>'IMMEDIATE' and p_method is not null then raise exception 'ORDER_INVALID';end if;
 if p_destination='ACCOUNT' and (p_customer_id is null or p_booking_id is not null or p_court is not null or not exists(select 1 from public.win_customers where id=p_customer_id)) then raise exception 'CUSTOMER_INVALID';end if;
 if p_destination='COURT' then
   if p_court not in ('C1','C2','C3','C4') or p_court_date is null or p_court_start is null then raise exception 'COURT_INVALID';end if;
   if p_booking_id is not null then
     select * into book from public.win_court_bookings where id=p_booking_id;
     if not found or book.status<>'CONFIRMED' or book.court<>p_court or book.business_date<>p_court_date or book.start_time<>p_court_start then raise exception 'COURT_INVALID';end if;
     holder_name=coalesce(nullif(book.customer_name,''),book.holder);
   else holder_name=null;end if;
 end if;
 select * into sh from public.win_cash_shifts where status='OPEN' for update;
 if not found then raise exception 'SHIFT_NOT_OPEN';end if;
 -- Lock products in deterministic order to obtain consistent prices while admin edits.
 perform 1 from public.win_products p where p.id in
  (select (value->>'id')::uuid from jsonb_array_elements(p_items) a(value))
  order by p.id for share;
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
 insert into public.win_bar_orders(request_id,created_by,status,destination,customer_id,booking_id,court,court_date,court_start,court_holder,note,total)
 values(p_request_id,uid,case when p_destination='IMMEDIATE' then 'PAID' else 'OPEN' end,p_destination,p_customer_id,p_booking_id,p_court,p_court_date,p_court_start,holder_name,coalesce(p_note,''),amount_sum)
 returning id into o_id;
 for line in select value from jsonb_array_elements(p_items) a(value) loop
  pid=(line->>'id')::uuid;qty=(line->>'quantity')::integer;
  select * into product from public.win_products where id=pid;
  insert into public.win_bar_order_items(order_id,product_id,quantity,product_label,unit_price)
    values(o_id,pid,qty,product.name||case when product.variant<>'' then ' · '||product.variant else '' end,product.sale_price) returning id into item_id;
  insert into public.win_bar_stock_movements(order_item_id,product_id,quantity_change,recorded_by) values(item_id,pid,-qty,uid);
 end loop;
 if p_destination='IMMEDIATE' then
   insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,reference_type,reference_id,note)
   values(p_request_id,sh.id,uid,'SALE','CAFE_BAR',p_method,amount_sum,'BAR_ORDER',o_id::text,coalesce(p_note,'')) returning id into cashid;
   insert into public.win_bar_order_payments(request_id,order_id,cash_movement_id,paid_by,amount,method)
   values(p_request_id,o_id,cashid,uid,amount_sum,p_method);
 end if;
 return jsonb_build_object('id',o_id,'total',amount_sum,'status',case when p_destination='IMMEDIATE' then 'PAID' else 'OPEN' end,'replayed',false);
end;$fn$;

create or replace function public.win_bar_pending(p_token text)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; items jsonb; people jsonb;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'BAR','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 select coalesce(jsonb_agg(v.payload order by v.created_at desc),'[]'::jsonb) into items from (
  select o.created_at,jsonb_build_object('id',o.id,'date',o.created_at,'destination',o.destination,
    'customerId',o.customer_id,'customerName',c.name,'bookingId',o.booking_id,'court',o.court,
    'courtDate',o.court_date,'courtStart',to_char(o.court_start,'HH24:MI'),
    'holder',o.court_holder,'total',o.total,'paid',coalesce(sum(py.amount),0),
    'balance',o.total-coalesce(sum(py.amount),0),'note',o.note,
    'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_label,'quantity',i.quantity,'price',i.unit_price) order by i.product_label) from public.win_bar_order_items i where i.order_id=o.id),'[]'::jsonb)
  ) as payload
  from public.win_bar_orders o
  left join public.win_customers c on c.id=o.customer_id
  left join public.win_bar_order_payments py on py.order_id=o.id
  where o.status='OPEN'
  group by o.id,c.name
  order by o.created_at desc limit 150
 ) v;
 return jsonb_build_object('orders',items);
end;$fn$;

create or replace function public.win_bar_order_pay(p_token text,p_request_id uuid,p_order_id uuid,p_amount numeric,p_method text)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare uid uuid; sh public.win_cash_shifts%rowtype; o public.win_bar_orders%rowtype; prior public.win_bar_order_payments%rowtype; paid_total numeric; cmid uuid;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'BAR','SALE') then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_order_id is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_method not in ('CASH','TRANSFER','CARD') then raise exception 'PAYMENT_INVALID';end if;
 select * into prior from public.win_bar_order_payments where request_id=p_request_id;
 if found then
  if prior.order_id<>p_order_id or prior.amount<>p_amount or prior.method<>p_method then raise exception 'REQUEST_ID_REUSED';end if;
  return jsonb_build_object('orderId',p_order_id,'replayed',true);
 end if;
 select * into sh from public.win_cash_shifts where status='OPEN' for update;
 if not found then raise exception 'SHIFT_NOT_OPEN';end if;
 select * into o from public.win_bar_orders where id=p_order_id for update;
 if not found or o.status<>'OPEN' then raise exception 'ORDER_NOT_PENDING';end if;
 select coalesce(sum(amount),0) into paid_total from public.win_bar_order_payments where order_id=o.id;
 if p_amount>o.total-paid_total then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
 insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,reference_type,reference_id,note)
 values(p_request_id,sh.id,uid,'SALE','CAFE_BAR',p_method,p_amount,'BAR_ORDER',o.id::text,'Cobro pendiente Bar') returning id into cmid;
 insert into public.win_bar_order_payments(request_id,order_id,cash_movement_id,paid_by,amount,method)
 values(p_request_id,o.id,cmid,uid,p_amount,p_method);
 if paid_total+p_amount=o.total then update public.win_bar_orders set status='PAID' where id=o.id;end if;
 return jsonb_build_object('orderId',o.id,'remaining',o.total-paid_total-p_amount,'replayed',false);
end;$fn$;

revoke all on function
 public.win_bar_customers(text),public.win_bar_customer_create(text,text),public.win_bar_court_choices(text,date),
 public.win_bar_order_place(text,uuid,jsonb,text,uuid,uuid,text,date,time,text,text),
 public.win_bar_pending(text),public.win_bar_order_pay(text,uuid,uuid,numeric,text)
 from public,anon,authenticated;
grant execute on function
 public.win_bar_customers(text),public.win_bar_customer_create(text,text),public.win_bar_court_choices(text,date),
 public.win_bar_order_place(text,uuid,jsonb,text,uuid,uuid,text,date,time,text,text),
 public.win_bar_pending(text),public.win_bar_order_pay(text,uuid,uuid,numeric,text)
 to service_role;
