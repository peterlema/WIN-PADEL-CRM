-- Preparation only: no employee prices, eligible employees or approvals are seeded.
-- Activation is intentionally unavailable through the application in this release.
create table public.win_bar_employee_release (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 approved_at timestamptz,approved_by uuid references win_auth.login_accounts(id),approval_reference text,
 check(not enabled or (approved_at is not null and approved_by is not null and length(btrim(approval_reference))>=5))
);
insert into public.win_bar_employee_release(singleton,enabled) values(true,false);
create table public.win_bar_employee_prices (
 product_id uuid primary key references public.win_products(id),
 mode text not null check(mode in ('FIXED_PRICE','PERCENT')),value numeric(14,2) not null,
 revision integer not null default 1,updated_by uuid not null references win_auth.login_accounts(id),updated_at timestamptz not null default now(),
 approved_by uuid references win_auth.login_accounts(id),approved_at timestamptz,
 check((mode='FIXED_PRICE' and value>0 and value<=1000000000) or (mode='PERCENT' and value>0 and value<100)),
 check((approved_by is null)=(approved_at is null))
);
create table public.win_bar_employee_access (
 account_id uuid primary key references win_auth.login_accounts(id),
 authorized boolean not null default false,customer_id uuid unique references public.win_customers(id),
 updated_by uuid not null references win_auth.login_accounts(id),updated_at timestamptz not null default now()
);
alter table public.win_bar_orders add column employee_id uuid references win_auth.login_accounts(id);
alter table public.win_bar_orders add column employee_name_snapshot text;
alter table public.win_bar_order_items add column public_unit_price numeric(14,2) check(public_unit_price>=0);
alter table public.win_bar_order_items add column discount_unit_amount numeric(14,2) check(discount_unit_amount>=0);
alter table public.win_bar_order_items add column employee_policy_snapshot jsonb;
create table public.win_bar_employee_exceptions (
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references win_auth.login_accounts(id),
 product_id uuid not null references public.win_products(id),quantity integer not null check(quantity between 1 and 100),
 public_price numeric(14,2) not null,final_price numeric(14,2) not null,average_cost numeric,
 policy_revision integer not null,approved_by uuid not null references win_auth.login_accounts(id),
 reason text not null check(length(btrim(reason)) between 5 and 400),created_at timestamptz not null default now(),
 expires_at timestamptz not null,used_order_id uuid references public.win_bar_orders(id)
);
alter table public.win_bar_order_items add column employee_exception_id uuid unique references public.win_bar_employee_exceptions(id);
do $$declare t text;begin
 foreach t in array array['win_bar_employee_release','win_bar_employee_prices','win_bar_employee_access','win_bar_employee_exceptions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end;$$;

create function public.win_bar_employee_ready_() returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.win_bar_employee_release where enabled and approved_at is not null and approved_by is not null and approval_reference is not null) then raise exception 'EMPLOYEE_PRICING_DISABLED';end if;
end;$$;
create function public.win_bar_employee_quote_(employee uuid,product_id_ uuid,qty integer,authorization_ uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare product public.win_products;policy public.win_bar_employee_prices;price_ numeric;discount_ numeric;needs_ boolean;rule_ jsonb;
begin
 perform public.win_bar_employee_ready_();
 if not exists(select 1 from public.win_bar_employee_access e join win_auth.login_accounts a on a.id=e.account_id join public.win_staff s on s.user_id=a.id where a.id=employee and a.enabled and s.active and e.authorized) then raise exception 'EMPLOYEE_NOT_AUTHORIZED';end if;
 select * into product from public.win_products where id=product_id_ and business_unit='CAFE_BAR' and active;
 if not found or product.sale_price is null or product.sale_price<=0 or qty is null or qty not between 1 and 100 then raise exception 'ORDER_INVALID';end if;
 select * into policy from public.win_bar_employee_prices where product_id=product_id_ and approved_at is not null and approved_by is not null;
 price_=product.sale_price;rule_=jsonb_build_object('mode','PUBLIC','revision',null);
 if policy.product_id is not null then
  price_=case when policy.mode='FIXED_PRICE' then policy.value else round(product.sale_price*(100-policy.value)/100,2) end;
  if price_<=0 or price_>product.sale_price then raise exception 'EMPLOYEE_PRICE_INVALID';end if;
  rule_=jsonb_build_object('mode',policy.mode,'value',policy.value,'revision',policy.revision,'approvedBy',policy.approved_by,'approvedAt',policy.approved_at);
 end if;
 discount_=product.sale_price-price_;
 needs_=discount_>0 and (product.unit_cost is null or price_<product.unit_cost);
 if authorization_ is not null and not exists(select 1 from public.win_bar_employee_exceptions e
  where e.id=authorization_ and e.employee_id=employee and e.product_id=product_id_ and e.quantity=qty
  and e.policy_revision=policy.revision and e.public_price=product.sale_price and e.final_price=price_
  and e.average_cost is not distinct from product.unit_cost and e.used_order_id is null and e.expires_at>now()) then raise exception 'EMPLOYEE_EXCEPTION_INVALID';end if;
 return jsonb_build_object('productId',product.id,'quantity',qty,'publicPrice',product.sale_price,'finalPrice',price_,
  'unitDiscount',discount_,'total',qty*price_,'unitCost',product.unit_cost,'needsAuthorization',needs_,
  'costUnknown',product.unit_cost is null,'policy',rule_,'authorizationId',case when needs_ then authorization_ end);
end;$$;

create function public.win_bar_price_snapshot_guard() returns trigger language plpgsql set search_path='' as $$
declare employee uuid;
begin
 if tg_op='UPDATE' then
  -- Only the stock-delivery trigger may fill the previously unknown cost; prices never change.
  if (to_jsonb(new)-'unit_cost'-'amount') is distinct from (to_jsonb(old)-'unit_cost'-'amount') or (old.unit_cost is not null and new.unit_cost is distinct from old.unit_cost) then raise exception 'BAR_PRICE_IMMUTABLE';end if;
  return new;
 end if;
 select employee_id into employee from public.win_bar_orders where id=new.order_id;
 if employee is null then
  new.public_unit_price=new.unit_price;new.discount_unit_amount=0;new.employee_policy_snapshot=null;new.employee_exception_id=null;
 elsif new.public_unit_price is null or new.discount_unit_amount is null or new.public_unit_price-new.discount_unit_amount<>new.unit_price or new.employee_policy_snapshot is null then raise exception 'EMPLOYEE_SNAPSHOT_INVALID';end if;
 return new;
end;$$;
create trigger bar_price_snapshot_guard before insert or update on public.win_bar_order_items for each row execute function public.win_bar_price_snapshot_guard();
create function public.win_bar_employee_header_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.employee_id is distinct from old.employee_id or new.employee_name_snapshot is distinct from old.employee_name_snapshot or new.total is distinct from old.total then raise exception 'BAR_PRICE_IMMUTABLE';end if;return new;
end;$$;
create trigger bar_employee_header_guard before update on public.win_bar_orders for each row execute function public.win_bar_employee_header_guard();

create function public.win_bar_employee_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid;role_ text;req uuid;saved public.win_bar_inventory_requests;result_ jsonb;
 product public.win_products;policy public.win_bar_employee_prices;employee uuid;target uuid;customer uuid;
 mode_ text;value_ numeric;note_ text;before_ jsonb;line jsonb;quote_ jsonb;lines_ jsonb:='[]';total_ numeric:=0;
 d1 date;d2 date;enabled_ boolean;recipient text;
begin
 select s.account_id,s.role into actor,role_ from public.win_pin_session(p_token) s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 select enabled into enabled_ from public.win_bar_employee_release where singleton;
 if p_action='status' then return jsonb_build_object('enabled',enabled_,'pendingApproval',not enabled_);end if;
 if p_action='employees' then
  return jsonb_build_object('enabled',enabled_,'employees',case when enabled_ then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name)) from public.win_bar_employee_access e join win_auth.login_accounts a on a.id=e.account_id join public.win_staff s on s.user_id=a.id where e.authorized and a.enabled and s.active),'[]') else '[]'::jsonb end);
 end if;
 if p_action='admin.list' then
  if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  return jsonb_build_object('enabled',enabled_,'pendingApproval',not enabled_,
   'products',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'variant',b.variant,'active',b.active,'publicPrice',b.sale_price,'averageCost',b.unit_cost,'mode',r.mode,'value',r.value,'revision',r.revision,'approved',r.approved_at is not null) order by b.name,b.variant) from public.win_products b left join public.win_bar_employee_prices r on r.product_id=b.id where b.business_unit='CAFE_BAR'),'[]'),
   'employees',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'enabled',a.enabled and s.active,'authorized',coalesce(e.authorized,false)) order by a.display_name) from win_auth.login_accounts a join public.win_staff s on s.user_id=a.id left join public.win_bar_employee_access e on e.account_id=a.id),'[]'));
 end if;
 if p_action='report' then
  if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  d1=coalesce(nullif(p->>'start','')::date,public.win_config_today_());d2=coalesce(nullif(p->>'end','')::date,d1);
  if d2<d1 or d2-d1>366 then raise exception 'PERIOD_INVALID';end if;
  return jsonb_build_object('enabled',enabled_,'start',d1,'end',d2,
   'sales',coalesce((select jsonb_agg(to_jsonb(x)) from (select case when o.employee_id is null then 'PUBLIC' else 'EMPLOYEE' end audience,
     count(distinct o.id) orders,sum(i.amount) final_total,sum(i.quantity*coalesce(i.public_unit_price,i.unit_price)) public_total,
     sum(i.quantity*coalesce(i.discount_unit_amount,0)) discounts,sum(i.quantity*i.unit_cost) known_cost,
     sum(i.amount-i.quantity*i.unit_cost) filter(where i.unit_cost is not null) known_margin
    from public.win_bar_orders o join public.win_bar_order_items i on i.order_id=o.id
    where (o.created_at at time zone 'America/Argentina/Buenos_Aires')::date between d1 and d2 group by 1)x),'[]'),
   'accounts',coalesce((select jsonb_agg(to_jsonb(x)) from (select o.employee_id,coalesce(max(o.employee_name_snapshot),'Empleado') name,
     sum(o.total-coalesce((select sum(amount) from public.win_bar_order_payments where order_id=o.id),0)) balance
     from public.win_bar_orders o where o.employee_id is not null and o.destination='ACCOUNT' and o.status='OPEN' group by o.employee_id)x),'[]'));
 end if;
 if p_action in('quote','place') then
  perform public.win_bar_employee_ready_();employee=nullif(p->>'employeeId','')::uuid;
  if p_action='quote' then
   if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 30 then raise exception 'ORDER_INVALID';end if;
   for line in select * from jsonb_array_elements(p->'items') loop
    quote_=public.win_bar_employee_quote_(employee,(line->>'id')::uuid,(line->>'quantity')::integer,nullif(p->'authorizations'->>(line->>'id'),'')::uuid);
    total_=total_+(quote_->>'total')::numeric;lines_=lines_||jsonb_build_array(case when role_='ADMIN' then quote_ else quote_-'unitCost' end);
   end loop;return jsonb_build_object('employeeId',employee,'lines',lines_,'total',total_);
  end if;
  if p->>'destination' is null or p->>'destination' not in('IMMEDIATE','ACCOUNT') then raise exception 'ORDER_INVALID';end if;
  select e.customer_id,a.display_name into customer,recipient from public.win_bar_employee_access e join win_auth.login_accounts a on a.id=e.account_id join public.win_staff s on s.user_id=a.id where a.id=employee and e.authorized and a.enabled and s.active for update of e;
  if not found then raise exception 'EMPLOYEE_NOT_AUTHORIZED';end if;
  if p->>'destination'='ACCOUNT' and customer is null then
   insert into public.win_customers(name,created_by) values(recipient||' · Empleado',actor) returning id into customer;
   update public.win_bar_employee_access set customer_id=customer where account_id=employee;
  end if;
  return public.win_bar_order_place_priced_(p_token,nullif(p->>'requestId','')::uuid,p->'items',p->>'destination',case when p->>'destination'='ACCOUNT' then customer end,null,null,null,null,coalesce(p->>'note',''),nullif(p->>'method',''),false,employee,coalesce(p->'authorizations','{}'));
 end if;
 if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if p_action not in('policy.save','employee.save','exception.authorize') then raise exception 'EMPLOYEE_ACTION_INVALID';end if;
 req=nullif(p->>'requestId','')::uuid;if req is null then raise exception 'BAR_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-employee-request:'||req::text,0));
 select * into saved from public.win_bar_inventory_requests where request_id=req;
 if found then
  if saved.actor_id<>actor or saved.action<>('employee.'||p_action) or saved.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;return saved.result;
 end if;
 note_=btrim(coalesce(p->>'note',''));if length(note_)<5 or length(note_)>400 then raise exception 'EMPLOYEE_REASON_REQUIRED';end if;
 if p_action='policy.save' then
  target=(p->>'productId')::uuid;select * into product from public.win_products where id=target and business_unit='CAFE_BAR' for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
  select * into policy from public.win_bar_employee_prices where product_id=target;before_=to_jsonb(policy);
  if coalesce((p->>'revision')::integer,0)<>coalesce(policy.revision,0) then raise exception 'STALE_REVISION';end if;
  mode_=nullif(p->>'mode','');value_=nullif(p->>'value','')::numeric;
  if mode_ is null then delete from public.win_bar_employee_prices where product_id=target;
  else
   if value_ is null or value_<>round(value_,2) or not ((mode_='FIXED_PRICE' and value_>0 and value_<=1000000000) or (mode_='PERCENT' and value_>0 and value_<100)) then raise exception 'EMPLOYEE_PRICE_INVALID';end if;
   insert into public.win_bar_employee_prices(product_id,mode,value,updated_by) values(target,mode_,value_,actor)
   on conflict(product_id) do update set mode=excluded.mode,value=excluded.value,revision=win_bar_employee_prices.revision+1,updated_by=actor,updated_at=now(),approved_by=null,approved_at=null;
  end if;
  result_=jsonb_build_object('id',target,'draftOnly',true,'mode',mode_,'value',value_);
 elsif p_action='employee.save' then
  target=(p->>'employeeId')::uuid;
  if not exists(select 1 from win_auth.login_accounts a join public.win_staff s on s.user_id=a.id where a.id=target and a.enabled and s.active) then raise exception 'EMPLOYEE_NOT_AUTHORIZED';end if;
  select to_jsonb(e) into before_ from public.win_bar_employee_access e where account_id=target;
  insert into public.win_bar_employee_access(account_id,authorized,updated_by) values(target,coalesce((p->>'authorized')::boolean,false),actor)
   on conflict(account_id) do update set authorized=excluded.authorized,updated_by=actor,updated_at=now();
  result_=jsonb_build_object('id',target,'authorized',coalesce((p->>'authorized')::boolean,false),'enabled',enabled_);
 else
  perform public.win_bar_employee_ready_();
  employee=(p->>'employeeId')::uuid;target=(p->>'productId')::uuid;
  perform 1 from public.win_products where id=target for update;
  quote_=public.win_bar_employee_quote_(employee,target,(p->>'quantity')::integer);
  if not (quote_->>'needsAuthorization')::boolean then raise exception 'EMPLOYEE_EXCEPTION_INVALID';end if;
  insert into public.win_bar_employee_exceptions(employee_id,product_id,quantity,public_price,final_price,average_cost,policy_revision,approved_by,reason,expires_at)
   values(employee,target,(p->>'quantity')::integer,(quote_->>'publicPrice')::numeric,(quote_->>'finalPrice')::numeric,(quote_->>'unitCost')::numeric,(quote_->'policy'->>'revision')::integer,actor,note_,now()+interval '15 minutes') returning id into target;
  result_=jsonb_build_object('id',target,'expiresInMinutes',15);
 end if;
 insert into public.win_bar_inventory_audit(actor_id,action,reference_id,before_record,after_record) values(actor,'EMPLOYEE_'||upper(replace(p_action,'.','_')),target,before_,result_||jsonb_build_object('reason',note_));
 insert into public.win_bar_inventory_requests values(req,actor,'employee.'||p_action,p,result_,now());return result_;
