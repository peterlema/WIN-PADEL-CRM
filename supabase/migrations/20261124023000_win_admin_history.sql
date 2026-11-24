-- Historical source records are separate from operational cash and bookings.
-- No triggers, references or writes to win_cash_*, win_ops_records or agenda.
create table if not exists public.win_history_rows (
 source_id text not null, entity text not null check(entity in ('entry','class_detail','allocation','shift')),
 origin_id text not null, source_row integer not null check(source_row>1),
 raw jsonb not null check(jsonb_typeof(raw)='array'), facts jsonb not null,
 content_hash text not null, imported_at timestamptz not null default now(),
 primary key(source_id,entity,origin_id)
);
create index if not exists win_history_activity_idx on public.win_history_rows((facts->>'activity_date'),entity);
create index if not exists win_history_payment_idx on public.win_history_rows((facts->>'payment_date'),entity);
alter table public.win_history_rows enable row level security;
revoke all on public.win_history_rows from public,anon,authenticated;
grant select on public.win_history_rows to service_role;

-- Reporting-only union. Operational balances continue to use win_ops_ledger.
create or replace view public.win_admin_ledger with(security_invoker=true) as
 select l.id::text id,l.shift_id::text shift_id,l.recorded_by,l.occurred_at,l.kind,l.business_unit,
  l.payment_method,l.amount_signed,l.note,l.business_date,l.operation_type,
  a.display_name author,'LIVE'::text source,null::text origin_id,o.teacher_id::text teacher_id,o.activity_date
 from public.win_ops_ledger l left join win_auth.login_accounts a on a.id=l.recorded_by
 left join public.win_ops_records o on l.reference_type='OPERATION' and l.reference_id=o.id::text
 union all
 select 'history:'||h.entity||':'||h.origin_id||':'||m.method,
  h.facts->>'shift_id',null::uuid,(h.facts->>'occurred_at')::timestamptz,
  case h.facts->>'type' when 'GASTO' then 'EXPENSE' when 'RETIRO' then 'WITHDRAWAL' else 'SALE' end,
  case h.facts->>'type' when 'RESERVA' then 'COURTS' when 'ABONO' then 'COURTS'
   when 'CLASE' then 'ACADEMY' when 'RENDICION' then 'ACADEMY' when 'TIENDA' then 'SHOP' when 'EVENTO' then 'EVENTS' else 'GENERAL' end,
  m.method,m.amount,concat_ws(' · ',nullif(h.facts->>'concept',''),nullif(h.facts->>'note','')),
  (h.facts->>'payment_date')::date,h.facts->>'type',h.facts->>'author','APPS_SCRIPT',h.origin_id,
  coalesce(c.id::text,case when nullif(h.facts->>'teacher','') is not null then 'history:'||lower(btrim(h.facts->>'teacher')) end),(h.facts->>'activity_date')::date
 from public.win_history_rows h
 left join public.win_coaches c on lower(btrim(c.name))=lower(btrim(h.facts->>'teacher'))
 cross join lateral (
  select 'CASH'::text method,(h.facts->>'cash')::numeric amount where h.entity='entry' and h.facts->>'type' not in ('CLASE','GASTO','RETIRO')
  union all select 'TRANSFER',(h.facts->>'transfer')::numeric where h.entity='entry' and h.facts->>'type' not in ('CLASE','GASTO','RETIRO')
  union all select case h.facts->>'expense_method' when 'Efectivo' then 'CASH' when 'Transferencia' then 'TRANSFER' else 'OTHER' end,
   -(h.facts->>'expense')::numeric where h.entity='entry' and h.facts->>'type' in ('GASTO','RETIRO')
  union all select case h.facts->>'method' when 'Efectivo' then 'CASH' when 'Transferencia' then 'TRANSFER' else 'OTHER' end,
   (h.facts->>'amount')::numeric where h.entity='allocation'
 )m
 where h.entity in ('entry','allocation') and h.facts->>'status'='ACTIVE' and m.amount<>0;

