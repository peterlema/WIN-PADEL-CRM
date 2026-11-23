create or replace function public.win_ops_context(p_token text,p_date date) returns jsonb language plpgsql stable set search_path='' as $$
declare a uuid;
begin
 a=public.win_ops_actor(p_token);
 return jsonb_build_object('today',public.win_config_today_(),
  'coaches',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'winPct',r.win_pct,'active',c.active) order by c.name) from public.win_coaches c left join lateral(select win_pct from public.win_ops_coach_rates x where x.teacher_id=c.id and x.valid_from<=p_date order by valid_from desc limit 1) r on true),'[]'),
  'prices',coalesce((select jsonb_agg(to_jsonb(x)) from (select distinct on(code,duration_min) code,duration_min,amount_cash,amount_transfer from public.win_price_list where valid_from<=p_date order by code,duration_min,valid_from desc)x),'[]'),
  'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'court',b.court,'start',to_char(b.start_time,'HH24:MI'),'duration',b.duration_min,'type',b.kind,'name',b.holder,'paid',coalesce((select sum(amount) from public.win_court_payments where booking_id=b.id),0))) from public.win_court_bookings b where b.business_date=p_date and b.status='CONFIRMED' and not exists(select 1 from public.win_ops_records o where o.booking_id=b.id and o.status='ACTIVE' and o.played)),'[]'));
end $$;

create or replace function public.win_ops_history(p_token text,p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare a uuid; start_day date; end_day date; offset_rows int; data jsonb;
begin
 a=public.win_ops_actor(p_token);start_day=coalesce(nullif(p->>'start','')::date,public.win_config_today_());end_day=coalesce(nullif(p->>'end','')::date,start_day);
 offset_rows=coalesce((p->>'offset')::int,0);
 if end_day<start_day or end_day>start_day+366 or offset_rows<0 or offset_rows>100000 then raise exception 'PERIOD_INVALID';end if;
 with rows as (
  select 'op:'||o.id id,o.created_at registered_at,o.type,o.status,o.note,o.cash,o.transfer,o.refund_cash,o.activity_date,o.start_time,o.duration_min,o.courts,o.participants,
   coalesce(c.name,'') teacher,a.display_name author,owner.display_name responsible,o.shift_id,sh.status shift_status,o.actor_id,
   o.updated_at is not null modified,o.review_note,
   case when o.type in ('GASTO','RETIRO') then -o.cash else o.cash+o.transfer-o.refund_cash end amount,
   (select coalesce(jsonb_agg(jsonb_build_object('id',cmov.id,'amount',cmov.amount_signed,'method',cmov.payment_method)), '[]') from public.win_cash_movements cmov where cmov.reference_type='OPERATION' and cmov.reference_id=o.id::text and cmov.reversal_of is null) payments
  from public.win_ops_records o join public.win_cash_shifts sh on sh.id=o.shift_id join win_auth.login_accounts a on a.id=o.actor_id join win_auth.login_accounts owner on owner.id=sh.opened_by left join public.win_coaches c on c.id=o.teacher_id
  where (o.created_at at time zone 'America/Argentina/Buenos_Aires')::date between start_day and end_day
  union all
  select 'cash:'||m.id,m.occurred_at,m.kind,case when exists(select 1 from public.win_cash_movements rev where rev.reversal_of=m.id) then 'VOID' else 'ACTIVE' end,m.note,
   case when m.payment_method='CASH' then m.amount_signed else 0 end,
   case when m.payment_method='TRANSFER' then m.amount_signed else 0 end,0,null,null,null,'{}',null,'',a.display_name,owner.display_name,m.shift_id,sh.status,m.recorded_by,false,'',m.amount_signed,
   jsonb_build_array(jsonb_build_object('id',m.id,'amount',m.amount_signed,'method',m.payment_method))
  from public.win_cash_movements cmov join public.win_cash_shifts sh on sh.id=cmov.shift_id join win_auth.login_accounts a on a.id=cmov.recorded_by join win_auth.login_accounts owner on owner.id=sh.opened_by
  where m.reference_type is distinct from 'OPERATION' and m.reversal_of is null and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between start_day and end_day
 ), filtered as (
 select * from rows where (coalesce(p->>'type','ALL')='ALL' or type=p->>'type')
  and (coalesce(p->>'method','ALL')='ALL' or (p->>'method'='CASH' and cash<>0) or (p->>'method'='TRANSFER' and transfer<>0))
  and (coalesce(p->>'search','')='' or concat_ws(' ',note,teacher,author,responsible,type) ilike '%'||(p->>'search')||'%')
  and (coalesce(p->>'shiftId','')='' or shift_id::text=p->>'shiftId')
 ), paged as(select * from filtered order by registered_at desc,id desc limit 100 offset offset_rows)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by registered_at desc,id desc) from paged x),'[]'), 'total',(select count(*) from filtered),'offset',offset_rows,'limit',100) into data;
 return data;
