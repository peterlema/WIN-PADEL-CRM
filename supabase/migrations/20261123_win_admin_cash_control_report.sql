-- ADMIN read-only cash shift controls. Does not pretend bank reconciliation exists.
create or replace function public.win_admin_cash_control(p_token text,p_start date,p_end date)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; actor_role text; output jsonb;
begin
 select s.account_id,s.role into uid,actor_role from public.win_pin_session(p_token) s;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if actor_role<>'ADMIN' then raise exception 'NOT_AUTHORIZED';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end>p_start+366 then raise exception 'PERIOD_INVALID';end if;
 select coalesce(jsonb_agg(v.payload order by v.opened_at desc),'[]'::jsonb) into output
 from (
 select sh.opened_at,
   jsonb_build_object(
    'id',sh.id,'status',sh.status,'businessDate',sh.business_date,
    'openedAt',sh.opened_at,'closedAt',sh.closed_at,
    'responsible',coalesce(st.display_name,'Usuario'),
    'closingUser',coalesce(cl.display_name,''),
    'openingCash',sh.opening_cash,'countedCash',sh.counted_cash,
    'expectedCash',sh.opening_cash+coalesce(sum(m.amount_signed) filter (where m.payment_method='CASH'),0),
    'cashDifference',case when sh.status='CLOSED' then sh.counted_cash-(sh.opening_cash+coalesce(sum(m.amount_signed) filter(where m.payment_method='CASH'),0)) else null end,
    'transferReceived',coalesce(sum(m.amount_signed) filter (where m.payment_method='TRANSFER' and m.amount_signed>0),0),
    'movementCount',count(m.id),'note',sh.note
   ) as payload
 from public.win_cash_shifts sh
 left join win_auth.login_accounts st on st.id=sh.opened_by
 left join win_auth.login_accounts cl on cl.id=sh.closed_by
 left join public.win_cash_movements m on m.shift_id=sh.id
 where sh.business_date between p_start and p_end
 group by sh.id,st.display_name,cl.display_name
 order by sh.opened_at desc limit 200
 ) v;
 return jsonb_build_object('shifts',output,'limit',200,'bankReconciliationAvailable',false,'dailyClosingAvailable',false);
end;$fn$;
revoke all on function public.win_admin_cash_control(text,date,date) from public,anon,authenticated;
grant execute on function public.win_admin_cash_control(text,date,date) to service_role;