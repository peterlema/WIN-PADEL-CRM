-- Exclusive Bar bank destination. No account or financial data are seeded.
alter table public.win_bar_bank_config add column bank_name text;
alter table public.win_bar_bank_config add column account_holder text;
alter table public.win_bar_bank_config add column bank_alias text;
alter table public.win_bar_bank_config add column cbu_cvu text;
alter table public.win_bar_bank_config add column confirmed_at timestamptz;
alter table public.win_bar_bank_config add column confirmed_by uuid references win_auth.login_accounts(id);
alter table public.win_bar_cash_movements add column bank_destination_snapshot jsonb;

create function public.win_bar_bank_ready_() returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.win_bar_bank_config where confirmed_at is not null and confirmed_by is not null
 and length(btrim(bank_name))>=2 and length(btrim(account_holder))>=2
 and (length(btrim(bank_alias))>=3 or cbu_cvu ~ '^[0-9]{22}$'));
$$;

create function public.win_bar_bank_save(p_token text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;r text;req uuid;prior public.win_bar_inventory_requests%rowtype;
 old_ public.win_bar_bank_config%rowtype;new_ public.win_bar_bank_config%rowtype;
 bank_ text;holder_ text;alias_ text;cbu_ text;reason_ text;result_ jsonb;
begin
 select s.account_id,s.role into actor,r from public.win_pin_session(p_token)s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 req=(p->>'requestId')::uuid;if req is null then raise exception 'BAR_REQUEST_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-request:'||req::text,0));
 select * into prior from public.win_bar_inventory_requests where request_id=req;
 if found then
  if prior.actor_id<>actor or prior.action<>'bank.save' or prior.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 bank_=btrim(coalesce(p->>'bankName',''));holder_=btrim(coalesce(p->>'accountHolder',''));
 alias_=nullif(lower(btrim(coalesce(p->>'alias',''))),'');
 cbu_=nullif(regexp_replace(coalesce(p->>'cbuCvu',''),'[[:space:]]','','g'),'');reason_=btrim(coalesce(p->>'note',''));
 if length(bank_) not between 2 and 100 or length(holder_) not between 2 and 120
 or (alias_ is null and cbu_ is null) or (alias_ is not null and alias_ !~ '^[a-z0-9._-]{3,40}$')
 or (cbu_ is not null and cbu_ !~ '^[0-9]{22}$') or length(reason_) not between 5 and 1000 then raise exception 'BAR_BANK_DATA_INVALID';end if;
 if coalesce((p->>'confirmExclusive')::boolean,false) is not true then raise exception 'BAR_BANK_CONFIRM_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('bar-bank-config',0));
 select * into old_ from public.win_bar_bank_config for update;
 if old_.updated_at is distinct from nullif(p->>'expectedUpdatedAt','')::timestamptz then raise exception 'BAR_BANK_STALE';end if;
 insert into public.win_bar_bank_config(account_label,bank_name,account_holder,bank_alias,cbu_cvu,confirmed_at,confirmed_by,updated_by)
 values(bank_||' · '||coalesce(alias_,cbu_),bank_,holder_,alias_,cbu_,now(),actor,actor)
 on conflict(singleton) do update set account_label=excluded.account_label,bank_name=excluded.bank_name,account_holder=excluded.account_holder,
 bank_alias=excluded.bank_alias,cbu_cvu=excluded.cbu_cvu,confirmed_at=now(),confirmed_by=actor,updated_by=actor,updated_at=now()
 returning * into new_;
 insert into public.win_bar_inventory_audit(actor_id,action,before_record,after_record)
 values(actor,'bank.save',case when old_.singleton is not null then to_jsonb(old_) end,to_jsonb(new_)||jsonb_build_object('reason',reason_));
 result_=jsonb_build_object('ok',true,'bankConfigured',true,'bankConfig',to_jsonb(new_));
 insert into public.win_bar_inventory_requests(request_id,actor_id,action,payload,result) values(req,actor,'bank.save',p,result_);
 return result_;
end;$$;