create or replace view public.win_admin_activity with(security_invoker=true) as
 select o.id::text id,o.type,o.activity_date,o.start_time,o.duration_min,o.courts,o.teacher_id::text teacher_id,c.name teacher,
  o.participants,o.gross,o.teacher_pay,o.win_net,o.win_pct,o.configured_win_pct,o.exception_reason,o.class_kind,o.note,
  1::integer quantity,false unknown_price,false tiny_price,o.created_at,'LIVE'::text source,null::text origin_id
 from public.win_ops_records o left join public.win_coaches c on c.id=o.teacher_id
 where o.status='ACTIVE' and o.played
 union all
 select 'history:'||h.origin_id,h.facts->>'type',(h.facts->>'activity_date')::date,(h.facts->>'start_time')::time,
  (h.facts->>'duration_min')::integer,array(select jsonb_array_elements_text(h.facts->'courts')),
  coalesce(c.id::text,case when nullif(h.facts->>'teacher','') is not null then 'history:'||lower(btrim(h.facts->>'teacher')) end),
  h.facts->>'teacher',(h.facts->>'participants')::integer,(h.facts->>'gross')::numeric,(h.facts->>'teacher_pay')::numeric,
  (h.facts->>'win_net')::numeric,(h.facts->>'win_pct')::numeric,null::numeric,''::text,h.facts->>'class_kind',
  concat_ws(' · ',nullif(h.facts->>'concept',''),nullif(h.facts->>'note','')),(h.facts->>'quantity')::integer,
  (h.facts->>'unknown_price')::boolean,(h.facts->>'tiny_price')::boolean,(h.facts->>'occurred_at')::timestamptz,'APPS_SCRIPT',h.origin_id
 from public.win_history_rows h left join public.win_coaches c on lower(btrim(c.name))=lower(btrim(h.facts->>'teacher'))
 where h.entity='entry' and h.facts->>'status'='ACTIVE' and not coalesce((h.facts->>'solo_cobro')::boolean,false)
  and h.facts->>'type' in ('RESERVA','ABONO','CLASE','EVENTO','TIENDA','OTRO');

revoke all on public.win_admin_ledger,public.win_admin_activity from public,anon,authenticated;
grant select on public.win_admin_ledger,public.win_admin_activity to service_role;

create or replace view public.win_admin_resources with(security_invoker=true) as
 select o.id::text id,o.activity_date,o.type,r.court,r.starts_at,r.ends_at
 from public.win_ops_resources r join public.win_ops_records o on o.id=r.operation_id
 where r.active and o.status='ACTIVE'
 union all
 select a.id,a.activity_date,a.type,c.court,
  public.win_courts_starts_at_(a.activity_date,a.start_time),
  public.win_courts_starts_at_(a.activity_date,a.start_time)+a.duration_min*interval '1 minute'
 from public.win_admin_activity a cross join lateral unnest(a.courts)c(court)
 where a.source='APPS_SCRIPT' and a.type in ('RESERVA','ABONO','CLASE','EVENTO') and a.start_time is not null and a.duration_min>0 and c.court in ('C1','C2','C3','C4');
revoke all on public.win_admin_resources from public,anon,authenticated;
grant select on public.win_admin_resources to service_role;

