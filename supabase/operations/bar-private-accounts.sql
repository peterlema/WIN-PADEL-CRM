
-- Private Bar accounts: additive schema, no authorization or repricing of existing customers/orders.
create table public.win_bar_private_accounts(
 id uuid primary key default gen_random_uuid(),customer_id uuid not null unique references public.win_customers(id),
 holder text not null check(length(btrim(holder)) between 2 and 120),
 account_type text not null check(account_type in('PARTNER','EMPLOYEE','OTHER')),
 active boolean not null default false,configuration jsonb not null,revision bigint not null default 1,
 created_at timestamptz not null default now(),created_by uuid not null references win_auth.login_accounts(id),
 updated_at timestamptz not null default now(),updated_by uuid not null references win_auth.login_accounts(id)
);
alter table public.win_bar_private_accounts enable row level security;
revoke all on public.win_bar_private_accounts from public,anon,authenticated;
grant select,insert,update on public.win_bar_private_accounts to service_role;
alter table public.win_bar_orders add column private_account_id uuid references public.win_bar_private_accounts(id);
alter table public.win_bar_orders add column private_holder_snapshot text;
alter table public.win_bar_order_items add column private_policy_snapshot jsonb;
create index win_bar_private_orders on public.win_bar_orders(customer_id,created_at) where destination='ACCOUNT';

