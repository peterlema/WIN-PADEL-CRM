-- Stabilization after v0.17.6. Bank configuration and optional transfers stay unchanged.
alter table public.win_bar_cash_shifts add column closing_snapshot jsonb;
alter table public.win_bar_cash_movements drop constraint win_bar_cash_movements_kind_check;
alter table public.win_bar_cash_movements drop constraint win_bar_cash_movements_check;
alter table public.win_bar_cash_movements add constraint bar_movement_kind check(kind in ('SALE','PURCHASE_PAYMENT','EXPENSE','WITHDRAWAL'));
alter table public.win_bar_cash_movements add constraint bar_movement_reference check(
 (kind='SALE' and amount_signed>0 and order_id is not null and purchase_id is null) or
 (kind='PURCHASE_PAYMENT' and amount_signed<0 and purchase_id is not null and order_id is null) or
 (kind in ('EXPENSE','WITHDRAWAL') and amount_signed<0 and purchase_id is null and order_id is null));
alter table public.win_bar_orders drop constraint bar_destination_check;
alter table public.win_bar_orders add constraint bar_destination_check check(
 (destination='IMMEDIATE' and customer_id is null and ((court is null and booking_id is null) or(court is not null and not client_unknown))) or
 (destination='ACCOUNT' and customer_id is not null and booking_id is null and court is null and not client_unknown) or
 (destination='COURT' and court is not null and court_date is not null and court_start is not null and customer_id is null and not client_unknown));