-- Kept as a source-level reconciliation, never spread across invented days.
create or replace function public.win_history_status() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('sourceId','1kYR8t-3dyXC0gFRiMMjBV7sV-byOgfIlGl2mCMwP-zE',
  'sourceName','WIN GESTION BASE DE PRUEBAS','start',min(facts->>'activity_date') filter(where entity='entry'),
  'end',max(facts->>'activity_date') filter(where entity='entry'),'importedAt',max(imported_at),'rows',count(*),
  'unknownPriceClasses',coalesce(sum((facts->>'quantity')::int) filter(where entity='entry' and facts->>'status'='ACTIVE' and (facts->>'unknown_price')::boolean),0),
  'missingShiftEntries',count(*) filter(where entity='entry' and (facts->>'missing_shift')::boolean),
  'unknownScheduleEntries',count(*) filter(where entity='entry' and facts->>'status'='ACTIVE' and facts->>'type' in ('RESERVA','ABONO','CLASE','EVENTO') and (facts->>'duration_min' is null or jsonb_array_length(facts->'courts')=0)),
  'tinyPriceClasses',count(*) filter(where entity='entry' and facts->>'status'='ACTIVE' and (facts->>'tiny_price')::boolean),
  'baseline',(select to_jsonb(s) from public.win_resumen_admin s order by periodo_hasta desc limit 1),
  'current',jsonb_build_object('collected',(select coalesce(sum(amount_signed),0) from public.win_admin_ledger where source='APPS_SCRIPT' and kind='SALE'),
   'activityNet',(select coalesce(sum(win_net),0) from public.win_admin_activity where source='APPS_SCRIPT'),
   'expenses',(select coalesce(sum(-amount_signed),0) from public.win_admin_ledger where source='APPS_SCRIPT' and kind='EXPENSE'),
   'withdrawals',(select coalesce(sum(-amount_signed),0) from public.win_admin_ledger where source='APPS_SCRIPT' and kind='WITHDRAWAL'),
   'reservations',(select coalesce(sum(quantity),0) from public.win_admin_activity where source='APPS_SCRIPT' and type in ('RESERVA','ABONO')),
   'classes',(select coalesce(sum(quantity),0) from public.win_admin_activity where source='APPS_SCRIPT' and type='CLASE')))
 from public.win_history_rows;
$$;
revoke all on function public.win_history_status() from public,anon,authenticated;
grant execute on function public.win_history_status() to service_role;

