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
  return jsonb_build_object('rows',public.win_calendar_rows(d1,d2),'settings',public.win_settings_get(p_token),'context',public.win_ops_context(p_token,d1));
 elsif p_action='quote' then
  dt=(p->>'date')::date;dur=(p->>'duration')::int;
  if dt is null or dur is null then raise exception 'BOOKING_INVALID';end if;
  if p->>'kind'='CLASE' then
   b.business_date=dt;b.duration_min=dur;b.teacher_id=nullif(p->>'teacherId','')::uuid;b.lesson=coalesce(p->'lesson','{}');
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
  return jsonb_build_object('customer',(select to_jsonb(c) from public.win_customers c where id=cid),'bookings',coalesce((select jsonb_agg(public.win_calendar_json(b) order by business_date desc) from public.win_court_bookings b where b.customer_id=cid or exists(select 1 from public.win_calendar_participants x where x.booking_id=b.id and x.customer_id=cid)),'[]'),'abonos',coalesce((select jsonb_agg(to_jsonb(s)) from public.win_court_abonos s where customer_id=cid),'[]'));
 elsif p_action='waitlist' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('name',c.name,'phone',c.phone) order by w.created_at) from public.win_calendar_waitlist w join public.win_customers c on c.id=w.customer_id),'[]'),
   'opportunities',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('name',c.name,'phone',c.phone,'court',s.court,'weekday',s.weekday,'start',s.start_time,'duration',s.duration_min)) from public.win_calendar_opportunities o join public.win_calendar_waitlist w on w.id=o.waitlist_id and w.status in('PENDING','CONTACTED') join public.win_customers c on c.id=w.customer_id join public.win_court_abonos s on s.id=o.abono_id),'[]'));
 elsif p_action='abonos' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s) order by weekday,start_time,court) from public.win_court_abonos s),'[]'));
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
  lesson_=coalesce(p->'lesson','{}');teacher=nullif(p->>'teacherId','')::uuid;
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