create function public.win_bar_private_config_(cfg jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare d numeric;m numeric;step_ numeric;r text;item record;v numeric;
begin
 d=(cfg->>'discountPercent')::numeric;m=(cfg->>'minMarkupPercent')::numeric;step_=(cfg->>'roundingStep')::numeric;r=cfg->>'rounding';
 if d is null or d not between 0 and 100 or d<>round(d,2) or m is null or m not between 0 and 1000 or m<>round(m,2)
 or step_ is null or step_ not between 0.01 and 1000000 or step_<>round(step_,2) or r is null or r not in('UP','NEAREST','NONE')
 or jsonb_typeof(cfg->'exceptions') is distinct from 'object' or length(coalesce(cfg->>'notes',''))>1000
 then raise exception 'PRIVATE_CONFIG_INVALID';end if;
 if (select count(*) from jsonb_each(cfg->'exceptions'))>50 then raise exception 'PRIVATE_CONFIG_INVALID';end if;
 for item in select * from jsonb_each_text(cfg->'exceptions') loop
  perform item.key::uuid;v=item.value::numeric;
  if v is null or v not between 0.01 and 1000000000 or v<>round(v,2) then raise exception 'PRIVATE_CONFIG_INVALID';end if;
 end loop;
 return jsonb_build_object('discountPercent',d,'minMarkupPercent',m,'rounding',r,'roundingStep',step_,'exceptions',cfg->'exceptions','notes',coalesce(cfg->>'notes',''));
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'PRIVATE_CONFIG_INVALID';
end;$$;

create function public.win_bar_private_price_(cfg jsonb,pr public.win_products) returns jsonb language plpgsql immutable set search_path='' as $$
declare raw_ numeric;floor_ numeric;final_ numeric;fixed_ numeric;step_ numeric:=(cfg->>'roundingStep')::numeric;reason_ text;
begin
 if not pr.active or pr.business_unit<>'CAFE_BAR' or pr.sale_price is null or pr.sale_price<=0 then reason_='Precio público no válido';
 elsif pr.unit_cost is null then reason_='Falta el costo: requiere revisión administrativa';
 else
  floor_=pr.unit_cost*(1+(cfg->>'minMarkupPercent')::numeric/100);
  fixed_=(cfg->'exceptions'->>pr.id::text)::numeric;
  raw_=coalesce(fixed_,greatest(pr.sale_price*(1-(cfg->>'discountPercent')::numeric/100),floor_));
  final_=case cfg->>'rounding' when 'UP' then ceil(raw_/step_)*step_ when 'NEAREST' then round(raw_/step_)*step_ else ceil(raw_*100)/100 end;
  if final_<floor_ and fixed_ is null then final_=case when cfg->>'rounding'='NONE' then ceil(floor_*100)/100 else ceil(floor_/step_)*step_ end;end if;
  if fixed_ is not null and (fixed_<floor_ or final_<>fixed_) then reason_='La excepción no respeta el recargo mínimo o el redondeo';
  elsif final_ is null or final_<=0 or final_>pr.sale_price or final_<floor_ then reason_='No hay precio válido entre el costo mínimo y el precio público';end if;
 end if;
 return jsonb_build_object('productId',pr.id,'name',pr.name||case when pr.variant<>'' then ' · '||pr.variant else '' end,
  'unitCost',pr.unit_cost,'publicPrice',pr.sale_price,'price',case when reason_ is null then round(final_,2) end,
  'valid',reason_ is null,'error',reason_,'estimated',pr.cost_is_provisional,
  'discountAmount',case when reason_ is null then pr.sale_price-final_ end,
  'effectiveDiscount',case when reason_ is null then round(100*(pr.sale_price-final_)/pr.sale_price,2) end,
  'grossMargin',case when reason_ is null then round(final_-pr.unit_cost,2) end,
  'marginPercent',case when reason_ is null then round(100*(final_-pr.unit_cost)/final_,2) end);
end;$$;

create function public.win_bar_private_quote_(cid uuid,items jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare a public.win_bar_private_accounts%rowtype;pr public.win_products%rowtype;line jsonb;q jsonb;all_ jsonb:='[]';total_ numeric:=0;qty integer;valid_ boolean:=true;
begin
 select * into a from public.win_bar_private_accounts where customer_id=cid and active;
 if not found then raise exception 'PRIVATE_ACCOUNT_UNAUTHORIZED';end if;
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 30 then raise exception 'ORDER_INVALID';end if;
 for line in select value from jsonb_array_elements(items) order by value->>'id' loop
  qty=(line->>'quantity')::integer;
  if qty is null or qty not between 1 and 100 or (select count(*) from jsonb_array_elements(items) x where x->>'id'=line->>'id')<>1 then raise exception 'ORDER_INVALID';end if;
  select * into pr from public.win_products where id=(line->>'id')::uuid;
  if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
  q=public.win_bar_private_price_(a.configuration,pr);
  valid_=valid_ and (q->>'valid')::boolean;
  total_=total_+coalesce((q->>'price')::numeric,0)*qty;
  all_=all_||jsonb_build_array(q||jsonb_build_object('quantity',qty,'total',(q->>'price')::numeric*qty));
 end loop;
 return jsonb_build_object('lines',all_,'valid',valid_,'total',case when valid_ then total_ end,
  'fingerprint',md5(jsonb_build_object('revision',a.revision,'configuration',a.configuration,'lines',all_)::text),'holder',a.holder);
end;$$;

create function public.win_bar_private_order_guard() returns trigger language plpgsql set search_path='' as $$
declare a public.win_bar_private_accounts%rowtype;
begin
 if tg_op='UPDATE' then
  if (new.private_account_id,new.private_holder_snapshot) is distinct from (old.private_account_id,old.private_holder_snapshot) then raise exception 'BAR_PRICE_IMMUTABLE';end if;
  return new;
 end if;
 if new.destination='ACCOUNT' then
  select * into a from public.win_bar_private_accounts where customer_id=new.customer_id for update;
  if not found or not a.active or new.employee_id is not null then raise exception 'PRIVATE_ACCOUNT_UNAUTHORIZED';end if;
  new.private_account_id=a.id;new.private_holder_snapshot=a.holder;
 end if;
 return new;
end;$$;
create trigger bar_private_order_guard before insert or update on public.win_bar_orders for each row execute function public.win_bar_private_order_guard();

create or replace function public.win_bar_price_snapshot_guard() returns trigger language plpgsql set search_path='' as $$
declare employee uuid;private_ uuid;a public.win_bar_private_accounts%rowtype;pr public.win_products%rowtype;q jsonb;
begin
 if tg_op='UPDATE' then
  if (to_jsonb(new)-'amount') is distinct from (to_jsonb(old)-'amount') then raise exception 'BAR_PRICE_IMMUTABLE';end if;
  return new;
 end if;
 select employee_id,private_account_id into employee,private_ from public.win_bar_orders where id=new.order_id;
 select * into pr from public.win_products where id=new.product_id and business_unit='CAFE_BAR';
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 if private_ is not null then
  select * into a from public.win_bar_private_accounts where id=private_;
  q=public.win_bar_private_price_(a.configuration,pr);
  if not (q->>'valid')::boolean or new.unit_price is distinct from (q->>'price')::numeric then raise exception 'PRIVATE_PRICE_REVIEW';end if;
  new.public_unit_price=pr.sale_price;new.discount_unit_amount=pr.sale_price-new.unit_price;
  new.private_policy_snapshot=jsonb_build_object('accountId',a.id,'holder',a.holder,'type',a.account_type,'revision',a.revision,'configuration',a.configuration,'applied',q);
  new.employee_policy_snapshot=null;new.employee_exception_id=null;
 elsif employee is null then
  new.public_unit_price=new.unit_price;new.discount_unit_amount=0;new.employee_policy_snapshot=null;new.employee_exception_id=null;new.private_policy_snapshot=null;
 elsif new.public_unit_price is null or new.discount_unit_amount is null or new.public_unit_price-new.discount_unit_amount<>new.unit_price or new.employee_policy_snapshot is null then raise exception 'EMPLOYEE_SNAPSHOT_INVALID';end if;
 new.unit_cost=pr.unit_cost;new.cost_is_provisional=pr.cost_is_provisional;
 return new;
end;$$;

CREATE OR REPLACE FUNCTION public.win_bar_order_place_priced_(p_token text, p_request_id uuid, p_items jsonb, p_destination text, p_customer_id uuid, p_booking_id uuid, p_court text, p_court_date date, p_court_start time without time zone, p_note text, p_method text, p_client_unknown boolean DEFAULT false, p_employee_id uuid DEFAULT NULL::uuid, p_authorizations jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare private_ public.win_bar_private_accounts%rowtype;private_quote_ jsonb;uid uuid; sh public.win_bar_cash_shifts%rowtype; book public.win_court_bookings%rowtype;
 o_id uuid; line jsonb; pid uuid; qty int; unit_price numeric; amount_sum numeric:=0;
 product public.win_products%rowtype; item_id uuid; item_count int:=0;
 found_existing public.win_bar_orders%rowtype; cashid uuid; holder_name text; move_request uuid; request_ jsonb; quotes_ jsonb:='{}'; quote_ jsonb; employee_name_ text; exception_ uuid;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(uid) then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'ORDER_INVALID';end if;
 request_=jsonb_build_object('items',p_items,'destination',p_destination,'customer',p_customer_id,'booking',p_booking_id,'court',p_court,'day',p_court_date,'start',p_court_start,'note',coalesce(p_note,''),'method',p_method,'unknown',coalesce(p_client_unknown,false));
 if p_employee_id is not null then
  perform public.win_bar_employee_ready_();
  if p_destination not in('IMMEDIATE','ACCOUNT') then raise exception 'ORDER_INVALID';end if;
  select a.display_name into employee_name_ from public.win_bar_employee_access e join win_auth.login_accounts a on a.id=e.account_id join public.win_staff s on s.user_id=a.id where a.id=p_employee_id and e.authorized and a.enabled and s.active for update of e;
  if not found then raise exception 'EMPLOYEE_NOT_AUTHORIZED';end if;
  request_=request_||jsonb_build_object('employee',p_employee_id,'authorizations',p_authorizations);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-order:'||p_request_id::text,0));
 select * into found_existing from public.win_bar_orders where request_id=p_request_id;
 if found then
 if found_existing.created_by<>uid or found_existing.request_payload is distinct from request_ then raise exception 'REQUEST_ID_REUSED';end if;
 return jsonb_build_object('id',found_existing.id,'total',found_existing.total,'status',found_existing.status,'replayed',true);end if;
 if p_destination='ACCOUNT' then
  select * into private_ from public.win_bar_private_accounts where customer_id=p_customer_id for update;
  if not found or not private_.active or p_employee_id is not null then raise exception 'PRIVATE_ACCOUNT_UNAUTHORIZED';end if;
 end if;
 if p_destination not in ('IMMEDIATE','ACCOUNT','COURT') or length(coalesce(p_note,''))>400 then raise exception 'ORDER_INVALID';end if;
 -- Cobrar ahora: sin cuenta corriente; opcionalmente la cancha y el horario del cliente (para saber quién consume),
 -- o "No conozco cliente" (p_client_unknown). Nunca las dos cosas.
 if p_destination='IMMEDIATE' and (p_customer_id is not null or p_method is null or p_method not in ('CASH','TRANSFER','CARD')) then raise exception 'ORDER_INVALID';end if;
 if coalesce(p_client_unknown,false) and (p_destination<>'IMMEDIATE' or p_court is not null or p_booking_id is not null) then raise exception 'ORDER_INVALID';end if;
 if p_destination='IMMEDIATE' and p_court is null and p_booking_id is not null then raise exception 'COURT_INVALID';end if;
 if p_destination<>'IMMEDIATE' and p_method is not null then raise exception 'ORDER_INVALID';end if;
 if p_destination='ACCOUNT' and (p_customer_id is null or p_booking_id is not null or p_court is not null or not exists(select 1 from public.win_customers where id=p_customer_id)) then raise exception 'CUSTOMER_INVALID';end if;
 if p_destination='COURT' or (p_destination='IMMEDIATE' and p_court is not null) then
   if p_court not in ('C1','C2','C3','C4') or ((p_destination='COURT' or p_booking_id is not null) and (p_court_date is null or p_court_start is null)) then raise exception 'COURT_INVALID';end if;
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
   if private_.id is not null then
    private_quote_=public.win_bar_private_price_(private_.configuration,product);
    if not (private_quote_->>'valid')::boolean then raise exception 'PRIVATE_PRICE_REVIEW';end if;
    quotes_=quotes_||jsonb_build_object(pid::text,private_quote_||jsonb_build_object('finalPrice',private_quote_->'price','unitDiscount',private_quote_->'discountAmount'));
    amount_sum=amount_sum+qty*(private_quote_->>'price')::numeric;
   elsif p_employee_id is null then amount_sum=amount_sum+qty*product.sale_price;
   else
    quote_=public.win_bar_employee_quote_(p_employee_id,pid,qty,nullif(p_authorizations->>pid::text,'')::uuid);
    if (quote_->>'needsAuthorization')::boolean and quote_->>'authorizationId' is null then raise exception 'EMPLOYEE_EXCEPTION_REQUIRED';end if;
    quotes_=quotes_||jsonb_build_object(pid::text,quote_);amount_sum=amount_sum+(quote_->>'total')::numeric;
   end if;
 end loop;
 if amount_sum>1000000000 then raise exception 'ORDER_INVALID';end if;
 insert into public.win_bar_orders(request_id,created_by,status,destination,customer_id,booking_id,court,court_date,court_start,court_holder,client_unknown,note,total,request_payload,employee_id,employee_name_snapshot)
 values(p_request_id,uid,case when p_destination='IMMEDIATE' then 'PAID' else 'OPEN' end,p_destination,p_customer_id,p_booking_id,p_court,p_court_date,p_court_start,holder_name,coalesce(p_client_unknown,false),coalesce(p_note,''),amount_sum,request_,p_employee_id,employee_name_)
 returning id into o_id;
 for line in select value from jsonb_array_elements(p_items) a(value) loop
  pid=(line->>'id')::uuid;qty=(line->>'quantity')::integer;
  select * into product from public.win_products where id=pid;
  quote_=quotes_->pid::text;
  exception_=nullif(quote_->>'authorizationId','')::uuid;
  if exception_ is not null then
   update public.win_bar_employee_exceptions set used_order_id=o_id where id=exception_ and used_order_id is null and expires_at>now();
   if not found then raise exception 'EMPLOYEE_EXCEPTION_INVALID';end if;
  end if;
  insert into public.win_bar_order_items(order_id,product_id,quantity,product_label,unit_price,public_unit_price,discount_unit_amount,employee_policy_snapshot,employee_exception_id)
    values(o_id,pid,qty,product.name||case when product.variant<>'' then ' · '||product.variant else '' end,
    coalesce((quote_->>'finalPrice')::numeric,product.sale_price),product.sale_price,coalesce((quote_->>'unitDiscount')::numeric,0),quote_->'policy',exception_) returning id into item_id;
  insert into public.win_bar_stock_movements(order_item_id,product_id,quantity_change,recorded_by) values(item_id,pid,-qty,uid);
 end loop;
 if p_employee_id is not null then
  insert into public.win_bar_inventory_audit(actor_id,action,reference_id,after_record)
  values(uid,'EMPLOYEE_SALE',o_id,jsonb_build_object('employeeId',p_employee_id,'total',amount_sum,'lines',quotes_));
 end if;
 if p_destination='IMMEDIATE' then
   insert into public.win_bar_cash_movements(request_id,shift_id,recorded_by,kind,payment_method,amount_signed,order_id,note)
   values(p_request_id,sh.id,uid,'SALE',p_method,amount_sum,o_id,coalesce(p_note,'')) returning id into cashid;
   insert into public.win_bar_order_payments(request_id,order_id,bar_cash_movement_id,paid_by,amount,method)
   values(p_request_id,o_id,cashid,uid,amount_sum,p_method);
 end if;
 return jsonb_build_object('id',o_id,'total',amount_sum,'status',case when p_destination='IMMEDIATE' then 'PAID' else 'OPEN' end,'replayed',false);
end;$function$;

create or replace function public.win_bar_accounts(p_token text,p jsonb default '{}') returns jsonb language plpgsql stable set search_path='' as $$
declare actor uuid;items jsonb;total_ integer;pending_ numeric;start_ date:=nullif(p->>'start','')::date;end_ date:=nullif(p->>'end','')::date;
 offset_ integer:=coalesce((p->>'offset')::integer,0);limit_ integer:=coalesce((p->>'limit')::integer,50);
 status_ text:=coalesce(p->>'status','PENDING');audience_ text:=coalesce(p->>'audience','ALL');
begin
 select account_id into actor from public.win_pin_session(p_token);
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 if offset_<0 or limit_ not between 1 and 200 or status_ not in ('ALL','PENDING','PAID') or audience_ not in ('ALL','CLIENT','EMPLOYEE','COURT') or start_>end_ then raise exception 'BAR_FILTER_INVALID';end if;
 with records as(
  select o.*,coalesce(c.name,o.employee_name_snapshot,o.court_holder,'Cliente sin identificar') person,
   case when o.employee_id is not null then 'EMPLOYEE' when o.destination='COURT' then 'COURT' else 'CLIENT' end audience,
   coalesce((select sum(amount) from public.win_bar_order_payments where order_id=o.id),0) paid
  from public.win_bar_orders o left join public.win_customers c on c.id=o.customer_id
  where not(o.destination='ACCOUNT' and exists(select 1 from public.win_bar_private_accounts a where a.customer_id=o.customer_id)) and(start_ is null or o.created_at>=start_::timestamp at time zone 'America/Argentina/Buenos_Aires')
   and(end_ is null or o.created_at<(end_+1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
 ),filtered as(
  select * from records where(status_='ALL' or(status_='PENDING' and total>paid) or(status_='PAID' and total=paid))
   and(audience_='ALL' or audience=audience_) and(nullif(p->>'court','') is null or court=p->>'court')
   and(nullif(p->>'person','') is null or person ilike '%'||(p->>'person')||'%')
 ),page as(select * from filtered order by created_at desc,id limit limit_ offset offset_)
 select coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'date',o.created_at,'status',o.status,'destination',o.destination,
   'audience',o.audience,'customerName',o.person,'employeeId',o.employee_id,'court',o.court,'courtDate',o.court_date,
   'courtStart',to_char(o.court_start,'HH24:MI'),'total',o.total,'paid',o.paid,'balance',o.total-o.paid,
   'ageDays',greatest(0,(now() at time zone 'America/Argentina/Buenos_Aires')::date-(o.created_at at time zone 'America/Argentina/Buenos_Aires')::date),
   'note',o.note,'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_label,'quantity',i.quantity,'price',i.unit_price,'amount',i.amount)) from public.win_bar_order_items i where i.order_id=o.id),'[]'),
   'payments',coalesce((select jsonb_agg(jsonb_build_object('id',py.id,'amount',py.amount,'method',py.method,'date',py.paid_at,'author',a.display_name) order by py.paid_at) from public.win_bar_order_payments py join win_auth.login_accounts a on a.id=py.paid_by where py.order_id=o.id),'[]')) order by o.created_at desc,o.id) from page o),'[]'),
  (select count(*)::integer from filtered),(select coalesce(sum(total-paid),0) from filtered) into items,total_,pending_;
 return jsonb_build_object('orders',items,'total',total_,'pending',pending_,'offset',offset_,'limit',limit_);
end;$$;


create function public.win_bar_private_statement_(cid uuid,start_ date,end_ date) returns jsonb language sql stable set search_path='' as $$
 with orders_ as(select * from public.win_bar_orders where destination='ACCOUNT' and customer_id=cid),
 events as(
 select i.id::text id,o.created_at date,o.id "orderId",'CONSUMPTION'::text kind,i.product_label product,i.quantity,i.unit_price "unitPrice",i.amount debit,0::numeric credit,null::text method
 from orders_ o join public.win_bar_order_items i on i.order_id=o.id
 union all
 select py.id::text,py.paid_at,o.id,'PAYMENT','Pago',null::integer,null::numeric,0,py.amount,py.method
 from orders_ o join public.win_bar_order_payments py on py.order_id=o.id),
 running as(select *,sum(debit-credit) over(order by date,kind,id rows unbounded preceding) balance from events),
 filtered as(select * from running where(start_ is null or date>=start_::timestamp at time zone 'America/Argentina/Buenos_Aires') and(end_ is null or date<(end_+1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by date,kind,id) from(select * from filtered order by date,kind,id limit 10000)x),'[]'),
 'truncated',(select count(*)>10000 from filtered),'totalRows',(select count(*) from filtered),
 'openingBalance',(select coalesce(sum(debit-credit),0) from events where start_ is not null and date<start_::timestamp at time zone 'America/Argentina/Buenos_Aires'),
 'closingBalance',(select coalesce(sum(debit-credit),0) from events where end_ is null or date<(end_+1)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
 'balance',(select coalesce(sum(debit-credit),0) from events),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'date',o.created_at,'total',o.total,'balance',o.total-coalesce((select sum(amount) from public.win_bar_order_payments where order_id=o.id),0)) order by o.created_at,o.id) from orders_ o),'[]'))
