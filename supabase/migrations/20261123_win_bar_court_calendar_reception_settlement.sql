-- Court-side Bar pending summary and reception settlement with existing cash permissions.
create or replace function public.win_bar_court_pending(p_token text,p_court text,p_day date,p_start time)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; items jsonb;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'COURTS','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 if p_court not in ('C1','C2','C3','C4') or p_day is null or p_start is null then raise exception 'COURT_INVALID';end if;
 select coalesce(jsonb_agg(q.payload order by q.created_at desc),'[]'::jsonb) into items
 from (
  select o.created_at,
    jsonb_build_object('id',o.id,'total',o.total,'balance',o.total-coalesce(sum(py.amount),0),
      'description',coalesce((select string_agg(i.quantity::text||'× '||i.product_label,', ' order by i.product_label)
                             from public.win_bar_order_items i where i.order_id=o.id),''),
      'note',o.note,'holder',o.court_holder) as payload
  from public.win_bar_orders o
  left join public.win_bar_order_payments py on py.order_id=o.id
  where o.status='OPEN' and o.destination='COURT'
    and o.court=p_court and o.court_date=p_day and o.court_start=p_start
  group by o.id
  order by o.created_at desc limit 30
 ) q;
 return jsonb_build_object('orders',items);
end;$fn$;
revoke all on function public.win_bar_court_pending(text,text,date,time) from public,anon,authenticated;
grant execute on function public.win_bar_court_pending(text,text,date,time) to service_role;

create or replace function public.win_bar_order_pay(p_token text,p_request_id uuid,p_order_id uuid,p_amount numeric,p_method text)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare uid uuid; sh public.win_cash_shifts%rowtype; o public.win_bar_orders%rowtype; prior public.win_bar_order_payments%rowtype; paid_total numeric; cmid uuid; can_sell boolean; can_reception boolean;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 can_sell=public.win_can_access(uid,'BAR','SALE');
 can_reception=public.win_can_access(uid,'CASH','CREATE') and public.win_can_access(uid,'COURTS','VIEW');
 if not can_sell and not can_reception then raise exception 'NOT_AUTHORIZED';end if;
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
 if not can_sell and (not can_reception or o.destination<>'COURT') then raise exception 'NOT_AUTHORIZED';end if;
 select coalesce(sum(amount),0) into paid_total from public.win_bar_order_payments where order_id=o.id;
 if p_amount>o.total-paid_total then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
 insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,reference_type,reference_id,note)
 values(p_request_id,sh.id,uid,'SALE','CAFE_BAR',p_method,p_amount,'BAR_ORDER',o.id::text,'Cobro pendiente Bar') returning id into cmid;
 insert into public.win_bar_order_payments(request_id,order_id,cash_movement_id,paid_by,amount,method)
 values(p_request_id,o.id,cmid,uid,p_amount,p_method);
 if paid_total+p_amount=o.total then update public.win_bar_orders set status='PAID' where id=o.id;end if;
 return jsonb_build_object('orderId',o.id,'remaining',o.total-paid_total-p_amount,'replayed',false);
end;$fn$;
revoke all on function public.win_bar_order_pay(text,uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.win_bar_order_pay(text,uuid,uuid,numeric,text) to service_role;
