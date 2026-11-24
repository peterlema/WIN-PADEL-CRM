-- M05, incremental sobre las mismas tablas operativas. Aplicar sólo tras aprobar el corte.
-- No contiene tarifas, clientes ni movimientos de ejemplo.
alter table public.win_customers add column if not exists first_name text not null default '';
alter table public.win_customers add column if not exists last_name text not null default '';
alter table public.win_customers add column if not exists note text not null default '';
alter table public.win_customers add column if not exists updated_at timestamptz;
create or replace function public.win_calendar_phone(p text) returns text language plpgsql immutable set search_path='' as $$
declare n text:=regexp_replace(coalesce(p,''),'[^0-9]','','g');begin
 if n='' then return null;end if;
 if left(n,2)='00' then n=substr(n,3);end if;
 if length(n)=11 and left(n,1)='0' then n=substr(n,2);end if;
 if length(n)=10 then n='549'||n;elsif length(n)=12 and left(n,2)='54' then n='549'||substr(n,3);end if;
 if length(n) not between 8 and 15 then raise exception 'PHONE_INVALID';end if;return n;
end $$;
-- Nombres iguales no significan la misma persona. Bar usa su búsqueda explícita, no esta unicidad.
drop index if exists public.win_customers_name_unique;
create unique index if not exists win_customers_phone_uq on public.win_customers(public.win_calendar_phone(phone)) where public.win_calendar_phone(phone) is not null;
create index if not exists win_customers_name_search on public.win_customers(lower(name));

alter table public.win_court_abonos add column if not exists customer_id uuid references public.win_customers(id);
alter table public.win_court_abonos add column if not exists agreed_amount numeric(14,2) check(agreed_amount>=0);
alter table public.win_court_abonos add column if not exists calendar_managed boolean not null default false;
alter table public.win_court_bookings add column if not exists customer_id uuid references public.win_customers(id);
alter table public.win_court_bookings add column if not exists source_abono_id uuid references public.win_court_abonos(id);
alter table public.win_court_bookings add column if not exists calendar_managed boolean not null default false;
alter table public.win_court_bookings add column if not exists revision int not null default 1;
alter table public.win_court_bookings add column if not exists performed_at timestamptz;
alter table public.win_court_bookings add column if not exists performed_by uuid references win_auth.login_accounts(id);
alter table public.win_court_bookings add column if not exists lesson jsonb not null default '{}';
alter table public.win_court_bookings add column if not exists teacher_id uuid references public.win_coaches(id);
create unique index if not exists win_calendar_abono_date_uq on public.win_court_bookings(source_abono_id,business_date) where source_abono_id is not null;
create index if not exists win_calendar_customer_idx on public.win_court_bookings(customer_id,business_date);
create index if not exists win_calendar_teacher_idx on public.win_court_bookings(teacher_id,starts_at) where status='CONFIRMED';
create index if not exists win_calendar_pending_idx on public.win_court_bookings(ends_at) where status='CONFIRMED' and performed_at is null;
alter table public.win_court_bookings drop constraint if exists win_court_bookings_start_time_check;
alter table public.win_court_bookings add constraint win_court_bookings_start_time_check check(extract(second from start_time)=0);
alter table public.win_court_bookings drop constraint if exists win_court_bookings_duration_min_check;
alter table public.win_court_bookings add constraint win_court_bookings_duration_min_check check(duration_min between 15 and 720 and duration_min%15=0);
alter table public.win_court_abonos drop constraint if exists win_court_abonos_start_time_check;
alter table public.win_court_abonos add constraint win_court_abonos_start_time_check check(extract(second from start_time)=0);
alter table public.win_court_abonos drop constraint if exists win_court_abonos_duration_min_check;
alter table public.win_court_abonos add constraint win_court_abonos_duration_min_check check(duration_min between 15 and 720 and duration_min%15=0);
-- Una actividad confirmada no necesita una caja abierta, porque no cobra dinero.
alter table public.win_ops_records alter column shift_id drop not null;
alter table public.win_ops_records drop constraint if exists win_calendar_activity_without_shift;
alter table public.win_ops_records add constraint win_calendar_activity_without_shift check(shift_id is not null or (type in('RESERVA','ABONO','CLASE') and played and cash=0 and transfer=0 and refund_cash=0));