$$;

create function public.win_bar_private_place(p_token text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;req uuid;prior public.win_bar_inventory_requests%rowtype;a public.win_bar_private_accounts%rowtype;quote_ jsonb;result_ jsonb;old_ public.win_bar_orders%rowtype;
begin
 select account_id into actor from public.win_pin_session(p_token);
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 req=(p->>'requestId')::uuid;if req is null or p->>'destination' is distinct from 'ACCOUNT' then raise exception 'ORDER_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-order:'||req::text,0));
 select * into prior from public.win_bar_inventory_requests where request_id=req;
 if found then
  if prior.actor_id<>actor or prior.action<>'private.place' or prior.payload is distinct from(p-'action') then raise exception 'REQUEST_ID_REUSED';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 -- Recover requests completed before this release without reauthorizing or repricing their history.
 select * into old_ from public.win_bar_orders where request_id=req;
 if not found then
  select * into a from public.win_bar_private_accounts where customer_id=(p->>'customerId')::uuid for update;
  if not found or not a.active then raise exception 'PRIVATE_ACCOUNT_UNAUTHORIZED';end if;
  perform 1 from public.win_bar_cash_shifts where status='OPEN' for update;
  if not found then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
  perform 1 from public.win_products where id in(select (value->>'id')::uuid from jsonb_array_elements(p->'items')) order by id for update;
  quote_=public.win_bar_private_quote_(a.customer_id,p->'items');
  if not (quote_->>'valid')::boolean then raise exception 'PRIVATE_PRICE_REVIEW';end if;
  if p->>'quoteFingerprint' is distinct from quote_->>'fingerprint' then raise exception 'PRIVATE_QUOTE_STALE';end if;
 end if;
 result_=public.win_bar_order_place(p_token,req,p->'items',p->>'destination',(p->>'customerId')::uuid,(p->>'bookingId')::uuid,p->>'court',
  (p->>'courtDate')::date,(p->>'courtStart')::time,coalesce(p->>'note',''),p->>'method',coalesce((p->>'clientUnknown')::boolean,false));
 if old_.id is null then
  insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result) values(req,actor,'private.place',p-'action',result_);
 end if;
 return result_;