end $$;

create or replace function public.win_ops_overview(p_token text) returns jsonb language plpgsql stable set search_path='' as $$
declare a uuid; sh public.win_cash_shifts; stats jsonb; teachers jsonb; notices jsonb; lastclosed jsonb; days jsonb; receipts jsonb;
begin
 a=public.win_ops_actor(p_token);
 select * into sh from public.win_cash_shifts where status='OPEN';
 select to_jsonb(x) into lastclosed from(select id,business_date,counted_cash,closed_at from public.win_cash_shifts where status='CLOSED' order by closed_at desc limit 1)x;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'sourceType',n.source_type,'sourceId',n.source_id,'message',n.message,'author',u.display_name,'createdAt',n.created_at,'resolvedAt',n.resolved_at,'resolution',n.resolution) order by n.created_at desc),'[]') into notices from public.win_ops_notices n join win_auth.login_accounts u on u.id=n.actor_id where n.resolved_at is null or n.resolved_at>now()-interval '30 days';
 select coalesce(jsonb_agg(to_jsonb(x) order by business_date desc),'[]') into days from (
 select distinct s.business_date from public.win_cash_shifts s left join public.win_ops_day_controls d on d.business_date=s.business_date
 where s.status='CLOSED' and s.business_date>=public.win_config_today_()-31 and (d.business_date is null or d.status<>'CONFIRMED') limit 31)x;
 if sh.id is not null then
  select jsonb_build_object('cashExpected',sh.opening_cash+coalesce(sum(amount_signed) filter(where payment_method='CASH'),0),
   'transferReceived',coalesce(sum(amount_signed) filter(where payment_method='TRANSFER'),0),'cashIncome',coalesce(sum(amount_signed) filter(where payment_method='CASH' and amount_signed>0),0),'cashOut',coalesce(sum(-amount_signed) filter(where payment_method='CASH' and amount_signed<0),0)) into stats from public.win_ops_ledger where shift_id=sh.id;
  stats=stats||jsonb_build_object('reservations',(select count(*) from public.win_ops_records where shift_id=sh.id and status='ACTIVE' and type in ('RESERVA','ABONO') and played),
   'reservationHours',(select coalesce(sum(duration_min),0)/60.0 from public.win_ops_records where shift_id=sh.id and status='ACTIVE' and type in ('RESERVA','ABONO') and played),
   'classes',(select count(*) from public.win_ops_records where shift_id=sh.id and status='ACTIVE' and type='CLASE'));
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into teachers from(
   select c.name,count(*) total,count(*) filter(where o.participants=1) individual,count(*) filter(where o.participants=2) double,count(*) filter(where o.participants=3) triple,count(*) filter(where o.participants=4) four
   from public.win_ops_records o join public.win_coaches c on c.id=o.teacher_id where o.shift_id=sh.id and o.status='ACTIVE' and o.type='CLASE' group by c.name)x;
 end if;
 return jsonb_build_object('shift',case when sh.id is null then null else to_jsonb(sh)||jsonb_build_object('responsible',(select display_name from win_auth.login_accounts where id=sh.opened_by)) end,
  'totals',stats,'classesByTeacher',teachers,'notices',notices,'lastClosed',lastclosed,'pendingDays',days,
  'settlementPending',(select count(*) from public.win_coaches c where (public.win_ops_balance(c.id)->>'balance')::numeric<>0));
end $$;

