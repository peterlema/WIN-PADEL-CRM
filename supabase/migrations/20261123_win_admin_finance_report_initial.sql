-- ADMIN-only read reports. Finance is cash movements; activity metrics are NOT inferred.
create or replace function public.win_admin_finance_report(
  p_token text, p_start date, p_end date
) returns jsonb
language plpgsql stable security invoker set search_path=''
as $fn$
declare
  actor uuid;
  actor_role text;
  start_at timestamptz;
  end_at timestamptz;
  totals jsonb;
  days jsonb;
  categories jsonb;
  methods jsonb;
  recent jsonb;
begin
  select s.account_id, s.role into actor,actor_role from public.win_pin_session(p_token) s;
  if actor is null then raise exception 'SESSION_INVALID'; end if;
  if actor_role <> 'ADMIN' then raise exception 'NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end > p_start + 366
    then raise exception 'PERIOD_INVALID'; end if;
  start_at := p_start::timestamp at time zone 'America/Argentina/Buenos_Aires';
  end_at := (p_end + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  with entries as (
    select m.* from public.win_cash_movements m
    where m.occurred_at >= start_at and m.occurred_at < end_at
  ) select jsonb_build_object(
    'collected',coalesce(sum(amount_signed) filter (where kind in ('SALE','DEPOSIT')),0),
    'expenses',coalesce(sum(-amount_signed) filter (where kind = 'EXPENSE'),0),
    'withdrawals',coalesce(sum(-amount_signed) filter (where kind = 'WITHDRAWAL'),0),
    'refunds',coalesce(sum(-amount_signed) filter (where kind = 'REFUND'),0),
    'entries',count(*),
    'result',coalesce(sum(amount_signed) filter (where kind in ('SALE','DEPOSIT','EXPENSE')),0)
  ) into totals from entries;

  with calendar as (
    select x::date as day from generate_series(p_start,p_end, interval '1 day') x
  ), grouped as (
    select (occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as day,
      coalesce(sum(amount_signed) filter (where kind in ('SALE','DEPOSIT')),0) as collected,
      coalesce(sum(-amount_signed) filter (where kind='EXPENSE'),0) as expenses,
      coalesce(sum(-amount_signed) filter (where kind='WITHDRAWAL'),0) as withdrawals
    from public.win_cash_movements
    where occurred_at >= start_at and occurred_at < end_at
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('date',c.day,'collected',coalesce(g.collected,0),
     'expenses',coalesce(g.expenses,0),'withdrawals',coalesce(g.withdrawals,0)) order by c.day),'[]'::jsonb)
  into days from calendar c left join grouped g using(day);

  select coalesce(jsonb_agg(jsonb_build_object(
    'unit',v.business_unit, 'kind',v.kind,'collected',v.collected,'expenses',v.expenses,
    'withdrawals',v.withdrawals,'count',v.n) order by v.business_unit,v.kind),'[]'::jsonb)
  into categories
  from (select business_unit,kind,count(*) as n,
    coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT')),0) as collected,
    coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0) as expenses,
    coalesce(sum(-amount_signed) filter(where kind='WITHDRAWAL'),0) as withdrawals
    from public.win_cash_movements where occurred_at>=start_at and occurred_at<end_at
    group by business_unit,kind) v;

  select coalesce(jsonb_agg(jsonb_build_object('method',v.payment_method,'collected',v.collected,'expenses',v.expenses,'count',v.n) order by v.payment_method),'[]'::jsonb)
  into methods from (
    select payment_method,count(*) as n,
      coalesce(sum(amount_signed) filter(where kind in ('SALE','DEPOSIT')),0) as collected,
      coalesce(sum(-amount_signed) filter(where kind='EXPENSE'),0) as expenses
    from public.win_cash_movements where occurred_at>=start_at and occurred_at<end_at group by payment_method
  ) v;

  select coalesce(jsonb_agg(v.payload order by v.occurred_at desc),'[]'::jsonb)
  into recent from (
    select m.occurred_at,jsonb_build_object(
      'id',m.id,'occurredAt',m.occurred_at,'unit',m.business_unit,'kind',m.kind,
      'amount',m.amount_signed,'method',m.payment_method,'note',m.note,
      'user',coalesce(a.display_name,'Usuario'),'shiftId',m.shift_id
    ) as payload
    from public.win_cash_movements m
    left join win_auth.login_accounts a on a.id=m.recorded_by
    where m.occurred_at>=start_at and m.occurred_at<end_at
    order by m.occurred_at desc limit 100
  ) v;

  return jsonb_build_object('start',p_start,'end',p_end,'totals',totals,'daily',days,
     'categories',categories,'methods',methods,'recent',recent,
     'recentLimit',100,'scope','registered_cash_movements_only',
     'activityAvailable',false,'completeAdministrativeExpenses',false);
end;$fn$;
revoke all on function public.win_admin_finance_report(text,date,date) from public,anon,authenticated;
grant execute on function public.win_admin_finance_report(text,date,date) to service_role;