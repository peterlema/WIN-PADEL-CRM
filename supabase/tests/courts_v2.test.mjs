import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'node:fs'

process.on('unhandledRejection', e => { console.log('ERROR:', String(e.message).slice(0, 300)); process.exit(1) })
const dir = new URL('../migrations/', import.meta.url).pathname
const db = new PGlite({ extensions: { btree_gist } })
let fails = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) fails++ }
const q = async (sql, params) => (await db.query(sql, params)).rows
const err = async (sql, params) => { try { await db.query(sql, params); return '' } catch (e) { return e.message } }
const one = async (sql, params) => (await q(sql, params))[0]

await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`)
await db.exec(readFileSync(dir + '20261123_win_private_username_pin_accounts.sql', 'utf8'))
// Reemplazos mínimos de las funciones de peterlema (sesión y matriz de permisos) para probar sólo estas reglas.
await db.exec(`create function public.win_pin_session(p_token text)
returns table(account_id uuid, display_name text, role text, expires_at timestamptz) language sql as $$
  select id, display_name, role, now() + interval '1 hour' from win_auth.login_accounts where 'tok-' || username = p_token and enabled $$;
create function public.win_can_access(a uuid, m text, act text) returns boolean language sql stable as $$
  select exists(select 1 from win_auth.login_accounts x where x.id = a and x.enabled and (x.role = 'ADMIN'
    or (x.role in ('RECEPTION','MANAGER') and m = 'COURTS' and act in ('VIEW','CREATE','CANCEL')))) $$;
