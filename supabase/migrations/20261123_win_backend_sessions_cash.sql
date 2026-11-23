-- WIN backend source snapshots, retrieved from deployed PostgreSQL functions.
-- Apply after 20261123_win_private_username_pin_accounts.sql.
alter table public.win_staff drop constraint if exists win_staff_user_id_fkey;
alter table public.win_staff add constraint win_staff_user_id_fkey foreign key(user_id) references win_auth.login_accounts(id) on delete restrict;
create table if not exists win_auth.login_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references win_auth.login_accounts(id) on delete cascade,
  token_digest text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint session_expiry check(expires_at>created_at)
);
alter table win_auth.login_sessions enable row level security;
revoke all on win_auth.login_sessions from public, anon, authenticated;
grant select,insert,update,delete on win_auth.login_sessions to service_role;

CREATE OR REPLACE FUNCTION public.win_pin_login(p_username text, p_pin text)
 RETURNS TABLE(login_status text, session_token text, account_id uuid, display_name text, role text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 a win_auth.login_accounts%rowtype;
 t text;
 exp timestamptz;
begin
 if p_username is null or length(btrim(p_username)) not between 3 and 100 or p_pin is null or p_pin !~ '^[0-9]{6}$' then
   return query select 'INVALID'::text,null::text,null::uuid,null::text,null::text,null::timestamptz; return;
 end if;
 select * into a from win_auth.login_accounts where username_key=lower(btrim(p_username)) for update;
 if not found or not a.enabled then
   return query select 'INVALID'::text,null::text,null::uuid,null::text,null::text,null::timestamptz; return;
 end if;
 if a.locked_until is not null and a.locked_until>now() then
   return query select 'LOCKED'::text,null::text,null::uuid,null::text,null::text,a.locked_until; return;
 end if;
 if a.pin_hash <> extensions.crypt(p_pin,a.pin_hash) then
   update win_auth.login_accounts set
    failed_attempts=failed_attempts+1,
    locked_until=case when failed_attempts>=4 then now()+interval '15 minutes' else null end,
    updated_at=now()
   where id=a.id;
   return query select 'INVALID'::text,null::text,null::uuid,null::text,null::text,null::timestamptz; return;
 end if;
 update win_auth.login_accounts set failed_attempts=0,locked_until=null,updated_at=now() where id=a.id;
 t=encode(extensions.gen_random_bytes(32),'hex'); exp=now()+interval '8 hours';
 insert into win_auth.login_sessions(account_id,token_digest,expires_at)
 values(a.id,encode(extensions.digest(t,'sha256'),'hex'),exp);
 return query select 'OK'::text,t,a.id,a.display_name,a.role,exp;
end;$function$;

CREATE OR REPLACE FUNCTION public.win_pin_session(p_token text)
 RETURNS TABLE(account_id uuid, display_name text, role text, expires_at timestamp with time zone)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select a.id,a.display_name,a.role,s.expires_at
 from win_auth.login_sessions s join win_auth.login_accounts a on a.id=s.account_id
 where s.token_digest=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
   and s.revoked_at is null and s.expires_at>now()
   and a.enabled
 limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.win_pin_logout(p_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 update win_auth.login_sessions
 set revoked_at=now()
 where token_digest=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
  and revoked_at is null;
 return found;
end;$function$;

CREATE OR REPLACE FUNCTION public.win_cash_state(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid; r text; sh public.win_cash_shifts%rowtype; expected numeric;
begin
 select s.account_id,s.role into a,r from public.win_pin_session(p_token) s;
 if a is null then raise exception 'SESSION_INVALID'; end if;
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
 if r not in ('ADMIN','MANAGER','RECEPTION') then raise exception 'NOT_AUTHORIZED';end if;
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
 if r not in ('ADMIN','MANAGER','RECEPTION','BAR') then raise exception 'NOT_AUTHORIZED';end if;
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
revoke all on function public.win_pin_login(text,text),public.win_pin_session(text),public.win_pin_logout(text),public.win_cash_state(text),public.win_cash_open(text,numeric),public.win_cash_entry(text,uuid,uuid,text,text,text,numeric,text),public.win_cash_close(text,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.win_pin_login(text,text),public.win_pin_session(text),public.win_pin_logout(text),public.win_cash_state(text),public.win_cash_open(text,numeric),public.win_cash_entry(text,uuid,uuid,text,text,text,numeric,text),public.win_cash_close(text,uuid,numeric,text) to service_role;
grant usage on schema win_auth to service_role;
grant select,insert,update on win_auth.login_accounts to service_role;
