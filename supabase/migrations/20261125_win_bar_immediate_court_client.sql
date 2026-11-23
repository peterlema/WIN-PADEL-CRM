-- Bar: "Cobrar ahora" puede registrar de qué cancha y horario era el cliente, o marcar "No conozco cliente".
-- Sirve para saber qué clientes consumen más, aunque paguen en el momento. No cambia el cobro ni el stock:
-- la venta sigue PAID y no aparece como pendiente de cancha (los pendientes filtran destination='COURT').
-- Orden de despliegue: primero esta migración, después win-api (p_client_unknown tiene valor por defecto).

alter table public.win_bar_orders add column if not exists client_unknown boolean not null default false;
alter table public.win_bar_orders drop constraint if exists bar_destination_check;
alter table public.win_bar_orders add constraint bar_destination_check check (
  (destination='IMMEDIATE' and customer_id is null
     and ((court is null and booking_id is null)
          or (court is not null and court_date is not null and court_start is not null and not client_unknown)))
  or (destination='ACCOUNT' and customer_id is not null and booking_id is null and court is null and not client_unknown)
  or (destination='COURT' and court is not null and court_date is not null and court_start is not null and customer_id is null and not client_unknown)
);

drop function if exists public.win_bar_order_place(text,uuid,jsonb,text,uuid,uuid,text,date,time,text,text);
create or replace function public.win_bar_order_place(
 p_token text,p_request_id uuid,p_items jsonb,p_destination text,
 p_customer_id uuid,p_booking_id uuid,p_court text,p_court_date date,p_court_start time,
 p_note text,p_method text,p_client_unknown boolean default false
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
 insert into public.win_bar_orders(request_id,created_by,status,destination,customer_id,booking_id,court,court_date,court_start,court_holder,client_unknown,note,total)
 values(p_request_id,uid,case when p_destination='IMMEDIATE' then 'PAID' else 'OPEN' end,p_destination,p_customer_id,p_booking_id,p_court,p_court_date,p_court_start,holder_name,coalesce(p_client_unknown,false),coalesce(p_note,''),amount_sum)
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
revoke all on function public.win_bar_order_place(text,uuid,jsonb,text,uuid,uuid,text,date,time,text,text,boolean) from public,anon,authenticated;
grant execute on function public.win_bar_order_place(text,uuid,jsonb,text,uuid,uuid,text,date,time,text,text,boolean) to service_role;