-- Mantener el cobro original inmutable; únicamente las aplicaciones cambian de destino.
drop index if exists public.win_court_payments_booking_uq;
drop index if exists public.win_court_payments_abono_uq;
create index if not exists win_court_payments_booking_idx on public.win_court_payments(booking_id);
create index if not exists win_court_payments_abono_idx on public.win_court_payments(abono_id,occurrence_date);
alter table public.win_court_payments add column if not exists note text not null default '' check(length(note)<=400);
create table if not exists public.win_calendar_allocations (
 payment_id uuid not null references public.win_court_payments(id),
 booking_id uuid not null references public.win_court_bookings(id),
 amount numeric(14,2) not null check(amount>0), primary key(payment_id,booking_id)
);
create index if not exists win_calendar_allocations_booking_idx on public.win_calendar_allocations(booking_id);
create table if not exists public.win_calendar_participants (
 booking_id uuid not null references public.win_court_bookings(id),customer_id uuid not null references public.win_customers(id),primary key(booking_id,customer_id)
);
create table if not exists public.win_calendar_requests (
 request_id uuid primary key,actor_id uuid not null references win_auth.login_accounts(id),action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.win_calendar_waitlist (
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.win_customers(id),
 weekdays int[] not null check(cardinality(weekdays) between 1 and 7 and weekdays<@array[1,2,3,4,5,6,7]),
 windows jsonb not null check(jsonb_typeof(windows)='array' and jsonb_array_length(windows) between 1 and 14),
 duration_min int not null check(duration_min between 15 and 720 and duration_min%15=0),
 court text check(court in('C1','C2','C3','C4')),
 note text not null default '' check(length(note)<=400),
 status text not null default 'PENDING' check(status in('PENDING','CONTACTED','AGREED','CLOSED')),
 abono_id uuid references public.win_court_abonos(id),created_by uuid not null references win_auth.login_accounts(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists win_calendar_waitlist_pending_idx on public.win_calendar_waitlist(created_at) where status in('PENDING','CONTACTED');
create table if not exists public.win_calendar_opportunities (
 id uuid primary key default gen_random_uuid(),waitlist_id uuid not null references public.win_calendar_waitlist(id),
 abono_id uuid not null references public.win_court_abonos(id),available_from date not null,created_at timestamptz not null default now(),unique(waitlist_id,abono_id,available_from)
);
do $$declare t text;begin
 foreach t in array array['win_calendar_allocations','win_calendar_participants','win_calendar_requests','win_calendar_waitlist','win_calendar_opportunities'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

create or replace function public.win_calendar_actor(t text,operation text default 'VIEW') returns uuid language plpgsql stable set search_path='' as $$
declare a uuid;begin
 select account_id into a from public.win_pin_session(t);if a is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(a,'COURTS',operation) then raise exception 'NOT_AUTHORIZED';end if;return a;
end $$;
create or replace function public.win_calendar_paid(id_ uuid) returns numeric language sql stable set search_path='' as $$
 select coalesce(sum(al.amount),0)+coalesce((select sum(o.cash+o.transfer) from public.win_ops_records o where o.booking_id=id_ and o.status='ACTIVE'),0)
 from public.win_calendar_allocations al where al.booking_id=id_
$$;
create or replace function public.win_calendar_customer(a uuid,p jsonb,required_ boolean default true) returns uuid language plpgsql set search_path='' as $$
declare cid uuid:=nullif(p->>'customerId','')::uuid;n text:=btrim(coalesce(p->>'customerName',''));ph text:=public.win_calendar_phone(p->>'phone');old public.win_customers;begin
 if cid is not null then
  select * into old from public.win_customers where id=cid;
  if not found or (required_ and old.phone is null) then raise exception 'CUSTOMER_REQUIRED';end if;return cid;
 end if;
 if required_ and (length(n)<3 or ph is null) then raise exception 'CUSTOMER_REQUIRED';end if;
 if n='' and ph is null then return null;end if;
 if ph is not null then select id into cid from public.win_customers where public.win_calendar_phone(phone)=ph;end if;
 if cid is not null then return cid;end if;
 if length(n) not between 2 and 120 then raise exception 'CUSTOMER_REQUIRED';end if;
 insert into public.win_customers(name,phone,first_name,last_name,note,created_by) values(n,ph,coalesce(p->>'firstName',''),coalesce(p->>'lastName',''),coalesce(p->>'customerNote',''),a) returning id into cid;
 return cid;
end $$;

-- Un único orden de bloqueo para agenda, recepción y caja; incluye clientes antiguos abiertos.
create or replace function public.win_calendar_booking_guard() returns trigger language plpgsql set search_path='' as $$
declare series public.win_court_abonos;begin
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 if new.status<>'CONFIRMED' then return new;end if;
 if exists(select 1 from public.win_court_abonos a where a.id is distinct from new.source_abono_id and a.court=new.court and a.weekday=extract(isodow from new.business_date)::int and a.starts_on<=new.business_date and (a.ends_on is null or a.ends_on>=new.business_date)
  and not exists(select 1 from public.win_court_abono_skips sk where sk.abono_id=a.id and sk.skip_date=new.business_date)
  and tstzrange(public.win_courts_starts_at_(new.business_date,a.start_time),public.win_courts_starts_at_(new.business_date,a.start_time)+make_interval(mins=>a.duration_min),'[)')&&tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'ABONO_CONFLICT';end if;
 if exists(select 1 from public.win_ops_resources r join public.win_ops_records o on o.id=r.operation_id where r.active and r.court=new.court and o.booking_id is distinct from new.id and (new.source_abono_id is null or o.abono_id is distinct from new.source_abono_id or o.activity_date<>new.business_date) and tstzrange(r.starts_at,r.ends_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'COURT_TAKEN';end if;
 if new.teacher_id is not null and (exists(select 1 from public.win_court_bookings b where b.id<>new.id and b.status='CONFIRMED' and b.teacher_id=new.teacher_id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)'))
  or exists(select 1 from public.win_ops_records o where o.status='ACTIVE' and o.type='CLASE' and o.teacher_id=new.teacher_id and o.booking_id is distinct from new.id and tstzrange(public.win_courts_starts_at_(o.activity_date,o.start_time),public.win_courts_starts_at_(o.activity_date,o.start_time)+make_interval(mins=>o.duration_min),'[)')&&tstzrange(new.starts_at,new.ends_at,'[)'))) then raise exception 'COACH_OVERLAP';end if;
 return new;
end $$;
drop trigger if exists win_calendar_booking_guard on public.win_court_bookings;
create trigger win_calendar_booking_guard before insert or update on public.win_court_bookings for each row execute function public.win_calendar_booking_guard();

create or replace function public.win_calendar_allocation_guard() returns trigger language plpgsql set search_path='' as $$
declare total_ numeric;budget numeric;begin
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select coalesce((select l.amount_signed from public.win_ops_ledger l where l.reference_type='COURT_PAYMENT' and l.reference_id=p.id::text limit 1),p.amount) into budget from public.win_court_payments p where p.id=new.payment_id;
 select coalesce(sum(amount),0) into total_ from public.win_calendar_allocations where payment_id=new.payment_id and booking_id<>new.booking_id;
 if new.amount+total_>budget then raise exception 'ALLOCATION_EXCEEDS_PAYMENT';end if;return new;
end $$;
drop trigger if exists win_calendar_allocation_guard on public.win_calendar_allocations;
create trigger win_calendar_allocation_guard before insert or update on public.win_calendar_allocations for each row execute function public.win_calendar_allocation_guard();

-- No vuelve a asentar cobros anteriores. Sólo crea el vínculo operativo cuando ya había una reserva.
insert into public.win_calendar_allocations(payment_id,booking_id,amount)
 select id,booking_id,amount from public.win_court_payments where booking_id is not null on conflict do nothing;
create or replace function public.win_calendar_economics(b public.win_court_bookings) returns jsonb language plpgsql stable set search_path='' as $$
declare g numeric;pay numeric;pct numeric;configured numeric;pax int:=nullif(b.lesson->>'participants','')::int;begin
 select r.win_pct into configured from public.win_ops_coach_rates r where teacher_id=b.teacher_id and valid_from<=b.business_date order by valid_from desc limit 1;
 pct=coalesce(nullif(b.lesson->>'configuredPct','')::numeric,configured);
 if b.lesson->>'classKind'='PARTIDO' then
  return jsonb_build_object('gross',null,'teacherPay',null,'winNet',nullif(b.lesson->>'winAmount','')::numeric,'configuredPct',pct,'winPct',null);
 elsif coalesce((b.lesson->>'exception')::boolean,false) then
  g=nullif(b.lesson->>'gross','')::numeric;pay=nullif(b.lesson->>'teacherPay','')::numeric;
  if length(btrim(coalesce(b.lesson->>'exceptionReason','')))<5 or g is null or pay is null or g<0 or pay<0 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
  return jsonb_build_object('gross',g,'teacherPay',pay,'winNet',g-pay,'configuredPct',pct,'winPct',case when g>0 then round((g-pay)/g*100,2) end);
 end if;
 select amount_cash into g from public.win_price_list where code='CLASS_'||pax and duration_min=b.duration_min and valid_from<=b.business_date order by valid_from desc limit 1;
 if g is null or pct is null then return jsonb_build_object('error','No hay tarifa o porcentaje vigente para esa fecha y duración. Cargá una excepción acordada.');end if;
 return jsonb_build_object('gross',g,'teacherPay',g-round(g*pct/100,2),'winNet',round(g*pct/100,2),'configuredPct',pct,'winPct',pct);
end $$;

create or replace function public.win_calendar_json(b public.win_court_bookings) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'abonoId',b.source_abono_id,'date',b.business_date,'court',b.court,'start',to_char(b.start_time,'HH24:MI'),'end',to_char(b.ends_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI'),'startsAt',b.starts_at,'endsAt',b.ends_at,'duration',b.duration_min,
  'kind',case when b.source_abono_id is not null then 'ABONO' else b.kind end,'name',coalesce(b.customer_name,b.holder),'phone',b.customer_whatsapp,'customerId',b.customer_id,'note',b.note,'revision',b.revision,'teacherId',b.teacher_id,'lesson',b.lesson,
  'status',case when b.status='CANCELLED' then 'CANCELLED' when b.performed_at is not null or exists(select 1 from public.win_ops_records o where o.status='ACTIVE' and o.played and (o.booking_id=b.id or (o.abono_id=b.source_abono_id and o.activity_date=b.business_date))) then 'PERFORMED' else 'SCHEDULED' end,
  'price',b.expected_amount,'paid',public.win_calendar_paid(b.id),'balance',greatest(coalesce(b.expected_amount,0)-public.win_calendar_paid(b.id),0),
  'paymentStatus',case when public.win_calendar_paid(b.id)=0 and coalesce(b.expected_amount,1)>0 then 'PENDING' when b.expected_amount is not null and public.win_calendar_paid(b.id)>=b.expected_amount then 'PAID' else 'PARTIAL' end,
  'economics',case when b.kind='CLASE' then public.win_calendar_economics(b) end,'cancelReason',b.cancel_reason,'author',(select display_name from win_auth.login_accounts where id=b.created_by),
  'participants',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone)) from public.win_calendar_participants cp join public.win_customers c on c.id=cp.customer_id where cp.booking_id=b.id),'[]'),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount,'applied',al.amount,'method',p.method,'paidAt',p.paid_at,'originalBookingId',p.booking_id,'originalDate',coalesce(original.business_date,p.occurrence_date),'shiftId',m.shift_id,'shiftOwner',owner.display_name,'author',u.display_name,'note',p.note,'receiptPath',p.receipt_path) order by p.paid_at)
   from public.win_calendar_allocations al join public.win_court_payments p on p.id=al.payment_id left join public.win_court_bookings original on original.id=p.booking_id
   left join public.win_cash_movements m on m.reference_type='COURT_PAYMENT' and m.reference_id=p.id::text and m.reversal_of is null left join public.win_cash_shifts sh on sh.id=m.shift_id left join win_auth.login_accounts owner on owner.id=sh.opened_by
   join win_auth.login_accounts u on u.id=p.recorded_by where al.booking_id=b.id),'[]'))
