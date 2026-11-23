-- Enforce role_permissions in existing cash and courts RPCs. Requires win_rbac_roles_permissions_initial migration.
CREATE OR REPLACE FUNCTION public.win_cash_state(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid; r text; sh public.win_cash_shifts%rowtype; expected numeric;
begin
 select s.account_id,s.role into a,r from public.win_pin_session(p_token) s;
 if a is null then raise exception 'SESSION_INVALID'; end if;
 if r='BAR' then
  select * into sh from public.win_cash_shifts where status='OPEN' order by opened_at desc limit 1;
  if not found then return jsonb_build_object('shift',null,'role',r); end if;
  return jsonb_build_object('role',r,'shift',jsonb_build_object('id',sh.id,'status',sh.status,'business_date',sh.business_date));
 end if;
 if not public.win_can_access(a,'CASH','VIEW') then raise exception 'NOT_AUTHORIZED'; end if;
 select * into sh from public.win_cash_shifts where status='OPEN' order by opened_at desc limit 1;
 if not found then return jsonb_build_object('shift',null,'role',r); end if;
 select sh.opening_cash+coalesce(sum(amount_signed) filter(where payment_method='CASH'),0)
 into expected from public.win_cash_movements where shift_id=sh.id;
 return jsonb_build_object('role',r,'shift',jsonb_build_object('id',sh.id,'opened_at',sh.opened_at,'business_date',sh.business_date,'opened_by',sh.opened_by,'opening_cash',sh.opening_cash,'expected_cash',expected));
end;$function$;

CREATE OR REPLACE FUNCTION public.win_cash_open(p_token text, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid; r text; new_shift uuid; open_shift uuid;
begin
 select s.account_id,s.role into a,r from public.win_pin_session(p_token) s;
 if a is null then raise exception 'SESSION_INVALID'; end if;
 if not public.win_can_access(a,'CASH','OPEN') then raise exception 'NOT_AUTHORIZED';end if;
 if p_amount is null or p_amount<0 or p_amount>1000000000 or p_amount<>round(p_amount,2) then raise exception 'AMOUNT_INVALID';end if;
 perform pg_catalog.pg_advisory_xact_lock(438011, 1);
 select id into open_shift from public.win_cash_shifts where status='OPEN';
 if open_shift is not null then raise exception 'SHIFT_ALREADY_OPEN';end if;
 insert into public.win_cash_shifts(opened_by,business_date,opening_cash)
 values(a,(now() at time zone 'America/Argentina/Buenos_Aires')::date,p_amount)
 returning id into new_shift;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)
 values(a,'OPEN_SHIFT','CASH_SHIFT',new_shift::text,jsonb_build_object('opening_cash',p_amount));
 return jsonb_build_object('id',new_shift,'status','OPEN');
end;$function$;

CREATE OR REPLACE FUNCTION public.win_cash_entry(p_token text, p_request_id uuid, p_shift_id uuid, p_kind text, p_unit text, p_method text, p_amount numeric, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid; r text; sh public.win_cash_shifts%rowtype; existing public.win_cash_movements%rowtype; signed_amount numeric; movement_id uuid;
begin
 select s.account_id,s.role into a,r from public.win_pin_session(p_token) s;
 if a is null then raise exception 'SESSION_INVALID';end if;
 if not (case when r='BAR' then public.win_can_access(a,'BAR','SALE') else public.win_can_access(a,'CASH','CREATE') end) then raise exception 'NOT_AUTHORIZED';end if;
 if p_kind not in ('SALE','EXPENSE','WITHDRAWAL','DEPOSIT') or p_unit not in ('COURTS','ACADEMY','EVENTS','CAFE_BAR','SHOP','GENERAL')
   or p_method not in ('CASH','TRANSFER','CARD','OTHER') then raise exception 'CATEGORY_INVALID';end if;
 if p_amount is null or p_amount<=0 or p_amount>1000000000 or p_amount<>round(p_amount,2) then raise exception 'AMOUNT_INVALID';end if;
 if length(coalesce(p_note,''))>400 then raise exception 'NOTE_TOO_LONG';end if;
 if r='BAR' and (p_kind<>'SALE' or p_unit<>'CAFE_BAR') then raise exception 'NOT_AUTHORIZED';end if;
 if p_kind='WITHDRAWAL' and p_method<>'CASH' then raise exception 'METHOD_INVALID';end if;
 signed_amount=case when p_kind in ('SALE','DEPOSIT') then p_amount else -p_amount end;
 select * into sh from public.win_cash_shifts where id=p_shift_id for update;
 if not found or sh.status<>'OPEN' then raise exception 'SHIFT_NOT_OPEN';end if;
 select * into existing from public.win_cash_movements where request_id=p_request_id;
 if found then
  if existing.shift_id<>p_shift_id or existing.kind<>p_kind or existing.business_unit<>p_unit or existing.payment_method<>p_method
     or existing.amount_signed<>signed_amount or existing.note<>coalesce(p_note,'') then raise exception 'REQUEST_ID_REUSED';end if;
  return jsonb_build_object('id',existing.id,'replayed',true);
 end if;
 insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,note)
 values(p_request_id,p_shift_id,a,p_kind,p_unit,p_method,signed_amount,coalesce(p_note,''))
 returning id into movement_id;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)
 values(a,'ADD_MOVEMENT','CASH_MOVEMENT',movement_id::text,jsonb_build_object('shift_id',p_shift_id,'kind',p_kind,'unit',p_unit,'method',p_method,'amount',signed_amount));
 return jsonb_build_object('id',movement_id,'replayed',false);