end;$$;

create function public.win_bar_private_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;role_ text;req uuid;prior public.win_bar_inventory_requests%rowtype;a public.win_bar_private_accounts%rowtype;before_ jsonb;result_ jsonb;cfg jsonb;
 cid uuid;holder_ text;type_ text;products_ jsonb;line record;quote_ jsonb;total_ numeric;amount_ numeric;left_ numeric;pay_ numeric;method_ text;child_ uuid;
 start_ date:=nullif(p->>'start','')::date;end_ date:=nullif(p->>'end','')::date;
begin
 select account_id,role into actor,role_ from public.win_pin_session(p_token);
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 if p_action='candidates' then
  if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  return jsonb_build_object('customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name) from public.win_customers c where not exists(select 1 from public.win_bar_private_accounts a where a.customer_id=c.id)),'[]'::jsonb));
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'customerId',x.customer_id,'holder',x.holder,'type',x.account_type,'active',x.active,'revision',x.revision,
   'balance',(select coalesce(sum(o.total-coalesce((select sum(amount) from public.win_bar_order_payments where order_id=o.id),0)),0) from public.win_bar_orders o where o.destination='ACCOUNT' and o.customer_id=x.customer_id)) order by x.holder,x.id),'[]')
  into result_ from public.win_bar_private_accounts x where not coalesce((p->>'activeOnly')::boolean,false) or x.active;
  return jsonb_build_object('accounts',result_,'canManage',role_='ADMIN');
 end if;
 if p_action='preview' then
  if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  cfg=public.win_bar_private_config_(p->'configuration');
  select coalesce(jsonb_agg(public.win_bar_private_price_(cfg,pr) order by pr.name,pr.variant),'[]') into products_ from public.win_products pr where pr.business_unit='CAFE_BAR' and pr.active;
  return jsonb_build_object('lines',products_);
 end if;
 if p_action='quote' then
  quote_=public.win_bar_private_quote_((p->>'customerId')::uuid,p->'items');
  select coalesce(jsonb_agg(q-'unitCost'-'grossMargin'-'marginPercent'),'[]') into products_ from jsonb_array_elements(quote_->'lines')q;
  return (quote_-'lines')||jsonb_build_object('lines',products_);
 end if;
 if p_action in('statement','configuration') then
  select * into a from public.win_bar_private_accounts where customer_id=(p->>'customerId')::uuid;
  if not found then raise exception 'PRIVATE_ACCOUNT_UNAUTHORIZED';end if;
  if p_action='configuration' then
   if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
   return jsonb_build_object('account',to_jsonb(a));
  end if;
  if start_>end_ then raise exception 'BAR_FILTER_INVALID';end if;
  return public.win_bar_private_statement_(a.customer_id,start_,end_)||jsonb_build_object('holder',a.holder,'active',a.active);
 end if;
 if p_action not in('save','pay') then raise exception 'BAR_ACTION_INVALID';end if;
 if p_action='save' and role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 req=(p->>'requestId')::uuid;if req is null then raise exception 'BAR_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-request:'||req::text,0));
 select * into prior from public.win_bar_inventory_requests where request_id=req;
 if found then
  if prior.actor_id<>actor or prior.action<>'private.'||p_action or prior.payload is distinct from p then raise exception 'REQUEST_ID_REUSED';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if p_action='save' then
  holder_=btrim(coalesce(p->>'holder',''));type_=p->>'type';cfg=public.win_bar_private_config_(p->'configuration');
  if length(holder_) not between 2 and 120 or type_ is null or type_ not in('PARTNER','EMPLOYEE','OTHER') or jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'PRIVATE_CONFIG_INVALID';end if;
  if exists(select 1 from jsonb_each(cfg->'exceptions')e where not exists(select 1 from public.win_products where id=e.key::uuid and business_unit='CAFE_BAR')) then raise exception 'PRODUCT_NOT_FOUND';end if;
  if nullif(p->>'id','') is null then
   cid=nullif(p->>'customerId','')::uuid;
   if cid is null then
    insert into public.win_customers(name,created_by) values(holder_,actor) returning id into cid;
   elsif not exists(select 1 from public.win_customers where id=cid) then raise exception 'CUSTOMER_INVALID';end if;
   if exists(select 1 from public.win_bar_private_accounts where customer_id=cid) then raise exception 'PRIVATE_ACCOUNT_EXISTS';end if;
   insert into public.win_bar_private_accounts(customer_id,holder,account_type,active,configuration,created_by,updated_by)
    values(cid,holder_,type_,(p->>'active')::boolean,cfg,actor,actor) returning * into a;
  else
   select * into a from public.win_bar_private_accounts where id=(p->>'id')::uuid for update;
   if not found or a.revision is distinct from (p->>'expectedRevision')::bigint then raise exception 'PRIVATE_CONFIG_STALE';end if;
   if nullif(p->>'customerId','')::uuid is distinct from a.customer_id then raise exception 'PRIVATE_CONFIG_INVALID';end if;
   before_=to_jsonb(a);
   update public.win_bar_private_accounts set holder=holder_,account_type=type_,active=(p->>'active')::boolean,configuration=cfg,
    revision=revision+1,updated_at=now(),updated_by=actor where id=a.id returning * into a;
  end if;
  result_=jsonb_build_object('ok',true,'id',a.id,'customerId',a.customer_id);
 else
  select * into a from public.win_bar_private_accounts where customer_id=(p->>'customerId')::uuid for update;
  if not found then raise exception 'PRIVATE_ACCOUNT_UNAUTHORIZED';end if;
  amount_=public.win_bar_money(p->'amount');method_=p->>'method';
  if amount_ is null or amount_<=0 or method_ is null or method_ not in('CASH','TRANSFER','CARD') then raise exception 'PAYMENT_INVALID';end if;
  perform 1 from public.win_bar_cash_shifts where status='OPEN' for update;
  if not found then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
  select coalesce(sum(o.total-coalesce((select sum(amount) from public.win_bar_order_payments where order_id=o.id),0)),0) into total_
   from public.win_bar_orders o where o.destination='ACCOUNT' and o.customer_id=a.customer_id;
  if amount_>total_ then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  left_=amount_;
  for line in select o.id,o.total-coalesce((select sum(amount) from public.win_bar_order_payments where order_id=o.id),0) balance
   from public.win_bar_orders o where o.destination='ACCOUNT' and o.customer_id=a.customer_id and o.status='OPEN' order by o.created_at,o.id for update loop
   pay_=least(left_,line.balance);if pay_<=0 then continue;end if;
   child_=md5('private-pay:'||req::text||':'||line.id::text)::uuid;
   perform public.win_bar_order_pay(p_token,child_,line.id,pay_,method_);
   left_=left_-pay_;exit when left_=0;
  end loop;
  if left_<>0 then raise exception 'PAYMENT_INVALID';end if;
  result_=jsonb_build_object('ok',true,'id',req,'remaining',total_-amount_);
 end if;
 insert into public.win_bar_inventory_audit(actor_id,action,reference_id,before_record,after_record)
  values(actor,'private.'||p_action,a.id,before_,case when p_action='save' then to_jsonb(a) else p end);
 insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result) values(req,actor,'private.'||p_action,p,result_);
 return result_;