$$;

-- Lectura sin escrituras: las ocurrencias futuras de un abono se proyectan desde su serie.
create or replace function public.win_calendar_rows(d1 date,d2 date) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(x.item order by x.item->>'date',x.item->>'start',x.item->>'court'),'[]') from (
  select public.win_calendar_json(b) item from public.win_court_bookings b where b.business_date between d1 and d2
  union all
  select jsonb_build_object('id','a:'||a.id||':'||d::date,'abonoId',a.id,'date',d::date,'court',a.court,'start',to_char(a.start_time,'HH24:MI'),'end',to_char(a.start_time+make_interval(mins=>a.duration_min),'HH24:MI'),
   'startsAt',public.win_courts_starts_at_(d::date,a.start_time),'endsAt',public.win_courts_starts_at_(d::date,a.start_time)+make_interval(mins=>a.duration_min),'duration',a.duration_min,'kind','ABONO','name',a.customer_name,'phone',a.customer_whatsapp,'customerId',a.customer_id,'note',a.note,'revision',0,
   'status',case when sk.abono_id is not null then 'CANCELLED' when exists(select 1 from public.win_ops_records o where o.abono_id=a.id and o.activity_date=d::date and o.played and o.status='ACTIVE') then 'PERFORMED' else 'SCHEDULED' end,
   'cancelReason',sk.reason,'price',coalesce(a.agreed_amount,public.win_court_price_(d::date,a.expected_method,a.duration_min)),
   'paid',coalesce((select sum(p.amount) from public.win_court_payments p where p.abono_id=a.id and p.occurrence_date=d::date),0)+coalesce((select sum(o.cash+o.transfer) from public.win_ops_records o where o.abono_id=a.id and o.payment_date=d::date and o.status='ACTIVE'),0),
   'paymentStatus','PENDING','payments','[]'::jsonb,'participants','[]'::jsonb)
  from public.win_court_abonos a cross join generate_series(d1,d2,interval '1 day')d left join public.win_court_abono_skips sk on sk.abono_id=a.id and sk.skip_date=d::date
  where a.weekday=extract(isodow from d)::int and d::date>=a.starts_on and (a.ends_on is null or d::date<=a.ends_on)
   and not exists(select 1 from public.win_court_bookings b where b.source_abono_id=a.id and b.business_date=d::date)
  union all
  select jsonb_build_object('id','op:'||o.id||':'||r.court,'date',o.activity_date,'court',r.court,'start',to_char(r.starts_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI'),'end',to_char(r.ends_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI'),'startsAt',r.starts_at,'endsAt',r.ends_at,'duration',extract(epoch from(r.ends_at-r.starts_at))/60,'kind',o.type,'name',coalesce(nullif(o.note,''),o.type),'status','PERFORMED','readOnly',true,'price',o.win_net,'paid',o.cash+o.transfer,'payments','[]'::jsonb)
  from public.win_ops_records o join public.win_ops_resources r on r.operation_id=o.id and r.active where o.status='ACTIVE' and o.activity_date between d1 and d2 and o.booking_id is null and o.abono_id is null
   and not exists(select 1 from public.win_court_bookings b where b.status='CONFIRMED' and b.court=r.court and b.starts_at=r.starts_at and b.ends_at=r.ends_at)
 )x
$$;

create or replace function public.win_calendar_resolve(a uuid,key_ text) returns public.win_court_bookings language plpgsql set search_path='' as $$
declare b public.win_court_bookings;s public.win_court_abonos;dt date;cid uuid;begin
 if left(key_,2)<>'a:' then
  select * into b from public.win_court_bookings where id=key_::uuid for update;
  if not found then raise exception 'BOOKING_NOT_FOUND';end if;return b;
 end if;
 dt=split_part(key_,':',3)::date;
 select * into s from public.win_court_abonos where id=split_part(key_,':',2)::uuid for update;
 if not found or dt<s.starts_on or (s.ends_on is not null and dt>s.ends_on) or extract(isodow from dt)::int<>s.weekday then raise exception 'BOOKING_NOT_FOUND';end if;
 select * into b from public.win_court_bookings where source_abono_id=s.id and business_date=dt;
 if found then return b;end if;
 if exists(select 1 from public.win_court_abono_skips where abono_id=s.id and skip_date=dt) then raise exception 'OCCURRENCE_SKIPPED';end if;
 cid=coalesce(s.customer_id,public.win_calendar_customer(a,jsonb_build_object('customerName',s.customer_name,'phone',s.customer_whatsapp)));
 insert into public.win_court_bookings(request_id,court,business_date,start_time,duration_min,starts_at,ends_at,kind,holder,note,created_by,customer_name,customer_whatsapp,customer_id,source_abono_id,calendar_managed,expected_amount,expected_method)
 values(gen_random_uuid(),s.court,dt,s.start_time,s.duration_min,public.win_courts_starts_at_(dt,s.start_time),public.win_courts_starts_at_(dt,s.start_time)+make_interval(mins=>s.duration_min),'RESERVA',s.customer_name,s.note,s.created_by,s.customer_name,s.customer_whatsapp,cid,s.id,true,coalesce(s.agreed_amount,public.win_court_price_(dt,s.expected_method,s.duration_min)),s.expected_method) returning * into b;
 insert into public.win_calendar_allocations select p.id,b.id,p.amount from public.win_court_payments p where p.abono_id=s.id and p.occurrence_date=dt on conflict do nothing;
 return b;
end $$;

create or replace function public.win_calendar_perform(a uuid,b public.win_court_bookings) returns uuid language plpgsql set search_path='' as $$
declare op public.win_ops_records; econ jsonb;net numeric;begin
 select * into op from public.win_ops_records where status='ACTIVE' and played and (booking_id=b.id or (abono_id=b.source_abono_id and activity_date=b.business_date)) for update;
 if b.kind='CLASE' then
  econ=public.win_calendar_economics(b);
  if econ ? 'error' then raise exception 'CLASS_PRICE_MISSING';end if;
  if econ->>'winNet' is null then raise exception 'CLASS_PRICE_MISSING';end if;
  net=(econ->>'winNet')::numeric;
 else net=b.expected_amount;if net is null then raise exception 'PRICE_MISSING';end if;end if;
 if op.id is null then
  insert into public.win_ops_records(request_id,shift_id,actor_id,type,activity_date,start_time,duration_min,courts,played,booking_id,teacher_id,participants,class_kind,gross,teacher_pay,win_net,win_pct,configured_win_pct,note,exception_reason)
  values(gen_random_uuid(),(select id from public.win_cash_shifts where status='OPEN'),a,case when b.source_abono_id is not null then 'ABONO' else b.kind end,b.business_date,b.start_time,b.duration_min,array[b.court],true,b.id,b.teacher_id,(b.lesson->>'participants')::int,b.lesson->>'classKind',(econ->>'gross')::numeric,(econ->>'teacherPay')::numeric,net,(econ->>'winPct')::numeric,(econ->>'configuredPct')::numeric,b.note,coalesce(b.lesson->>'exceptionReason','')) returning * into op;
  insert into public.win_ops_resources(operation_id,court,starts_at,ends_at) values(op.id,b.court,b.starts_at,b.ends_at);
 else
  update public.win_ops_records set booking_id=b.id,participants=(b.lesson->>'participants')::int,gross=(econ->>'gross')::numeric,teacher_pay=(econ->>'teacherPay')::numeric,win_net=net,win_pct=(econ->>'winPct')::numeric,configured_win_pct=(econ->>'configuredPct')::numeric,note=b.note,exception_reason=coalesce(b.lesson->>'exceptionReason',''),updated_at=now() where id=op.id;
 end if;
 update public.win_court_bookings set lesson=case when b.kind='CLASE' then b.lesson||jsonb_build_object('configuredPct',econ->'configuredPct') else lesson end,performed_at=coalesce(performed_at,now()),performed_by=coalesce(performed_by,a) where id=b.id;
 return op.id;
