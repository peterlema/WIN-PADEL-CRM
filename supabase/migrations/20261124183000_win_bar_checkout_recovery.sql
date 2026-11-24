create or replace function public.win_bar_price_snapshot_guard() returns trigger language plpgsql set search_path='' as $$
declare employee uuid; cost_ numeric;provisional_ boolean;
begin
 if tg_op='UPDATE' then
  -- The complete snapshot is immutable after insertion, including its cost origin.
  if (to_jsonb(new)-'amount') is distinct from (to_jsonb(old)-'amount') then raise exception 'BAR_PRICE_IMMUTABLE';end if;
  return new;
 end if;
 select employee_id into employee from public.win_bar_orders where id=new.order_id;
 if employee is null then
  new.public_unit_price=new.unit_price;new.discount_unit_amount=0;new.employee_policy_snapshot=null;new.employee_exception_id=null;
 elsif new.public_unit_price is null or new.discount_unit_amount is null or new.public_unit_price-new.discount_unit_amount<>new.unit_price or new.employee_policy_snapshot is null then raise exception 'EMPLOYEE_SNAPSHOT_INVALID';end if;
 -- Capture cost and its provisional flag together, before the delivery ledger is inserted.
 select unit_cost,cost_is_provisional into cost_,provisional_ from public.win_products where id=new.product_id and business_unit='CAFE_BAR';
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 new.unit_cost=cost_;new.cost_is_provisional=provisional_;
 return new;
end;$$;

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
 if p_request_id is null or p_order_id is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_method is null or p_method not in ('CASH','TRANSFER','CARD') then raise exception 'PAYMENT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-payment:'||p_request_id::text,0));
 select * into prior from public.win_bar_order_payments where request_id=p_request_id;
 if found then
  if prior.paid_by<>uid or prior.order_id<>p_order_id or prior.amount<>p_amount or prior.method<>p_method then raise exception 'REQUEST_ID_REUSED';end if;
  return jsonb_build_object('orderId',p_order_id,'remaining',(select wo.total-coalesce((select sum(wp.amount) from public.win_bar_order_payments wp where wp.order_id=wo.id),0) from public.win_bar_orders wo where wo.id=p_order_id),'replayed',true);
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

create function public.win_bar_request_status(p_token text,p_request_id uuid,p_kind text,p_payload jsonb default '{}')
returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;o public.win_bar_orders%rowtype;payment_ public.win_bar_order_payments%rowtype;expected_ jsonb;balance_ numeric;
begin
 select account_id into actor from public.win_pin_session(p_token);
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 if p_request_id is null or p_kind is null or p_kind not in ('PLACE','PAY') then raise exception 'ORDER_INVALID';end if;
 -- Share the exact mutation lock. Absence while a transaction is running is never called NOT_FOUND.
 if not pg_try_advisory_xact_lock(hashtextextended(case when p_kind='PLACE' then 'bar-order:' else 'bar-payment:' end||p_request_id::text,0)) then
  return jsonb_build_object('state','IN_PROGRESS','requestId',p_request_id);
 end if;
 if p_kind='PLACE' then
  select * into o from public.win_bar_orders where request_id=p_request_id;
  if not found then return jsonb_build_object('state','NOT_FOUND','requestId',p_request_id);end if;
  if o.created_by<>actor then raise exception 'NOT_AUTHORIZED';end if;
  expected_=jsonb_build_object('items',p_payload->'items','destination',p_payload->>'destination','customer',(p_payload->>'customerId')::uuid,
   'booking',(p_payload->>'bookingId')::uuid,'court',p_payload->>'court','day',(p_payload->>'courtDate')::date,
   'start',(p_payload->>'courtStart')::time,'note',coalesce(p_payload->>'note',''),'method',p_payload->>'method','unknown',coalesce((p_payload->>'clientUnknown')::boolean,false));
  if o.request_payload is distinct from expected_ then raise exception 'REQUEST_ID_REUSED';end if;
  if not exists(select 1 from public.win_bar_order_items where order_id=o.id) or exists(
   select 1 from public.win_bar_order_items i where i.order_id=o.id and
    (select count(*) from public.win_bar_stock_movements m where m.order_item_id=i.id and m.quantity_change=-i.quantity and m.kind='SALE')<>1) then
   return jsonb_build_object('state','INCONSISTENT','requestId',p_request_id);end if;
  if o.destination='IMMEDIATE' and not exists(
   select 1 from public.win_bar_order_payments p join public.win_bar_cash_movements m on m.id=p.bar_cash_movement_id
   where p.request_id=p_request_id and p.order_id=o.id and p.amount=o.total and m.amount_signed=o.total and m.order_id=o.id
   and p.method=m.payment_method and p.method=p_payload->>'method' and p.paid_by=actor and m.recorded_by=actor) then
   return jsonb_build_object('state','INCONSISTENT','requestId',p_request_id);end if;
  return jsonb_build_object('state','FOUND','requestId',p_request_id,'result',jsonb_build_object('id',o.id,'total',o.total,'status',o.status,'replayed',true));
 else
  select * into payment_ from public.win_bar_order_payments where request_id=p_request_id;
  if not found then return jsonb_build_object('state','NOT_FOUND','requestId',p_request_id);end if;
  if payment_.paid_by<>actor then raise exception 'NOT_AUTHORIZED';end if;
  if payment_.order_id is distinct from (p_payload->>'orderId')::uuid or payment_.amount is distinct from (p_payload->>'amount')::numeric or payment_.method is distinct from p_payload->>'method' then raise exception 'REQUEST_ID_REUSED';end if;
  if not exists(select 1 from public.win_bar_cash_movements m where m.id=payment_.bar_cash_movement_id and m.order_id=payment_.order_id and m.amount_signed=payment_.amount and m.payment_method=payment_.method and m.recorded_by=actor) then
   return jsonb_build_object('state','INCONSISTENT','requestId',p_request_id);end if;
  select wo.total-coalesce(sum(wp.amount),0) into balance_ from public.win_bar_orders wo left join public.win_bar_order_payments wp on wp.order_id=wo.id where wo.id=payment_.order_id group by wo.id;
  return jsonb_build_object('state','FOUND','requestId',p_request_id,'result',jsonb_build_object('orderId',payment_.order_id,'remaining',balance_,'replayed',true));
 end if;
end;$$;
revoke all on function public.win_bar_request_status(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.win_bar_request_status(text,uuid,text,jsonb) to service_role;