create or replace function public.win_ops_control(p_token text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
#variable_conflict use_variable
declare a uuid; role_ text; action_ text; req uuid; old public.win_ops_requests; sh public.win_cash_shifts; previous public.win_cash_shifts; m public.win_cash_movements;
 dt date; cash numeric; tr numeric; cnt int; expected numeric; tx numeric; reason text; checks_ text; notified boolean; result jsonb; new_id uuid; ns text; item record; correction public.win_ops_corrections;
begin
 a=public.win_ops_actor(p_token);select s.role into role_ from public.win_pin_session(p_token)s;
 action_=coalesce(p->>'operation',p->>'action');req=(p->>'requestId')::uuid;
 if req is null then raise exception 'REQUEST_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select * into old from public.win_ops_requests where request_id=req;
 if found then if old.actor_id<>a or old.action<>'control' or old.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;return old.result;end if;
 reason=btrim(coalesce(p->>'note',''));checks_=btrim(coalesce(p->>'checks',''));notified=coalesce((p->>'notified')::boolean,false);
 if length(reason)>800 or length(checks_)>800 then raise exception 'NOTE_TOO_LONG';end if;
 if action_='open' then
  if not public.win_can_access(a,'CASH','OPEN') then raise exception 'NOT_AUTHORIZED';end if;
  perform pg_catalog.pg_advisory_xact_lock(438011,1);
  if exists(select 1 from public.win_cash_shifts where status='OPEN') then raise exception 'SHIFT_ALREADY_OPEN';end if;
  cash=public.win_ops_money(p,'cash');dt=(p->>'date')::date;
  if dt is null or dt not between public.win_config_today_()-1 and public.win_config_today_() then raise exception 'BUSINESS_DATE_INVALID';end if;
  select * into previous from public.win_cash_shifts where status='CLOSED' order by closed_at desc limit 1;
  if previous.id is not null and cash<>previous.counted_cash and length(reason)<5 then raise exception 'OPENING_DIFFERENCE_REASON';end if;
  insert into public.win_cash_shifts(opened_by,business_date,opening_cash,note) values(a,dt,cash,reason) returning * into sh;
  if previous.id is not null and cash<>previous.counted_cash then insert into public.win_ops_notices(source_type,source_id,message,actor_id) values('HANDOVER',sh.id::text,'Diferencia de traspaso: contado $'||cash||', cierre anterior $'||previous.counted_cash||'. '||reason,a);end if;
  result=jsonb_build_object('id',sh.id,'saved',true);
 elsif action_='close' then
  select * into sh from public.win_cash_shifts where id=(p->>'shiftId')::uuid for update;
  if not found or sh.status<>'OPEN' then raise exception 'SHIFT_NOT_OPEN';end if;
  if not public.win_can_access(a,'CASH','CLOSE') or (a<>sh.opened_by and role_<>'ADMIN') then raise exception 'NOT_AUTHORIZED';end if;
  cash=public.win_ops_money(p,'cash');tr=public.win_ops_money(p,'transfer');cnt=(p->>'count')::int;
  if cnt is null or cnt<0 or cnt>100000 or (tr>0 and cnt=0) then raise exception 'RECEIPT_COUNT_REQUIRED';end if;
  select sh.opening_cash+coalesce(sum(amount_signed) filter(where payment_method='CASH'),0),coalesce(sum(amount_signed) filter(where payment_method='TRANSFER'),0) into expected,tx from public.win_ops_ledger where shift_id=sh.id;
  if (cash<>expected or tr<>tx) and (length(reason)<5 or length(checks_)<5 or not notified) then raise exception 'CLOSE_EXCEPTION_REQUIRED';end if;
  update public.win_cash_shifts set status='CLOSED',closed_by=a,closed_at=now(),counted_cash=cash,transfer_counted=tr,receipt_count=cnt,note=reason,exception_checks=checks_,admin_notified=notified where id=sh.id;
  if cash<>expected or tr<>tx then insert into public.win_ops_notices(source_type,source_id,message,actor_id) values('CLOSURE',sh.id::text,'Cierre excepcional: efectivo diferencia $'||(cash-expected)||', transferencia diferencia $'||(tr-tx)||'. '||reason,a);end if;
  result=jsonb_build_object('id',sh.id,'cashExpected',expected,'transferExpected',tx,'saved',true);
 elsif action_='day' then
  dt=(p->>'date')::date;tr=public.win_ops_money(p,'transfer');cnt=(p->>'count')::int;
  if dt is null or dt>public.win_config_today_() or cnt is null or cnt<0 or (tr>0 and cnt=0) then raise exception 'RECEIPT_COUNT_REQUIRED';end if;
  if exists(select 1 from public.win_cash_shifts where business_date=dt and status='OPEN') then raise exception 'DAY_HAS_OPEN_SHIFT';end if;
  if not exists(select 1 from public.win_cash_shifts where business_date=dt) then raise exception 'PERIOD_INVALID';end if;
  select coalesce(sum(amount_signed),0) into tx from public.win_ops_ledger where business_date=dt and payment_method='TRANSFER';
  -- Ajustes provisionales afectan la conciliación, nunca la presentación definitiva de Finanzas.
  tx=tx+coalesce((select sum(case when c.proposed_method='TRANSFER' then c.proposed_amount else 0 end-case when cmov.payment_method='TRANSFER' then cmov.amount_signed else 0 end) from public.win_ops_corrections c join public.win_cash_movements cmov on cmov.id=c.movement_id join public.win_cash_shifts s on s.id=cmov.shift_id where c.status='PENDING' and s.business_date=dt),0);
  ns=case when tr<>tx then 'EXCEPTION' when exists(select 1 from public.win_ops_corrections c join public.win_cash_movements cmov on cmov.id=c.movement_id join public.win_cash_shifts s on s.id=cmov.shift_id where c.status='PENDING' and s.business_date=dt) then 'PROVISIONAL' else 'CONFIRMED' end;
  if tr<>tx and (length(reason)<5 or length(checks_)<5 or not notified) then raise exception 'CLOSE_EXCEPTION_REQUIRED';end if;
  insert into public.win_ops_day_controls values(dt,tr,cnt,tx,a,now(),reason,checks_,notified,ns)
  on conflict(business_date) do update set transfer_counted=excluded.transfer_counted,receipt_count=excluded.receipt_count,expected_transfer=excluded.expected_transfer,actor_id=excluded.actor_id,updated_at=excluded.updated_at,note=excluded.note,checks=excluded.checks,admin_notified=excluded.admin_notified,status=excluded.status;
  result=jsonb_build_object('saved',true,'status',ns,'message',to_char(dt,'DD/MM/YYYY')||' — Total transferencias: $'||tr);
 elsif action_='notice' then
  if reason='' then raise exception 'CONCEPT_REQUIRED';end if;
  insert into public.win_ops_notices(request_id,message,actor_id) values(req,reason,a) returning id into new_id;
  result=jsonb_build_object('id',new_id,'saved',true);
 elsif action_='resolve' then
  if not exists(select 1 from public.win_ops_notices where id=(p->>'id')::uuid and source_type is null and resolved_at is null) then raise exception 'RESOLVE_AT_ORIGIN';end if;
  update public.win_ops_notices set resolved_by=a,resolved_at=now(),resolution=reason where id=(p->>'id')::uuid;
  result=jsonb_build_object('saved',true);
 elsif action_='receipt' then
  select * into m from public.win_cash_movements where id=(p->>'id')::uuid;
  if not found or m.payment_method<>'TRANSFER' or length(reason)<3 or length(reason)>200 then raise exception 'RECEIPT_INVALID';end if;
  update public.win_ops_receipts set reference=reason,verified=true where movement_id=m.id and not verified;
  update public.win_ops_notices set resolved_by=a,resolved_at=now(),resolution=reason where source_type='RECEIPT' and source_id=m.id::text;
  result=jsonb_build_object('saved',true);
 elsif action_='review' then
  if length(reason)<3 then raise exception 'CONCEPT_REQUIRED';end if;
  update public.win_ops_records set review_note='',updated_at=now() where id=(p->>'id')::uuid and status='ACTIVE';
  if not found then raise exception 'OPERATION_NOT_FOUND';end if;
  update public.win_ops_notices set resolved_by=a,resolved_at=now(),resolution=reason where source_type='OPERATION' and source_id=p->>'id';
  result=jsonb_build_object('saved',true);
 elsif action_='incident' then
  if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  if length(reason)<5 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
  update public.win_ops_notices set resolved_at=now(),resolved_by=a,resolution=reason where id=(p->>'id')::uuid and source_type in ('HANDOVER','CLOSURE');
  if not found then raise exception 'OPERATION_NOT_FOUND';end if;
  result=jsonb_build_object('saved',true);
 elsif action_='voidMovement' then
  select * into m from public.win_cash_movements where id=(p->>'id')::uuid for update;
  if not found or m.reference_type in ('OPERATION','BAR_ORDER','COURT_PAYMENT') or m.reversal_of is not null or exists(select 1 from public.win_cash_movements where reversal_of=m.id) then raise exception 'EDIT_AT_ORIGIN';end if;
  select * into sh from public.win_cash_shifts where id=m.shift_id for update;
  if sh.status<>'OPEN' then raise exception 'CLOSED_CORRECTION_REQUIRED';end if;
  if role_<>'ADMIN' and a<>m.recorded_by and a<>sh.opened_by then raise exception 'NOT_AUTHORIZED';end if;
  if length(reason)<5 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
  insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,note,reversal_of)
   values(gen_random_uuid(),sh.id,a,'ADJUSTMENT',m.business_unit,m.payment_method,-m.amount_signed,reason,m.id);
  if sh.opening_cash+coalesce((select sum(amount_signed) from public.win_cash_movements where shift_id=sh.id and payment_method='CASH'),0)<0 then raise exception 'INSUFFICIENT_CASH';end if;
  result=jsonb_build_object('saved',true);
 elsif action_='void' then
  if length(reason)<5 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
  select s.* into sh from public.win_ops_records o join public.win_cash_shifts s on s.id=o.shift_id where o.id=(p->>'id')::uuid for update of s;
  if not found then raise exception 'OPERATION_NOT_FOUND';end if;
  if sh.status<>'OPEN' and not exists(select 1 from public.win_ops_records where id=(p->>'id')::uuid and type='CLASE') then raise exception 'CLOSED_CORRECTION_REQUIRED';end if;
  if role_<>'ADMIN' and sh.opened_by<>a and not exists(select 1 from public.win_ops_records where id=(p->>'id')::uuid and actor_id=a) then raise exception 'NOT_AUTHORIZED';end if;
  if exists(select 1 from public.win_ops_records where id=(p->>'id')::uuid and type='RENDICION') then
   -- Su anulación devuelve crédito; no permitir consumir un crédito ya aplicado en otro registro.
   if exists(select 1 from public.win_ops_records r where r.id=(p->>'id')::uuid and (public.win_ops_balance(r.teacher_id)->>'credit')::numeric < r.cash+r.transfer-r.refund_cash-coalesce((select sum(amount) from public.win_ops_allocations where settlement_id=r.id),0)) then raise exception 'CREDIT_ALREADY_USED';end if;
  end if;
  insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) select a,'BEFORE_VOID','OPERATION',id::text,to_jsonb(o) from public.win_ops_records o where id=(p->>'id')::uuid;
  update public.win_ops_records set status='VOID',updated_at=now() where id=(p->>'id')::uuid and status='ACTIVE';
  if not found then raise exception 'OPERATION_NOT_FOUND';end if;
  update public.win_ops_resources set active=false where operation_id=(p->>'id')::uuid;
  for item in select * from public.win_cash_movements where reference_type='OPERATION' and reference_id=p->>'id' and reversal_of is null loop
   insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,note,reversal_of,reference_type,reference_id)
    values(gen_random_uuid(),sh.id,a,'ADJUSTMENT',item.business_unit,item.payment_method,-item.amount_signed,reason,item.id,'OPERATION',p->>'id');
  end loop;
  if sh.opening_cash+coalesce((select sum(amount_signed) from public.win_cash_movements where shift_id=sh.id and payment_method='CASH'),0)<0 then raise exception 'INSUFFICIENT_CASH';end if;
  update public.win_ops_notices set resolved_at=now(),resolved_by=a,resolution='Operación anulada: '||reason where source_id=p->>'id' and source_type='OPERATION';
  result=jsonb_build_object('saved',true);
 elsif action_='correction' then
  if length(reason)<5 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
  select * into m from public.win_cash_movements where id=(p->>'id')::uuid;
  if not found then raise exception 'OPERATION_NOT_FOUND';end if;
  select * into sh from public.win_cash_shifts where id=m.shift_id for update;
  cash=(p->>'amount')::numeric;
  if cash is null or abs(cash)>1000000000 or cash<>round(cash,2) or (m.amount_signed<0 and cash>0) or (m.amount_signed>0 and cash<0) then raise exception 'AMOUNT_INVALID';end if;
  if sh.status<>'CLOSED' then raise exception 'CLOSED_CORRECTION_REQUIRED';end if;
  insert into public.win_ops_corrections(request_id,movement_id,actor_id,proposed_amount,proposed_method,reason) values(req,m.id,a,cash,p->>'method',reason) returning id into new_id;
  update public.win_ops_day_controls set status='PROVISIONAL' where business_date=sh.business_date;
  result=jsonb_build_object('id',new_id,'saved',true);
 elsif action_='decide' then
  if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  select * into correction from public.win_ops_corrections where id=(p->>'id')::uuid for update;
  if not found or correction.status<>'PENDING' then raise exception 'CORRECTION_NOT_PENDING';end if;
  if length(reason)<5 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
  ns=case when coalesce((p->>'approve')::boolean,false) then 'APPROVED' else 'REJECTED' end;
  update public.win_ops_corrections set status=ns,decided_by=a,decided_at=now(),decision_note=reason where id=correction.id;
  update public.win_ops_day_controls set status='REVIEW' where business_date=(select s.business_date from public.win_cash_movements cmov join public.win_cash_shifts s on s.id=cmov.shift_id where cmov.id=correction.movement_id);
  result=jsonb_build_object('saved',true,'status',ns);
 else raise exception 'ACTION_INVALID';end if;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(a,'OPS_'||upper(action_),'OPERATION',coalesce(result->>'id',p->>'id',req::text),p-'requestId');
 insert into public.win_ops_requests values(req,a,'control',p,result,now());return result;