create or replace function public.win_admin_report_(d1 date,d2 date) returns jsonb language plpgsql stable set search_path='' as $$
declare report jsonb; finance jsonb; days jsonb; categories jsonb; methods jsonb; recent jsonb; activity jsonb; academy jsonb; events jsonb; occupied numeric; capacity numeric; availability_missing int;
begin
 if d1 is null or d2 is null or d2<d1 or d2>d1+366 then raise exception 'PERIOD_INVALID';end if;
 select jsonb_build_object('collected',coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND')),0),
  'expenses',coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0),'withdrawals',coalesce(sum(-amount_signed) filter(where kind='WITHDRAWAL'),0),
  'result',coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND','EXPENSE')),0),'entries',count(*),
  'activityNet',coalesce((select sum(win_net) from public.win_admin_activity where activity_date between d1 and d2),0)) into finance
 from public.win_admin_ledger where business_date between d1 and d2;
 select coalesce(jsonb_agg(jsonb_build_object('date',d::date,
  'collected',coalesce((select sum(amount_signed) from public.win_admin_ledger where business_date=d::date and kind in ('SALE','DEPOSIT','REFUND')),0),
  'expenses',coalesce((select sum(-amount_signed) from public.win_admin_ledger where business_date=d::date and kind='EXPENSE'),0),
  'activityNet',coalesce((select sum(win_net) from public.win_admin_activity where activity_date=d::date),0)) order by d),'[]') into days
 from generate_series(d1,d2,interval '1 day') d;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into categories from(
  select business_unit unit,coalesce(operation_type,kind) category,kind,count(*) count,
   coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND')),0) collected,coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0) expenses
  from public.win_admin_ledger where business_date between d1 and d2 group by 1,2,3)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into methods from(
  select payment_method method,coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND')),0) collected,coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0) expenses
  from public.win_admin_ledger where business_date between d1 and d2 group by 1)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by "occurredAt" desc),'[]') into recent from(
  select m.id,m.business_date date,m.occurred_at "occurredAt",m.business_unit unit,m.operation_type category,m.kind,m.payment_method method,m.amount_signed amount,m.note,m.author "user",m.source,m.origin_id,m.activity_date,m.shift_id "shiftId"
  from public.win_admin_ledger m where m.business_date between d1 and d2 order by m.occurred_at desc limit 500)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into activity from(
  select type,sum(quantity) count,sum(win_net) net,sum(duration_min*cardinality(courts))/60.0 hours,sum(participants*quantity) participants,sum(quantity) filter(where unknown_price) unknown_price
  from public.win_admin_activity where activity_date between d1 and d2 group by type)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by name),'[]') into academy from(
  with teachers as (
   select id::text id,name from public.win_coaches
   union select teacher_id,teacher from public.win_admin_activity where type='CLASE' and teacher_id like 'history:%'
  )
  select c.id,c.name,coalesce(sum(o.quantity),0) classes,
   coalesce(sum(o.quantity) filter(where o.participants=1),0) individual,
   coalesce(sum(o.quantity) filter(where o.participants=2),0) double,
   coalesce(sum(o.quantity) filter(where o.participants=3),0) triple,
   coalesce(sum(o.quantity) filter(where o.participants=4),0) four,
   round(sum(o.participants*o.quantity)::numeric/nullif(sum(o.quantity),0),2) average,
   coalesce(sum(o.gross),0) gross,coalesce(sum(o.teacher_pay),0) remuneration,coalesce(sum(o.win_net),0) net,
   coalesce(sum(o.quantity) filter(where o.gross is null and o.id is not null),0) unknown_gross,
   coalesce(sum(o.quantity) filter(where o.unknown_price),0) unknown_price,
   coalesce((select sum(l.amount_signed) from public.win_admin_ledger l where l.teacher_id=c.id and l.operation_type='RENDICION' and l.business_date between d1 and d2),0) received,
   case when c.id like 'history:%' then jsonb_build_object('balance',null,'credit',null,'days','[]'::jsonb)
    else public.win_ops_balance(c.id::uuid) end balance,
   jsonb_build_object('classes',coalesce(sum(o.quantity) filter(where o.source='APPS_SCRIPT'),0),
    'net',coalesce(sum(o.win_net) filter(where o.source='APPS_SCRIPT'),0),'balanceConfirmed',false) history
  from teachers c left join public.win_admin_activity o on o.teacher_id=c.id and o.type='CLASE' and o.activity_date between d1 and d2
  group by c.id,c.name)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by activity_date desc),'[]') into events from(
  select id,activity_date,start_time,duration_min,courts,participants,win_net,note,round(win_net/nullif(participants,0),2) per_participant,
   round(win_net/nullif(duration_min*cardinality(courts)/60.0,0),2) per_court_hour from public.win_admin_activity where type='EVENTO' and activity_date between d1 and d2)x;
 select coalesce(sum(extract(epoch from(r.ends_at-r.starts_at)))/3600,0) into occupied
 from public.win_admin_resources r where r.activity_date between d1 and d2;
 select coalesce(sum(extract(epoch from(ends_at-starts_at)))/3600,0),((d2-d1+1)*4)-count(*) into capacity,availability_missing from public.win_ops_availability where business_date between d1 and d2;
 report=jsonb_build_object('start',d1,'end',d2,'totals',finance,'daily',days,'categories',categories,'methods',methods,'recent',recent,'activity',activity,'academy',academy,'events',events,
  'history',public.win_history_status(),'occupancy',jsonb_build_object('historyIncomplete',exists(select 1 from public.win_admin_activity where source='APPS_SCRIPT' and type in ('RESERVA','ABONO','CLASE','EVENTO') and activity_date between d1 and d2 and (duration_min is null or cardinality(courts)=0)),'occupiedHours',occupied,'capacityHours',case when availability_missing=0 then capacity end,'missingCourtDays',availability_missing,'physicalPercent',case when availability_missing=0 and capacity>0 and not exists(select 1 from public.win_admin_activity where source='APPS_SCRIPT' and activity_date between d1 and d2 and type in ('RESERVA','ABONO','CLASE','EVENTO') and (duration_min is null or cardinality(courts)=0)) then round(occupied/capacity*100,2) end,
   'economicPercent',case when availability_missing=0 and capacity>0 then round((finance->>'activityNet')::numeric/(capacity*60000)*100,2) end,'netPerHour',case when occupied>0 then round((finance->>'activityNet')::numeric/occupied,2) end),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('date',r.activity_date,'court',r.court,'start',r.starts_at,'end',r.ends_at,'type',r.type,'id',r.id)) from public.win_admin_resources r where r.activity_date between d1 and d2),'[]'),
  'operations',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,type,activity_date,start_time,duration_min,courts,teacher_id,participants,gross,teacher_pay,win_net,win_pct,configured_win_pct,exception_reason,class_kind,note,quantity,unknown_price,source,origin_id from public.win_admin_activity where activity_date between d1 and d2 order by activity_date desc,created_at desc limit 5000)x),'[]'),
  'corrections',coalesce((select jsonb_agg(to_jsonb(c)) from public.win_ops_corrections c where c.status='PENDING'),'[]'),
  'controls',coalesce((select jsonb_agg(to_jsonb(d)) from public.win_ops_day_controls d where business_date between d1 and d2),'[]'),
  'shifts',coalesce((select jsonb_agg(to_jsonb(x)) from(select s.id,s.business_date,s.status,s.counted_cash,s.transfer_counted,s.receipt_count,s.note,s.exception_checks,s.opening_cash,u.display_name responsible,
   s.opening_cash+coalesce((select sum(amount_signed) from public.win_ops_ledger m where m.shift_id=s.id and m.payment_method='CASH'),0) expected_cash
   from public.win_cash_shifts s join win_auth.login_accounts u on u.id=s.opened_by where s.business_date between d1 and d2 order by opened_at desc limit 200)x),'[]'),
  'audit',coalesce((select jsonb_agg(to_jsonb(x)) from(select au.*,a.display_name author from public.win_cash_audit au left join win_auth.login_accounts a on a.id=au.actor_id where (au.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between d1 and d2 order by au.occurred_at desc limit 200)x),'[]'));
 return report;
