create or replace view public.win_admin_ledger with(security_invoker=true) as
 select l.id::text id,l.shift_id::text shift_id,l.recorded_by,l.occurred_at,l.kind,l.business_unit,
  l.payment_method,l.amount_signed,l.note,l.business_date,coalesce(l.operation_type,case when l.reference_type='COURT_PAYMENT' then case when cp.abono_id is not null or to_jsonb(cb)->>'source_abono_id' is not null then 'ABONO' else cb.kind end when l.reference_type='BAR_ORDER' then 'CAFE_BAR' end) operation_type,
  a.display_name author,'LIVE'::text source,null::text origin_id,o.teacher_id::text teacher_id,o.activity_date
 from public.win_ops_ledger l left join win_auth.login_accounts a on a.id=l.recorded_by
 left join public.win_ops_records o on l.reference_type='OPERATION' and l.reference_id=o.id::text
 left join public.win_court_payments cp on l.reference_type='COURT_PAYMENT' and l.reference_id=cp.id::text
 left join public.win_court_bookings cb on cb.id=cp.booking_id
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
  from public.win_admin_ledger m where m.business_date between d1 and d2 order by m.occurred_at desc limit 5000)x;
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
  'academyDaily',coalesce((select jsonb_agg(to_jsonb(x) order by date,teacher_id) from(select teacher_id,activity_date date,sum(quantity) classes,sum(win_net) activityNet,sum(quantity) filter(where unknown_price) unknown_price from public.win_admin_activity where type='CLASE' and activity_date between d1 and d2 group by teacher_id,activity_date)x),'[]'::jsonb),'history',public.win_history_status(),'historicalShifts',coalesce((select jsonb_agg(h.facts||jsonb_build_object('origin_id',h.origin_id) order by h.facts->>'date') from public.win_history_rows h where h.entity='shift' and (h.facts->>'date')::date between d1 and d2),'[]'::jsonb),'occupancy',jsonb_build_object('historyIncomplete',exists(select 1 from public.win_admin_activity where source='APPS_SCRIPT' and type in ('RESERVA','ABONO','CLASE','EVENTO') and activity_date between d1 and d2 and (duration_min is null or cardinality(courts)=0)),'occupiedHours',occupied,'capacityHours',case when availability_missing=0 then capacity end,'missingCourtDays',availability_missing,'physicalPercent',case when availability_missing=0 and capacity>0 and not exists(select 1 from public.win_admin_activity where source='APPS_SCRIPT' and activity_date between d1 and d2 and type in ('RESERVA','ABONO','CLASE','EVENTO') and (duration_min is null or cardinality(courts)=0)) then round(occupied/capacity*100,2) end,
   'economicPercent',case when availability_missing=0 and capacity>0 then round((finance->>'activityNet')::numeric/(capacity*60000)*100,2) end,'netPerHour',case when occupied>0 then round((finance->>'activityNet')::numeric/occupied,2) end),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('date',r.activity_date,'court',r.court,'start',r.starts_at,'end',r.ends_at,'type',r.type,'id',r.id)) from public.win_admin_resources r where r.activity_date between d1 and d2),'[]'),
  'operations',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,type,activity_date,start_time,duration_min,courts,teacher_id,participants,gross,teacher_pay,win_net,win_pct,configured_win_pct,exception_reason,class_kind,note,quantity,unknown_price,source,origin_id from public.win_admin_activity where activity_date between d1 and d2 order by activity_date desc,created_at desc limit 5000)x),'[]'),
  'corrections',coalesce((select jsonb_agg(to_jsonb(c)) from public.win_ops_corrections c where c.status='PENDING'),'[]'),
  'controls',coalesce((select jsonb_agg(to_jsonb(d)) from public.win_ops_day_controls d where business_date between d1 and d2),'[]'),
  'shifts',coalesce((select jsonb_agg(to_jsonb(x)) from(select s.id,s.business_date,s.status,s.counted_cash,s.transfer_counted,s.receipt_count,s.note,s.exception_checks,s.opening_cash,u.display_name responsible,
   s.opening_cash+coalesce((select sum(amount_signed) from public.win_ops_ledger m where m.shift_id=s.id and m.payment_method='CASH'),0) expected_cash
   from public.win_cash_shifts s join win_auth.login_accounts u on u.id=s.opened_by where s.business_date between d1 and d2 order by opened_at desc limit 200)x),'[]'),
  'audit',coalesce((select jsonb_agg(to_jsonb(x)) from(select au.*,a.display_name author from public.win_cash_audit au left join win_auth.login_accounts a on a.id=au.actor_id where (au.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between d1 and d2 order by au.occurred_at desc limit 200)x),'[]'));
 if (report->'occupancy'->>'historyIncomplete')::boolean then report=jsonb_set(report,'{occupancy,netPerHour}','null'::jsonb);end if;
 return report;
end $$;



revoke all on function public.win_admin_report_(date,date) from public,anon,authenticated;
grant execute on function public.win_admin_report_(date,date) to service_role;
