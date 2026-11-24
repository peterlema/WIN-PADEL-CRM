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
create or replace function public.win_history_status() returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; baseline jsonb;
begin
 select jsonb_build_object('sourceId','1kYR8t-3dyXC0gFRiMMjBV7sV-byOgfIlGl2mCMwP-zE',
  'sourceName','WIN GESTION BASE DE PRUEBAS','start',min(facts->>'activity_date') filter(where entity='entry'),
  'end',max(facts->>'activity_date') filter(where entity='entry'),'importedAt',max(imported_at),'rows',count(*),
  'unknownPriceClasses',coalesce(sum((facts->>'quantity')::int) filter(where entity='entry' and facts->>'status'='ACTIVE' and (facts->>'unknown_price')::boolean),0),
  'missingShiftEntries',count(*) filter(where entity='entry' and (facts->>'missing_shift')::boolean),
  'unknownScheduleEntries',count(*) filter(where entity='entry' and facts->>'status'='ACTIVE' and facts->>'type' in ('RESERVA','ABONO','CLASE','EVENTO') and (facts->>'duration_min' is null or jsonb_array_length(facts->'courts')=0)),
  'tinyPriceClasses',count(*) filter(where entity='entry' and facts->>'status'='ACTIVE' and (facts->>'tiny_price')::boolean),
  'baseline',null,
  'current',jsonb_build_object('collected',(select coalesce(sum(amount_signed),0) from public.win_admin_ledger where source='APPS_SCRIPT' and kind='SALE'),
   'activityNet',(select coalesce(sum(win_net),0) from public.win_admin_activity where source='APPS_SCRIPT'),
   'expenses',(select coalesce(sum(-amount_signed),0) from public.win_admin_ledger where source='APPS_SCRIPT' and kind='EXPENSE'),
   'withdrawals',(select coalesce(sum(-amount_signed),0) from public.win_admin_ledger where source='APPS_SCRIPT' and kind='WITHDRAWAL'),
   'reservations',(select coalesce(sum(quantity),0) from public.win_admin_activity where source='APPS_SCRIPT' and type in ('RESERVA','ABONO')),
   'classes',(select coalesce(sum(quantity),0) from public.win_admin_activity where source='APPS_SCRIPT' and type='CLASE')))
 into result from public.win_history_rows;
 if to_regclass('public.win_resumen_admin') is not null then
  execute 'select to_jsonb(s) from public.win_resumen_admin s order by periodo_hasta desc limit 1' into baseline;
  result=jsonb_set(result,'{baseline}',coalesce(baseline,'null'::jsonb));
 end if;
 return result;
end $$;
revoke all on function public.win_history_status() from public,anon,authenticated;
grant execute on function public.win_history_status() to service_role;
