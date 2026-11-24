-- New purchase flow: canonical amounts, invoice-preserving allocation and explicit receipt/payment.
alter table public.win_bar_purchase_lines add column cost_estimated boolean not null default false;
alter table public.win_bar_purchase_lines add column cost_origin text not null default 'DECLARED';
alter table public.win_bar_purchases add column cost_allocation jsonb not null default '{}';
alter table public.win_products add column estimated_receipt_cost boolean not null default false;

create function public.win_bar_money(value jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare s text;n numeric;
begin
 if value is null or value='null'::jsonb or value='""'::jsonb then return null;end if;
 if jsonb_typeof(value)='number' then n=(value#>>'{}')::numeric;
 elsif jsonb_typeof(value)='string' then
  s=regexp_replace(value#>>'{}','[[:space:]]','','g');s=replace(s,'$','');
  if s !~ '^[0-9]+(,[0-9]{1,2})?$' and s !~ '^[0-9]{1,3}([.][0-9]{3})+(,[0-9]{1,2})?$' then raise exception 'BAR_MONEY_FORMAT';end if;
  n=replace(replace(s,'.',''),',','.')::numeric;
 else raise exception 'BAR_MONEY_FORMAT';end if;
 if n<0 or n>1000000000 or n<>round(n,2) then raise exception 'BAR_MONEY_RANGE';end if;
 return n;
end;$$;

create function public.win_bar_purchase_quote(p_token text,p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare actor uuid;r text;item jsonb;pr public.win_products%rowtype;pid uuid;qty numeric;cost numeric;mode_ text;
 rows_ jsonb:='[]';lines_ jsonb;invoice numeric;known_ numeric:=0;unknown_ integer:=0;allweight numeric:=0;
 base_ numeric;weight_ numeric;target_ numeric;scale_all boolean;estimated_ boolean;res jsonb;i integer:=0;
begin
 select s.account_id,s.role into actor,r from public.win_pin_session(p_token)s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 50 then raise exception 'BAR_PURCHASE_INVALID';end if;
 invoice=public.win_bar_money(p->'totalCost');
 for item in select value from jsonb_array_elements(p->'lines') loop
  i=i+1;pid=(item->>'productId')::uuid;qty=(item->>'quantity')::numeric;mode_=coalesce(item->>'costMode','TOTAL');
  select * into pr from public.win_products where id=pid and active and business_unit='CAFE_BAR';
  if pr.id is null then raise exception 'PRODUCT_NOT_FOUND';end if;
  if qty is null or qty<1 or qty>1000000 or qty<>trunc(qty) or mode_ not in ('UNIT','TOTAL','REFERENCE')
   or (select count(*) from jsonb_array_elements(p->'lines') x where x->>'productId'=pid::text)<>1 then raise exception 'BAR_PURCHASE_INVALID';end if;
  cost=public.win_bar_money(case when item ? 'cost' then item->'cost' else item->'totalCost' end);
  base_=case when mode_='REFERENCE' or cost is null then null when mode_='UNIT' then round(qty*cost,2) else cost end;
  weight_=coalesce(nullif(qty*coalesce(pr.provisional_initial_cost,pr.unit_cost),0),qty);
  if base_ is null then unknown_=unknown_+1;else known_=known_+base_;end if;
  allweight=allweight+coalesce(base_,weight_);
  rows_=rows_||jsonb_build_array(jsonb_build_object('productId',pid,'quantity',qty,'label',pr.name||case when pr.variant<>'' then ' · '||pr.variant else '' end,
   'base',base_,'weight',weight_,'reference',qty*coalesce(pr.provisional_initial_cost,pr.unit_cost),'estimated',coalesce((item->>'estimated')::boolean,false)));
 end loop;
 if invoice is null then
  if exists(select 1 from jsonb_array_elements(rows_) x where x->>'base' is null and x->>'reference' is null) then raise exception 'BAR_COST_INPUT_REQUIRED';end if;
  select round(sum(coalesce((x->>'base')::numeric,(x->>'reference')::numeric)),2) into invoice from jsonb_array_elements(rows_)x;
 end if;
 if invoice<0 or invoice>1000000000 then raise exception 'BAR_MONEY_RANGE';end if;
 scale_all=known_>invoice or (unknown_=0 and known_<>invoice);
 target_=case when scale_all then invoice else invoice-known_ end;
 -- Largest remainders in cents. The final allocations always sum to the exact invoice.
 with raw as(
  select x,ord,case when scale_all then
   case when allweight>0 then invoice*100*coalesce((x->>'base')::numeric,(x->>'weight')::numeric)/allweight else invoice*100/jsonb_array_length(rows_) end
   when x->>'base' is not null then (x->>'base')::numeric*100
   else target_*100*(x->>'weight')::numeric/(select sum((y->>'weight')::numeric) from jsonb_array_elements(rows_)y where y->>'base' is null) end cents
  from jsonb_array_elements(rows_) with ordinality a(x,ord)
 ), ranked as(
  select *,floor(cents) whole,row_number() over(order by cents-floor(cents) desc,ord) rank_,
  round(invoice*100)-(sum(floor(cents)) over()) remainder from raw
 ), allocated as(select *, (whole+case when rank_<=remainder then 1 else 0 end)/100 amount from ranked)
 select jsonb_agg(jsonb_build_object('productId',x->'productId','label',x->'label','quantity',x->'quantity','totalCost',amount,
 'unitCost',round(amount/(x->>'quantity')::numeric,8),
 'estimated',(x->>'estimated')::boolean or (jsonb_array_length(rows_)>1 and x->>'base' is null) or scale_all or (p->>'totalCost' is null and x->>'base' is null),
 'origin',case when scale_all then 'Ajuste automático al total de factura' when x->>'base' is null and jsonb_array_length(rows_)>1 and x->>'reference' is null then 'Reparto estimado por cantidades (sin referencia)' when x->>'base' is null and jsonb_array_length(rows_)>1 then 'Reparto estimado por costos de referencia'
 when x->>'base' is null and p->>'totalCost' is not null then 'Total de factura' when x->>'base' is null then 'Costo de referencia estimado' else 'Costo informado' end,
 'adjustment',case when x->>'base' is not null then amount-(x->>'base')::numeric else 0 end) order by ord) into lines_ from allocated;
 res=jsonb_build_object('total',invoice,'lines',lines_,'estimated',exists(select 1 from jsonb_array_elements(lines_)x where (x->>'estimated')::boolean),
 'differenceInformational',true);
 return res||jsonb_build_object('quoteHash',md5(res::text));
end;$$;

create function public.win_bar_purchase_api(p_token text,p_action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;r text;req uuid;old_ public.win_bar_inventory_requests%rowtype;quote_ jsonb;result_ jsonb;pid uuid;
 lines_ jsonb;item jsonb;state_ text;payment_ text;child uuid;note_ text;
begin
 select s.account_id,s.role into actor,r from public.win_pin_session(p_token)s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if p_action='purchase.preview' then return public.win_bar_purchase_quote(p_token,p);end if;
 if p_action<>'purchase.save' then raise exception 'BAR_ACTION_INVALID';end if;
 req=(p->>'requestId')::uuid;if req is null then raise exception 'BAR_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-request:'||req::text,0));
 select * into old_ from public.win_bar_inventory_requests where request_id=req;
 if found then
  if old_.actor_id<>actor or old_.action<>p_action or old_.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;
  return old_.result||jsonb_build_object('replayed',true);
 end if;
 perform 1 from public.win_products where id in(select (value->>'productId')::uuid from jsonb_array_elements(p->'lines')) order by id for update;
 quote_=public.win_bar_purchase_quote(p_token,p);
 if p ? 'quoteHash' and p->>'quoteHash' is distinct from quote_->>'quoteHash' then raise exception 'BAR_QUOTE_STALE';end if;
 state_=coalesce(p->>'state','ORDERED');payment_=coalesce(p->>'payment','UNPAID');note_=coalesce(p->>'note','');
 if state_ not in ('ORDERED','RECEIVED') or payment_ not in ('PAID','UNPAID') then raise exception 'BAR_PURCHASE_INVALID';end if;
 if payment_='PAID' and coalesce((p->>'confirmPayment')::boolean,false) is not true then raise exception 'BAR_PAYMENT_CONFIRM_REQUIRED';end if;
 child=md5(req::text||':create')::uuid;
 result_=public.win_bar_inventory_api(p_token,'purchase.create',jsonb_build_object('requestId',child,'supplier',p->>'supplier','purchaseDate',p->>'purchaseDate','note',note_,'lines',quote_->'lines'));
 pid=(result_->>'id')::uuid;
 update public.win_bar_purchases set cost_allocation=quote_ where id=pid;
 for item in select value from jsonb_array_elements(quote_->'lines') loop
  update public.win_bar_purchase_lines set cost_estimated=(item->>'estimated')::boolean,cost_origin=item->>'origin'
   where purchase_id=pid and product_id=(item->>'productId')::uuid;
 end loop;
 if state_='RECEIVED' then
  select jsonb_agg(jsonb_build_object('lineId',id,'quantity',quantity) order by id) into lines_ from public.win_bar_purchase_lines where purchase_id=pid;
  perform public.win_bar_inventory_api(p_token,'purchase.receive',jsonb_build_object('requestId',md5(req::text||':receive')::uuid,'purchaseId',pid,'note',note_,'lines',lines_));
 end if;
 if payment_='PAID' then
  perform public.win_bar_inventory_api(p_token,'purchase.pay',jsonb_build_object('requestId',md5(req::text||':pay')::uuid,'purchaseId',pid,'note',note_,'amount',quote_->'total','method',p->>'method'));
 end if;
 result_=jsonb_build_object('ok',true,'id',pid,'quote',quote_,'state',state_,'payment',payment_);
 insert into public.win_bar_inventory_audit(actor_id,action,reference_id,after_record) values(actor,p_action,pid,p||jsonb_build_object('quote',quote_));
 insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result) values(req,actor,p_action,p,result_);
 return result_;
end;$$;
revoke all on function public.win_bar_money(jsonb),public.win_bar_purchase_quote(text,jsonb),public.win_bar_purchase_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.win_bar_money(jsonb),public.win_bar_purchase_quote(text,jsonb),public.win_bar_purchase_api(text,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.win_bar_inventory_api(p_token text, p_action text, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor uuid;r text;req uuid;saved public.win_bar_inventory_requests%rowtype;result_ jsonb;
 target uuid;product public.win_products%rowtype;pur public.win_bar_purchases%rowtype;line public.win_bar_purchase_lines%rowtype;
 sh public.win_bar_cash_shifts%rowtype;item jsonb;pid uuid;qty integer;cost numeric;total_ numeric;paid numeric;balance numeric;note_ text;method_ text;bank text;
begin
 select s.account_id,s.role into actor,r from public.win_pin_session(p_token) s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if p_action in ('purchase.preview','purchase.save') then return public.win_bar_purchase_api(p_token,p_action,p);end if;
 if p_action like 'cost.%' then return public.win_bar_cost_api(p_token,p_action,p);end if;
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
     'estimatedCostUnits',coalesce(sum(quantity) filter(where cost_is_provisional),0),
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
    insert into public.win_bar_stock_movements(product_id,quantity_change,recorded_by,kind,source_key,note,unit_cost,cost_is_provisional)
     values(line.product_id,qty,actor,'RECEIPT','receipt:'||req||':'||line.id,note_,line.total_cost/line.quantity,line.cost_estimated);
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
end;$function$;

CREATE OR REPLACE FUNCTION public.win_bar_stock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  new.cost_is_provisional=p.cost_is_provisional;
  if new.order_item_id is not null then update public.win_bar_order_items set unit_cost=p.unit_cost,cost_is_provisional=p.cost_is_provisional where id=new.order_item_id;end if;
 else
  if new.kind='RECEIPT' and new.unit_cost is null then raise exception 'BAR_RECEIPT_COST_REQUIRED';end if;
  update public.win_products set unit_cost=case
   when qty=0 then new.unit_cost
   when unit_cost is null or new.unit_cost is null then null
   else (qty*unit_cost+new.quantity_change*new.unit_cost)/(qty+new.quantity_change) end,
   automatic_unit_cost=case when qty=0 then new.unit_cost
    when p.automatic_unit_cost is null or new.unit_cost is null then null
    else (qty*p.automatic_unit_cost+new.quantity_change*new.unit_cost)/(qty+new.quantity_change) end,
   initial_cost_fraction=case when qty=0 then 0 else p.initial_cost_fraction*qty/(qty+new.quantity_change) end,
   estimated_receipt_cost=(qty>0 and p.estimated_receipt_cost) or new.cost_is_provisional,
   cost_is_provisional=(qty>0 and p.cost_is_provisional) or new.cost_is_provisional,
   cost_version=cost_version+1,stock_configured=true,updated_by=new.recorded_by,updated_at=now() where id=p.id;
 end if;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION public.win_bar_initial_cost_set(p_actor uuid, p_product uuid, p_cost numeric, p_note text, p_version bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare old_ public.win_products%rowtype;new_ public.win_products%rowtype;
begin
 if not exists(select 1 from win_auth.login_accounts where id=p_actor and role='ADMIN' and enabled) then raise exception 'NOT_AUTHORIZED';end if;
 if p_cost is null or p_cost<0 or p_cost>1000000000 or p_cost<>round(p_cost,2) or length(btrim(coalesce(p_note,''))) not between 5 and 1000 then raise exception 'BAR_COST_INVALID';end if;
 select * into old_ from public.win_products where id=p_product and business_unit='CAFE_BAR' for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 if p_version is distinct from old_.cost_version then raise exception 'BAR_COST_STALE';end if;
 -- A manual initial cost cannot replace a stock already made entirely from subsequent receipts.
 if old_.initial_basis_cost is null and exists(select 1 from public.win_bar_stock_movements where product_id=p_product and kind='RECEIPT') then raise exception 'BAR_COST_RECEIVED';end if;
 update public.win_products set
 unit_cost=case when old_.initial_basis_cost is null then p_cost
  when old_.initial_cost_fraction=0 then old_.unit_cost
  else old_.unit_cost+old_.initial_cost_fraction*(p_cost-old_.initial_basis_cost) end,
 initial_cost_fraction=case when old_.initial_basis_cost is null then 1 else old_.initial_cost_fraction end,
 initial_basis_cost=p_cost,provisional_initial_cost=p_cost,
 cost_is_provisional=case when old_.initial_basis_cost is null then true else old_.initial_cost_fraction>0 or old_.estimated_receipt_cost end,
 updated_by=p_actor,updated_at=now(),cost_version=cost_version+1
 where id=p_product returning * into new_;
 insert into public.win_bar_inventory_audit(actor_id,action,reference_id,before_record,after_record)
 values(p_actor,'cost.set',p_product,to_jsonb(old_),to_jsonb(new_)||jsonb_build_object('reason',btrim(p_note),'origin','Costo provisional manual'));
end;$function$;

CREATE OR REPLACE FUNCTION public.win_bar_cost_api(p_token text, p_action text, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor uuid;r text;req uuid;saved public.win_bar_inventory_requests%rowtype;result_ jsonb;
 pur public.win_bar_purchases%rowtype;old_ public.win_products%rowtype;new_ public.win_products%rowtype;
 item jsonb;g jsonb;pid uuid;qty numeric;amount_ numeric;total_ numeric:=0;units_ numeric:=0;
 exact_ numeric;note_ text;group_ text;rec uuid;line record;
begin
 select s.account_id,s.role into actor,r from public.win_pin_session(p_token)s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if p_action='cost.snapshot' then
 return jsonb_build_object(
 'history',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actorName',u.display_name) order by a.created_at desc)
 from public.win_bar_inventory_audit a join win_auth.login_accounts u on u.id=a.actor_id where a.action in ('cost.set','cost.reconcile')),'[]'),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('purchaseId',q.id,'group',cg->>'group','originalTotal',cg->'total',
 'units',(select sum(l.quantity) from public.win_bar_purchase_lines l where l.purchase_id=q.id and l.cost_group=cg->>'group'),
 'status',case when exists(select 1 from public.win_bar_cost_reconciliations c where c.purchase_id=q.id and c.group_name=cg->>'group'
 and not exists(select 1 from public.win_bar_inventory_audit a join public.win_products pr on pr.id=a.reference_id
 join public.win_bar_purchase_lines l on (l.product_id=pr.id or (l.product_id is null and l.label like pr.name||' ·%'))
 where l.purchase_id=q.id and l.cost_group=cg->>'group' and a.action='cost.set' and a.created_at>c.created_at)) then 'RECONCILED' else 'PENDING' end,
 'referenceTotal',(select case when count(*)=count(z.reference_cost) then sum(z.quantity*z.reference_cost) end from (
 select l.quantity,case when l.product_id is not null then pr.provisional_initial_cost else
 (select case when count(distinct x.provisional_initial_cost)=1 and count(*)=count(x.provisional_initial_cost) then min(x.provisional_initial_cost) end from public.win_products x
 where l.label like x.name||' ·%' and x.business_unit='CAFE_BAR') end reference_cost
 from public.win_bar_purchase_lines l left join public.win_products pr on pr.id=l.product_id where l.purchase_id=q.id and l.cost_group=cg->>'group') z),
 'lines',(select jsonb_agg(to_jsonb(l)) from public.win_bar_purchase_lines l where l.purchase_id=q.id and l.cost_group=cg->>'group')))
 from public.win_bar_purchases q cross join lateral jsonb_array_elements(q.cost_groups) cg where q.kind='HISTORICAL'),'[]'));
 end if;
 req=(p->>'requestId')::uuid;
 if req is null then raise exception 'BAR_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-request:'||req::text,0));
 select * into saved from public.win_bar_inventory_requests where request_id=req;
 if found then
  if saved.actor_id<>actor or saved.action<>p_action or saved.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;
 note_=btrim(coalesce(p->>'note',''));
 if p_action='cost.set' then
  pid=(p->>'productId')::uuid;
  perform public.win_bar_initial_cost_set(actor,pid,(p->>'cost')::numeric,note_,(p->>'version')::bigint);
  result_=jsonb_build_object('ok',true,'id',pid);
 elsif p_action='cost.reconcile' then
  if length(note_) not between 5 and 1000 or jsonb_typeof(p->'lines') is distinct from 'array'
   or jsonb_array_length(p->'lines') not between 1 and 50 then raise exception 'BAR_COST_INVALID';end if;
  select * into pur from public.win_bar_purchases where id=(p->>'purchaseId')::uuid and kind='HISTORICAL' for update;
  group_=p->>'group';
  select value into g from jsonb_array_elements(pur.cost_groups) where value->>'group'=group_;
  if pur.id is null or g is null then raise exception 'BAR_COST_INVALID';end if;
  perform 1 from public.win_products where id in(select (value->>'productId')::uuid from jsonb_array_elements(p->'lines')) order by id for update;
  for item in select value from jsonb_array_elements(p->'lines') loop
   pid=(item->>'productId')::uuid;qty=(item->>'quantity')::numeric;amount_=(item->>'totalCost')::numeric;
   select * into old_ from public.win_products where id=pid and business_unit='CAFE_BAR';
   if old_.id is null or qty is null or qty<=0 or qty<>trunc(qty) or amount_ is null or amount_<0 or amount_>1000000000 or amount_<>round(amount_,2)
    or old_.initial_basis_cost is null or old_.cost_version is distinct from (item->>'version')::bigint
    or (select count(*) from jsonb_array_elements(p->'lines') x where x->>'productId'=pid::text)<>1 then raise exception 'BAR_COST_INVALID';end if;
   if not exists(select 1 from public.win_bar_purchase_lines l where l.purchase_id=pur.id and l.cost_group=group_
     and (l.product_id=pid or (l.product_id is null and l.label like old_.name||' ·%'))) then raise exception 'BAR_COST_ALLOCATION_INVALID';end if;
   total_=total_+amount_;units_=units_+qty;
  end loop;
  if total_<>(g->>'total')::numeric then raise exception 'BAR_COST_TOTAL_MISMATCH';end if;
  -- Validate each original line, including still-unknown flavor/variety distributions.
  for line in select * from public.win_bar_purchase_lines where purchase_id=pur.id and cost_group=group_ loop
   select coalesce(sum((x->>'quantity')::numeric),0) into qty from jsonb_array_elements(p->'lines') x join public.win_products pr on pr.id=(x->>'productId')::uuid
    where pr.id=line.product_id or (line.product_id is null and line.label like pr.name||' ·%');
   if qty<>line.quantity then raise exception 'BAR_COST_ALLOCATION_INVALID';end if;
  end loop;
  insert into public.win_bar_cost_reconciliations(purchase_id,group_name,allocations,evidence,actor_id)
   values(pur.id,group_,p->'lines',note_,actor) returning id into rec;
  for item in select value from jsonb_array_elements(p->'lines') loop
   pid=(item->>'productId')::uuid;exact_=(item->>'totalCost')::numeric/(item->>'quantity')::numeric;
   select * into old_ from public.win_products where id=pid for update;
   update public.win_products set
    unit_cost=case when initial_cost_fraction=0 then unit_cost else unit_cost+initial_cost_fraction*(exact_-initial_basis_cost) end,
    automatic_unit_cost=case when initial_cost_fraction=0 then automatic_unit_cost else unit_cost+initial_cost_fraction*(exact_-initial_basis_cost) end,
    initial_basis_cost=exact_,cost_is_provisional=estimated_receipt_cost,cost_version=cost_version+1,updated_by=actor,updated_at=now()
   where id=pid returning * into new_;
   insert into public.win_bar_inventory_audit(actor_id,action,reference_id,before_record,after_record)
   values(actor,p_action,pid,to_jsonb(old_),to_jsonb(new_)||jsonb_build_object('evidence',note_,'reconciliationId',rec,'purchaseId',pur.id,'group',group_));
  end loop;
  result_=jsonb_build_object('ok',true,'id',rec);
 else raise exception 'BAR_ACTION_INVALID';end if;
 insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result) values(req,actor,p_action,p,result_);
 return result_;
end;$function$;