end $$;

create or replace function public.win_ops_day(p_token text,dt date) returns jsonb language plpgsql stable set search_path='' as $$
declare a uuid; data jsonb;
begin
 a=public.win_ops_actor(p_token);
 select jsonb_build_object('date',dt,'transferExpected',coalesce(sum(amount_signed) filter(where payment_method='TRANSFER'),0),
  'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'owner',u.display_name,'status',s.status,'transferCounted',s.transfer_counted,'receiptCount',s.receipt_count,'expected',(select coalesce(sum(amount_signed),0) from public.win_ops_ledger l where l.shift_id=s.id and l.payment_method='TRANSFER'))) from public.win_cash_shifts s join win_auth.login_accounts u on u.id=s.opened_by where s.business_date=dt),'[]'),
  'control',(select to_jsonb(d) from public.win_ops_day_controls d where d.business_date=dt),
  'provisional',coalesce((select sum(case when c.proposed_method='TRANSFER' then c.proposed_amount else 0 end-case when cmov.payment_method='TRANSFER' then cmov.amount_signed else 0 end) from public.win_ops_corrections c join public.win_cash_movements cmov on cmov.id=c.movement_id join public.win_cash_shifts s on s.id=cmov.shift_id where c.status='PENDING' and s.business_date=dt),0)) into data
 from public.win_ops_ledger where business_date=dt;
 return data;
