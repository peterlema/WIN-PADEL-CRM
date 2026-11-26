-- Real source data is supplied separately, never committed in this repository.
-- No financial, access-account or private Bar-account writes in this migration.
create table if not exists public.win_migration_rows (
 id uuid primary key default gen_random_uuid(), source_key text not null unique,
 source_file text not null, file_sha256 text not null, sheet text not null, cell text not null,
 kind text not null check(kind in('CLIENT','ABONO','WAITLIST')),
 status text not null check(status in('CONFIRMED','REVIEW','DUPLICATE','BAJA','RETURN_PENDING','POSSIBLE','INTERNAL')),
 original jsonb not null, data jsonb not null, reasons jsonb not null default '[]',
 customer_id uuid references public.win_customers(id), abono_id uuid references public.win_court_abonos(id),
 waitlist_id uuid references public.win_calendar_waitlist(id), revision int not null default 1,
 created_by uuid not null references win_auth.login_accounts(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.win_migration_rows enable row level security;
revoke all on public.win_migration_rows from public,anon,authenticated;
grant select,insert,update on public.win_migration_rows to service_role;
create index if not exists win_migration_kind_status_idx on public.win_migration_rows(kind,status);

create or replace function public.win_person_key(n text) returns text language sql immutable set search_path='' as $$
 select btrim(regexp_replace(lower(translate(coalesce(n,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^a-z]+',' ','g'))
$$;
create or replace function public.win_migration_near_phone(a text,b text) returns boolean language sql immutable set search_path='' as $$
 select a is not null and b is not null and length(a)=length(b) and length(a) between 10 and 15
  and (select count(*) from generate_series(1,length(a)) i where substr(a,i,1)<>substr(b,i,1))=1
$$;
-- A household can share a telephone. A phone match alone never selects a person.
drop index if exists public.win_customers_phone_uq;
create index if not exists win_customers_phone_search on public.win_customers(public.win_calendar_phone(phone));
create or replace function public.win_calendar_customer(a uuid,p jsonb,required_ boolean default true) returns uuid language plpgsql set search_path='' as $$
declare cid uuid:=nullif(p->>'customerId','')::uuid;n text:=btrim(coalesce(p->>'customerName',''));ph text:=public.win_calendar_phone(p->>'phone');old public.win_customers;cnt int;begin
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 if cid is not null then
  select * into old from public.win_customers where id=cid;
  if not found then raise exception 'CUSTOMER_REQUIRED';end if;
  if required_ and public.win_calendar_phone(old.phone) is null then
   if ph is null then raise exception 'CUSTOMER_REQUIRED';end if;
   update public.win_customers set phone=ph,updated_at=now() where id=cid;
   insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(a,'CALENDAR_CUSTOMER_ENRICH','CALENDAR',cid::text,jsonb_build_object('before',to_jsonb(old),'phone',ph));
  end if;return cid;
 end if;
 if required_ and (length(n)<3 or ph is null) then raise exception 'CUSTOMER_REQUIRED';end if;
 if n='' and ph is null then return null;end if;
 select count(*),(array_agg(id))[1] into cnt,cid from public.win_customers where public.win_calendar_phone(phone)=ph and public.win_person_key(name)=public.win_person_key(n);
 if cnt=1 then return cid;end if;
 if cnt>1 or exists(select 1 from public.win_customers where public.win_calendar_phone(phone)=ph) then raise exception 'CUSTOMER_AMBIGUOUS';end if;
 if length(n) not between 2 and 120 then raise exception 'CUSTOMER_REQUIRED';end if;
 insert into public.win_customers(name,phone,first_name,last_name,note,created_by) values(n,ph,coalesce(p->>'firstName',''),coalesce(p->>'lastName',''),coalesce(p->>'customerNote',''),a) returning id into cid;
 return cid;
end $$;

-- Incomplete waitlist contacts are useful records, not invented customer identities.
alter table public.win_calendar_waitlist add column if not exists source_key text unique;
alter table public.win_calendar_waitlist add column if not exists contact_name text;
alter table public.win_calendar_waitlist add column if not exists contact_phone text;
alter table public.win_calendar_waitlist add column if not exists channel text not null default '';
alter table public.win_calendar_waitlist add column if not exists referral text not null default '';
alter table public.win_calendar_waitlist add column if not exists requested_days text not null default '';
alter table public.win_calendar_waitlist add column if not exists requested_times text not null default '';
alter table public.win_calendar_waitlist alter column customer_id drop not null;
alter table public.win_calendar_waitlist alter column duration_min drop not null;
alter table public.win_calendar_waitlist drop constraint if exists win_calendar_waitlist_weekdays_check;
alter table public.win_calendar_waitlist add constraint win_calendar_waitlist_weekdays_check check((cardinality(weekdays) between 1 and 7 and weekdays<@array[1,2,3,4,5,6,7]) or (source_key is not null and cardinality(weekdays)=0));
alter table public.win_calendar_waitlist drop constraint if exists win_calendar_waitlist_windows_check;
alter table public.win_calendar_waitlist add constraint win_calendar_waitlist_windows_check check(jsonb_typeof(windows)='array' and (jsonb_array_length(windows) between 1 and 14 or(source_key is not null and windows='[]')));
alter table public.win_calendar_waitlist drop constraint if exists win_waitlist_identity_required;
alter table public.win_calendar_waitlist add constraint win_waitlist_identity_required check(source_key is not null or(customer_id is not null and duration_min is not null));

create or replace function public.win_migration_apply(row_id uuid,actor uuid) returns void language plpgsql set search_path='' as $$
declare r public.win_migration_rows;d jsonb;cid uuid;aid uuid;wid uuid;dt date;st time;dur int;cnt int;customer public.win_customers;begin
 select * into r from public.win_migration_rows where id=row_id for update;d=r.data;
 if r.kind='CLIENT' and r.status='CONFIRMED' and r.customer_id is null then
  if length(public.win_person_key(d->>'name'))<3 or d->>'phone' !~ '^[0-9]{10,15}$' or d->>'phone' is null then raise exception 'CUSTOMER_REQUIRED';end if;
  select count(*),(array_agg(id))[1] into cnt,cid from public.win_customers where public.win_person_key(name)=public.win_person_key(d->>'name') and public.win_calendar_phone(phone)=d->>'phone';
  if cnt>1 or (cid is null and exists(select 1 from public.win_customers where public.win_person_key(name)=public.win_person_key(d->>'name') or public.win_calendar_phone(phone)=d->>'phone'
   or (regexp_replace(public.win_person_key(name),'^.* ','')=regexp_replace(public.win_person_key(d->>'name'),'^.* ','') and public.win_migration_near_phone(public.win_calendar_phone(phone),d->>'phone')))) then
   update public.win_migration_rows set status='REVIEW',reasons='["Coincidencia con cliente existente que requiere selección explícita"]' where id=r.id;return;
  end if;
  if cid is null then insert into public.win_customers(name,phone,note,created_by) values(d->>'name',d->>'phone','Origen: Playmix · ficha sin pagos históricos',actor) returning id into cid;end if;
  update public.win_migration_rows set customer_id=cid where id=r.id;
 elsif r.kind='ABONO' and r.status='CONFIRMED' and r.abono_id is null then
  cid=coalesce(nullif(d->>'customerId','')::uuid,(select customer_id from public.win_migration_rows where source_key=d->>'clientSourceKey' and kind='CLIENT' and status='CONFIRMED'));
  select * into customer from public.win_customers where id=cid;
  if customer.id is null or public.win_calendar_phone(customer.phone) is null then
   update public.win_migration_rows set status='REVIEW',reasons='["Seleccionar cliente validado con teléfono"]' where id=r.id;return;
  end if;
  dt=greatest(coalesce(nullif(d->>'startsOn','')::date,'2026-12-01'::date),(now() at time zone 'America/Argentina/Buenos_Aires')::date);
  dt=dt+(((d->>'weekday')::int-extract(isodow from dt)::int+7)%7);
  st=nullif(d->>'start','')::time;dur=nullif(d->>'duration','')::int;
  if st is null or dur is null or dur<15 or dur>720 or dur%15<>0 or (d->>'weekday')::int not between 1 and 7 or d->>'court' not in('C1','C2','C3','C4') then raise exception 'BOOKING_INVALID';end if;
  if public.win_abono_minutes_(st)<coalesce((select value from public.win_settings where key='GRID_OPEN_MIN'),480) or public.win_abono_minutes_(st)+dur>coalesce((select value from public.win_settings where key='GRID_CLOSE_MIN'),1500) then raise exception 'OUTSIDE_HOURS';end if;
  if exists(select 1 from public.win_ops_resources res join public.win_ops_records op on op.id=res.operation_id where res.active and op.status='ACTIVE' and op.activity_date>=dt and extract(isodow from op.activity_date)::int=(d->>'weekday')::int and res.court=d->>'court' and tstzrange(res.starts_at,res.ends_at,'[)')&&tstzrange(public.win_courts_starts_at_(op.activity_date,st),public.win_courts_starts_at_(op.activity_date,st)+make_interval(mins=>dur),'[)')) then
   update public.win_migration_rows set status='REVIEW',reasons='["Conflicto con actividad existente"]' where id=r.id;return;
  end if;
  begin
   insert into public.win_court_abonos(request_id,court,weekday,start_time,duration_min,customer_name,customer_whatsapp,starts_on,note,created_by,customer_id,calendar_managed)
   values(r.id,d->>'court',(d->>'weekday')::int,st,dur,customer.name,public.win_calendar_phone(customer.phone),dt,left(coalesce(d->>'note',''),400),actor,cid,true) returning id into aid;
  exception when raise_exception then
   if sqlerrm='ABONO_CONFLICT' then update public.win_migration_rows set status='REVIEW',reasons='["Conflicto con reserva, clase o abono existente"]' where id=r.id;return;else raise;end if;
  end;
  update public.win_migration_rows set customer_id=cid,abono_id=aid where id=r.id;
 elsif r.kind='WAITLIST' and r.waitlist_id is null then
  cid=(select customer_id from public.win_migration_rows where source_key=d->>'clientSourceKey' and kind='CLIENT' and status='CONFIRMED');
  insert into public.win_calendar_waitlist(customer_id,weekdays,windows,duration_min,court,note,created_by,source_key,contact_name,contact_phone,channel,referral,requested_days,requested_times)
  values(cid,'{}','[]',null,null,'Solicitud importada: revisar disponibilidad y duración antes de acordar',actor,r.source_key,d->>'name',d->>'phone',coalesce(d->>'channel',''),coalesce(d->>'reference',''),coalesce(d->>'days',''),coalesce(d->'times','[]')::text) returning id into wid;
  update public.win_migration_rows set customer_id=cid,waitlist_id=wid where id=r.id;
 end if;
end $$;

create or replace function public.win_first_migration_import(p_actor uuid,p_rows jsonb) returns jsonb language plpgsql set search_path='' as $$
declare obj jsonb;r public.win_migration_rows;inserted int:=0;begin
 if not exists(select 1 from win_auth.login_accounts where id=p_actor and enabled and role='ADMIN') then raise exception 'NOT_AUTHORIZED';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'IMPORT_INVALID';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 for obj in select * from jsonb_array_elements(p_rows) loop
  select * into r from public.win_migration_rows where source_key=obj->>'sourceKey';
  if found then
   if r.file_sha256 is distinct from obj->>'sha256' or r.kind is distinct from obj->>'kind' or r.original->'raw' is distinct from obj->'raw' then raise exception 'IMPORT_SOURCE_CHANGED';end if;
   -- Derived classifications can change when a preview sees already imported
   -- customers. The original source is stable; never overwrite reviewed rows.
   continue;
  end if;
  insert into public.win_migration_rows(source_key,source_file,file_sha256,sheet,cell,kind,status,original,data,reasons,created_by)
  values(obj->>'sourceKey',obj->>'file',obj->>'sha256',obj->>'sheet',obj->>'cell',obj->>'kind',obj->>'status',obj,obj,coalesce(obj->'reasons','[]'),p_actor) returning * into r;
  perform public.win_migration_apply(r.id,p_actor);inserted=inserted+1;
 end loop;
 if inserted>0 then insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(p_actor,'FIRST_MIGRATION_IMPORT','MIGRATION','20261126',jsonb_build_object('rows',inserted,'financialWrites',false));end if;
 return jsonb_build_object('inserted',inserted,'total',(select count(*) from public.win_migration_rows));
end $$;

create or replace function public.win_migration_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare actor uuid;role_ text;r public.win_migration_rows;prior public.win_calendar_requests;req uuid;result jsonb;d jsonb;begin
 actor=public.win_calendar_actor(p_token);select role into role_ from public.win_pin_session(p_token);
 if p_action='registry.list' then
  if p->>'kind'='CLIENT' and role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(m)-'original' order by m.sheet,m.cell) from public.win_migration_rows m where m.kind=coalesce(p->>'kind','ABONO') and (m.kind<>'CLIENT' or m.status in('REVIEW','DUPLICATE'))),'[]'),
   'series',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('nextDate',x.dt::date,'nextId','a:'||a.id||':'||x.dt::date,'paid',coalesce((select sum(cp.amount) from public.win_court_payments cp where cp.abono_id=a.id),0)) order by weekday,start_time,court) from public.win_court_abonos a left join lateral(select dt from generate_series(greatest(a.starts_on,(now() at time zone 'America/Argentina/Buenos_Aires')::date)::timestamp,greatest(a.starts_on,(now() at time zone 'America/Argentina/Buenos_Aires')::date)+interval '370 day','1 day')dt where extract(isodow from dt)::int=a.weekday and(a.ends_on is null or dt::date<=a.ends_on) and not exists(select 1 from public.win_court_abono_skips sk where sk.abono_id=a.id and sk.skip_date=dt::date) order by dt limit 1)x on true),'[]'),
   'waitlist',coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('name',coalesce(w.contact_name,c.name),'phone',coalesce(w.contact_phone,c.phone)) order by w.created_at,w.id) from public.win_calendar_waitlist w left join public.win_customers c on c.id=w.customer_id),'[]'),
   'counts',coalesce((select jsonb_agg(to_jsonb(x)) from(select kind,status,count(*) count from public.win_migration_rows group by kind,status)x),'[]'));
 end if;
 if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if p_action<>'registry.save' then raise exception 'ACTION_INVALID';end if;
 req=(p->>'requestId')::uuid;if req is null then raise exception 'REQUEST_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select * into prior from public.win_calendar_requests where request_id=req;
 if found then if prior.actor_id<>actor or prior.action<>p_action or prior.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;return prior.result;end if;
 select * into r from public.win_migration_rows where id=(p->>'id')::uuid for update;
 if not found then raise exception 'IMPORT_ROW_NOT_FOUND';end if;
 if r.revision<>coalesce((p->>'revision')::int,-1) then raise exception 'STALE_REVISION';end if;
 if length(btrim(coalesce(p->>'reason','')))<5 then raise exception 'REASON_REQUIRED';end if;
 if r.kind<>'ABONO' and coalesce(p->>'status',r.status) not in('CONFIRMED','REVIEW','DUPLICATE') then raise exception 'IMPORT_STATUS_INVALID';end if;
 if r.abono_id is not null or r.customer_id is not null and r.kind='CLIENT' then raise exception 'IMPORT_EDIT_AT_ORIGIN';end if;
 d=r.data||jsonb_strip_nulls(jsonb_build_object('name',p->>'name','phone',p->>'phone','note',p->>'note','customerId',nullif(p->>'customerId',''),'court',p->>'court','weekday',p->'weekday','start',p->>'start','duration',p->'duration','days',p->>'days','times',p->'times'));
 update public.win_migration_rows set data=d,status=coalesce(p->>'status',r.status),reasons='[]',revision=revision+1,updated_at=now() where id=r.id;
 if r.waitlist_id is not null then
  update public.win_calendar_waitlist set contact_name=d->>'name',contact_phone=d->>'phone',requested_days=coalesce(d->>'days',''),requested_times=coalesce(d->'times','[]')::text,updated_at=now() where id=r.waitlist_id;
 else perform public.win_migration_apply(r.id,actor);end if;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)values(actor,'MIGRATION_REVIEW','MIGRATION',r.id::text,jsonb_build_object('before',to_jsonb(r),'reason',p->>'reason','after',(select to_jsonb(m)-'original' from public.win_migration_rows m where id=r.id)));
 select to_jsonb(m)-'original' into result from public.win_migration_rows m where id=r.id;
 insert into public.win_calendar_requests(request_id,actor_id,action,payload,result)values(req,actor,p_action,p,result);return result;
end $$;

-- Add dispatch without replacing the existing calendar/move/payment implementation.
do $$declare definition text;begin
 select pg_get_functiondef('public.win_calendar_api(text,text,jsonb)'::regprocedure) into definition;
 if position('public.win_migration_api' in definition)=0 then
  definition=replace(definition,E'begin\n a=public.win_calendar_actor',E'begin\n if p_action like ''registry.%'' then return public.win_migration_api(p_token,p_action,p);end if;\n a=public.win_calendar_actor');
  if position('public.win_migration_api' in definition)=0 then raise exception 'CALENDAR_DISPATCH_NOT_FOUND';end if;
  definition=replace(definition,'do update set weekdays=excluded.weekdays','do update set customer_id=excluded.customer_id,weekdays=excluded.weekdays');
  execute definition;
 end if;
end $$;
revoke all on function public.win_migration_apply(uuid,uuid),public.win_first_migration_import(uuid,jsonb),public.win_migration_api(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.win_migration_apply(uuid,uuid),public.win_first_migration_import(uuid,jsonb),public.win_migration_api(text,text,jsonb) to service_role;