create index win_bar_movements_time on public.win_bar_cash_movements(occurred_at);
create index win_bar_orders_time on public.win_bar_orders(created_at);
create function public.win_bar_shift_totals(p_shift uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('openingCash',s.opening_cash,
 'cashSales',coalesce(sum(m.amount_signed) filter(where m.kind='SALE' and m.payment_method='CASH'),0),
 'transferSales',coalesce(sum(m.amount_signed) filter(where m.kind='SALE' and m.payment_method='TRANSFER'),0),
 'cardSales',coalesce(sum(m.amount_signed) filter(where m.kind='SALE' and m.payment_method='CARD'),0),
 'supplierPayments',-coalesce(sum(m.amount_signed) filter(where m.kind='PURCHASE_PAYMENT'),0),
 'expenses',-coalesce(sum(m.amount_signed) filter(where m.kind='EXPENSE'),0),
 'withdrawals',-coalesce(sum(m.amount_signed) filter(where m.kind='WITHDRAWAL'),0),
 'cashOut',-coalesce(sum(m.amount_signed) filter(where m.amount_signed<0 and m.payment_method='CASH'),0),
 'transferOut',-coalesce(sum(m.amount_signed) filter(where m.amount_signed<0 and m.payment_method='TRANSFER'),0),
 'cardOut',-coalesce(sum(m.amount_signed) filter(where m.amount_signed<0 and m.payment_method='CARD'),0),
 'cashExpected',s.opening_cash+coalesce(sum(m.amount_signed) filter(where m.payment_method='CASH'),0),
 'cashCounted',s.counted_cash,'difference',s.counted_cash-s.opening_cash-coalesce(sum(m.amount_signed) filter(where m.payment_method='CASH'),0))
 from public.win_bar_cash_shifts s left join public.win_bar_cash_movements m on m.shift_id=s.id where s.id=p_shift group by s.id
$$;
create function public.win_bar_accounts(p_token text,p jsonb default '{}') returns jsonb language plpgsql stable set search_path='' as $$
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
  where(start_ is null or o.created_at>=start_::timestamp at time zone 'America/Argentina/Buenos_Aires')
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
create function public.win_bar_period_summary(start_ date,end_ date) returns jsonb language sql stable set search_path='' as $$
 with orders_ as(select * from public.win_bar_orders where created_at>=start_::timestamp at time zone 'America/Argentina/Buenos_Aires' and created_at<(end_+1)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
 lines_ as(select i.* from public.win_bar_order_items i join orders_ o on o.id=i.order_id),
 cash_ as(select * from public.win_bar_cash_movements where occurred_at>=start_::timestamp at time zone 'America/Argentina/Buenos_Aires' and occurred_at<(end_+1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
 select jsonb_build_object('sales',(select coalesce(sum(total),0) from orders_),'orders',(select count(*) from orders_),
  'collected',(select coalesce(sum(amount_signed) filter(where kind='SALE'),0) from cash_),
  'cash',(select coalesce(sum(amount_signed) filter(where kind='SALE' and payment_method='CASH'),0) from cash_),
  'transfer',(select coalesce(sum(amount_signed) filter(where kind='SALE' and payment_method='TRANSFER'),0) from cash_),
  'card',(select coalesce(sum(amount_signed) filter(where kind='SALE' and payment_method='CARD'),0) from cash_),
  'pending',(select coalesce(sum(o.total-coalesce((select sum(amount) from public.win_bar_order_payments where order_id=o.id),0)),0) from orders_ o),
  'purchases',(select coalesce(sum(total),0) from public.win_bar_purchases where kind='OPERATIONAL' and purchase_date between start_ and end_),
  'supplierPayments',(select -coalesce(sum(amount_signed) filter(where kind='PURCHASE_PAYMENT'),0) from cash_),
  'expenses',(select -coalesce(sum(amount_signed) filter(where kind='EXPENSE'),0) from cash_),
  'withdrawals',(select -coalesce(sum(amount_signed) filter(where kind='WITHDRAWAL'),0) from cash_),
  'cogs',(select coalesce(sum(quantity*unit_cost),0) from lines_),
  'knownCostRevenue',(select coalesce(sum(amount) filter(where unit_cost is not null),0) from lines_),
  'grossMargin',(select coalesce(sum(amount-quantity*unit_cost) filter(where unit_cost is not null),0) from lines_),
  'estimatedCostUnits',(select coalesce(sum(quantity) filter(where cost_is_provisional),0) from lines_),
  'unknownCostUnits',(select coalesce(sum(quantity) filter(where unit_cost is null),0) from lines_),
  'topProducts',coalesce((select jsonb_agg(to_jsonb(x)) from(select product_id,max(product_label) name,sum(quantity) units,sum(amount) sales from lines_ group by product_id order by sum(quantity) desc,product_id limit 8)x),'[]'))
$$;
alter function public.win_bar_inventory_api(text,text,jsonb) rename to win_bar_inventory_v176_;
create function public.win_bar_inventory_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;r text;req uuid;saved public.win_bar_inventory_requests%rowtype;result_ jsonb;before_ jsonb;
 b public.win_bar_bank_config%rowtype;sh public.win_bar_cash_shifts%rowtype;target uuid;totals jsonb;
 amount_ numeric;note_ text;method_ text;kind_ text;start_ date;end_ date;days_ integer;
begin
 select s.account_id,s.role into actor,r from public.win_pin_session(p_token)s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if p_action='access' then return public.win_bar_inventory_v176_(p_token,p_action,p);end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 if p_action='accounts' then return public.win_bar_accounts(p_token,p);end if;
 if p_action='dashboard' then
  if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  start_=coalesce(nullif(p->>'start','')::date,(now() at time zone 'America/Argentina/Buenos_Aires')::date);
  end_=coalesce(nullif(p->>'end','')::date,start_);days_=end_-start_+1;
  if days_ not between 1 and 366 then raise exception 'BAR_FILTER_INVALID';end if;
  return jsonb_build_object('start',start_,'end',end_,'previousStart',start_-days_,'previousEnd',start_-1,
   'current',public.win_bar_period_summary(start_,end_),'previous',public.win_bar_period_summary(start_-days_,start_-1),
   'products',public.win_bar_products_list(p_token)->'products');
 end if;
 if p_action='cash.state' then
  select s.* into sh from public.win_bar_cash_shifts s where status='OPEN';
  select * into b from public.win_bar_bank_config;
  return jsonb_build_object('canManage',r='ADMIN','currentUserId',actor,'shift',case when sh.id is not null then to_jsonb(sh)||(select jsonb_build_object('responsible',display_name) from win_auth.login_accounts where id=sh.opened_by) end,
   'transfersEnabled',true,'bankConfigured',public.win_bar_bank_ready_(),'canConfigureBank',r='ADMIN','bankConfig',case when b.singleton is not null then to_jsonb(b) end,'bankAccount',b.account_label,'bank',case when b.singleton is not null then to_jsonb(b) end,
   'totals',public.win_bar_shift_totals(sh.id),'cashExpected',coalesce((public.win_bar_shift_totals(sh.id)->>'cashExpected')::numeric,0),
   'shifts',coalesce((select jsonb_agg(to_jsonb(x) order by x.opened_at desc) from
    (select s.*,a.display_name responsible,public.win_bar_shift_totals(s.id) totals from public.win_bar_cash_shifts s join win_auth.login_accounts a on a.id=s.opened_by order by s.opened_at desc limit 50)x),'[]'),
   'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at desc) from
    (select m.*,a.display_name author from public.win_bar_cash_movements m join win_auth.login_accounts a on a.id=m.recorded_by where(coalesce(p->>'movementShift','OPEN')='ALL' or(coalesce(p->>'movementShift','OPEN')='OPEN' and m.shift_id=sh.id) or m.shift_id::text=p->>'movementShift') order by m.occurred_at desc limit 200)x),'[]'),
   'bankHistory',case when r='ADMIN' then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from
    (select i.created_at,i.before_record,i.after_record,a.display_name author from public.win_bar_inventory_audit i join win_auth.login_accounts a on a.id=i.actor_id where i.action='bank.save' order by i.created_at desc limit 30)x),'[]') else '[]'::jsonb end);
 end if;
 if p_action not in ('cash.close','cash.out') then return public.win_bar_inventory_v176_(p_token,p_action,p);end if;
 req=(p->>'requestId')::uuid;if req is null then raise exception 'BAR_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-request:'||req::text,0));
 select * into saved from public.win_bar_inventory_requests where request_id=req;
 if found then
  if saved.actor_id<>actor or saved.action<>p_action or saved.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;
 note_=btrim(coalesce(p->>'note',''));if length(note_)>1000 then raise exception 'BAR_DATA_INVALID';end if;
 if p_action='cash.close' then
  select * into sh from public.win_bar_cash_shifts where id=(p->>'shiftId')::uuid for update;
  if not found or sh.status<>'OPEN' then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
  if sh.opened_by<>actor and r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  before_=to_jsonb(sh);amount_=public.win_bar_money(p->'countedCash');totals=public.win_bar_shift_totals(sh.id);
  if amount_ is null or(amount_<>(totals->>'cashExpected')::numeric and length(note_)<5) then raise exception 'BAR_CLOSE_INVALID';end if;
  update public.win_bar_cash_shifts set status='CLOSED',closed_by=actor,closed_at=now(),counted_cash=amount_,note=note_,
   closing_snapshot=totals||jsonb_build_object('cashCounted',amount_,'difference',amount_-(totals->>'cashExpected')::numeric) where id=sh.id;
  target=sh.id;
 else
  select * into sh from public.win_bar_cash_shifts where id=(p->>'shiftId')::uuid for update;
  if not found or sh.status<>'OPEN' then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
  if r<>'ADMIN' and sh.opened_by<>actor then raise exception 'NOT_AUTHORIZED';end if;
  amount_=public.win_bar_money(p->'amount');kind_=p->>'kind';method_=p->>'method';
  if amount_ is null or amount_<=0 or kind_ is null or kind_ not in ('EXPENSE','WITHDRAWAL') or method_ is null or method_ not in ('CASH','TRANSFER','CARD') or length(note_)<5 then raise exception 'BAR_DATA_INVALID';end if;
  insert into public.win_bar_cash_movements(request_id,shift_id,recorded_by,kind,payment_method,amount_signed,note)
   values(req,sh.id,actor,kind_,method_,-amount_,note_) returning id into target;
 end if;
 result_=jsonb_build_object('ok',true,'id',target);
 insert into public.win_bar_inventory_audit(actor_id,action,reference_id,before_record,after_record) values(actor,p_action,target,before_,p);
 insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result) values(req,actor,p_action,p,result_);
 return result_;
