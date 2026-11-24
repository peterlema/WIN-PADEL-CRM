-- Move only scheduling fields. Existing court/teacher/availability guards remain authoritative.
CREATE OR REPLACE FUNCTION public.win_calendar_booking_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare series public.win_court_abonos;begin
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 if new.status<>'CONFIRMED' then return new;end if;
 if new.calendar_managed and new.performed_at is null and exists(select 1 from public.win_ops_availability v where v.business_date=new.business_date and v.court=new.court and (new.starts_at<v.starts_at or new.ends_at>v.ends_at)) then raise exception 'OUTSIDE_HOURS';end if;
 if exists(select 1 from public.win_court_abonos a where a.id is distinct from new.source_abono_id and a.court=new.court and a.weekday=extract(isodow from new.business_date)::int and a.starts_on<=new.business_date and (a.ends_on is null or a.ends_on>=new.business_date)
  and not exists(select 1 from public.win_court_abono_skips sk where sk.abono_id=a.id and sk.skip_date=new.business_date)
  -- A moved, materialized occurrence replaces this date only; the weekly series stays unchanged.
  and not exists(select 1 from public.win_court_bookings moved where moved.source_abono_id=a.id and moved.business_date=new.business_date and moved.status='CONFIRMED' and (moved.court<>a.court or moved.start_time<>a.start_time))
  and tstzrange(public.win_courts_starts_at_(new.business_date,a.start_time),public.win_courts_starts_at_(new.business_date,a.start_time)+make_interval(mins=>a.duration_min),'[)')&&tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'ABONO_CONFLICT';end if;
 if exists(select 1 from public.win_ops_resources r join public.win_ops_records o on o.id=r.operation_id where r.active and r.court=new.court and o.booking_id is distinct from new.id and (new.source_abono_id is null or o.abono_id is distinct from new.source_abono_id or o.activity_date<>new.business_date) and tstzrange(r.starts_at,r.ends_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'COURT_TAKEN';end if;
 if new.teacher_id is not null and (exists(select 1 from public.win_court_bookings b where b.id<>new.id and b.status='CONFIRMED' and b.teacher_id=new.teacher_id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)'))
  or exists(select 1 from public.win_ops_records o where o.status='ACTIVE' and o.type='CLASE' and o.teacher_id=new.teacher_id and o.booking_id is distinct from new.id and tstzrange(public.win_courts_starts_at_(o.activity_date,o.start_time),public.win_courts_starts_at_(o.activity_date,o.start_time)+make_interval(mins=>o.duration_min),'[)')&&tstzrange(new.starts_at,new.ends_at,'[)'))) then raise exception 'COACH_OVERLAP';end if;
 return new;
end $function$
;
revoke all on function public.win_calendar_booking_guard() from public,anon,authenticated;
grant execute on function public.win_calendar_booking_guard() to service_role;

create or replace function public.win_calendar_move(p_token text,p jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare actor uuid; req uuid; prior public.win_calendar_requests; b public.win_court_bookings;
 before_ jsonb; result_ jsonb; old_date date; old_court text; old_start time;
 dt date; st time; court_ text; at_ timestamptz; finish_ timestamptz; fresh_virtual boolean:=false;
 bar_ids jsonb; candidate public.win_court_bookings;
begin
 actor=public.win_calendar_actor(p_token,'CREATE');
 req=nullif(p->>'requestId','')::uuid;
 if req is null then raise exception 'REQUEST_REQUIRED';end if;
 -- Match the common lock order used by booking, cash, academy and calendar writes.
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select * into prior from public.win_calendar_requests where request_id=req;
 if found then
  if prior.actor_id<>actor or prior.action<>'move' or prior.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;
  return prior.result;
 end if;
 dt=nullif(p->>'date','')::date;court_=p->>'court';
 if coalesce(p->>'start','')!~'^([01][0-9]|2[0-3]):(00|15|30|45)$' or dt is null or court_ is null or court_ not in('C4','C3','C2','C1') or coalesce(p->>'id','')='' then raise exception 'BOOKING_INVALID';end if;
 st=(p->>'start')::time;
 if left(p->>'id',2)='a:' then
  fresh_virtual=not exists(select 1 from public.win_court_bookings where source_abono_id=split_part(p->>'id',':',2)::uuid and business_date=split_part(p->>'id',':',3)::date);
 end if;
 -- Future abonos are projected. Resolve only on confirmed save, using the existing occurrence resolver.
 b=public.win_calendar_resolve(actor,p->>'id');before_=public.win_calendar_json(b);
 if (before_->>'status')<>'SCHEDULED' or b.kind not in('RESERVA','CLASE') or b.starts_at<=now() then raise exception 'MOVE_NOT_ALLOWED';end if;
 if coalesce((p->>'revision')::int,-1)<>(case when fresh_virtual then 0 else b.revision end)
  or p->'from'->>'date' is distinct from b.business_date::text
  or p->'from'->>'court' is distinct from b.court
  or p->'from'->>'start' is distinct from to_char(b.start_time,'HH24:MI') then raise exception 'STALE_REVISION';end if;
 -- Keeping the commercial date preserves legacy abono payments, skips and occurrence identity.
 if b.source_abono_id is not null and (coalesce(p->>'scope','')<>'occurrence' or dt<>b.business_date) then raise exception 'ABONO_MOVE_SCOPE';end if;
 if b.teacher_id is not null and not exists(select 1 from public.win_coaches where id=b.teacher_id and active) then raise exception 'COACH_INVALID';end if;
 if b.kind='CLASE' and dt<>b.business_date then
  candidate=b;candidate.business_date=dt;
  if public.win_calendar_economics(candidate) is distinct from public.win_calendar_economics(b) then raise exception 'MOVE_CLASS_RATE_CHANGE';end if;
 end if;
 at_=public.win_courts_starts_at_(dt,st);finish_=at_+make_interval(mins=>b.duration_min);
 if at_<=now() then raise exception 'MOVE_IN_PAST';end if;
 if public.win_abono_minutes_(st)<coalesce((select value from public.win_settings where key='GRID_OPEN_MIN'),480)
  or public.win_abono_minutes_(st)+b.duration_min>coalesce((select value from public.win_settings where key='GRID_CLOSE_MIN'),1500) then raise exception 'OUTSIDE_HOURS';end if;
 if dt=b.business_date and court_=b.court and st=b.start_time then raise exception 'MOVE_UNCHANGED';end if;
 old_date=b.business_date;old_court=b.court;old_start=b.start_time;
 -- No customer, class economics, participant, price, payment or cash columns are submitted or rewritten.
 update public.win_court_bookings set business_date=dt,court=court_,start_time=st,starts_at=at_,ends_at=finish_,revision=revision+1
  where id=b.id returning * into b;
 -- Pending Bar accounts follow their turn. Completed orders and every amount/payment stay unchanged.
 with moved as (
  update public.win_bar_orders set booking_id=b.id,court=court_,court_date=dt,court_start=st
  where status='OPEN' and destination='COURT'
   and (booking_id=b.id or (booking_id is null and court=old_court and court_date=old_date and court_start=old_start))
  returning id
 ) select coalesce(jsonb_agg(id),'[]') into bar_ids from moved;
 result_=public.win_calendar_json(b);
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)
 values(actor,'CALENDAR_MOVE','CALENDAR',b.id::text,jsonb_build_object(
  'bookingId',b.id,'before',before_,'after',result_,'scope',case when b.source_abono_id is not null then 'occurrence' else 'booking' end,
  'from',jsonb_build_object('date',old_date,'court',old_court,'start',to_char(old_start,'HH24:MI')),
  'to',jsonb_build_object('date',dt,'court',court_,'start',to_char(st,'HH24:MI')),
  'barOrderIds',bar_ids,'note',case when b.source_abono_id is not null then 'Se movió únicamente esta fecha del abono; la serie semanal no cambió.' else 'Actividad reubicada desde Calendario.' end));
 insert into public.win_calendar_requests values(req,actor,'move',p,result_,now());
 return result_;
exception when exclusion_violation then raise exception 'COURT_TAKEN';
end;$fn$;
revoke all on function public.win_calendar_move(text,jsonb) from public,anon,authenticated;
grant execute on function public.win_calendar_move(text,jsonb) to service_role;

