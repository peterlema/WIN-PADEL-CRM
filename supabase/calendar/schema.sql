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
  if not found then raise exception 'CUSTOMER_REQUIRED';end if;
  if required_ and public.win_calendar_phone(old.phone) is null then
   if ph is null then raise exception 'CUSTOMER_REQUIRED';end if;
   update public.win_customers set phone=ph,updated_at=now() where id=cid;
   insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(a,'CALENDAR_CUSTOMER_ENRICH','CALENDAR',cid::text,jsonb_build_object('before',to_jsonb(old),'phone',ph));
  end if;return cid;
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
 if new.calendar_managed and new.performed_at is null and exists(select 1 from public.win_ops_availability v where v.business_date=new.business_date and v.court=new.court and (new.starts_at<v.starts_at or new.ends_at>v.ends_at)) then raise exception 'OUTSIDE_HOURS';end if;
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