end $$;

create or replace function public.win_calendar_api(p_token text,p_action text,p jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
#variable_conflict use_variable
declare a uuid;role_ text;req uuid;prior public.win_calendar_requests;result jsonb;d1 date;d2 date;dt date;st time;dur int;cid uuid;part jsonb;before_ jsonb;key_ text;
 b public.win_court_bookings;s public.win_court_abonos;customer public.win_customers;price numeric;cash numeric;tr numeric;paid numeric;kind_ text;teacher uuid;lesson_ jsonb;mid uuid;pid uuid;op uuid;window_ jsonb;
 target public.win_court_bookings;allocation record;remaining numeric;room numeric;portion numeric;week_ int;targets jsonb:='[]';notes text;sid uuid;waitid uuid;row_ record;
begin
 a=public.win_calendar_actor(p_token);select role into role_ from public.win_pin_session(p_token);
 if p_action='range' then
  d1=(p->>'start')::date;d2=coalesce((p->>'end')::date,d1);
  if d1 is null or d2<d1 or d2>d1+31 then raise exception 'PERIOD_INVALID';end if;
  return jsonb_build_object('rows',public.win_calendar_rows(d1,d2),'settings',public.win_settings_get(p_token),'context',jsonb_build_object('coaches',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.active) order by c.name) from public.win_coaches c),'[]')));
 elsif p_action='quote' then
  dt=(p->>'date')::date;dur=(p->>'duration')::int;
  if dt is null or dur is null then raise exception 'BOOKING_INVALID';end if;
  if p->>'kind'='CLASE' then
   b.business_date=dt;b.duration_min=dur;b.teacher_id=nullif(p->>'teacherId','')::uuid;b.lesson=coalesce(p->'lesson','{}')-'configuredPct';
   return public.win_calendar_economics(b);
  end if;
  return jsonb_build_object('cash',public.win_court_price_(dt,'CASH',dur),'transfer',public.win_court_price_(dt,'TRANSFER',dur));
 elsif p_action='pending' then
  d1=public.win_config_today_()-31;d2=public.win_config_today_();
  return jsonb_build_object('rows',coalesce((select jsonb_agg(x) from jsonb_array_elements(public.win_calendar_rows(d1,d2)) x where x->>'status'='SCHEDULED' and x->>'kind' in('RESERVA','ABONO','CLASE') and (x->>'endsAt')::timestamptz<=now()),'[]'));
 elsif p_action='customers' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,name,first_name,last_name,phone,note from public.win_customers where coalesce(p->>'search','')='' or name ilike '%'||(p->>'search')||'%' or public.win_calendar_phone(phone) like '%'||regexp_replace(p->>'search','[^0-9]','','g')||'%' and regexp_replace(p->>'search','[^0-9]','','g')<>'' order by name,id limit 50 offset greatest(coalesce((p->>'offset')::int,0),0))x),'[]'));
 elsif p_action='customer.detail' then
  cid=(p->>'id')::uuid;
  return jsonb_build_object('customer',(select to_jsonb(c) from public.win_customers c where id=cid),'bookings',coalesce((select jsonb_agg(public.win_calendar_json(cb) order by business_date desc) from public.win_court_bookings cb where cb.customer_id=cid or exists(select 1 from public.win_calendar_participants x where x.booking_id=cb.id and x.customer_id=cid)),'[]'),'abonos',coalesce((select jsonb_agg(to_jsonb(ca)) from public.win_court_abonos ca where customer_id=cid),'[]'));
 elsif p_action='waitlist' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('name',c.name,'phone',c.phone) order by w.created_at) from public.win_calendar_waitlist w join public.win_customers c on c.id=w.customer_id),'[]'),
   'opportunities',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('name',c.name,'phone',c.phone,'court',ca.court,'weekday',ca.weekday,'start',ca.start_time,'duration',ca.duration_min)) from public.win_calendar_opportunities o join public.win_calendar_waitlist w on w.id=o.waitlist_id and w.status in('PENDING','CONTACTED') join public.win_customers c on c.id=w.customer_id join public.win_court_abonos ca on ca.id=o.abono_id),'[]'));
 elsif p_action='abonos' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(ca) order by weekday,start_time,court) from public.win_court_abonos ca),'[]'));
 elsif p_action='audit' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by occurred_at desc) from(select u.display_name author,au.* from public.win_cash_audit au join win_auth.login_accounts u on u.id=au.actor_id where au.entity_type='CALENDAR' and (coalesce(p->>'id','')='' or au.entity_id=p->>'id' or au.detail->>'bookingId'=p->>'id') order by au.occurred_at desc limit 200)x),'[]'));
 elsif p_action='request' then
  return coalesce((select jsonb_build_object('found',true,'result',x.result) from public.win_calendar_requests x where x.request_id=(p->>'requestId')::uuid and x.actor_id=a),jsonb_build_object('found',false));
 end if;
 a=public.win_calendar_actor(p_token,case when p_action in('cancel','skip','abono.end') then 'CANCEL' else 'CREATE' end);req=(p->>'requestId')::uuid;
 if req is null then raise exception 'REQUEST_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select * into prior from public.win_calendar_requests where request_id=req;
 if found then if prior.actor_id<>a or prior.action<>p_action or prior.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;return prior.result;end if;
 notes=btrim(coalesce(p->>'note',''));if length(notes)>400 then raise exception 'NOTE_TOO_LONG';end if;

 if p_action='customer.save' then
  cid=nullif(p->>'customerId','')::uuid;
  if cid is null then cid=public.win_calendar_customer(a,p,false);
  else
   if length(btrim(coalesce(p->>'customerName',''))) not between 2 and 120 then raise exception 'CUSTOMER_REQUIRED';end if;
   update public.win_customers set name=btrim(p->>'customerName'),phone=public.win_calendar_phone(p->>'phone'),first_name=coalesce(p->>'firstName',''),last_name=coalesce(p->>'lastName',''),note=notes,updated_at=now() where id=cid;
   if not found then raise exception 'CUSTOMER_REQUIRED';end if;
  end if;
  result=jsonb_build_object('id',cid);
 elsif p_action='waitlist.save' then
  cid=public.win_calendar_customer(a,p);waitid=nullif(p->>'id','')::uuid;
  if jsonb_typeof(p->'windows')<>'array' or jsonb_array_length(p->'windows') not between 1 and 14 then raise exception 'WAITLIST_INVALID';end if;
  for window_ in select * from jsonb_array_elements(p->'windows') loop
   if window_->>'from' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or window_->>'to' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or public.win_abono_minutes_((window_->>'to')::time)<=public.win_abono_minutes_((window_->>'from')::time) then raise exception 'WAITLIST_INVALID';end if;
  end loop;
  if coalesce(p->>'status','PENDING')='AGREED' and not exists(select 1 from public.win_court_abonos where id=nullif(p->>'abonoId','')::uuid and customer_id=cid) then raise exception 'WAITLIST_INVALID';end if;
  insert into public.win_calendar_waitlist(id,customer_id,weekdays,windows,duration_min,court,note,status,abono_id,created_by)
  values(coalesce(waitid,gen_random_uuid()),cid,array(select jsonb_array_elements_text(p->'weekdays')::int),p->'windows',(p->>'duration')::int,nullif(p->>'court',''),notes,coalesce(p->>'status','PENDING'),nullif(p->>'abonoId','')::uuid,a)
  on conflict(id) do update set weekdays=excluded.weekdays,windows=excluded.windows,duration_min=excluded.duration_min,court=excluded.court,note=excluded.note,status=excluded.status,abono_id=excluded.abono_id,updated_at=now() returning id into waitid;
  result=jsonb_build_object('id',waitid);
 elsif p_action in('create','update','abono.create') then
  kind_=coalesce(p->>'kind','RESERVA');dt=(p->>'date')::date;st=(p->>'start')::time;dur=(p->>'duration')::int;
  if kind_ not in('RESERVA','CLASE','BLOQUEO') or dt is null or st is null or dur is null or dur not between 15 and 720 or dur%15<>0 or extract(second from st)<>0 or p->>'court' not in('C1','C2','C3','C4') then raise exception 'BOOKING_INVALID';end if;
  if public.win_abono_minutes_(st)<coalesce((select value from public.win_settings where key='GRID_OPEN_MIN'),480) or public.win_abono_minutes_(st)+dur>coalesce((select value from public.win_settings where key='GRID_CLOSE_MIN'),1500) then raise exception 'OUTSIDE_HOURS';end if;
  if p_action<>'update' and public.win_courts_starts_at_(dt,st)+make_interval(mins=>dur)<now() and role_<>'ADMIN' then raise exception 'BOOKING_IN_PAST';end if;
  if kind_='RESERVA' then cid=public.win_calendar_customer(a,p);select * into customer from public.win_customers where id=cid;end if;
  lesson_=coalesce(p->'lesson','{}')-'configuredPct';teacher=nullif(p->>'teacherId','')::uuid;
  if kind_='CLASE' and (teacher is null or not exists(select 1 from public.win_coaches where id=teacher and active) or coalesce((lesson_->>'participants')::int,0) not between 1 and 4 or coalesce(lesson_->>'classKind','TRADICIONAL') not in('TRADICIONAL','PARTIDO')) then raise exception 'COACH_INVALID';end if;
  if kind_='CLASE' then lesson_=lesson_||jsonb_build_object('classKind',coalesce(lesson_->>'classKind','TRADICIONAL'));end if;
  price=nullif(p->>'price','')::numeric;
  if kind_='RESERVA' and price is null then price=public.win_court_price_(dt,coalesce(p->>'priceMethod','TRANSFER'),dur);end if;
  if kind_='RESERVA' and price is null then raise exception 'PRICE_MISSING';end if;
  if price<0 or price>1000000000 or price<>round(price,2) then raise exception 'AMOUNT_INVALID';end if;
  if kind_='RESERVA' and price=0 and length(btrim(coalesce(p->>'priceReason','')))<5 then raise exception 'COURTESY_REASON_REQUIRED';end if;
  if p_action='abono.create' then
   if kind_<>'RESERVA' then raise exception 'BOOKING_INVALID';end if;
   -- La misma cancha queda reservada todas las semanas, sin inventar una fecha de fin.
   if exists(select 1 from public.win_court_abonos x where x.court=p->>'court' and x.weekday=extract(isodow from dt)::int and (x.ends_on is null or x.ends_on>=dt) and public.win_abono_minutes_(x.start_time)<public.win_abono_minutes_(st)+dur and public.win_abono_minutes_(st)<public.win_abono_minutes_(x.start_time)+x.duration_min)
    or exists(select 1 from public.win_court_bookings x where x.status='CONFIRMED' and x.court=p->>'court' and x.business_date>=dt and extract(isodow from x.business_date)=extract(isodow from dt) and public.win_abono_minutes_(x.start_time)<public.win_abono_minutes_(st)+dur and public.win_abono_minutes_(st)<public.win_abono_minutes_(x.start_time)+x.duration_min) then raise exception 'ABONO_CONFLICT';end if;
   insert into public.win_court_abonos(request_id,court,weekday,start_time,duration_min,customer_name,customer_whatsapp,expected_method,starts_on,note,created_by,customer_id,agreed_amount,calendar_managed)
   values(req,p->>'court',extract(isodow from dt)::int,st,dur,customer.name,public.win_calendar_phone(customer.phone),coalesce(p->>'priceMethod','TRANSFER'),dt,notes,a,cid,price,true) returning * into s;
   b=public.win_calendar_resolve(a,'a:'||s.id||':'||dt);
   if nullif(p->>'waitlistId','') is not null then
    update public.win_calendar_waitlist set status='AGREED',abono_id=s.id,updated_at=now() where id=(p->>'waitlistId')::uuid and customer_id=cid and status in('PENDING','CONTACTED');
    if not found then raise exception 'WAITLIST_INVALID';end if;
   end if;
  elsif p_action='create' then
   insert into public.win_court_bookings(request_id,court,business_date,start_time,duration_min,starts_at,ends_at,kind,holder,note,created_by,customer_name,customer_whatsapp,customer_id,calendar_managed,expected_amount,expected_method,teacher_id,lesson)
   values(req,p->>'court',dt,st,dur,public.win_courts_starts_at_(dt,st),public.win_courts_starts_at_(dt,st)+make_interval(mins=>dur),kind_,case when kind_='RESERVA' then customer.name else coalesce(nullif(p->>'name',''),case when kind_='CLASE' then 'Clase' else 'Bloqueo' end) end,notes,a,customer.name,public.win_calendar_phone(customer.phone),cid,true,price,coalesce(p->>'priceMethod','TRANSFER'),teacher,lesson_) returning * into b;
  else
   b=public.win_calendar_resolve(a,p->>'id');before_=public.win_calendar_json(b);
   if b.status='CANCELLED' then raise exception 'BOOKING_NOT_FOUND';end if;
   if coalesce((p->>'revision')::int,-1)<>b.revision then raise exception 'STALE_REVISION';end if;
   if b.kind<>kind_ then raise exception 'BOOKING_INVALID';end if;
   if b.performed_at is not null and (dt<>b.business_date or st<>b.start_time or dur<>b.duration_min or p->>'court'<>b.court or teacher is distinct from b.teacher_id) then raise exception 'PERFORMED_SLOT_FIXED';end if;
   if b.source_abono_id is not null and (dt<>b.business_date or st<>b.start_time or dur<>b.duration_min or p->>'court'<>b.court) then raise exception 'ABONO_SLOT_FIXED';end if;
   if kind_='RESERVA' and price<public.win_calendar_paid(b.id) then raise exception 'PRICE_BELOW_PAID';end if;
   if kind_='RESERVA' and price is distinct from b.expected_amount and length(btrim(coalesce(p->>'priceReason','')))<5 then raise exception 'PRICE_REASON_REQUIRED';end if;
   if b.lesson ? 'configuredPct' then lesson_=lesson_||jsonb_build_object('configuredPct',b.lesson->'configuredPct');end if;
   update public.win_court_bookings set court=p->>'court',business_date=dt,start_time=st,duration_min=dur,starts_at=public.win_courts_starts_at_(dt,st),ends_at=public.win_courts_starts_at_(dt,st)+make_interval(mins=>dur),customer_id=cid,customer_name=customer.name,customer_whatsapp=public.win_calendar_phone(customer.phone),holder=case when kind_='RESERVA' then customer.name else coalesce(nullif(p->>'name',''),b.holder) end,note=notes,expected_amount=price,teacher_id=teacher,lesson=lesson_,revision=revision+1 where id=b.id returning * into b;
   if b.performed_at is not null then perform public.win_calendar_perform(a,b);end if;
  end if;
  if jsonb_array_length(coalesce(p->'participants','[]'))>4 then raise exception 'PARTICIPANTS_REQUIRED';end if;
  delete from public.win_calendar_participants where booking_id=b.id;
  for part in select * from jsonb_array_elements(coalesce(p->'participants','[]')) loop
   cid=public.win_calendar_customer(a,part,false);
   if cid is not null then insert into public.win_calendar_participants values(b.id,cid) on conflict do nothing;end if;
  end loop;
  result=public.win_calendar_json(b);
 elsif p_action in('pay','confirm','cancel','skip','abono.end') then
  b=public.win_calendar_resolve(a,p->>'id');before_=public.win_calendar_json(b);
  if b.status='CANCELLED' then raise exception 'BOOKING_NOT_FOUND';end if;
  if p_action='pay' then
   if b.kind<>'RESERVA' then raise exception 'CLASS_IS_NOT_CASH';end if;
   if not public.win_can_access(a,'CASH','CREATE') then raise exception 'NOT_AUTHORIZED';end if;
   if not exists(select 1 from public.win_cash_shifts where id=nullif(p->>'shiftId','')::uuid and status='OPEN') then raise exception 'SHIFT_NOT_OPEN';end if;
   cash=public.win_ops_money(p,'cash');tr=public.win_ops_money(p,'transfer');paid=public.win_calendar_paid(b.id);
   if b.expected_amount is null then raise exception 'PRICE_MISSING';end if;
   if paid>=b.expected_amount then raise exception 'ALREADY_PAID';end if;
   if cash+tr<=0 then raise exception 'PAYMENT_INVALID';end if;
   if cash+tr>b.expected_amount-paid then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
   for row_ in select 'CASH' method,cash amount union all select 'TRANSFER',tr loop
    if row_.amount>0 then
     insert into public.win_court_payments(request_id,booking_id,method,amount,received_by,recorded_by,note)
     values(gen_random_uuid(),b.id,row_.method,row_.amount,case when row_.method='CASH' then a end,a,notes) returning id into pid;
     insert into public.win_calendar_allocations values(pid,b.id,row_.amount);
     if row_.method='TRANSFER' and length(btrim(coalesce(p->>'receiptReference','')))>0 then
      select id into mid from public.win_cash_movements where reference_type='COURT_PAYMENT' and reference_id=pid::text;
      update public.win_ops_receipts set reference=btrim(p->>'receiptReference'),verified=true where movement_id=mid;
      update public.win_ops_notices set resolved_at=now(),resolved_by=a,resolution='Referencia registrada al cobrar' where source_type='RECEIPT' and source_id=mid::text;
     end if;
    end if;
   end loop;
   result=public.win_calendar_json(b);
  elsif p_action='confirm' then
   if b.kind not in('RESERVA','CLASE') or b.ends_at>now() then raise exception 'ACTIVITY_NOT_FINISHED';end if;
   op=public.win_calendar_perform(a,b);
   update public.win_court_bookings set revision=revision+1 where id=b.id returning * into b;
   result=public.win_calendar_json(b)||jsonb_build_object('operationId',op);
  elsif p_action='cancel' then
   if b.performed_at is not null then raise exception 'ACTIVITY_ALREADY_PERFORMED';end if;
   if length(notes)<5 then raise exception 'REASON_REQUIRED';end if;
   update public.win_court_bookings set status='CANCELLED',cancelled_at=now(),cancelled_by=a,cancel_reason=notes,revision=revision+1 where id=b.id returning * into b;
   result=public.win_calendar_json(b); -- Los cobros y sus aplicaciones se conservan, sin devolución automática.
  else
   if b.source_abono_id is null then raise exception 'ABONO_REQUIRED';end if;
   select * into s from public.win_court_abonos where id=b.source_abono_id for update;
   if length(notes)<5 then raise exception 'REASON_REQUIRED';end if;
   if p_action='skip' then
    if b.performed_at is not null or b.starts_at<=now() then raise exception 'ACTIVITY_ALREADY_PERFORMED';end if;
    paid=public.win_calendar_paid(b.id);
    if paid>0 and b.starts_at<now()+interval '24 hours' and role_<>'ADMIN' then raise exception 'ADMIN_LATE_SKIP_REQUIRED';end if;
    -- Un anticipo histórico de Recepción no se puede trasladar sin identificar su cobro.
    if exists(select 1 from public.win_ops_records o where o.booking_id=b.id and o.status='ACTIVE' and o.cash+o.transfer>0) then raise exception 'LEGACY_PAYMENT_REVIEW';end if;
    for allocation in select * from public.win_calendar_allocations where booking_id=b.id order by payment_id loop
     remaining=allocation.amount;week_=1;
     delete from public.win_calendar_allocations where payment_id=allocation.payment_id and booking_id=b.id;
     while remaining>0 and week_<=104 loop
      dt=b.business_date+7*week_;week_=week_+1;
      if s.ends_on is not null and dt>s.ends_on then exit;end if;
      if exists(select 1 from public.win_court_abono_skips where abono_id=s.id and skip_date=dt) then continue;end if;
      target=public.win_calendar_resolve(a,'a:'||s.id||':'||dt);
      if target.status='CANCELLED' or target.performed_at is not null then continue;end if;
      room=target.expected_amount-public.win_calendar_paid(target.id);
      if room is null then raise exception 'NO_VALID_DESTINATION';end if;
      if room<=0 then continue;end if;
      portion=least(remaining,room);
      insert into public.win_calendar_allocations values(allocation.payment_id,target.id,portion) on conflict(payment_id,booking_id) do update set amount=win_calendar_allocations.amount+excluded.amount;
      remaining=remaining-portion;targets=targets||jsonb_build_array(jsonb_build_object('paymentId',allocation.payment_id,'bookingId',target.id,'date',target.business_date,'amount',portion));
     end loop;
     if remaining>0 then raise exception 'NO_VALID_DESTINATION';end if;
    end loop;
    insert into public.win_court_abono_skips(abono_id,skip_date,reason,created_by) values(s.id,b.business_date,notes,a) on conflict do nothing;
    update public.win_court_bookings set status='CANCELLED',cancelled_at=now(),cancelled_by=a,cancel_reason=notes,revision=revision+1 where id=b.id;
    result=jsonb_build_object('id',b.id,'abonoId',s.id,'transferred',targets,'saved',true);
   else
    dt=b.business_date;
    if exists(select 1 from public.win_court_bookings where source_abono_id=s.id and business_date>=dt and performed_at is not null) then raise exception 'ACTIVITY_ALREADY_PERFORMED';end if;
    update public.win_court_abonos set ends_on=dt-1,ended_by=a,ended_at=now(),end_reason=notes where id=s.id;
    update public.win_court_bookings set status='CANCELLED',cancelled_at=now(),cancelled_by=a,cancel_reason=notes,revision=revision+1 where source_abono_id=s.id and business_date>=dt and status='CONFIRMED';
    insert into public.win_calendar_opportunities(waitlist_id,abono_id,available_from)
    select w.id,s.id,dt from public.win_calendar_waitlist w where w.status in('PENDING','CONTACTED') and s.weekday=any(w.weekdays) and (w.court is null or w.court=s.court) and w.duration_min<=s.duration_min
     and exists(select 1 from jsonb_array_elements(w.windows)x where public.win_abono_minutes_((x->>'from')::time)<=public.win_abono_minutes_(s.start_time) and public.win_abono_minutes_((x->>'to')::time)>=public.win_abono_minutes_(s.start_time)+w.duration_min) on conflict do nothing;
    result=jsonb_build_object('id',s.id,'saved',true);
   end if;
  end if;
 else raise exception 'ACTION_INVALID';end if;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(a,'CALENDAR_'||upper(replace(p_action,'.','_')),'CALENDAR',coalesce(b.id::text,result->>'id',req::text),jsonb_build_object('before',before_,'after',result,'bookingId',b.id,'note',notes,'priceReason',p->>'priceReason'));
 insert into public.win_calendar_requests values(req,a,p_action,p,result,now());return result;