end;$function$;

CREATE OR REPLACE FUNCTION public.win_cash_close(p_token text, p_shift_id uuid, p_counted numeric, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid; r text; sh public.win_cash_shifts%rowtype; expected numeric;
begin
 select s.account_id,s.role into a,r from public.win_pin_session(p_token) s;
 if a is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(a,'CASH','CLOSE') then raise exception 'NOT_AUTHORIZED';end if;
 select * into sh from public.win_cash_shifts where id=p_shift_id for update;
 if not found or sh.status<>'OPEN' then raise exception 'SHIFT_NOT_OPEN';end if;
 if a<>sh.opened_by and r<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if p_counted is null or p_counted<0 or p_counted>1000000000 or p_counted<>round(p_counted,2) then raise exception 'AMOUNT_INVALID';end if;
 if length(coalesce(p_note,''))>400 then raise exception 'NOTE_TOO_LONG';end if;
 select sh.opening_cash+coalesce(sum(amount_signed) filter(where payment_method='CASH'),0) into expected
  from public.win_cash_movements where shift_id=p_shift_id;
 if p_counted<>expected and length(btrim(coalesce(p_note,'')))<5 then raise exception 'DIFFERENCE_REQUIRES_NOTE';end if;
 update public.win_cash_shifts set status='CLOSED',closed_by=a,closed_at=now(),counted_cash=p_counted,note=coalesce(p_note,'') where id=p_shift_id;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)
 values(a,'CLOSE_SHIFT','CASH_SHIFT',p_shift_id::text,jsonb_build_object('expected',expected,'counted',p_counted,'difference',p_counted-expected));
 return jsonb_build_object('id',p_shift_id,'expected_cash',expected,'counted_cash',p_counted,'difference',p_counted-expected);
end;$function$;