create or replace function public.win_bar_cash_guard() returns trigger language plpgsql set search_path='' as $$
declare sh public.win_bar_cash_shifts%rowtype;b public.win_bar_bank_config%rowtype;
begin
 select * into sh from public.win_bar_cash_shifts where id=new.shift_id for update;
 if not found or sh.status<>'OPEN' then raise exception 'BAR_SHIFT_NOT_OPEN';end if;
 if not public.win_bar_allowed(new.recorded_by) then raise exception 'NOT_AUTHORIZED';end if;
 if new.payment_method='TRANSFER' then
  select * into b from public.win_bar_bank_config for share;
  if not public.win_bar_bank_ready_() then raise exception 'BAR_BANK_REQUIRED';end if;
  new.bank_account_snapshot=b.account_label;
  new.bank_destination_snapshot=jsonb_build_object('bankName',b.bank_name,'accountHolder',b.account_holder,'alias',b.bank_alias,
   'cbuCvu',b.cbu_cvu,'confirmedAt',b.confirmed_at,'confirmedBy',b.confirmed_by);
 else
  new.bank_account_snapshot=null;new.bank_destination_snapshot=null;
 end if;
 return new;
end;$$;
create function public.win_bar_shift_totals_(p_shift uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'transfersReceived',coalesce(sum(amount_signed) filter(where payment_method='TRANSFER' and amount_signed>0),0),
 'transfersPaid',coalesce(-sum(amount_signed) filter(where payment_method='TRANSFER' and amount_signed<0),0),
 'transfersNet',coalesce(sum(amount_signed) filter(where payment_method='TRANSFER'),0),
 'cardsReceived',coalesce(sum(amount_signed) filter(where payment_method='CARD' and amount_signed>0),0),
 'cashNet',coalesce(sum(amount_signed) filter(where payment_method='CASH'),0))
 from public.win_bar_cash_movements where shift_id=p_shift;
$$;
revoke all on function public.win_bar_bank_ready_(),public.win_bar_bank_save(text,jsonb),public.win_bar_shift_totals_(uuid) from public,anon,authenticated;
grant execute on function public.win_bar_bank_ready_(),public.win_bar_bank_save(text,jsonb),public.win_bar_shift_totals_(uuid) to service_role;

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
 if p_action='bank.save' then return public.win_bar_bank_save(p_token,p);end if;
 if p_action in ('purchase.preview','purchase.save') then return public.win_bar_purchase_api(p_token,p_action,p);end if;
 if p_action like 'cost.%' then return public.win_bar_cost_api(p_token,p_action,p);end if;
 if p_action='access' then return jsonb_build_object('allowed',public.win_bar_allowed(actor));end if;
 if not public.win_bar_allowed(actor) then raise exception 'NOT_AUTHORIZED';end if;
 if p_action='cash.state' then
  select * into sh from public.win_bar_cash_shifts where status='OPEN';
  return jsonb_build_object('shift',case when sh.id is not null then to_jsonb(sh) end,
   'cashExpected',coalesce(sh.opening_cash,0)+coalesce((select sum(amount_signed) from public.win_bar_cash_movements where shift_id=sh.id and payment_method='CASH'),0),
   'bankConfigured',public.win_bar_bank_ready_(),'canConfigureBank',r='ADMIN',
   'bankConfig',(select to_jsonb(c) from public.win_bar_bank_config c),
   'bankHistory',case when r='ADMIN' then coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actorName',u.display_name) order by a.created_at desc) from public.win_bar_inventory_audit a join win_auth.login_accounts u on u.id=a.actor_id where a.action='bank.save'),'[]') end,
   'totals',public.win_bar_shift_totals_(sh.id),'bankAccount',(select account_label from public.win_bar_bank_config),
   'shifts',coalesce((select jsonb_agg(to_jsonb(t) order by t.opened_at desc) from (select b.*,a.display_name responsible,public.win_bar_shift_totals_(b.id) totals from public.win_bar_cash_shifts b join win_auth.login_accounts a on a.id=b.opened_by order by b.opened_at desc limit 50) t),'[]'),
   'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at desc) from
    (select m.*,a.display_name responsible from public.win_bar_cash_movements m join win_auth.login_accounts a on a.id=m.recorded_by order by m.occurred_at desc limit 100) x),'[]'));
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
