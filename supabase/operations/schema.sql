-- Recepción operativa M01–M04. Sólo Edge Functions con service_role.
-- Actividad realizada, dinero cobrado y agenda conservan identidades separadas.
create table if not exists public.win_ops_requests (
 request_id uuid primary key, actor_id uuid not null references win_auth.login_accounts(id),
 action text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.win_ops_records (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 shift_id uuid not null references public.win_cash_shifts(id), actor_id uuid not null references win_auth.login_accounts(id),
 created_at timestamptz not null default now(), updated_at timestamptz,
 type text not null check(type in ('RESERVA','ABONO','CLASE','RENDICION','EVENTO','TIENDA','GASTO','RETIRO','OTRO')),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','VOID')),
 activity_date date, start_time time, duration_min int, courts text[] not null default '{}', played boolean not null default false,
 teacher_id uuid references public.win_coaches(id), participants int, class_kind text,
 gross numeric(14,2), teacher_pay numeric(14,2), win_net numeric(14,2) not null default 0, win_pct numeric(5,2),
 cash numeric(14,2) not null default 0, transfer numeric(14,2) not null default 0, refund_cash numeric(14,2) not null default 0,
 category text, note text not null default '', exception_reason text not null default '', review_note text not null default '',
 booking_id uuid references public.win_court_bookings(id), abono_id uuid references public.win_court_abonos(id),
 constraint win_ops_money check(cash>=0 and transfer>=0 and refund_cash>=0 and cash<=1000000000 and transfer<=1000000000),
 constraint win_ops_note_length check(length(note)<=400 and length(exception_reason)<=400 and length(review_note)<=400),
 constraint win_ops_participants check(participants is null or participants between 0 and 1000)
);
create index if not exists win_ops_records_shift_idx on public.win_ops_records(shift_id,created_at desc);
create index if not exists win_ops_records_activity_idx on public.win_ops_records(activity_date,type) where status='ACTIVE';
create index if not exists win_ops_records_teacher_idx on public.win_ops_records(teacher_id,activity_date) where status='ACTIVE';
create unique index if not exists win_ops_records_booking_uq on public.win_ops_records(booking_id) where status='ACTIVE' and played;
create unique index if not exists win_ops_records_abono_uq on public.win_ops_records(abono_id,activity_date) where status='ACTIVE' and played;
create table if not exists public.win_ops_resources (
 id uuid primary key default gen_random_uuid(), operation_id uuid not null references public.win_ops_records(id),
 court text not null check(court in ('C1','C2','C3','C4')), starts_at timestamptz not null, ends_at timestamptz not null,
 active boolean not null default true, check(ends_at>starts_at),
 constraint win_ops_resources_overlap exclude using gist(court with =, tstzrange(starts_at,ends_at,'[)') with &&) where(active)
);
create index if not exists win_ops_resources_op_idx on public.win_ops_resources(operation_id);
create table if not exists public.win_ops_allocations (
 settlement_id uuid not null references public.win_ops_records(id), teacher_id uuid not null references public.win_coaches(id),
 activity_date date not null, amount numeric(14,2) not null check(amount<>0), primary key(settlement_id,activity_date)
);
create index if not exists win_ops_allocations_teacher_idx on public.win_ops_allocations(teacher_id,activity_date);
create table if not exists public.win_ops_receipts (
 movement_id uuid references public.win_cash_movements(id), reference text not null check(length(reference) between 1 and 200),
 amount numeric(14,2) not null check(amount>0), verified boolean not null default false, primary key(movement_id,reference)
);
create table if not exists public.win_ops_notices (
 id uuid primary key default gen_random_uuid(), request_id uuid unique,
 source_type text, source_id text, message text not null check(length(btrim(message)) between 1 and 800),
 actor_id uuid not null references win_auth.login_accounts(id), created_at timestamptz not null default now(),
 resolved_by uuid references win_auth.login_accounts(id), resolved_at timestamptz, resolution text,
 unique(source_type,source_id)
);
create index if not exists win_ops_notices_open_idx on public.win_ops_notices(created_at desc) where resolved_at is null;
create table if not exists public.win_ops_coach_rates (
 teacher_id uuid not null references public.win_coaches(id), valid_from date not null,
 win_pct numeric(5,2) not null check(win_pct between 0 and 100), primary key(teacher_id,valid_from)
);
-- No inventar comisiones históricas anteriores al alta del catálogo.
insert into public.win_ops_coach_rates(teacher_id,valid_from,win_pct)
 select id,(created_at at time zone 'America/Argentina/Buenos_Aires')::date,win_pct from public.win_coaches on conflict do nothing;
create or replace function public.win_ops_coach_rate_trigger() returns trigger language plpgsql set search_path='' as $$
begin
 insert into public.win_ops_coach_rates values(new.id,public.win_config_today_(),new.win_pct)
 on conflict(teacher_id,valid_from) do update set win_pct=excluded.win_pct;
 return new;
end $$;
drop trigger if exists win_ops_coach_rate on public.win_coaches;
create trigger win_ops_coach_rate after insert or update of win_pct on public.win_coaches for each row execute function public.win_ops_coach_rate_trigger();

alter table public.win_cash_shifts add column if not exists transfer_counted numeric(14,2);
alter table public.win_cash_shifts add column if not exists receipt_count int;
alter table public.win_cash_shifts add column if not exists exception_checks text;
alter table public.win_cash_shifts add column if not exists admin_notified boolean not null default false;
create table if not exists public.win_ops_day_controls (
 business_date date primary key, transfer_counted numeric(14,2) not null check(transfer_counted>=0),
 receipt_count int not null check(receipt_count>=0), expected_transfer numeric(14,2) not null,
 actor_id uuid not null references win_auth.login_accounts(id), updated_at timestamptz not null default now(),
 note text not null default '', checks text not null default '', admin_notified boolean not null default false,
 status text not null check(status in ('CONFIRMED','EXCEPTION','PROVISIONAL','REVIEW'))
);
create table if not exists public.win_ops_corrections (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 movement_id uuid not null references public.win_cash_movements(id), actor_id uuid not null references win_auth.login_accounts(id),
 proposed_amount numeric(14,2) not null, proposed_method text not null check(proposed_method in ('CASH','TRANSFER','CARD','OTHER')),
 reason text not null check(length(btrim(reason)) between 5 and 400), created_at timestamptz not null default now(),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 decided_by uuid references win_auth.login_accounts(id), decided_at timestamptz, decision_note text,
 constraint win_ops_correction_amount check(abs(proposed_amount)<=1000000000)
);
create unique index if not exists win_ops_correction_pending_uq on public.win_ops_corrections(movement_id) where status in ('PENDING','APPROVED');

-- Vista financiera definitiva: anulaciones como asientos inversos trazables y ajustes aprobados.
create or replace view public.win_ops_ledger with(security_invoker=true) as
 select m.id,m.shift_id,m.recorded_by,m.occurred_at,
  coalesce(original.kind,m.kind) kind, m.business_unit,
  coalesce(c.proposed_method,m.payment_method) payment_method,
  coalesce(c.proposed_amount,m.amount_signed) amount_signed,m.note,m.reference_type,m.reference_id,m.reversal_of,
  sh.business_date, o.type operation_type
 from public.win_cash_movements m
 join public.win_cash_shifts sh on sh.id=m.shift_id
 left join public.win_cash_movements original on original.id=m.reversal_of
 left join public.win_ops_corrections c on c.movement_id=m.id and c.status='APPROVED'
 left join public.win_ops_records o on m.reference_type='OPERATION' and m.reference_id=o.id::text;
revoke all on public.win_ops_ledger from public,anon,authenticated;
grant select on public.win_ops_ledger to service_role;

create or replace function public.win_ops_actor(p_token text) returns uuid language plpgsql stable set search_path='' as $$
declare a uuid;
begin
 select account_id into a from public.win_pin_session(p_token);
 if a is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(a,'CASH','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 return a;
end $$;
create or replace function public.win_ops_money(p jsonb,k text) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 n=coalesce(nullif(p->>k,'')::numeric,0);
 if n<0 or n>1000000000 or n<>round(n,2) then raise exception 'AMOUNT_INVALID';end if;
 return n;
end $$;
create or replace function public.win_ops_balance(p_teacher uuid) returns jsonb language sql stable set search_path='' as $$
 with dates as (
  select activity_date from public.win_ops_records where teacher_id=p_teacher and type='CLASE' and status='ACTIVE'
  union select activity_date from public.win_ops_allocations where teacher_id=p_teacher
 ), debts as (
  select d.activity_date,
   coalesce((select sum(win_net) from public.win_ops_records o where o.teacher_id=p_teacher and o.type='CLASE' and o.status='ACTIVE' and o.activity_date=d.activity_date),0) due,
   coalesce((select sum(a.amount) from public.win_ops_allocations a join public.win_ops_records o on o.id=a.settlement_id where a.teacher_id=p_teacher and a.activity_date=d.activity_date and o.status='ACTIVE'),0) allocated
  from dates d
 ) select jsonb_build_object('teacherId',p_teacher,'days',coalesce((select jsonb_agg(jsonb_build_object('date',activity_date,'due',due,'allocated',allocated,'pending',due-allocated) order by activity_date) from debts where due<>allocated),'[]'::jsonb),
 'credit',coalesce((select sum(cash+transfer-refund_cash) from public.win_ops_records where teacher_id=p_teacher and type='RENDICION' and status='ACTIVE'),0)
  -coalesce((select sum(a.amount) from public.win_ops_allocations a join public.win_ops_records o on o.id=a.settlement_id where a.teacher_id=p_teacher and o.status='ACTIVE'),0),
 'balance',coalesce((select sum(due) from debts),0)-coalesce((select sum(cash+transfer-refund_cash) from public.win_ops_records where teacher_id=p_teacher and type='RENDICION' and status='ACTIVE'),0))
$$;

create or replace function public.win_ops_save(p_token text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare a uuid; sh public.win_cash_shifts; o public.win_ops_records; old public.win_ops_requests; req uuid;
 typ text; dt date; tm time; dur int; ct text[]; played boolean; pax int; teacher uuid; pct numeric; gross numeric; remuneration numeric; net numeric;
 cash numeric; tr numeric; refund numeric; note text; reason text; cat text; review text; classkind text;
 st timestamptz; en timestamptz; total numeric; credit numeric; due numeric; allocated numeric:=0; item jsonb;
 mid uuid; uid uuid; meth text; val numeric; bk public.win_court_bookings; bid uuid; abid uuid; priorpaid numeric:=0;
 result jsonb; rows_count int; actual_tr numeric:=0;
begin
 a=public.win_ops_actor(p_token);
 if not public.win_can_access(a,'CASH','CREATE') then raise exception 'NOT_AUTHORIZED';end if;
 req=(p->>'requestId')::uuid;
 if req is null then raise exception 'REQUEST_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011,2);
 select * into old from public.win_ops_requests where request_id=req;
 if found then
  if old.actor_id<>a or old.action<>'save' or old.payload<>p then raise exception 'REQUEST_ID_REUSED';end if;
  return old.result||jsonb_build_object('replayed',true);
 end if;
 select * into sh from public.win_cash_shifts where id=(p->>'shiftId')::uuid for update;
 if not found or sh.status<>'OPEN' then raise exception 'SHIFT_NOT_OPEN';end if;
 typ=p->>'type'; cash=public.win_ops_money(p,'cash'); tr=public.win_ops_money(p,'transfer');refund=public.win_ops_money(p,'refundCash');
 note=btrim(coalesce(p->>'note',''));reason=btrim(coalesce(p->>'exceptionReason',''));review=btrim(coalesce(p->>'reviewNote',''));cat=p->>'category';
 dt=coalesce(nullif(p->>'date','')::date,sh.business_date);played=coalesce((p->>'played')::boolean,true);
 if typ not in ('RESERVA','ABONO','CLASE','RENDICION','EVENTO','TIENDA','GASTO','RETIRO','OTRO') or typ is null then raise exception 'CATEGORY_INVALID';end if;
 if dt>sh.business_date and typ not in ('ABONO') then raise exception 'ACTIVITY_DATE_INVALID';end if;
 if typ in ('GASTO','RETIRO') then
  if cash<=0 or tr<>0 or refund<>0 or length(note)<3 then raise exception 'CASH_EXPENSE_INVALID';end if;
  if typ='GASTO' and (cat is null or cat not in ('Artículos de limpieza','Bar / Compras','Inversión / Equipamiento pádel','Inversión / Equipamiento club','Mantenimiento y reparaciones / Gastos menores','Otros gastos')) then raise exception 'CATEGORY_INVALID';end if;
 end if;
 if typ in ('TIENDA','OTRO') and (cash+tr<=0 or length(note)<3) then raise exception 'CONCEPT_REQUIRED';end if;
 if refund>0 and typ<>'RENDICION' then raise exception 'PAYMENT_INVALID';end if;
 if typ='ABONO' and not played and cash+tr=0 then raise exception 'PAYMENT_INVALID';end if;
 if typ not in ('RESERVA','ABONO','CLASE','EVENTO') then played=false;end if;
 if played then
  tm=nullif(p->>'start','')::time;dur=(p->>'duration')::int;
  select array_agg(distinct x order by x) into ct from jsonb_array_elements_text(coalesce(p->'courts','[]')) x;
  if tm is null or dur is null or dur<30 or dur>720 or dur%30<>0 or ct is null or array_length(ct,1)>4 or not ct<@array['C1','C2','C3','C4'] then raise exception 'ACTIVITY_INVALID';end if;
  if typ in ('RESERVA','ABONO') and (dur not in (60,90,120) or array_length(ct,1)<>1) then raise exception 'ACTIVITY_INVALID';end if;
  if typ='CLASE' and array_length(ct,1)<>1 then raise exception 'ACTIVITY_INVALID';end if;
  st=public.win_courts_starts_at_(dt,tm);en=st+make_interval(mins=>dur);
  if exists(select 1 from public.win_ops_resources where active and court=any(ct) and tstzrange(starts_at,ends_at,'[)')&&tstzrange(st,en,'[)')) then raise exception 'COURT_ACTIVITY_OVERLAP';end if;
 else ct='{}';end if;
 bid=nullif(p->>'bookingId','')::uuid;abid=nullif(p->>'abonoId','')::uuid;
 if bid is not null and abid is not null then raise exception 'BOOKING_LINK_INVALID';end if;
 if bid is not null then
  select * into bk from public.win_court_bookings where id=bid and status='CONFIRMED' for update;
  if not found or not played or bk.business_date<>dt or bk.start_time<>tm or bk.duration_min<>dur or not bk.court=any(ct) or (typ='CLASE' and bk.kind<>'CLASE') or (typ='RESERVA' and bk.kind<>'RESERVA') then raise exception 'BOOKING_LINK_INVALID';end if;
  select coalesce(sum(amount),0) into priorpaid from public.win_court_payments where booking_id=bid;
  if priorpaid>0 and cash+tr>0 then raise exception 'BOOKING_ALREADY_PAID';end if;
 end if;
 if abid is not null then
  if typ<>'ABONO' or not exists(select 1 from public.win_court_abonos ab where ab.id=abid and ab.court=any(ct) and ab.start_time=tm and ab.duration_min=dur and dt>=ab.starts_on and (ab.ends_on is null or dt<=ab.ends_on) and extract(isodow from dt)::int=ab.weekday) then raise exception 'BOOKING_LINK_INVALID';end if;
  select coalesce(sum(amount),0) into priorpaid from public.win_court_payments where abono_id=abid and occurrence_date=dt;
 end if;
 if played and exists(select 1 from public.win_court_bookings b where b.status='CONFIRMED' and b.court=any(ct) and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(st,en,'[)') and b.id is distinct from bid and not (b.kind='EVENTO' and typ='EVENTO' and b.starts_at=st and b.ends_at=en)) then raise exception 'AGENDA_LINK_REQUIRED';end if;
 net=0;
 if typ='RESERVA' then
  net=cash+tr+priorpaid;
  if net=0 and length(reason)<5 then raise exception 'COURTESY_REASON_REQUIRED';end if;
 elsif typ='ABONO' and played then
  if p->>'activityValue' is null then raise exception 'ACTIVITY_VALUE_REQUIRED';end if;
  net=public.win_ops_money(p,'activityValue');
  if net=0 and length(reason)<5 then raise exception 'COURTESY_REASON_REQUIRED';end if;
 elsif typ='EVENTO' then
  if dt<>sh.business_date or cash+tr<=0 then raise exception 'EVENT_SAME_DAY_REQUIRED';end if;
  pax=(p->>'participants')::int;
  if pax is null or pax<1 then raise exception 'PARTICIPANTS_REQUIRED';end if;
  net=cash+tr;
 elsif typ='CLASE' then
  teacher=(p->>'teacherId')::uuid;classkind=coalesce(p->>'classKind','TRADICIONAL');pax=nullif(p->>'participants','')::int;
  if teacher is null or not exists(select 1 from public.win_coaches where id=teacher and active) or classkind not in ('TRADICIONAL','PARTIDO') then raise exception 'COACH_INVALID';end if;
  if cash+tr<>0 then raise exception 'CLASS_IS_NOT_CASH';end if;
  if not played then raise exception 'ACTIVITY_INVALID';end if;
  if exists(select 1 from public.win_ops_records c where c.type='CLASE' and c.status='ACTIVE' and c.teacher_id=teacher and public.win_courts_starts_at_(c.activity_date,c.start_time)<en and public.win_courts_starts_at_(c.activity_date,c.start_time)+make_interval(mins=>c.duration_min)>st) then raise exception 'COACH_OVERLAP';end if;
  select r.win_pct into pct from public.win_ops_coach_rates r where r.teacher_id=teacher and r.valid_from<=dt order by valid_from desc limit 1;
  if classkind='PARTIDO' then net=public.win_ops_money(p,'winAmount');
  else
   if pax is null or pax not between 1 and 4 then raise exception 'PARTICIPANTS_REQUIRED';end if;
   if coalesce((p->>'exception')::boolean,false) then
    if length(reason)<5 then raise exception 'EXCEPTION_REASON_REQUIRED';end if;
    gross=public.win_ops_money(p,'gross');remuneration=public.win_ops_money(p,'teacherPay');net=gross-remuneration;
   else
    if pct is null then raise exception 'HISTORIC_RATE_MISSING';end if;
    select amount_cash into gross from public.win_price_list where code='CLASS_'||pax and duration_min=dur and valid_from<=dt order by valid_from desc limit 1;
    if gross is null then raise exception 'CLASS_PRICE_MISSING';end if;
    net=round(gross*pct/100,2);remuneration=gross-net;
   end if;
  end if;
 elsif typ='RENDICION' then
  teacher=(p->>'teacherId')::uuid;
  if teacher is null or not exists(select 1 from public.win_coaches where id=teacher) then raise exception 'COACH_INVALID';end if;
  credit=(public.win_ops_balance(teacher)->>'credit')::numeric;
  if refund>0 and (cash+tr>0 or jsonb_array_length(coalesce(p->'allocations','[]'))>0 or refund>credit) then raise exception 'CREDIT_INVALID';end if;
  if jsonb_array_length(coalesce(p->'allocations','[]'))>366 then raise exception 'ALLOCATION_INVALID';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p->'allocations','[]')) x group by x->>'date' having count(*)>1) then raise exception 'ALLOCATION_INVALID';end if;
  for item in select * from jsonb_array_elements(coalesce(p->'allocations','[]')) loop
   if (item->>'date')::date>sh.business_date then raise exception 'ALLOCATION_INVALID';end if;
   select coalesce(sum(win_net),0) into due from public.win_ops_records where teacher_id=teacher and type='CLASE' and status='ACTIVE' and activity_date=(item->>'date')::date;
   due=due-coalesce((select sum(al.amount) from public.win_ops_allocations al join public.win_ops_records z on z.id=al.settlement_id where al.teacher_id=teacher and al.activity_date=(item->>'date')::date and z.status='ACTIVE'),0);
   val=(item->>'amount')::numeric;
   if val is null or val=0 or val<>round(val,2) or (due>=0 and (val<0 or val>due)) or (due<0 and (val>0 or val<due)) then raise exception 'ALLOCATION_INVALID';end if;
   allocated=allocated+val;
  end loop;
  if allocated>cash+tr+credit or (cash+tr+refund=0 and jsonb_array_length(coalesce(p->'allocations','[]'))=0) then raise exception 'ALLOCATION_INVALID';end if;
 end if;
 insert into public.win_ops_records(request_id,shift_id,actor_id,type,activity_date,start_time,duration_min,courts,played,teacher_id,participants,class_kind,gross,teacher_pay,win_net,win_pct,cash,transfer,refund_cash,category,note,exception_reason,review_note,booking_id,abono_id)
 values(req,sh.id,a,typ,dt,tm,dur,ct,played,teacher,pax,classkind,gross,remuneration,net,pct,cash,tr,refund,cat,note,reason,review,bid,abid) returning * into o;
 if played then insert into public.win_ops_resources(operation_id,court,starts_at,ends_at) select o.id,unnest(ct),st,en;end if;
 if typ='RENDICION' then
  insert into public.win_ops_allocations(settlement_id,teacher_id,activity_date,amount)
  select o.id,teacher,(x->>'date')::date,(x->>'amount')::numeric from jsonb_array_elements(coalesce(p->'allocations','[]')) x;
 end if;
 uid=o.id;
 for meth,val in select 'CASH',cash union all select 'TRANSFER',tr union all select 'CASH',-refund loop
  if val<>0 then
   if typ in ('GASTO','RETIRO') then val=-val;end if;
   if val<0 and meth='CASH' and -val>sh.opening_cash+coalesce((select sum(amount_signed) from public.win_cash_movements where shift_id=sh.id and payment_method='CASH'),0) then raise exception 'INSUFFICIENT_CASH';end if;
   insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,reference_type,reference_id,note)
   values(gen_random_uuid(),sh.id,a,case when typ='GASTO' then 'EXPENSE' when typ='RETIRO' then 'WITHDRAWAL' when val<0 then 'REFUND' else 'SALE' end,
    case when typ in ('RESERVA','ABONO') then 'COURTS' when typ in ('CLASE','RENDICION') then 'ACADEMY' when typ='EVENTO' then 'EVENTS' when typ='TIENDA' then 'SHOP' else 'GENERAL' end,
    meth,val,'OPERATION',o.id::text,note) returning id into mid;
   if meth='TRANSFER' then
    for item in select * from jsonb_array_elements(coalesce(p->'receipts','[]')) loop
     if length(btrim(coalesce(item->>'reference','')))>0 then
      actual_tr=actual_tr+public.win_ops_money(item,'amount');
      insert into public.win_ops_receipts values(mid,btrim(item->>'reference'),public.win_ops_money(item,'amount'),true);
     end if;
    end loop;
    if actual_tr>tr then raise exception 'RECEIPT_AMOUNT_INVALID';end if;
    if actual_tr<tr then
     insert into public.win_ops_receipts values(mid,'PENDIENTE:'||o.id,tr-actual_tr,false);
     insert into public.win_ops_notices(source_type,source_id,message,actor_id) values('RECEIPT',mid::text,'Comprobante de transferencia pendiente · '||typ||' · $'||tr,a);
    end if;
   end if;
  end if;
 end loop;
 if review<>'' then insert into public.win_ops_notices(source_type,source_id,message,actor_id) values('OPERATION',o.id::text,review,a);end if;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail) values(a,'CREATE_OPERATION','OPERATION',o.id::text,to_jsonb(o));
 result=jsonb_build_object('id',o.id,'type',typ,'saved',true);
 insert into public.win_ops_requests values(req,a,'save',p,result,now());
 return result;
end $$;

-- Las tablas nuevas no están expuestas a los roles del navegador.
do $$ declare t text;begin
 foreach t in array array['win_ops_requests','win_ops_records','win_ops_resources','win_ops_allocations','win_ops_receipts','win_ops_notices','win_ops_coach_rates','win_ops_day_controls','win_ops_corrections'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
 end loop;
end $$;