CREATE OR REPLACE FUNCTION public.win_courts_identity_(p_token text)
 RETURNS TABLE(account_id uuid, display_name text, role text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  return query select s.account_id, s.display_name, s.role from public.win_pin_session(p_token) s limit 1;
  if not found then raise exception 'SESSION_INVALID'; end if;
 if not public.win_can_access((select s.account_id from public.win_pin_session(p_token) s limit 1),'COURTS','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
end $function$;

CREATE OR REPLACE FUNCTION public.win_courts_book(p_token text, p_request_id uuid, p_court text, p_date date, p_start text, p_duration integer, p_kind text, p_holder text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor record;
  v_start time;
  v_starts timestamptz;
  v_existing public.win_court_bookings;
  v_new public.win_court_bookings;
  v_kind text := upper(btrim(coalesce(p_kind, '')));
  v_holder text := btrim(coalesce(p_holder, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id,'COURTS','CREATE') then raise exception 'NOT_AUTHORIZED'; end if;

  if p_request_id is null or p_date is null or coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):(00|30)$'
     or p_court is null or p_court not in ('C1','C2','C3','C4')
     or v_kind not in ('RESERVA','CLASE','EVENTO','BLOQUEO')
     or length(v_holder) not between 1 and 120 or length(v_note) > 400 then
    raise exception 'BOOKING_INVALID';
  end if;
  if (v_kind in ('RESERVA','CLASE') and p_duration not in (60, 90, 120))
     or (v_kind in ('EVENTO','BLOQUEO') and (p_duration is null or p_duration not between 30 and 720 or p_duration % 30 <> 0)) then
    raise exception 'DURATION_INVALID';
  end if;

  v_start := p_start::time;
  v_starts := public.win_courts_starts_at_(p_date, v_start);

  select * into v_existing from public.win_court_bookings where request_id = p_request_id;
  if found then
    if v_existing.court = p_court and v_existing.business_date = p_date and v_existing.start_time = v_start
       and v_existing.duration_min = p_duration and v_existing.kind = v_kind and v_existing.holder = v_holder then
      return public.win_courts_json_(v_existing);
    end if;
    raise exception 'REQUEST_ID_REUSED';
  end if;

  if v_actor.role <> 'ADMIN' and v_starts + make_interval(mins => p_duration) < now() then
    raise exception 'BOOKING_IN_PAST';
  end if;

  begin
    insert into public.win_court_bookings
      (request_id, court, business_date, start_time, duration_min, starts_at, ends_at, kind, holder, note, created_by)
    values
      (p_request_id, p_court, p_date, v_start, p_duration, v_starts, v_starts + make_interval(mins => p_duration),
       v_kind, v_holder, v_note, v_actor.account_id)
    returning * into v_new;
  exception
    when exclusion_violation then raise exception 'COURT_TAKEN';
    when unique_violation then raise exception 'REQUEST_ID_REUSED';
  end;

  insert into public.win_court_booking_events (booking_id, actor_id, action, detail)
  values (v_new.id, v_actor.account_id, 'CREATE', public.win_courts_json_(v_new));
  return public.win_courts_json_(v_new);
end $function$;

CREATE OR REPLACE FUNCTION public.win_courts_cancel(p_token text, p_booking_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor record;
  v_booking public.win_court_bookings;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_actor from public.win_courts_identity_(p_token);
  if not public.win_can_access(v_actor.account_id,'COURTS','CANCEL') then raise exception 'NOT_AUTHORIZED';end if;
  if length(v_reason) not between 1 and 400 then raise exception 'REASON_REQUIRED'; end if;

  select * into v_booking from public.win_court_bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'CONFIRMED' then raise exception 'BOOKING_NOT_FOUND'; end if;
  if v_actor.role not in ('ADMIN','MANAGER') and v_booking.created_by <> v_actor.account_id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.win_court_bookings
     set status = 'CANCELLED', cancelled_by = v_actor.account_id, cancelled_at = now(), cancel_reason = v_reason
   where id = p_booking_id
  returning * into v_booking;

  insert into public.win_court_booking_events (booking_id, actor_id, action, detail)
  values (v_booking.id, v_actor.account_id, 'CANCEL', jsonb_build_object('motivo', v_reason));
  return public.win_courts_json_(v_booking);
end $function$;