end $$;


create or replace function public.win_ops_admin(p_token text,p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare a uuid;r text;
begin
 a=public.win_ops_actor(p_token);select role into r from public.win_pin_session(p_token);
 if r is distinct from 'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 return public.win_admin_report_((p->>'start')::date,(p->>'end')::date);
end $$;
revoke all on function public.win_admin_report_(date,date) from public,anon,authenticated;
grant execute on function public.win_admin_report_(date,date) to service_role;
revoke all on function public.win_ops_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.win_ops_admin(text,jsonb) to service_role;
create or replace function public.win_ops_api(p_token text,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare a uuid; r text; d1 date; d2 date; dt date; st time; en time; ct text; row_ jsonb; req uuid; old public.win_ops_requests; result jsonb;
begin
 a=public.win_ops_actor(p_token);
 case p_action
 when 'overview' then return public.win_ops_overview(p_token);
 when 'context' then return public.win_ops_context(p_token,coalesce((p_data->>'date')::date,public.win_config_today_()));
 when 'history' then return public.win_ops_history(p_token,p_data);
 when 'balance' then return public.win_ops_balance((p_data->>'teacherId')::uuid);
 when 'status' then
  select jsonb_build_object('found',true,'result',x.result) into result from public.win_ops_requests x where x.request_id=(p_data->>'requestId')::uuid and x.actor_id=a;
  return coalesce(result,jsonb_build_object('found',false));
 when 'detail' then
  return jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(x)) from(select au.id,au.occurred_at,au.action,au.detail,u.display_name author from public.win_cash_audit au left join win_auth.login_accounts u on u.id=au.actor_id where au.entity_id=split_part(p_data->>'id',':',2) order by au.occurred_at desc limit 100)x),'[]'));
 when 'quote' then
  select role into r from public.win_pin_session(p_token);
  select jsonb_build_object('gross',pr.amount_cash,'winPct',rate.win_pct,'winNet',round(pr.amount_cash*rate.win_pct/100,2),'teacherPay',pr.amount_cash-round(pr.amount_cash*rate.win_pct/100,2)) into result
  from public.win_coaches c
  join lateral(select win_pct from public.win_ops_coach_rates x where teacher_id=c.id and valid_from<=(p_data->>'date')::date order by valid_from desc limit 1)rate on true
  join lateral(select amount_cash from public.win_price_list where code='CLASS_'||(p_data->>'participants') and duration_min=(p_data->>'duration')::int and valid_from<=(p_data->>'date')::date order by valid_from desc limit 1)pr on true
  where c.id=(p_data->>'teacherId')::uuid and c.active;
  return coalesce(result,jsonb_build_object('error','No hay tarifa o porcentaje configurado para esa fecha y duración. Usá Excepción con importes reales y motivo.'));
 when 'save' then return public.win_ops_save(p_token,p_data);
 when 'control' then return public.win_ops_control(p_token,p_data);
 when 'day' then return public.win_ops_day(p_token,(p_data->>'date')::date);
 when 'export' then
  select role into r from public.win_pin_session(p_token);if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  d1=(p_data->>'start')::date;d2=(p_data->>'end')::date;
  if d1 is null or d2 is null or d2<d1 or d2>d1+366 then raise exception 'PERIOD_INVALID';end if;
  if (select count(*) from public.win_admin_ledger where business_date between d1 and d2)>20000 then raise exception 'EXPORT_LIMIT';end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by occurred_at,id) from(select l.* from public.win_admin_ledger l where business_date between d1 and d2)x),'[]'));
 when 'admin' then return public.win_ops_admin(p_token,p_data);
 when 'availability' then
  select role into r from public.win_pin_session(p_token);if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  req=(p_data->>'requestId')::uuid;if req is null then raise exception 'REQUEST_REQUIRED';end if;
  perform pg_catalog.pg_advisory_xact_lock(438011,2);
  select * into old from public.win_ops_requests where request_id=req;
  if found then if old.actor_id<>a or old.action<>'availability' or old.payload<>p_data then raise exception 'REQUEST_ID_REUSED';end if;return old.result;end if;
  d1=(p_data->>'startDate')::date;d2=(p_data->>'endDate')::date;st=(p_data->>'open')::time;en=(p_data->>'close')::time;
  if d1 is null or d2 is null or d2<d1 or d2>d1+31 or st is null or en is null or jsonb_array_length(coalesce(p_data->'courts','[]'))=0 then raise exception 'AVAILABILITY_INVALID';end if;
  for dt in select x::date from generate_series(d1,d2,interval '1 day')x loop
   for ct in select jsonb_array_elements_text(p_data->'courts') loop
    insert into public.win_ops_availability(business_date,court,starts_at,ends_at,actor_id,note)
    values(dt,ct,public.win_courts_starts_at_(dt,st),case when coalesce((p_data->>'closed')::boolean,false) then public.win_courts_starts_at_(dt,st) else public.win_courts_starts_at_(dt,en)+case when en<st and en>=time '06:00' then interval '1 day' else interval '0 days' end end,a,coalesce(p_data->>'note',''))
    on conflict(business_date,court) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,actor_id=excluded.actor_id,updated_at=now(),note=excluded.note;
   end loop;
  end loop;
  result=jsonb_build_object('saved',true);
  insert into public.win_ops_requests values(req,a,'availability',p_data,result,now());
  insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(a,'SET_AVAILABILITY','AVAILABILITY',req::text,p_data);return result;
 else raise exception 'ACTION_INVALID';end case;
end $$;

revoke all on function public.win_ops_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.win_ops_api(text,text,jsonb) to service_role;
