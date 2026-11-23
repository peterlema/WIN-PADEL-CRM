-- M01/M02: reception expenses cash-only; all cash expenses/withdrawals cannot exceed available cash.
CREATE OR REPLACE FUNCTION public.win_cash_entry(p_token text, p_request_id uuid, p_shift_id uuid, p_kind text, p_unit text, p_method text, p_amount numeric, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid; r text; sh public.win_cash_shifts%rowtype; existing public.win_cash_movements%rowtype; signed_amount numeric; movement_id uuid; cash_available numeric;
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
 if p_kind='EXPENSE' and r='RECEPTION' and p_method<>'CASH' then raise exception 'METHOD_INVALID';end if;
 signed_amount=case when p_kind in ('SALE','DEPOSIT') then p_amount else -p_amount end;
 select * into sh from public.win_cash_shifts where id=p_shift_id for update;
 if not found or sh.status<>'OPEN' then raise exception 'SHIFT_NOT_OPEN';end if;
 select * into existing from public.win_cash_movements where request_id=p_request_id;
 if found then
  if existing.shift_id<>p_shift_id or existing.kind<>p_kind or existing.business_unit<>p_unit or existing.payment_method<>p_method
     or existing.amount_signed<>signed_amount or existing.note<>coalesce(p_note,'') then raise exception 'REQUEST_ID_REUSED';end if;
  return jsonb_build_object('id',existing.id,'replayed',true);
 end if;
 if p_kind in ('EXPENSE','WITHDRAWAL') and p_method='CASH' then
   select sh.opening_cash + coalesce(sum(amount_signed),0)
   into cash_available from public.win_cash_movements
   where shift_id=p_shift_id and payment_method='CASH';
   if p_amount>cash_available then raise exception 'INSUFFICIENT_CASH'; end if;
 end if;
 insert into public.win_cash_movements(request_id,shift_id,recorded_by,kind,business_unit,payment_method,amount_signed,note)
 values(p_request_id,p_shift_id,a,p_kind,p_unit,p_method,signed_amount,coalesce(p_note,''))
 returning id into movement_id;
 insert into public.win_cash_audit(actor_id,action,entity_type,entity_id,detail)
 values(a,'ADD_MOVEMENT','CASH_MOVEMENT',movement_id::text,jsonb_build_object('shift_id',p_shift_id,'kind',p_kind,'unit',p_unit,'method',p_method,'amount',signed_amount));
 return jsonb_build_object('id',movement_id,'replayed',false);
end;$function$;