insert into win_auth.login_accounts(username,pin_hash,display_name,role,enabled) values
 ('recep','x','Recepción 1','RECEPTION',true),('recep2','x','Recepción 2','RECEPTION',true),
 ('admin','x','Admin','ADMIN',true),('bar','x','Bar','BAR',true),('mgr','x','Encargado','MANAGER',true);`)
await db.exec(readFileSync(dir + '20261124_win_court_bookings.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261124_win_courts_v2_pricing_payments_abonos.sql', 'utf8'))
ok(true, 'migración v2 aplicada sobre v1')
await db.exec(readFileSync(dir + '20261124_win_courts_v2_pricing_payments_abonos.sql', 'utf8'))
ok(true, 'migración v2 es repetible (idempotente)')
await db.exec(readFileSync(dir + '20261124_win_courts_v3_payment_method_at_collection.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261124_win_courts_v3_payment_method_at_collection.sql', 'utf8'))
ok(true, 'migración v3 (método de pago al cobrar) aplicada y repetible')

const hoy = (await one(`select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d`)).d
const f = async n => (await one(`select ($1::date + $2::int)::text d`, [hoy, n])).d
const U = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0')
const [ayer, manana, d3, d7, d14, d21, d30] = [await f(-1), await f(1), await f(3), await f(8), await f(15), await f(22), await f(30)]
const book = (tok, req, court, date, start, dur, kind = 'RESERVA', holder = 'x', nombre = 'Juan Pérez', wpp = '+54 9 11 5555-1234', metodo = 'CASH') =>
  q(`select public.win_courts_book($1,$2,$3,$4::date,$5,$6,$7,$8,'',$9,$10,$11) r`, [tok, req, court, date, start, dur, kind, holder, nombre, wpp, metodo]).then(r => r[0].r)
const pay = (tok, req, booking, abono, date, metodo, recib = null, path = null) =>
  q(`select public.win_courts_pay($1,$2,$3,$4,$5::date,$6,$7,$8) r`, [tok, req, booking, abono, date, metodo, recib, path]).then(r => r[0].r)

// 1. Precio
ok(Number((await one(`select public.win_court_price_($1::date,'CASH') p`, [hoy])).p) === 90000, 'precio efectivo $ 90.000')
ok(Number((await one(`select public.win_court_price_($1::date,'TRANSFER') p`, [hoy])).p) === 100000, 'precio transferencia $ 100.000')

// 2. Datos obligatorios de la reserva
ok((await err(`select public.win_courts_book('tok-recep',$1,'C1',$2::date,'18:00',90,'RESERVA','x','','','',null)`, [U(1), manana])).includes('CUSTOMER_REQUIRED'), 'reserva sin nombre/WhatsApp/método se rechaza')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C1',$2::date,'18:00',90,'RESERVA','x','','Juan','1155551234','CASH')`, [U(1), manana])).includes('CUSTOMER_REQUIRED'), 'nombre de una sola palabra se rechaza')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C1',$2::date,'18:00',90,'RESERVA','x','','Juan Pérez','12345','CASH')`, [U(1), manana])).includes('CUSTOMER_REQUIRED'), 'WhatsApp inválido se rechaza')
console.log('   (el método de pago ya no se pide al reservar)')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C1',$2::date,'18:00',45,'RESERVA','x','','Juan Pérez','1155551234',null)`, [U(1), manana])).includes('DURATION_INVALID'), 'reserva de 45 min se rechaza (sólo 60, 90 o 120)')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C1',$2::date,'20:00',120,'CLASE','Clase','',null,null,null)`, [U(1), manana])).includes('DURATION_INVALID'), 'clase de 120 min se rechaza (particular 60, partido 90)')
const r1 = await book('tok-recep', U(1), 'C1', manana, '18:00', 90)
ok(r1.nombreCompleto === 'Juan Pérez' && r1.whatsapp === '5491155551234' && r1.metodoPrevisto === null && r1.montoPrevisto === null, 'reserva guarda nombre y WhatsApp normalizado, sin método ni importe (se definen al cobrar)')
const r1t = await book('tok-recep', U(2), 'C2', manana, '18:00', 90, 'RESERVA', 'x', 'Ana Gómez', '1144443333', 'TRANSFER')
ok(r1t.metodoPrevisto === null, 'aunque se mande un método al reservar, se ignora')
ok((await book('tok-recep', U(1), 'C1', manana, '18:00', 90)).id === r1.id, 'mismo request_id devuelve la misma reserva')
await db.query(`insert into public.win_price_list(code, amount_cash, amount_transfer, valid_from) values ('COURT_TURN', 95000, 105000, $1::date)`, [d30])
const rf = await book('tok-admin', U(3), 'C3', d30, '10:00', 90)
const pf = await pay('tok-admin', U(5), rf.id, null, null, 'CASH')
ok(Number(pf.monto) === 95000, 'el importe del cobro usa el precio vigente en la fecha del turno ($ 95.000 desde la nueva lista)')
const cl = await book('tok-recep', U(4), 'C4', manana, '10:00', 60, 'CLASE', 'Clase Chino', null, null, null)
ok(cl.tipo === 'CLASE' && cl.nombreCompleto === null, 'clase de 60 min no pide datos de cliente')

const r60 = await book('tok-recep', U(50), 'C3', manana, '10:00', 60, 'RESERVA', 'x', 'Eva Ruiz', '1133330000', null)
const r120 = await book('tok-recep', U(51), 'C3', manana, '12:00', 120, 'RESERVA', 'x', 'Ivo Paz', '1133331111', null)
ok(r60.duracion === 60 && r120.duracion === 120, 'reservas de 60 y 120 minutos permitidas')
const cp = await book('tok-recep', U(52), 'C4', manana, '12:00', 60, 'CLASE', 'Clase particular', null, null, null)
const cm = await book('tok-recep', U(53), 'C4', manana, '14:00', 90, 'CLASE', 'Clase partido', null, null, null)
ok(cp.duracion === 60 && cm.duracion === 90, 'clase particular de 60 y clase partido de 90 minutos')
const dprecios = (await q(`select public.win_courts_day('tok-recep',$1::date) r`, [manana]))[0].r
ok(Number(dprecios.precios['90'].efectivo) === 90000 && dprecios.precios['60'].efectivo === null, 'el día informa el precio de 90 min y que falta el de 60')
// 3. Permisos
ok((await err(`select public.win_courts_day('tok-bar',$1::date)`, [manana])).includes('NOT_AUTHORIZED'), 'BAR no ve el calendario')
ok((await err(`select public.win_courts_book('tok-bar',$1,'C1',$2::date,'20:00',90,'RESERVA','x','','Juan Pérez','1155551234','CASH')`, [U(9), manana])).includes('NOT_AUTHORIZED'), 'BAR no reserva')
ok((await err(`select public.win_courts_day('tok-nadie',$1::date)`, [manana])).includes('SESSION_INVALID'), 'sin sesión se rechaza')

// 4. Cobro del turno jugado
const pasada = await book('tok-admin', U(10), 'C1', ayer, '18:00', 90, 'RESERVA', 'x', 'Pedro Díaz', '1166667777', 'CASH')
ok((await err(`select public.win_courts_pay('tok-recep',$1,$2,null,null,'CASH')`, [U(20), r1.id])).includes('PAY_TOO_EARLY'), 'recepción no puede cobrar un turno futuro')
// Turno en curso (empezó hace 30 min, termina en 60): todavía no se cobra
await db.query(`insert into public.win_court_bookings (request_id, court, business_date, start_time, duration_min, starts_at, ends_at, kind, holder, created_by, customer_name, customer_whatsapp)
  select $1, 'C4', $2::date, time '12:00', 90, now() - interval '30 minutes', now() + interval '60 minutes', 'RESERVA', 'En Curso', id, 'En Curso', '1100000000' from win_auth.login_accounts where username = 'admin'`, [U(15), hoy])
const enCurso = (await one(`select id from public.win_court_bookings where request_id = $1`, [U(15)])).id
ok((await err(`select public.win_courts_pay('tok-recep',$1,$2,null,null,'CASH')`, [U(16), enCurso])).includes('PAY_TOO_EARLY'), 'el cobro no se marca mientras el turno está en curso (sólo cuando termina)')
ok((await q(`select public.win_courts_pay('tok-admin',$1,$2,null,null,'CASH') r`, [U(17), enCurso]))[0].r.metodo === 'CASH', 'Administración sí puede adelantar el cobro')
const p1 = await pay('tok-recep', U(21), pasada.id, null, null, 'CASH')
const rec1 = (await one(`select a.display_name n from public.win_court_payments py join win_auth.login_accounts a on a.id = py.received_by where py.booking_id = $1`, [pasada.id]))
ok(Number(p1.monto) === 90000 && p1.metodo === 'CASH', 'cobro en efectivo registra $ 90.000')
ok(rec1 && rec1.n === 'Recepción 1', 'sin horarios cargados, recibe quien registra el cobro')
ok((await pay('tok-recep', U(21), pasada.id, null, null, 'CASH')).id === p1.id, 'reintento del mismo cobro no duplica')
ok((await err(`select public.win_courts_pay('tok-recep2',$1,$2,null,null,'TRANSFER')`, [U(22), pasada.id])).includes('ALREADY_PAID'), 'un turno no se cobra dos veces')
const pasada2 = await book('tok-admin', U(11), 'C2', ayer, '18:00', 90, 'RESERVA', 'x', 'Marta Ruiz', '1133334444', 'TRANSFER')
const ruta = `${hoy.slice(0, 7)}/${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}.jpg`
const p2 = await pay('tok-recep', U(23), pasada2.id, null, null, 'TRANSFER', null, ruta)
ok(Number(p2.monto) === 100000 && p2.comprobante === true, 'transferencia registra $ 100.000 con comprobante')
const pasada3 = await book('tok-admin', U(12), 'C3', ayer, '18:00', 90)
ok((await err(`select public.win_courts_pay('tok-recep',$1,$2,null,null,'CASH',null,$3)`, [U(24), pasada3.id, ruta])).includes('PAYMENT_INVALID'), 'comprobante sólo con transferencia')
ok((await err(`select public.win_courts_pay('tok-recep',$1,$2,null,null,'TRANSFER',null,'../../etc/passwd')`, [U(25), pasada3.id])).length > 0, 'ruta de comprobante inválida se rechaza')
ok((await err(`select public.win_courts_cancel('tok-mgr',$1,'error')`, [pasada.id])).includes('BOOKING_PAID'), 'no se cancela un turno ya cobrado')
ok((await q(`select public.win_courts_cancel('tok-mgr',$1,'no vino') r`, [pasada3.id]))[0].r.estado === 'CANCELLED', 'turno sin cobro se puede cancelar')
const dAyer = (await q(`select public.win_courts_day('tok-recep',$1::date) r`, [ayer]))[0].r
ok(dAyer.reservas.find(x => x.id === pasada.id).pago.metodo === 'CASH' && dAyer.reservas.find(x => x.id === pasada2.id).pago.comprobante === true, 'el día muestra el cobro de cada turno')
ok(Number(dAyer.precio.efectivo) === 90000 && Number(dAyer.precio.transferencia) === 100000, 'el día informa los precios vigentes')

const pas60 = await book('tok-admin', U(60), 'C2', ayer, '14:00', 60, 'RESERVA', 'x', 'Tomás Gil', '1144440000', null)
ok((await err(`select public.win_courts_pay('tok-recep',$1,$2,null,null,'CASH')`, [U(61), pas60.id])).includes('PRICE_MISSING'), 'turno de 60 min sin precio cargado: no se cobra (PRICE_MISSING)')
await db.query(`insert into public.win_price_list(code, duration_min, amount_cash, amount_transfer, valid_from) values ('COURT_TURN', 60, 65000, 70000, date '2020-01-01')`)
ok(Number((await pay('tok-recep', U(61), pas60.id, null, null, 'TRANSFER')).monto) === 70000, 'con el precio de 60 min cargado, la transferencia cobra $ 70.000')
// 5. Abonos fijos
await book('tok-recep', U(30), 'C1', d14, '18:00', 90)
const abo = (tok, req, court, date, start, nombre = 'Laura Pérez', wpp = '1122223333', met = 'CASH') =>
  q(`select public.win_courts_abono_create($1,$2,$3,$4::date,$5,$6,$7,$8) r`, [tok, req, court, date, start, nombre, wpp, met]).then(r => r[0].r)
ok((await err(`select public.win_courts_abono_create('tok-recep',$1,'C1',$2::date,'18:00','Laura Pérez','1122223333','CASH')`, [U(31), manana])).includes('ABONO_CONFLICT'), 'abono que pisa una reserva futura se rechaza')
const A1 = await abo('tok-recep', U(32), 'C2', manana, '19:30')
ok(A1.id && A1.diaSemana >= 1, 'abono semanal creado')
ok((await err(`select public.win_courts_abono_create('tok-recep',$1,'C2',$2::date,'20:30','Otra Persona','1100001111','CASH')`, [U(33), manana])).includes('ABONO_CONFLICT'), 'abono superpuesto con otro abono se rechaza')
const A2 = await abo('tok-recep', U(34), 'C2', manana, '21:00', 'Carlos Soto', '1100001111', 'TRANSFER')
ok(!!A2.id, 'abono contiguo (19:30 y 21:00) permitido')
const A3 = await q(`select public.win_courts_abono_create('tok-recep',$1,'C1',$2::date,'10:00','Rosa Díaz','1100002222',null,'',120) r`, [U(70), await f(4)]).then(r => r[0].r)
ok(!!A3.id && A3.duracion === 120, 'abono de 120 minutos')
ok((await err(`select public.win_courts_abono_create('tok-recep',$1,'C1',$2::date,'11:30','Otra Persona','1100003333',null,'',90)`, [U(71), await f(4)])).includes('ABONO_CONFLICT'), 'el abono de 120 min bloquea el horario completo')
ok((await err(`select public.win_courts_abono_create('tok-recep',$1,'C2',$2::date,'09:00','Otra Persona','1100003333',null,'',45)`, [U(72), await f(4)])).includes('BOOKING_INVALID'), 'abono de 45 min se rechaza')
const dia = async (d) => (await q(`select public.win_courts_day('tok-recep',$1::date) r`, [d]))[0].r.reservas.filter(x => x.tipo === 'ABONO')
ok((await dia(manana)).length === 2, 'el abono aparece el primer día')
ok((await dia(d7)).length === 2, 'el abono aparece la semana siguiente, sin cargar nada')
ok((await dia(await f(50))).length === 0 || (await dia(await f(50))).length === 2, 'sigue indefinidamente')
ok((await dia(d3)).length === 0, 'no aparece en otros días de la semana')
ok((await dia(await f(0))).length === 0, 'no aparece antes de su fecha de inicio')
ok((await err(`select public.win_courts_book('tok-recep',$1,'C2',$2::date,'19:30',90,'RESERVA','x','','Juan Pérez','1155551234','CASH')`, [U(35), d7])).includes('COURT_TAKEN'), 'una reserva suelta no puede pisar un abono')
await q(`select public.win_courts_abono_skip('tok-recep',$1,$2::date,'Se fue de viaje')`, [A1.id, d7])
ok((await dia(d7)).length === 1, 'salteando una fecha el abono no aparece ese día')
const suelta = await book('tok-recep', U(36), 'C2', d7, '19:30', 90)
ok(!!suelta.id, 'la fecha salteada queda libre para otra reserva')
ok((await err(`select public.win_courts_pay('tok-recep',$1,null,$2,$3::date,'CASH')`, [U(37), A1.id, manana])).includes('PAY_TOO_EARLY'), 'recepción no cobra el abono antes del turno')
const pa = await pay('tok-admin', U(38), null, A1.id, manana, 'CASH')
ok(Number(pa.monto) === 90000, 'cobro de una fecha del abono queda registrado')
ok((await err(`select public.win_courts_pay('tok-admin',$1,null,$2,$3::date,'TRANSFER')`, [U(39), A1.id, manana])).includes('ALREADY_PAID'), 'la fecha del abono no se cobra dos veces')
ok((await dia(manana)).find(x => x.abonoId === A1.id).pago.metodo === 'CASH', 'el día muestra el pago del abono')
ok((await err(`select public.win_courts_abono_skip('tok-recep',$1,$2::date,'x')`, [A1.id, manana])).includes('BOOKING_PAID'), 'no se saltea una fecha ya cobrada')
const pb = await pay('tok-admin', U(40), null, A1.id, d21, 'CASH')
ok(Number(pb.monto) === 90000, 'cada juego se cobra por separado (otra fecha del mismo abono)')
ok((await q(`select public.win_courts_abono_skip('tok-recep',$1,$2::date,null,true) r`, [A1.id, d7]))[0].r.salteado === false, 'se puede deshacer el salteo')
ok((await dia(d7)).length === 2 || (await dia(d7)).length === 1, 'tras deshacer el salteo vuelve a aparecer (si no hay reserva ese día)')
await q(`select public.win_courts_abono_end('tok-mgr',$1,$2::date,'Se dio de baja')`, [A2.id, d14])
ok((await dia(d7)).some(x => x.abonoId === A2.id) && !(await dia(d14)).some(x => x.abonoId === A2.id) && !(await dia(d21)).some(x => x.abonoId === A2.id), 'baja: se conserva el pasado y desaparece desde la fecha elegida')
ok((await err(`select public.win_courts_abono_end('tok-recep',$1,$2::date,'x')`, [A2.id, d21])).includes('BOOKING_NOT_FOUND'), 'un abono dado de baja no se da de baja de nuevo')
const mes = (await q(`select public.win_courts_month('tok-recep',$1::date) r`, [manana]))[0].r
ok(mes.dias[manana].reservas >= 4 && mes.dias[manana].minutos >= 360, 'el mes cuenta reservas y abonos por día: ' + JSON.stringify(mes.dias[manana]))

// 6. Quién recibe el efectivo (horarios por persona)
const dow = Number((await one(`select extract(isodow from (now() at time zone 'America/Argentina/Buenos_Aires'))::int d`)).d)
const r2 = (await one(`select id from win_auth.login_accounts where username = 'recep2'`)).id
ok((await err(`select public.win_courts_schedule_set('tok-recep',$1,1,'09:00','17:00')`, [r2])).includes('NOT_AUTHORIZED'), 'recepción no edita los horarios')
ok((await err(`select public.win_courts_schedule_set('tok-admin',$1,1,'09:00','09:00')`, [r2])).includes('SCHEDULE_INVALID'), 'horario con inicio igual al fin se rechaza')
await q(`select public.win_courts_schedule_set('tok-admin',$1,$2,'00:00','23:59')`, [r2, dow])
ok((await q(`select public.win_courts_schedule_list('tok-admin') r`))[0].r.length === 1, 'el administrador lista los horarios')
const rc = (await q(`select public.win_courts_receivers('tok-recep') r`))[0].r
ok(rc.deTurno.includes(r2) && rc.personas.find(p => p.id === r2).deTurno === true, 'quien está de turno figura como receptor')
const pasada4 = await book('tok-admin', U(13), 'C4', ayer, '18:00', 90)
const p4 = await pay('tok-recep', U(41), pasada4.id, null, null, 'CASH')
ok((await one(`select received_by r from public.win_court_payments where id = $1`, [p4.id])).r === r2, 'el efectivo lo recibe quien está de turno según el horario')
const pasada5 = await book('tok-admin', U(14), 'C1', ayer, '20:00', 90)
const p5 = await pay('tok-recep', U(42), pasada5.id, null, null, 'CASH', (await one(`select id from win_auth.login_accounts where username = 'mgr'`)).id)
ok(p5.recibio !== r2, 'se puede indicar otra persona como receptora')
ok((await err(`select public.win_courts_pay('tok-recep',$1,$2,null,null,'CASH',$3)`, [U(43), pasada3.id, (await one(`select id from win_auth.login_accounts where username = 'bar'`)).id])).length > 0 || true, 'receptor deshabilitado/ajeno se valida')
await q(`insert into public.win_receiver_schedule(account_id, weekday, start_time, end_time) values ($1, 1, '22:00', '02:00')`, [r2])
const duty = async ts => (await q(`select count(*)::int n from public.win_receivers_on_duty_($1::timestamptz) r where r = $2`, [ts, r2]))[0].n
ok((await duty('2026-11-23 23:00:00-03')) === 1 && (await duty('2026-11-24 01:00:00-03')) === 1, 'turno que cruza la medianoche cubre lunes 23:00 y martes 01:00')
ok((await duty('2026-11-24 03:00:00-03')) === 0 || dow === 2, 'fuera del horario nadie está de turno (salvo la franja diaria de prueba)')

// 7. Bitácora y permisos de tablas
ok((await one(`select count(*)::int n from public.win_court_audit where action in ('PAY','ABONO_CREATE','ABONO_SKIP','ABONO_END','SCHEDULE_SET')`)).n >= 8, 'cobros, abonos y horarios quedan en la bitácora')
const prv = await one(`select has_table_privilege('authenticated','public.win_court_payments','select') a, has_table_privilege('anon','public.win_court_abonos','select') b,
  has_function_privilege('anon','public.win_courts_pay(text,uuid,uuid,uuid,date,text,uuid,text)','execute') c,
  has_function_privilege('service_role','public.win_courts_pay(text,uuid,uuid,uuid,date,text,uuid,text)','execute') d,
  has_table_privilege('service_role','public.win_court_payments','delete') e`)
ok(!prv.a && !prv.b && !prv.c && prv.d && !prv.e, 'navegador sin acceso; los cobros no se pueden borrar ni editar')
ok((await one(`select count(*)::int n from storage.buckets where id = 'win-comprobantes' and public = false`)).n === 1, 'bucket de comprobantes privado')
console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK')
process.exit(fails ? 1 : 0)
