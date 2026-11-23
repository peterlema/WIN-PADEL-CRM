-- Lectura de los datos importados a mano desde Apps Script (tablas staging win_*, carga del 23/11/2026).
-- Sólo lectura: no escribe, no toca caja real (win_cash_*). Acceso: sólo ADMIN.
-- Las tablas staging tienen RLS sin políticas; sólo el backend (service_role) llega a esta función.
create or replace function public.win_imported_snapshot(p_token text)
returns jsonb
language plpgsql stable security invoker set search_path=''
as $body$
declare
 actor uuid; user_role text;
begin
 select s.account_id,s.role into actor,user_role from public.win_pin_session(p_token) s;
 if actor is null then raise exception 'SESSION_INVALID';end if;
 if user_role is distinct from 'ADMIN' or not public.win_can_access(actor,'REPORTS','VIEW') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object(
  'resumen',(select to_jsonb(r) from public.win_resumen_admin r order by r.periodo_hasta desc limit 1),
  'clases',coalesce((select jsonb_agg(to_jsonb(c) order by c.fecha_clase desc,c.profesor) from public.win_clases_profesor_dia c),'[]'::jsonb),
  'turnos',coalesce((select jsonb_agg(to_jsonb(t) order by t.apertura) from public.win_turnos t),'[]'::jsonb),
  'movimientos',coalesce((select jsonb_agg(to_jsonb(m) order by m.fecha_hora) from public.win_movimientos m),'[]'::jsonb),
  'cobros',coalesce((select jsonb_agg(to_jsonb(d) order by d.fecha_cobro) from public.win_cobros_distribuidos d),'[]'::jsonb),
  'incidencias',coalesce((select jsonb_agg(to_jsonb(i) order by i.registrada) from public.win_incidencias i),'[]'::jsonb)
 );
end;$body$;
revoke all on function public.win_imported_snapshot(text) from public,anon,authenticated;
grant execute on function public.win_imported_snapshot(text) to service_role;

-- El proyecto no concede permisos por defecto a service_role sobre tablas nuevas creadas desde el SQL Editor:
-- sin este GRANT la función falla al leer las tablas staging. Sólo lectura; anon y authenticated siguen sin acceso.
grant select on public.win_resumen_admin, public.win_clases_profesor_dia, public.win_turnos,
  public.win_movimientos, public.win_cobros_distribuidos, public.win_incidencias to service_role;
