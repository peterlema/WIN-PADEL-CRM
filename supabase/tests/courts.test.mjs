import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'node:fs'
const repo = new URL('../migrations/', import.meta.url).pathname
const db = new PGlite({ extensions: { btree_gist } })
let fails = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fails++ }
async function err(sql, params) { try { await db.query(sql, params); return null } catch (e) { return e.message } }

await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);`)
await db.exec(readFileSync(repo + '20261123_win_private_username_pin_accounts.sql', 'utf8'))
// Stub de la sesión de peterlema: token = 'tok-<username>'
await db.exec(`create function public.win_pin_session(p_token text)
returns table(account_id uuid, display_name text, role text, expires_at timestamptz) language sql as $$
  select id, display_name, role, now() + interval '1 hour' from win_auth.login_accounts
  where 'tok-' || username = p_token and enabled $$;
insert into win_auth.login_accounts(username,pin_hash,display_name,role,enabled) values
 ('recep','x','Recepción 1','RECEPTION',true),('recep2','x','Recepción 2','RECEPTION',true),
 ('admin','x','Admin','ADMIN',true),('bar','x','Bar','BAR',true);`)
await db.exec(readFileSync(repo + '20261124_win_court_bookings.sql', 'utf8'))
ok(true, 'migración aplicada')

const tomorrow = (await db.query(`select ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)::text d`)).rows[0].d
const book = (tok, req, court, start, dur, kind = 'RESERVA', holder = 'Juan', date = tomorrow) =>
  db.query(`select public.win_courts_book($1,$2,$3,$4::date,$5,$6,$7,$8,'') r`, [tok, req, court, date, start, dur, kind, holder])
const U = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')

const r1 = (await book('tok-recep', U(1), 'C1', '18:00', 90)).rows[0].r
ok(r1.inicio === '18:00' && r1.fin === '19:30' && r1.cancha === 'C1', 'reserva creada 18:00-19:30 C1')
const r1b = (await book('tok-recep', U(1), 'C1', '18:00', 90)).rows[0].r
ok(r1b.id === r1.id, 'mismo request_id devuelve la misma reserva (idempotencia)')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C2',$2::date,'18:00',90,'RESERVA','Otro','')`, [U(1), tomorrow]))?.includes('REQUEST_ID_REUSED'), 'request_id reusado con otros datos se rechaza')
ok((await err(`select public.win_courts_book('tok-recep2',$1,'C1',$2::date,'19:00',60,'RESERVA','Pedro','')`, [U(2), tomorrow]))?.includes('COURT_TAKEN'), 'superposición en C1 se rechaza')
await book('tok-recep2', U(3), 'C1', '19:30', 60)
ok(true, 'reserva contigua 19:30 en C1 permitida')
await book('tok-recep2', U(4), 'C2', '18:00', 120)
ok(true, 'misma hora en otra cancha permitida')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C3',$2::date,'18:15',60,'RESERVA','X','')`, [U(5), tomorrow]))?.includes('BOOKING_INVALID'), 'hora fuera de :00/:30 se rechaza')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C3',$2::date,'18:00',45,'RESERVA','X','')`, [U(6), tomorrow]))?.includes('DURATION_INVALID'), 'duración 45 en reserva se rechaza')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C5',$2::date,'18:00',60,'RESERVA','X','')`, [U(7), tomorrow]))?.includes('BOOKING_INVALID'), 'cancha inexistente se rechaza')
ok((await err(`select public.win_courts_book('tok-bar',$1,'C3',$2::date,'18:00',60,'RESERVA','X','')`, [U(8), tomorrow]))?.includes('NOT_AUTHORIZED'), 'rol BAR no puede reservar')
ok((await err(`select public.win_courts_book('tok-nadie',$1,'C3',$2::date,'18:00',60,'RESERVA','X','')`, [U(9), tomorrow]))?.includes('SESSION_INVALID'), 'sesión inválida se rechaza')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C3','2020-01-01','18:00',60,'RESERVA','X','')`, [U(10)]))?.includes('BOOKING_IN_PAST'), 'recepción no puede cargar reservas pasadas')
await db.query(`select public.win_courts_book('tok-admin',$1,'C3','2020-01-01','18:00',60,'RESERVA','X','')`, [U(11)])
ok(true, 'admin puede cargar reserva pasada')

// Madrugada: 00:30 de la jornada pertenece al día siguiente; 23:30-01:00 choca con 00:30
const m = (await book('tok-recep', U(12), 'C4', '23:30', 90)).rows[0].r
ok(m.fin === '01:00', 'reserva 23:30-01:00 cruza medianoche')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C4',$2::date,'00:30',60,'RESERVA','X','')`, [U(13), tomorrow]))?.includes('COURT_TAKEN'), '00:30 de la misma jornada choca con 23:30-01:00')
const ts = (await db.query(`select to_char(starts_at at time zone 'America/Argentina/Buenos_Aires','YYYY-MM-DD HH24:MI') t from public.win_court_bookings where request_id=$1`, [U(12)])).rows[0].t
ok(ts === tomorrow + ' 23:30', 'hora guardada en horario de Argentina')

const day = (await db.query(`select public.win_courts_day('tok-recep',$1::date) d`, [tomorrow])).rows[0].d
ok(day.reservas.length === 4 && day.reservas[0].creadoPor === 'Recepción 1', 'día devuelve 4 reservas con nombre de quien cargó')
const month = (await db.query(`select public.win_courts_month('tok-recep',$1::date) d`, [tomorrow])).rows[0].d
ok(month.dias[tomorrow]?.reservas === 4 && month.dias[tomorrow]?.minutos === 360, 'mes resume 4 reservas / 360 minutos')

ok((await err(`select public.win_courts_cancel('tok-recep2',$1,'cambio')`, [r1.id]))?.includes('NOT_AUTHORIZED'), 'otro recepcionista no cancela reserva ajena')
ok((await err(`select public.win_courts_cancel('tok-recep',$1,'  ')`, [r1.id]))?.includes('REASON_REQUIRED'), 'cancelar exige motivo')
await db.query(`select public.win_courts_cancel('tok-recep',$1,'avisó que no viene')`, [r1.id])
ok(true, 'creador cancela su reserva')
ok((await err(`select public.win_courts_cancel('tok-admin',$1,'x')`, [r1.id]))?.includes('BOOKING_NOT_FOUND'), 'no se cancela dos veces')
await book('tok-recep2', U(14), 'C1', '18:00', 60)
ok(true, 'horario liberado se puede volver a reservar')
const ev = (await db.query(`select action, count(*)::int n from public.win_court_booking_events group by action order by action`)).rows
ok(JSON.stringify(ev) === JSON.stringify([{ action: 'CANCEL', n: 1 }, { action: 'CREATE', n: 6 }]), 'bitácora: 6 altas y 1 cancelación')

// Permisos: roles del navegador sin acceso
const priv = (await db.query(`select has_table_privilege('authenticated','public.win_court_bookings','select') t,
  has_function_privilege('anon','public.win_courts_day(text,date)','execute') f,
  has_function_privilege('service_role','public.win_courts_book(text,uuid,text,date,text,integer,text,text,text)','execute') s`)).rows[0]
ok(!priv.t && !priv.f && priv.s, 'anon/authenticated sin acceso; service_role con acceso')
console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK')
process.exit(fails ? 1 : 0)
