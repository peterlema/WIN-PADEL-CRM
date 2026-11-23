-- Mantener el contrato del Calendario y sumar el estado de cobro de Recepción.
do $$begin
 if to_regprocedure('public.win_ops_courts_day_base(text,date)') is null then
  alter function public.win_courts_day(text,date) rename to win_ops_courts_day_base;
 end if;
end $$;
create or replace function public.win_courts_day(p_token text,p_date date) returns jsonb language plpgsql stable set search_path='' as $$
declare original jsonb; rows_ jsonb;
begin
 original=public.win_ops_courts_day_base(p_token,p_date);
 select coalesce(jsonb_agg(case when op.id is not null then b||jsonb_build_object('actividadRegistrada',true) else b end),'[]') into rows_
 from jsonb_array_elements(original->'reservas') b
 left join lateral(select o.id from public.win_ops_records o where o.status='ACTIVE' and o.played and (o.booking_id=(b->>'id')::uuid or (o.abono_id=(b->>'abonoId')::uuid and o.activity_date=p_date)) limit 1)op on true;
 -- El pago confirmado se muestra por separado de la actividad realizada.
 select coalesce(jsonb_agg(case when py.id is not null and (b->'pago' is null or b->'pago'='null'::jsonb) then b||jsonb_build_object('pago',jsonb_build_object('id',py.id,'metodo',case when py.cash>0 and py.transfer>0 then 'MIXTO' when py.transfer>0 then 'TRANSFER' else 'CASH' end,'monto',py.cash+py.transfer,'recibioNombre','Recepción','fecha',py.created_at,'comprobante',py.transfer=0 or not exists(select 1 from public.win_ops_receipts rr join public.win_cash_movements mm on mm.id=rr.movement_id where mm.reference_type='OPERATION' and mm.reference_id=py.id::text and not rr.verified),'ruta',null)) else b end),'[]') into rows_
 from jsonb_array_elements(rows_) b
 left join lateral(select o.id,o.cash,o.transfer,o.created_at from public.win_ops_records o where o.status='ACTIVE' and o.cash+o.transfer>0 and (o.booking_id=(b->>'id')::uuid or (o.abono_id=(b->>'abonoId')::uuid and o.payment_date=p_date)) limit 1)py on true;
 return original||jsonb_build_object('reservas',rows_);
end $$;
revoke all on function public.win_courts_day(text,date),public.win_ops_courts_day_base(text,date) from public,anon,authenticated;
grant execute on function public.win_courts_day(text,date),public.win_ops_courts_day_base(text,date) to service_role;
