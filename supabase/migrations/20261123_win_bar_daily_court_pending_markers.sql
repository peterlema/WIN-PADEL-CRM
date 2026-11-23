-- Small daily Bar debt markers for the calendar. Only users with COURTS VIEW may read them.
create or replace function public.win_bar_court_day_pending(p_token text,p_day date)
returns jsonb language plpgsql stable security invoker set search_path=''
as $fn$
declare uid uuid; markers jsonb;
begin
 select account_id into uid from public.win_pin_session(p_token) limit 1;
 if uid is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(uid,'COURTS','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 if p_day is null then raise exception 'DATE_INVALID';end if;
 select coalesce(jsonb_agg(jsonb_build_object('court',x.court,'start',x.start_time,
    'balance',x.balance,'orders',x.order_count) order by x.court,x.start_time),'[]'::jsonb)
 into markers from (
  select o.court,to_char(o.court_start,'HH24:MI') as start_time,
         sum(o.total-coalesce(p.paid,0)) as balance,count(*) as order_count
  from public.win_bar_orders o
  left join (select order_id,sum(amount) as paid from public.win_bar_order_payments group by order_id) p on p.order_id=o.id
  where o.status='OPEN' and o.destination='COURT' and o.court_date=p_day
  group by o.court,o.court_start
 ) x;
 return jsonb_build_object('slots',markers);
end;$fn$;
revoke all on function public.win_bar_court_day_pending(text,date) from public,anon,authenticated;
grant execute on function public.win_bar_court_day_pending(text,date) to service_role;