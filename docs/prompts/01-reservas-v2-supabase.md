# Prompt 01 · Supabase: reservas v2 (precio, cobro, abonos fijos, comprobantes, quién recibe el efectivo)

Pegar este texto completo en el ChatGPT que tiene conexión a Supabase (proyecto WIN, ref `cqvoherekzntmhyzdidj`).

---

Sos mi asistente de base de datos para el proyecto Supabase de WIN Padel Club (ref `cqvoherekzntmhyzdidj`). Tenés que aplicar una migración y desplegar una Edge Function. El código ya está escrito y probado en este repositorio público de GitHub: https://github.com/peterlema/WIN-PADEL-CRM (rama `main`).

Archivos a usar, leídos tal cual están en el repo (no los reescribas ni los "mejores"):
1. Migración SQL: `supabase/migrations/20261124_win_courts_v2_pricing_payments_abonos.sql`
   https://raw.githubusercontent.com/peterlema/WIN-PADEL-CRM/main/supabase/migrations/20261124_win_courts_v2_pricing_payments_abonos.sql
2. Edge Function: `supabase/functions/win-courts/index.ts`
   https://raw.githubusercontent.com/peterlema/WIN-PADEL-CRM/main/supabase/functions/win-courts/index.ts

Si no podés leer los enlaces, pedime que te pegue el contenido de cada archivo y esperá.

## Contexto (no lo modifiques)
- La migración REEMPLAZA funciones que ya existen: `win_courts_book` (se elimina la firma vieja de 9 parámetros y se crea una de 12), `win_courts_cancel`, `win_courts_day`, `win_courts_month`, `win_courts_identity_`, `win_courts_json_`. Conserva los controles de permisos con `public.win_can_access` (COURTS VIEW/CREATE/CANCEL; USERS MANAGE para horarios). No toca nada de caja (`win_cash_*`) ni de login.
- Agrega tablas con RLS activado y sin acceso para `anon` ni `authenticated`: `win_price_list`, `win_court_abonos`, `win_court_abono_skips`, `win_court_payments`, `win_receiver_schedule`, `win_court_audit`; columnas nuevas en `win_court_bookings`; y el bucket privado `win-comprobantes` en Storage.
- Reglas de negocio: turnos de cancha de 90 minutos; precio $ 90.000 en efectivo / $ 100.000 por transferencia (tabla `win_price_list`); la reserva exige nombre y apellido, WhatsApp y método previsto; el cobro real se marca después del turno (uno por turno, no se borra ni se edita); abonos semanales fijos hasta que se den de baja; foto de comprobante para transferencias; quién recibió el efectivo según horarios por persona.

## Pasos (en este orden; frená y avisame si algo falla)
1. **Antes de cambiar nada**, mostrame el resultado de estas consultas de solo lectura:
   ```sql
   select proname, pg_get_function_identity_arguments(oid) as argumentos
   from pg_proc where pronamespace = 'public'::regnamespace and proname like 'win\_courts\_%' order by 1;
   select count(*) as reservas from public.win_court_bookings;
   select to_regprocedure('public.win_can_access(uuid,text,text)') as can_access,
          to_regprocedure('public.win_pin_session(text)') as pin_session;
   ```
   Si `can_access` o `pin_session` salen vacíos, NO sigas.
2. Aplicá la migración SQL completa como UNA sola migración (por ejemplo con `apply_migration`, nombre `win_courts_v2_pricing_payments_abonos_20261124`). Es repetible (idempotente).
3. Desplegá la Edge Function `win-courts` con el contenido exacto de `index.ts`, **con "Verify JWT" desactivado** (la web envía un token propio, no un JWT de Supabase). No cambies el nombre.
4. No toques la función `win-api` ni cargues claves: la Edge Function usa las variables que Supabase ya inyecta.

## Verificación (corré cada consulta y devolveme los resultados tal cual)
```sql
-- 1) Precios vigentes (esperado: 90000 / 100000)
select public.win_court_price_(current_date, 'CASH') as efectivo, public.win_court_price_(current_date, 'TRANSFER') as transferencia;
-- 2) Tablas nuevas con RLS (esperado: 6 filas con rls = true)
select relname, relrowsecurity as rls from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('win_price_list','win_court_abonos','win_court_abono_skips','win_court_payments','win_receiver_schedule','win_court_audit');
-- 3) Sin acceso para el navegador (esperado: false, false, false)
select has_table_privilege('authenticated','public.win_court_payments','select') as authenticated_tabla,
       has_table_privilege('anon','public.win_court_abonos','select') as anon_tabla,
       has_function_privilege('anon','public.win_courts_pay(text,uuid,uuid,uuid,date,text,uuid,text)','execute') as anon_funcion;
-- 4) Bucket privado (esperado: public = false)
select id, public, file_size_limit from storage.buckets where id = 'win-comprobantes';
-- 5) Funciones nuevas (esperado: al menos 14 nombres win_courts_*)
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'win\_courts\_%' order by 1;
```
Además comprobá que la Edge Function responde (desde el navegador o con curl):
`POST https://cqvoherekzntmhyzdidj.supabase.co/functions/v1/win-courts` con encabezado `Authorization: Bearer ` + 64 letras "a" y cuerpo `{"action":"courts.day","date":"2026-11-24"}`. Esperado: HTTP 401 con `{"error":"La sesión expiró. Volvé a ingresar.","code":"SESSION_INVALID"}`.

## Reglas
- No borres ni modifiques datos existentes. No ejecutes `drop` salvo el `drop function if exists ... win_courts_book(9 parámetros)` que ya está dentro de la migración.
- No pegues claves, PIN ni tokens en la conversación.
- Al terminar, resumime en 5 líneas qué quedó aplicado y qué resultado dio cada verificación.