end $$;

-- Todo cobro futuro del calendario se asienta una sola vez en la caja que lo recibe.
-- No trasladar al turno actual los pagos históricos que ya existían.
create or replace function public.win_ops_court_payment_trigger() returns trigger language plpgsql set search_path='' as $$
declare sh public.win_cash_shifts; mid uuid;
begin
 select * into sh from public.win_cash_shifts where status='OPEN' for update;
 if not found then raise exception 'SHIFT_NOT_OPEN';end if;
 if exists(select 1 from public.win_ops_records o where o.status='ACTIVE' and o.cash+o.transfer>0 and
  ((new.booking_id is not null and o.booking_id=new.booking_id) or (new.abono_id is not null and o.abono_id=new.abono_id and o.activity_date=new.occurrence_date))) then raise exception 'BOOKING_ALREADY_PAID';end if;
 insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,reference_type,reference_id,note)
 values(new.request_id,sh.id,new.recorded_by,'SALE','COURTS',new.method,new.amount,'COURT_PAYMENT',new.id::text,case when new.abono_id is null then 'Cobro de reserva desde Calendario' else 'Cobro de abono desde Calendario' end) returning id into mid;
 if new.method='TRANSFER' then
  insert into public.win_ops_receipts values(mid,coalesce(new.receipt_path,'PENDIENTE:'||mid),new.amount,new.receipt_path is not null);
  if new.receipt_path is null then insert into public.win_ops_notices(source_type,source_id,message,actor_id) values('RECEIPT',mid::text,'Comprobante pendiente de cobro de cancha',new.recorded_by);end if;
 end if;
 return new;
end $$;
drop trigger if exists win_ops_calendar_cash on public.win_court_payments;
create trigger win_ops_calendar_cash after insert on public.win_court_payments for each row execute function public.win_ops_court_payment_trigger();