end;$$;
alter function public.win_bar_request_status(text,uuid,text,jsonb) rename to win_bar_request_status_v176_;
create function public.win_bar_request_status(p_token text,p_request_id uuid,p_kind text,p_payload jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;saved public.win_bar_inventory_requests%rowtype;action_ text;
begin
 if p_kind is distinct from 'INVENTORY' then return public.win_bar_request_status_v176_(p_token,p_request_id,p_kind,p_payload);end if;
 select account_id into actor from public.win_pin_session(p_token);
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 action_=replace(coalesce(p_payload->>'action',''),'bar.inventory.','');
 if p_request_id is null or action_ not in ('stock.out','bank.save','cash.open','cash.close','cash.out','purchase.save','purchase.receive','purchase.pay') then raise exception 'ORDER_INVALID';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('bar-request:'||p_request_id::text,0)) then return jsonb_build_object('state','IN_PROGRESS');end if;
 select * into saved from public.win_bar_inventory_requests where request_id=p_request_id;
 if not found then return jsonb_build_object('state','NOT_FOUND');end if;
 if saved.actor_id<>actor then raise exception 'NOT_AUTHORIZED';end if;
 if saved.action<>action_ or(saved.payload-'action') is distinct from(p_payload-'action') then raise exception 'REQUEST_ID_REUSED';end if;
 return jsonb_build_object('state','FOUND','result',saved.result||jsonb_build_object('replayed',true));
end;$$;
do $$declare signature regprocedure;begin
 foreach signature in array array['public.win_bar_shift_totals(uuid)'::regprocedure,
 'public.win_bar_accounts(text,jsonb)'::regprocedure,'public.win_bar_period_summary(date,date)'::regprocedure,
 'public.win_bar_inventory_api(text,text,jsonb)'::regprocedure,'public.win_bar_inventory_v176_(text,text,jsonb)'::regprocedure,
 'public.win_bar_request_status(text,uuid,text,jsonb)'::regprocedure,'public.win_bar_request_status_v176_(text,uuid,text,jsonb)'::regprocedure] loop
 execute format('revoke all on function %s from public,anon,authenticated',signature);
 execute format('grant execute on function %s to service_role',signature);
 end loop;
end;$$;

CREATE OR REPLACE FUNCTION public.win_bar_order_place_priced_(p_token text, p_request_id uuid, p_items jsonb, p_destination text, p_customer_id uuid, p_booking_id uuid, p_court text, p_court_date date, p_court_start time without time zone, p_note text, p_method text, p_client_unknown boolean DEFAULT false, p_employee_id uuid DEFAULT NULL::uuid, p_authorizations jsonb DEFAULT '{}'::jsonb)
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
