-- Capacidad real configurada por Administración; no se inventa una semana de 408 h.
create table if not exists public.win_ops_availability (
 business_date date not null, court text not null check(court in ('C1','C2','C3','C4')),
 starts_at timestamptz not null, ends_at timestamptz not null, actor_id uuid not null references win_auth.login_accounts(id),
 updated_at timestamptz not null default now(), note text not null default '',
 primary key(business_date,court),check(ends_at>=starts_at and ends_at<=starts_at+interval '24 hours')
);
alter table public.win_ops_availability enable row level security;
revoke all on public.win_ops_availability from public,anon,authenticated;
grant select,insert,update on public.win_ops_availability to service_role;

create or replace function public.win_ops_admin(p_token text,p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare actor uuid; r text; d1 date; d2 date; report jsonb; finance jsonb; days jsonb; categories jsonb; methods jsonb; recent jsonb; activity jsonb; academy jsonb; events jsonb; occupied numeric; capacity numeric; availability_missing int;
begin
 actor=public.win_ops_actor(p_token);select role into r from public.win_pin_session(p_token);
 if r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 d1=(p->>'start')::date;d2=(p->>'end')::date;
 if d1 is null or d2 is null or d2<d1 or d2>d1+366 then raise exception 'PERIOD_INVALID';end if;
 select jsonb_build_object('collected',coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND')),0),
  'expenses',coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0),'withdrawals',coalesce(sum(-amount_signed) filter(where kind='WITHDRAWAL'),0),
  'result',coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND','EXPENSE')),0),'entries',count(*),
  'activityNet',coalesce((select sum(win_net) from public.win_ops_records where status='ACTIVE' and played and activity_date between d1 and d2),0)) into finance
 from public.win_ops_ledger where business_date between d1 and d2;
 select coalesce(jsonb_agg(jsonb_build_object('date',d::date,
  'collected',coalesce((select sum(amount_signed) from public.win_ops_ledger where business_date=d::date and kind in ('SALE','DEPOSIT','REFUND')),0),
  'expenses',coalesce((select sum(-amount_signed) from public.win_ops_ledger where business_date=d::date and kind='EXPENSE'),0),
  'activityNet',coalesce((select sum(win_net) from public.win_ops_records where status='ACTIVE' and played and activity_date=d::date),0)) order by d),'[]') into days
 from generate_series(d1,d2,interval '1 day') d;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into categories from(
  select business_unit unit,coalesce(operation_type,kind) category,kind,count(*) count,
   coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND')),0) collected,coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0) expenses
  from public.win_ops_ledger where business_date between d1 and d2 group by 1,2,3)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into methods from(
  select payment_method method,coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT','REFUND')),0) collected,coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0) expenses
  from public.win_ops_ledger where business_date between d1 and d2 group by 1)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by "occurredAt" desc),'[]') into recent from(
  select m.id,m.business_date date,m.occurred_at "occurredAt",m.business_unit unit,m.operation_type category,m.kind,m.payment_method method,m.amount_signed amount,m.note,a.display_name "user",m.shift_id "shiftId"
  from public.win_ops_ledger m join win_auth.login_accounts a on a.id=m.recorded_by where m.business_date between d1 and d2 order by m.occurred_at desc limit 500)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into activity from(
  select type,count(*) count,sum(win_net) net,sum(duration_min*cardinality(courts))/60.0 hours,sum(participants) participants
  from public.win_ops_records where status='ACTIVE' and played and activity_date between d1 and d2 group by type)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into academy from(
  select c.id,c.name,count(o.id) classes,count(o.id) filter(where o.participants=1) individual,count(o.id) filter(where o.participants=2) double,
   count(o.id) filter(where o.participants=3) triple,count(o.id) filter(where o.participants=4) four,round(avg(o.participants),2) average,
   coalesce(sum(o.gross),0) gross,coalesce(sum(o.teacher_pay),0) remuneration,coalesce(sum(o.win_net),0) net,
   count(o.id) filter(where o.gross is null) unknown_gross,
   coalesce((select sum(s.cash+s.transfer-s.refund_cash) from public.win_ops_records s join public.win_cash_shifts sh on sh.id=s.shift_id where s.teacher_id=c.id and s.type='RENDICION' and s.status='ACTIVE' and sh.business_date between d1 and d2),0) received,
   public.win_ops_balance(c.id) balance
  from public.win_coaches c left join public.win_ops_records o on o.teacher_id=c.id and o.type='CLASE' and o.status='ACTIVE' and o.activity_date between d1 and d2 group by c.id,c.name)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by activity_date desc),'[]') into events from(
  select id,activity_date,start_time,duration_min,courts,participants,win_net,note,round(win_net/nullif(participants,0),2) per_participant,
   round(win_net/nullif(duration_min*cardinality(courts)/60.0,0),2) per_court_hour from public.win_ops_records where type='EVENTO' and status='ACTIVE' and activity_date between d1 and d2)x;
 select coalesce(sum(extract(epoch from(r.ends_at-r.starts_at)))/3600,0) into occupied from public.win_ops_resources r join public.win_ops_records o on o.id=r.operation_id where r.active and o.activity_date between d1 and d2;
 select coalesce(sum(extract(epoch from(ends_at-starts_at)))/3600,0),((d2-d1+1)*4)-count(*) into capacity,availability_missing from public.win_ops_availability where business_date between d1 and d2;
 report=jsonb_build_object('start',d1,'end',d2,'totals',finance,'daily',days,'categories',categories,'methods',methods,'recent',recent,'activity',activity,'academy',academy,'events',events,
  'occupancy',jsonb_build_object('occupiedHours',occupied,'capacityHours',case when availability_missing=0 then capacity end,'missingCourtDays',availability_missing,'physicalPercent',case when availability_missing=0 and capacity>0 then round(occupied/capacity*100,2) end,
   'economicPercent',case when availability_missing=0 and capacity>0 then round((finance->>'activityNet')::numeric/(capacity*60000)*100,2) end,'netPerHour',case when occupied>0 then round((finance->>'activityNet')::numeric/occupied,2) end),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('date',o.activity_date,'court',r.court,'start',r.starts_at,'end',r.ends_at,'type',o.type,'id',o.id)) from public.win_ops_resources r join public.win_ops_records o on o.id=r.operation_id where r.active and o.activity_date between d1 and d2),'[]'),
  'operations',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,type,activity_date,start_time,duration_min,courts,teacher_id,participants,gross,teacher_pay,win_net,win_pct,class_kind,note from public.win_ops_records where status='ACTIVE' and played and activity_date between d1 and d2 order by activity_date desc,created_at desc limit 500)x),'[]'),
  'corrections',coalesce((select jsonb_agg(to_jsonb(c)) from public.win_ops_corrections c where c.status='PENDING'),'[]'),
  'controls',coalesce((select jsonb_agg(to_jsonb(d)) from public.win_ops_day_controls d where business_date between d1 and d2),'[]'),
  'shifts',coalesce((select jsonb_agg(to_jsonb(x)) from(select s.id,s.business_date,s.status,s.counted_cash,s.transfer_counted,s.receipt_count,s.note,s.exception_checks,s.opening_cash,u.display_name responsible,
   s.opening_cash+coalesce((select sum(amount_signed) from public.win_ops_ledger m where m.shift_id=s.id and m.payment_method='CASH'),0) expected_cash
   from public.win_cash_shifts s join win_auth.login_accounts u on u.id=s.opened_by where s.business_date between d1 and d2 order by opened_at desc limit 200)x),'[]'),
  'audit',coalesce((select jsonb_agg(to_jsonb(x)) from(select au.*,a.display_name author from public.win_cash_audit au left join win_auth.login_accounts a on a.id=au.actor_id where (au.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between d1 and d2 order by au.occurred_at desc limit 200)x),'[]'));
 return report;
end $$;

create or replace function public.win_ops_api(p_token text,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare a uuid; r text; d1 date; d2 date; dt date; st time; en time; ct text; row_ jsonb; req uuid; old public.win_ops_requests; result jsonb;
begin
 a=public.win_ops_actor(p_token);
 case p_action
 when 'overview' then return public.win_ops_overview(p_token);
 when 'context' then return public.win_ops_context(p_token,coalesce((p_data->>'date')::date,public.win_config_today_()));
 when 'history' then return public.win_ops_history(p_token,p_data);
 when 'balance' then return public.win_ops_balance((p_data->>'teacherId')::uuid);
 when 'save' then return public.win_ops_save(p_token,p_data);
 when 'control' then return public.win_ops_control(p_token,p_data);
 when 'day' then return public.win_ops_day(p_token,(p_data->>'date')::date);
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

do $$declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'win_ops_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
