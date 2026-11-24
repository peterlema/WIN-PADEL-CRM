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