exception when exclusion_violation then raise exception 'COURT_TAKEN';
 when unique_violation then raise exception 'CUSTOMER_OR_REQUEST_CONFLICT';
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'win_calendar_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
-- M05: historial operativo y financiero compartido; reglas M04 conservadas.
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
   (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'amount',m.amount_signed,'method',m.payment_method)), '[]') from public.win_cash_movements m where m.reference_type='OPERATION' and m.reference_id=o.id::text and m.reversal_of is null) payments
  from public.win_ops_records o left join public.win_cash_shifts sh on sh.id=o.shift_id join win_auth.login_accounts a on a.id=o.actor_id left join win_auth.login_accounts owner on owner.id=sh.opened_by left join public.win_coaches c on c.id=o.teacher_id
  where (o.created_at at time zone 'America/Argentina/Buenos_Aires')::date between start_day and end_day
  union all
  select 'calendar:'||au.id,au.occurred_at,'ACTIVITY_EVENT','ACTIVE',au.action||' · '||coalesce(au.detail->>'note',''),0,0,0,b.business_date,b.start_time,b.duration_min,
   case when b.court is null then '{}'::text[] else array[b.court] end,null,'',u.display_name,'Actividad sin movimiento de caja',null::uuid,'ACTIVITY',au.actor_id,false,'',0,'[]'::jsonb
  from public.win_cash_audit au join win_auth.login_accounts u on u.id=au.actor_id left join public.win_court_bookings b on b.id::text=au.entity_id
  where au.entity_type='CALENDAR' and (au.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between start_day and end_day
  union all
  select 'cash:'||m.id,m.occurred_at,m.kind,case when exists(select 1 from public.win_cash_movements rev where rev.reversal_of=m.id) then 'VOID' else 'ACTIVE' end,m.note,
   case when m.payment_method='CASH' then m.amount_signed else 0 end,
   case when m.payment_method='TRANSFER' then m.amount_signed else 0 end,0,null,null,null,'{}',null,'',a.display_name,owner.display_name,m.shift_id,sh.status,m.recorded_by,false,'',m.amount_signed,
   jsonb_build_array(jsonb_build_object('id',m.id,'amount',m.amount_signed,'method',m.payment_method))
  from public.win_cash_movements m join public.win_cash_shifts sh on sh.id=m.shift_id join win_auth.login_accounts a on a.id=m.recorded_by join win_auth.login_accounts owner on owner.id=sh.opened_by
  where m.reference_type is distinct from 'OPERATION' and m.reversal_of is null and (m.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date between start_day and end_day
 ), filtered as (
 select * from rows where (coalesce(p->>'type','ALL')='ALL' or type=p->>'type')
  and (coalesce(p->>'method','ALL')='ALL' or (p->>'method'='CASH' and cash<>0) or (p->>'method'='TRANSFER' and transfer<>0))
  and (coalesce(p->>'search','')='' or concat_ws(' ',note,teacher,author,responsible,type) ilike '%'||(p->>'search')||'%')
  and (coalesce(p->>'shiftId','')='' or shift_id::text=p->>'shiftId')
 ), paged as(select * from filtered order by registered_at desc,id desc limit 100 offset offset_rows)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('calendarId',origin.id,'calendarDate',origin.business_date) order by registered_at desc,x.id desc)
  from paged x left join lateral(select cb.id,cb.business_date from public.win_court_bookings cb where cb.id::text=case
   when x.id like 'op:%' then (select oo.booking_id::text from public.win_ops_records oo where oo.id::text=substr(x.id,4))
   when x.id like 'cash:%' then (select cp.booking_id::text from public.win_cash_movements mm join public.win_court_payments cp on cp.id::text=mm.reference_id where mm.id::text=substr(x.id,6) and mm.reference_type='COURT_PAYMENT')
   when x.id like 'calendar:%' then (select aa.entity_id from public.win_cash_audit aa where aa.id::text=substr(x.id,10)) end) origin on true),'[]'), 'total',(select count(*) from filtered),'offset',offset_rows,'limit',100) into data;
 return data;
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
  tx=tx+coalesce((select sum(case when c.proposed_method='TRANSFER' then c.proposed_amount else 0 end-case when cmov.payment_method='TRANSFER' then cmov.amount_signed else 0 end) from public.win_ops_corrections c join public.win_ops_ledger cmov on cmov.id=c.movement_id join public.win_cash_shifts s on s.id=cmov.shift_id where c.status='PENDING' and s.business_date=dt),0);
  ns=case when tr<>tx then 'EXCEPTION' when exists(select 1 from public.win_ops_corrections c join public.win_ops_ledger cmov on cmov.id=c.movement_id join public.win_cash_shifts s on s.id=cmov.shift_id where c.status='PENDING' and s.business_date=dt) then 'PROVISIONAL' else 'CONFIRMED' end;
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
  if exists(select 1 from public.win_ops_records o join public.win_court_bookings bk on bk.id=o.booking_id where o.id=nullif(p->>'id','')::uuid and bk.calendar_managed) then raise exception 'EDIT_AT_ORIGIN';end if;
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
  if m.kind in ('EXPENSE','WITHDRAWAL','REFUND') and m.reference_type='OPERATION' and p->>'method'<>'CASH' then raise exception 'METHOD_INVALID';end if;
  insert into public.win_ops_corrections(request_id,movement_id,actor_id,proposed_amount,proposed_method,reason) values(req,m.id,a,cash,p->>'method',reason) returning id into new_id;
  update public.win_ops_day_controls set status='PROVISIONAL' where business_date=sh.business_date;
  result=jsonb_build_object('id',new_id,'saved',true);
 elsif action_='decide' then
  if role_<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
  select * into correction from public.win_ops_corrections where id=(p->>'id')::uuid for update;
  if not found or correction.status<>'PENDING' then raise exception 'CORRECTION_NOT_PENDING';end if;
  if length(reason)<5 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
  ns=case when coalesce((p->>'approve')::boolean,false) then 'APPROVED' else 'REJECTED' end;
  update public.win_ops_corrections set status=ns,decided_by=a,decided_at=clock_timestamp(),decision_note=reason where id=correction.id;
  if ns='APPROVED' then
   select * into m from public.win_cash_movements where id=correction.movement_id;
   if m.reference_type='OPERATION' then
    insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) select a,'BEFORE_CORRECTION','OPERATION',id::text,to_jsonb(o) from public.win_ops_records o where id::text=m.reference_id;
    update public.win_ops_records o set
     cash=coalesce((select sum(case when o.type in ('GASTO','RETIRO') then -l.amount_signed else greatest(l.amount_signed,0) end) from public.win_ops_ledger l where l.reference_type='OPERATION' and l.reference_id=o.id::text and l.payment_method='CASH'),0),
     transfer=coalesce((select sum(l.amount_signed) from public.win_ops_ledger l where l.reference_type='OPERATION' and l.reference_id=o.id::text and l.payment_method='TRANSFER'),0),
     refund_cash=case when o.type='RENDICION' then coalesce((select sum(-least(l.amount_signed,0)) from public.win_ops_ledger l where l.reference_type='OPERATION' and l.reference_id=o.id::text and l.payment_method='CASH'),0) else 0 end,
     win_net=case when o.type in ('RESERVA','EVENTO') then coalesce((select sum(l.amount_signed) from public.win_ops_ledger l where l.reference_type='OPERATION' and l.reference_id=o.id::text),0) else o.win_net end,
     updated_at=now()
    where o.id::text=m.reference_id;
   elsif m.reference_type='COURT_PAYMENT' and not exists(select 1 from public.win_court_payments cp join public.win_court_bookings bk on bk.id=cp.booking_id where cp.id::text=m.reference_id and bk.calendar_managed) then
    update public.win_ops_records o set win_net=
     coalesce((select sum(coalesce((select l.amount_signed from public.win_ops_ledger l where l.reference_type='COURT_PAYMENT' and l.reference_id=cp.id::text limit 1),cp.amount)) from public.win_court_payments cp where cp.booking_id=o.booking_id),0)
     +coalesce((select sum(l.amount_signed) from public.win_ops_ledger l where l.reference_type='OPERATION' and l.reference_id=o.id::text),0),
     updated_at=now()
    where o.type='RESERVA' and o.booking_id=(select cp.booking_id from public.win_court_payments cp where cp.id::text=m.reference_id);
   end if;
  end if;
  update public.win_ops_day_controls set status='REVIEW' where business_date=(select s.business_date from public.win_cash_movements cmov join public.win_cash_shifts s on s.id=cmov.shift_id where cmov.id=correction.movement_id);
  result=jsonb_build_object('saved',true,'status',ns);
 else raise exception 'ACTION_INVALID';end if;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(a,'OPS_'||upper(action_),'OPERATION',coalesce(result->>'id',p->>'id',req::text),p-'requestId');
 insert into public.win_ops_requests values(req,a,'control',p,result,now());return result;