end;$$;
CREATE OR REPLACE FUNCTION public.win_bar_order_place_priced_(p_token text, p_request_id uuid, p_items jsonb, p_destination text, p_customer_id uuid, p_booking_id uuid, p_court text, p_court_date date, p_court_start time without time zone, p_note text, p_method text, p_client_unknown boolean DEFAULT false, p_employee_id uuid DEFAULT null, p_authorizations jsonb DEFAULT '{}')
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid; sh public.win_bar_cash_shifts%rowtype; book public.win_court_bookings%rowtype;
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
   if p_employee_id is null then amount_sum=amount_sum+qty*product.sale_price;
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

create or replace function public.win_bar_order_place(p_token text,p_request_id uuid,p_items jsonb,p_destination text,p_customer_id uuid,p_booking_id uuid,p_court text,p_court_date date,p_court_start time,p_note text,p_method text,p_client_unknown boolean default false) returns jsonb language sql security invoker set search_path='' as $$
select public.win_bar_order_place_priced_(p_token,p_request_id,p_items,p_destination,p_customer_id,p_booking_id,p_court,p_court_date,p_court_start,p_note,p_method,p_client_unknown,null,'{}');
$$;
do $$declare r record;begin
for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'win_bar_employee_%' or proname in('win_bar_price_snapshot_guard','win_bar_order_place_priced_','win_bar_order_place')) loop
execute format('revoke all on function %s from public,anon,authenticated',r.signature);
execute format('grant execute on function %s to service_role',r.signature);
end loop;end;$$;

