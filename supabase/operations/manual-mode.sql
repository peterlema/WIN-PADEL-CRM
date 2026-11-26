
-- Manual operation mode. Retire import entrypoints while retaining financial and calendar APIs.
create or replace function public.win_first_migration_import(p_actor uuid,p_rows jsonb) returns jsonb language plpgsql set search_path='' as $$begin raise exception 'IMPORT_DISABLED';end $$;
create or replace function public.win_migration_apply(row_id uuid,actor uuid) returns void language plpgsql set search_path='' as $$begin raise exception 'IMPORT_DISABLED';end $$;
create or replace function public.win_migration_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$begin raise exception 'IMPORT_DISABLED';end $$;
revoke all on function public.win_first_migration_import(uuid,jsonb),public.win_migration_apply(uuid,uuid),public.win_migration_api(text,text,jsonb) from public,anon,authenticated,service_role;
-- The old route can still return a concrete error to previously open browser tabs.
grant execute on function public.win_migration_api(text,text,jsonb) to service_role;
create or replace function public.win_history_status() returns jsonb language sql stable set search_path='' as $$select '{}'::jsonb$$;
create or replace function public.win_imported_snapshot(p_token text) returns jsonb language plpgsql set search_path='' as $$begin raise exception 'IMPORT_DISABLED';end $$;
revoke all on function public.win_history_status(),public.win_imported_snapshot(text) from public,anon,authenticated;
grant execute on function public.win_history_status(),public.win_imported_snapshot(text) to service_role;
-- Preserve every current native branch, including independent Caja Bar entries.
do $views$ declare v text;definition text;begin
 foreach v in array array['win_admin_ledger','win_admin_activity'] loop
  select pg_get_viewdef(to_regclass('public.'||v),true) into definition;
  if position('manual_live_only' in definition)=0 then
   definition=regexp_replace(definition,';[[:space:]]*$','');
   execute format('create or replace view public.%I with(security_invoker=true) as select * from (%s) manual_live_only where manual_live_only.source is distinct from ''APPS_SCRIPT''',v,definition);
  end if;
 end loop;
end $views$;

-- Report native Bar cash separately from Recepción; never copy or modify money.
do $bar_view$declare definition text;begin
 if to_regclass('public.win_bar_cash_movements') is not null then
  select pg_get_viewdef('public.win_admin_ledger'::regclass,true) into definition;
  if position('LIVE_BAR_NATIVE' in definition)=0 then
   definition=regexp_replace(definition,';[[:space:]]*$','');
   execute format($ddl$create or replace view public.win_admin_ledger with(security_invoker=true) as
    select * from (%s) native_existing
    union all
    select 'bar-native:'||m.id::text,m.shift_id::text,m.recorded_by,m.occurred_at,m.kind,'CAFE_BAR'::text,
     m.payment_method,m.amount_signed,m.note,(m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date,
     case m.kind when 'SALE' then 'CAFE_BAR' when 'EXPENSE' then 'GASTO' when 'WITHDRAWAL' then 'RETIRO' else m.kind end,
     a.display_name,'LIVE_BAR_NATIVE'::text,null::text,null::text,(o.created_at at time zone 'America/Argentina/Buenos_Aires')::date
    from public.win_bar_cash_movements m left join win_auth.login_accounts a on a.id=m.recorded_by
    left join public.win_bar_orders o on o.id=m.order_id
    where not exists(select 1 from public.win_cash_movements legacy where legacy.request_id=m.request_id)
    and not exists(select 1 from public.win_bar_order_payments p join public.win_cash_movements legacy on legacy.id=p.cash_movement_id where p.bar_cash_movement_id=m.id)
   $ddl$,definition);
  end if;
 end if;
end $bar_view$;

create or replace function public.win_ops_admin(p_token text,p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare actor uuid;role_ text;report jsonb;first_date date;last_date date;begin
 actor=public.win_ops_actor(p_token);select role into role_ from public.win_pin_session(p_token);
 if role_ is distinct from 'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 report=public.win_admin_report_((p->>'start')::date,(p->>'end')::date);
 select min(d),max(d) into first_date,last_date from(
  select business_date d from public.win_admin_ledger union all select activity_date from public.win_admin_activity
 )dates;
 return (report-'history'-'historicalShifts')||jsonb_build_object('history','{}'::jsonb,'historicalShifts','[]'::jsonb,'coverage',jsonb_build_object('start',first_date,'end',last_date));
end $$;
revoke all on function public.win_ops_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.win_ops_admin(text,jsonb) to service_role;

-- Explicitly requested weekly classes reuse the existing creation/validation path.
-- A chosen end date is mandatory. No activity, teacher debt or cash is recorded here.
create or replace function public.win_calendar_class_series(p_token text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;req uuid;prior public.win_calendar_requests;first_ date;last_ date;dt date;child jsonb;result jsonb;bookings jsonb:='[]';begin
 actor=public.win_calendar_actor(p_token,'CREATE');req=nullif(p->>'requestId','')::uuid;
 if req is null then raise exception 'REQUEST_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select * into prior from public.win_calendar_requests where request_id=req;
 if found then if prior.actor_id<>actor or prior.action<>'class.series.create' or prior.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;return prior.result;end if;
 first_=nullif(p->>'date','')::date;last_=nullif(p->>'classUntil','')::date;
 if first_ is null or last_ is null or first_<(now() at time zone 'America/Argentina/Buenos_Aires')::date or last_<first_ or last_>first_+366 or p->>'kind' is distinct from 'CLASE' then raise exception 'CLASS_SERIES_INVALID';end if;
 dt=first_;
 while dt<=last_ loop
  child=public.win_calendar_api(p_token,'create',(p-'classUntil'-'repeatClass')||jsonb_build_object('requestId',gen_random_uuid(),'date',dt,'lesson',coalesce(p->'lesson','{}')||jsonb_build_object('manualSeriesId',req,'manualSeriesUntil',last_,'manualSeriesCadence','WEEKLY')));
  bookings=bookings||jsonb_build_array(child);dt=dt+7;
 end loop;
 result=jsonb_build_object('id',req,'date',first_,'kind','CLASS_SERIES','count',jsonb_array_length(bookings),'bookings',bookings);
 insert into public.win_calendar_requests(request_id,actor_id,action,payload,result)values(req,actor,'class.series.create',p,result);
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)values(actor,'MANUAL_CLASS_SERIES','CALENDAR',req::text,jsonb_build_object('from',first_,'until',last_,'count',jsonb_array_length(bookings),'financialWrites',false));
 return result;
end $$;
revoke all on function public.win_calendar_class_series(text,jsonb) from public,anon,authenticated;
grant execute on function public.win_calendar_class_series(text,jsonb) to service_role;
do $dispatch$declare definition text;begin
 select pg_get_functiondef('public.win_calendar_api(text,text,jsonb)'::regprocedure) into definition;
 if position('public.win_calendar_class_series' in definition)=0 then
  definition=replace(definition,E'begin\n',E'begin\n if p_action=''class.series.create'' then return public.win_calendar_class_series(p_token,p);end if;\n');
  if position('public.win_calendar_class_series' in definition)=0 then raise exception 'CALENDAR_DISPATCH_NOT_FOUND';end if;
  execute definition;
 end if;
end $dispatch$;