end $$;

-- API antigua de sólo lectura: evita subconsultas escalares al existir pagos parciales.
create or replace function public.win_courts_day(p_token text,p_date date) returns jsonb language plpgsql stable set search_path='' as $$
declare rows_ jsonb;begin
 perform public.win_calendar_actor(p_token);
 select coalesce(jsonb_agg(x||jsonb_build_object('id',case when left(x->>'id',2)='a:' then x->>'abonoId' else x->>'id' end,'cancha',x->>'court','fecha',x->>'date','inicio',x->>'start','fin',x->>'end','duracion',x->'duration','tipo',x->>'kind','titular',x->>'name','nombreCompleto',x->>'name','whatsapp',x->>'phone','nota',x->>'note','estado','CONFIRMED','montoPrevisto',x->'price','actividadRegistrada',x->>'status'='PERFORMED','pago',case when (x->>'paid')::numeric>0 then jsonb_build_object('monto',x->'paid','metodo','MIXTO') end)),'[]') into rows_
 from jsonb_array_elements(public.win_calendar_rows(p_date,p_date))x where x->>'status'<>'CANCELLED' and not coalesce((x->>'readOnly')::boolean,false);
 return jsonb_build_object('fecha',p_date,'canchas',jsonb_build_array('C4','C3','C2','C1'),'reservas',rows_,'precios',(select jsonb_object_agg(d,jsonb_build_object('efectivo',public.win_court_price_(p_date,'CASH',d),'transferencia',public.win_court_price_(p_date,'TRANSFER',d))) from unnest(array[60,90,120])d));