end;$$;

alter function public.win_bar_inventory_api(text,text,jsonb) rename to win_bar_inventory_v190_;
create function public.win_bar_inventory_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
begin
 if p_action like 'private.%' then return public.win_bar_private_api(p_token,substring(p_action from 9),p);end if;
 return public.win_bar_inventory_v190_(p_token,p_action,p);
end;$$;

create or replace function public.win_bar_customers(p_token text) returns jsonb language plpgsql stable set search_path='' as $$
declare uid uuid;items jsonb;
begin
 select account_id into uid from public.win_pin_session(p_token);
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(uid) then raise exception 'NOT_AUTHORIZED';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',customer_id,'accountId',id,'name',holder,'type',account_type) order by holder),'[]') into items from public.win_bar_private_accounts where active;
 return jsonb_build_object('customers',items);
end;$$;
create or replace function public.win_bar_customer_create(p_token text,p_name text) returns jsonb language plpgsql set search_path='' as $$
begin raise exception 'PRIVATE_ACCOUNT_ADMIN_REQUIRED';end;$$;

alter function public.win_bar_request_status(text,uuid,text,jsonb) rename to win_bar_request_status_v190_;
create function public.win_bar_request_status(p_token text,p_request_id uuid,p_kind text,p_payload jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;saved public.win_bar_inventory_requests%rowtype;action_ text;
begin
 select account_id into actor from public.win_pin_session(p_token);
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 action_=replace(coalesce(p_payload->>'action',''),'bar.inventory.','');
 if p_kind='INVENTORY' and action_ in('private.save','private.pay') then
  if not pg_try_advisory_xact_lock(hashtextextended('bar-request:'||p_request_id::text,0)) then return jsonb_build_object('state','IN_PROGRESS');end if;
  select * into saved from public.win_bar_inventory_requests where request_id=p_request_id;
  if not found then return jsonb_build_object('state','NOT_FOUND');end if;
  if saved.actor_id<>actor then raise exception 'NOT_AUTHORIZED';end if;
  if saved.action<>action_ or(saved.payload-'action') is distinct from(p_payload-'action') then raise exception 'REQUEST_ID_REUSED';end if;
  return jsonb_build_object('state','FOUND','result',saved.result||jsonb_build_object('replayed',true));
 end if;
 if p_kind='PLACE' then
  if not pg_try_advisory_xact_lock(hashtextextended('bar-order:'||p_request_id::text,0)) then return jsonb_build_object('state','IN_PROGRESS');end if;
  select * into saved from public.win_bar_inventory_requests where request_id=p_request_id and action='private.place';
  if found then
   if saved.actor_id<>actor then raise exception 'NOT_AUTHORIZED';end if;
   if saved.payload is distinct from(p_payload-'action') then raise exception 'REQUEST_ID_REUSED';end if;
  end if;
 end if;
 return public.win_bar_request_status_v190_(p_token,p_request_id,p_kind,p_payload);
end;$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'win_bar_private%' or p.proname in('win_bar_inventory_api','win_bar_inventory_v190_','win_bar_request_status','win_bar_request_status_v190_','win_bar_customer_create','win_bar_customers')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end;$$;
notify pgrst,'reload schema';
