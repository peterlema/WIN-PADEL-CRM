-- Read-only snapshot for reception. Never counts scheduled court bookings as played.
create or replace function public.win_reception_overview(p_token text)
returns jsonb
language plpgsql stable security invoker set search_path=''
as $body$
declare
 actor uuid; user_role text; sh public.win_cash_shifts%rowtype;
 summary jsonb; recent jsonb; expected numeric;
begin
 select s.account_id,s.role into actor,user_role from public.win_pin_session(p_token) s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if not public.win_can_access(actor,'CASH','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 select * into sh from public.win_cash_shifts where status='OPEN' order by opened_at desc limit 1;
 if not found then return jsonb_build_object('shift',null,'totals',null,'movements','[]'::jsonb,'activitiesAvailable',false,'noticesAvailable',false);end if;
 select jsonb_build_object(
   'cash_expected',sh.opening_cash + coalesce(sum(m.amount_signed) filter (where m.payment_method='CASH'),0),
   'transfer_received',coalesce(sum(m.amount_signed) filter (where m.payment_method='TRANSFER' and m.amount_signed>0),0),
   'transfer_out',coalesce(sum(-m.amount_signed) filter (where m.payment_method='TRANSFER' and m.amount_signed<0),0),
   'cash_received',coalesce(sum(m.amount_signed) filter (where m.payment_method='CASH' and m.amount_signed>0),0),
   'cash_out',coalesce(sum(-m.amount_signed) filter (where m.payment_method='CASH' and m.amount_signed<0),0),
   'movements_count',count(m.id)
 ) into summary from public.win_cash_movements m where m.shift_id=sh.id;
 select coalesce(jsonb_agg(q.payload order by q.occurred_at desc),'[]'::jsonb) into recent
 from (
   select m.occurred_at, jsonb_build_object(
     'id',m.id,'date',m.occurred_at,'kind',m.kind,'unit',m.business_unit,
     'paymentMethod',m.payment_method,'amount',m.amount_signed,'note',m.note,
     'recordedBy',coalesce(a.display_name,'Usuario'),'shiftOwner',coalesce(owner.display_name,'Usuario')
   ) as payload
   from public.win_cash_movements m
   left join win_auth.login_accounts a on a.id=m.recorded_by
   left join win_auth.login_accounts owner on owner.id=sh.opened_by
   where m.shift_id=sh.id
   order by m.occurred_at desc limit 100
 ) q;
 return jsonb_build_object(
   'shift',jsonb_build_object('id',sh.id,'opened_by',sh.opened_by,'responsible',coalesce((select display_name from win_auth.login_accounts where id=sh.opened_by),'Usuario'),'opened_at',sh.opened_at,'business_date',sh.business_date,'opening_cash',sh.opening_cash),
   'totals',summary,'movements',recent,'activitiesAvailable',false,'noticesAvailable',false,
   'limitedHistory',true
 );
end;$body$;
revoke all on function public.win_reception_overview(text) from public,anon,authenticated;
grant execute on function public.win_reception_overview(text) to service_role;