end $$;

-- Impedir que una pestaña vieja cree otra actividad desde Caja después del corte.
do $$begin
 if to_regprocedure('public.win_calendar_legacy_ops_save(text,jsonb)') is null then alter function public.win_ops_save(text,jsonb) rename to win_calendar_legacy_ops_save;end if;
end $$;
create or replace function public.win_ops_save(p_token text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 perform public.win_ops_actor(p_token);
 if p->>'type' in('RESERVA','ABONO','CLASE') then raise exception 'CATEGORY_MOVED_TO_CALENDAR';end if;
 return public.win_calendar_legacy_ops_save(p_token,p);
end $$;

-- También protege agenda frente a operaciones nuevas cargadas desde una pantalla anterior.
create or replace function public.win_calendar_resource_guard() returns trigger language plpgsql set search_path='' as $$
declare o public.win_ops_records;begin
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 if not new.active then return new;end if;
 select * into o from public.win_ops_records where id=new.operation_id;
 if exists(select 1 from public.win_court_bookings b where b.status='CONFIRMED' and b.court=new.court and b.id is distinct from o.booking_id
  and not(b.source_abono_id is not null and b.source_abono_id=o.abono_id and b.business_date=o.activity_date)
  and not(o.type='EVENTO' and b.kind='EVENTO' and b.starts_at=new.starts_at and b.ends_at=new.ends_at)
  and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'COURT_TAKEN';end if;
 return new;
end $$;
drop trigger if exists win_calendar_resource_guard on public.win_ops_resources;
create trigger win_calendar_resource_guard before insert or update on public.win_ops_resources for each row execute function public.win_calendar_resource_guard();

-- Protege también las altas recurrentes hechas por clientes de API anteriores.
create or replace function public.win_calendar_series_guard() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 if new.ends_on is not null and new.ends_on<new.starts_on then return new;end if;
 if exists(select 1 from public.win_court_abonos s where s.id<>new.id and s.court=new.court and s.weekday=new.weekday and coalesce(s.ends_on,'infinity'::date)>=new.starts_on and coalesce(new.ends_on,'infinity'::date)>=s.starts_on
  and public.win_abono_minutes_(s.start_time)<public.win_abono_minutes_(new.start_time)+new.duration_min and public.win_abono_minutes_(new.start_time)<public.win_abono_minutes_(s.start_time)+s.duration_min)
  or exists(select 1 from public.win_court_bookings b where b.source_abono_id is distinct from new.id and b.status='CONFIRMED' and b.court=new.court and extract(isodow from b.business_date)::int=new.weekday and b.business_date>=new.starts_on and (new.ends_on is null or b.business_date<=new.ends_on)
   and not exists(select 1 from public.win_court_abono_skips sk where sk.abono_id=new.id and sk.skip_date=b.business_date)
   and public.win_abono_minutes_(b.start_time)<public.win_abono_minutes_(new.start_time)+new.duration_min and public.win_abono_minutes_(new.start_time)<public.win_abono_minutes_(b.start_time)+b.duration_min) then raise exception 'ABONO_CONFLICT';end if;
 return new;
end $$;
drop trigger if exists win_calendar_series_guard on public.win_court_abonos;
create trigger win_calendar_series_guard before insert or update on public.win_court_abonos for each row execute function public.win_calendar_series_guard();

-- Una corrección financiera aprobada ajusta la aplicación de un único destino sin tocar el precio acordado.
-- Si el cobro ya se repartió entre fechas se requiere revisión expresa, evitando una reasignación inventada.
create or replace function public.win_calendar_correction_guard() returns trigger language plpgsql set search_path='' as $$
declare pid uuid;n int;begin
 if new.status='APPROVED' and old.status is distinct from new.status then
  select cp.id into pid from public.win_cash_movements m join public.win_court_payments cp on cp.id::text=m.reference_id where m.id=new.movement_id and m.reference_type='COURT_PAYMENT';
  if pid is not null then
   select count(*) into n from public.win_calendar_allocations where payment_id=pid;
   if n>1 and new.proposed_amount<>(select sum(amount) from public.win_calendar_allocations where payment_id=pid) then raise exception 'ALLOCATION_REVIEW_REQUIRED';end if;
   if new.proposed_amount<0 then raise exception 'AMOUNT_INVALID';end if;
   if n=1 then
    if new.proposed_amount=0 then delete from public.win_calendar_allocations where payment_id=pid;
    else update public.win_calendar_allocations set amount=new.proposed_amount where payment_id=pid;end if;
   end if;
  end if;
 end if;return new;
end $$;
drop trigger if exists win_calendar_correction_guard on public.win_ops_corrections;
create trigger win_calendar_correction_guard after update on public.win_ops_corrections for each row execute function public.win_calendar_correction_guard();

-- Mantener Bar compatible con los homónimos: no elegir una cuenta arbitraria.
create or replace function public.win_bar_customer_create(p_token text,p_name text) returns jsonb language plpgsql set search_path='' as $$
declare a uuid;cid uuid;n int;cleaned text:=btrim(coalesce(p_name,''));begin
 select account_id into a from public.win_pin_session(p_token);if a is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(a,'BAR','SALE') then raise exception 'NOT_AUTHORIZED';end if;
 if length(cleaned) not between 2 and 120 then raise exception 'CUSTOMER_INVALID';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select count(*),min(id::text)::uuid into n,cid from public.win_customers where lower(btrim(name))=lower(cleaned);
 if n>1 then raise exception 'CUSTOMER_AMBIGUOUS';end if;
 if cid is null then insert into public.win_customers(name,created_by) values(cleaned,a) returning id into cid;end if;
 return jsonb_build_object('id',cid,'name',cleaned);
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'win_calendar_%' or p.proname in('win_courts_day','win_ops_save','win_ops_control','win_ops_history','win_bar_customer_create')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
