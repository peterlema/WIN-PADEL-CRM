import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'node:fs'

// Pruebas de la migración de configuración (productos, profesores y precios editables desde la web).
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
// Reemplazos mínimos de sesión y matriz de permisos (misma semántica que win_can_access: ADMIN todo; el resto por matriz).
await db.exec(`create function public.win_pin_session(p_token text)
returns table(account_id uuid, display_name text, role text, expires_at timestamptz) language sql as $$
  select id, display_name, role, now() + interval '1 hour' from win_auth.login_accounts where 'tok-' || username = p_token and enabled $$;
create function public.win_can_access(a uuid, m text, act text) returns boolean language sql stable as $$
  select exists(select 1 from win_auth.login_accounts x where x.id = a and x.enabled and (x.role = 'ADMIN'
    or (x.role = 'MANAGER' and act = 'MANAGE' and m in ('BAR','SHOP','ACADEMY'))
    or (x.role in ('RECEPTION','MANAGER') and m = 'COURTS' and act in ('VIEW','CREATE','CANCEL')))) $$;
insert into win_auth.login_accounts(username,pin_hash,display_name,role,enabled) values
 ('recep','x','Recepción 1','RECEPTION',true),('admin','x','Admin','ADMIN',true),('bar','x','Bar','BAR',true),('mgr','x','Encargado','MANAGER',true);`)
await db.exec(readFileSync(dir + '20261124_win_court_bookings.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261124_win_courts_v2_pricing_payments_abonos.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261124_win_courts_v3_payment_method_at_collection.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261125_win_config_catalog_coaches_prices.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261125_win_config_catalog_coaches_prices.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261126_win_settings.sql', 'utf8'))
await db.exec(readFileSync(dir + '20261126_win_settings.sql', 'utf8'))
ok(true, 'migración de configuración aplicada y repetible')

const hoy = (await one(`select public.win_config_today_()::text d`)).d
const f = async n => (await one(`select ($1::date + $2::int)::text d`, [hoy, n])).d
const list = tok => one(`select public.win_config_list($1) r`, [tok]).then(r => r.r)
const item = (tok, id, unit, name, cat, price, active = true) =>
  one(`select public.win_config_item_save($1,$2,$3,$4,$5,$6,$7) r`, [tok, id, unit, name, cat, price, active]).then(r => r.r)
const coach = (tok, id, name, pct, active = true) =>
  one(`select public.win_config_coach_save($1,$2,$3,$4,$5) r`, [tok, id, name, pct, active]).then(r => r.r)
const price = (tok, code, dur, cash, tr, from) =>
  one(`select public.win_config_price_set($1,$2,$3,$4,$5,$6::date) r`, [tok, code, dur, cash, tr, from]).then(r => r.r)

// 1. Datos iniciales
const l0 = await list('tok-admin')
ok(l0.profesores.length === 6 && l0.profesores.find(p => p.nombre === 'Chino').porcentajeWin == 55, 'profesores iniciales del Apps Script (Chino 55 %)')
ok(l0.precios.some(p => p.codigo === 'COURT_TURN' && p.duracion === 90 && p.efectivo == 90000) && l0.precios.some(p => p.codigo === 'CLASS_4' && p.efectivo == 100000), 'precios vigentes de cancha y clases')
ok(l0.permisos.precios && l0.permisos.bar && l0.permisos.tienda && l0.permisos.profesores, 'ADMIN tiene todos los permisos')

// 2. Permisos
ok((await err(`select public.win_config_list('tok-recep')`)).includes('NOT_AUTHORIZED'), 'Recepción no entra a Configuración')
ok((await err(`select public.win_config_list('tok-bar')`)).includes('NOT_AUTHORIZED'), 'Bar no entra a Configuración')
ok((await err(`select public.win_config_list('tok-nadie')`)).includes('SESSION_INVALID'), 'sin sesión se rechaza')
const lm = await list('tok-mgr')
ok(lm.permisos.bar && lm.permisos.profesores && !lm.permisos.precios, 'Encargado edita productos y profesores pero no precios')
ok((await err(`select public.win_config_price_set('tok-mgr','COURT_TURN',90,1,1,$1::date)`, [hoy])).includes('NOT_AUTHORIZED'), 'Encargado no cambia precios')

// 3. Productos
const agua = await item('tok-mgr', null, 'CAFE_BAR', ' Agua 500 ml ', 'Bebidas', 1500)
ok(!!agua.id, 'alta de producto de Bar')
ok((await err(`select public.win_config_item_save('tok-admin',null,'CAFE_BAR','agua 500 ML','',1,true)`)).includes('NAME_TAKEN'), 'nombre repetido (sin distinguir mayúsculas) se rechaza')
ok((await err(`select public.win_config_item_save('tok-admin',null,'CAFE_BAR','Café','',-5,true)`)).includes('CONFIG_INVALID'), 'precio negativo se rechaza')
await item('tok-admin', null, 'SHOP', 'Agua 500 ml', '', 2000)
ok(true, 'mismo nombre en otra unidad (Tienda) se permite')
await item('tok-admin', agua.id, 'CAFE_BAR', 'Agua 500 ml', 'Bebidas', 1800, false)
const a2 = (await list('tok-admin')).productos.find(p => p.id === agua.id)
ok(a2.precio == 1800 && a2.activo === false && a2.nombre === 'Agua 500 ml', 'modificación de precio y baja lógica')
ok((await err(`select public.win_config_item_save('tok-admin',$1,'SHOP','Agua 500 ml','',1,true)`, [agua.id])).includes('CONFIG_INVALID'), 'no se cambia la unidad de un producto existente')

// 4. Profesores
const nuevo = await coach('tok-mgr', null, 'Martina', 62.5)
ok(!!nuevo.id, 'alta de profesor')
ok((await err(`select public.win_config_coach_save('tok-admin',null,'chino',60,true)`)).includes('NAME_TAKEN'), 'profesor repetido se rechaza')
ok((await err(`select public.win_config_coach_save('tok-admin',null,'Otro',120,true)`)).includes('CONFIG_INVALID'), 'porcentaje mayor a 100 se rechaza')
await coach('tok-admin', nuevo.id, 'Martina', 50, false)
const m2 = (await list('tok-admin')).profesores.find(p => p.id === nuevo.id)
ok(m2.porcentajeWin == 50 && m2.activo === false, 'modificación y baja de profesor')

// 5. Precios con vigencia
ok((await err(`select public.win_config_price_set('tok-admin','COURT_TURN',90,1,1,$1::date)`, [await f(-1)])).includes('PRICE_DATE_PAST'), 'no se cambian precios hacia atrás')
const d10 = await f(10)
await price('tok-admin', 'COURT_TURN', 90, 95000, 105000, d10)
ok(Number((await one(`select public.win_court_price_($1::date,'CASH') p`, [hoy])).p) === 90000, 'hoy sigue el precio anterior')
ok(Number((await one(`select public.win_court_price_($1::date,'CASH') p`, [d10])).p) === 95000, 'desde la fecha nueva rige el precio nuevo (lo usa el cobro de canchas)')
ok((await list('tok-admin')).precios.some(p => p.codigo === 'COURT_TURN' && p.futuro && p.efectivo == 95000), 'el cambio programado se lista como futuro')
await price('tok-admin', 'COURT_TURN', 90, 96000, 106000, d10)
ok((await q(`select * from public.win_price_list where code='COURT_TURN' and duration_min=90 and valid_from=$1::date`, [d10])).length === 1, 'reprogramar la misma fecha reemplaza, no duplica')
await q(`select public.win_config_price_cancel('tok-admin','COURT_TURN',90,$1::date)`, [d10])
ok(Number((await one(`select public.win_court_price_($1::date,'CASH') p`, [d10])).p) === 90000, 'anular cambio futuro vuelve al precio vigente')
ok((await err(`select public.win_config_price_cancel('tok-admin','COURT_TURN',90,'2020-01-01'::date)`)).includes('PRICE_DATE_PAST'), 'no se borra un precio vigente o pasado')
await price('tok-admin', 'CLASS_2', 60, 75000, 75000, hoy)
ok((await list('tok-admin')).precios.find(p => p.codigo === 'CLASS_2').efectivo == 75000, 'cambio de precio de clase desde hoy')

// 5b. Precio de 60 y 120 min (hoy sin cargar: el cobro da PRICE_MISSING hasta definirlos)
ok((await one(`select public.win_court_price_($1::date,'CASH',60) p`, [hoy])).p === null, 'turno de 60 min arranca sin precio')
await price('tok-admin', 'COURT_TURN', 60, 65000, 72000, hoy)
ok(Number((await one(`select public.win_court_price_($1::date,'TRANSFER',60) p`, [hoy])).p) === 72000, 'precio de 60 min cargado desde la web lo usa el cobro')
ok(Number((await one(`select public.win_court_price_($1::date,'CASH',90) p`, [hoy])).p) === 90000, 'cargar 60 min no altera el de 90')
ok((await err(`select public.win_config_price_set('tok-admin','CLASS_1',90,1,1,$1::date)`, [hoy])).includes('CONFIG_INVALID'), 'clase con duración distinta de 60 se rechaza')

// 5c. Ajustes numéricos
const aj = tok => one(`select public.win_settings_get($1) r`, [tok]).then(r => r.r)
const setA = (tok, k, v) => q(`select public.win_config_setting_set($1,$2,$3)`, [tok, k, v])
const a0 = await aj('tok-bar')
ok(a0.GRID_OPEN_MIN == 480 && a0.GRID_CLOSE_MIN == 1500 && a0.BOOKING_DEFAULT_DURATION == 90 && a0.COACH_DEFAULT_WIN_PCT == 60, 'ajustes iniciales legibles por cualquier sesión (08:00–01:00, 90 min, 60 %)')
ok((await err(`select public.win_settings_get('tok-nadie')`)).includes('SESSION_INVALID'), 'ajustes sin sesión se rechazan')
ok((await err(`select public.win_config_setting_set('tok-mgr','GRID_OPEN_MIN',540)`)).includes('NOT_AUTHORIZED'), 'Encargado no cambia ajustes')
await setA('tok-admin', 'GRID_OPEN_MIN', 540); await setA('tok-admin', 'GRID_CLOSE_MIN', 1560)
ok((await aj('tok-recep')).GRID_OPEN_MIN == 540 && (await aj('tok-recep')).GRID_CLOSE_MIN == 1560, 'grilla 09:00–02:00 guardada')
ok((await err(`select public.win_config_setting_set('tok-admin','GRID_CLOSE_MIN',1830)`)).includes('CONFIG_INVALID'), 'cierre después de las 06:00 se rechaza')
ok((await err(`select public.win_config_setting_set('tok-admin','GRID_OPEN_MIN',1530)`)).includes('CONFIG_INVALID'), 'apertura posterior al cierre se rechaza')
ok((await err(`select public.win_config_setting_set('tok-admin','GRID_OPEN_MIN',545)`)).includes('CONFIG_INVALID'), 'horario fuera de bloques de 30 min se rechaza')
ok((await err(`select public.win_config_setting_set('tok-admin','BOOKING_DEFAULT_DURATION',75)`)).includes('CONFIG_INVALID'), 'duración por defecto distinta de 60/90/120 se rechaza')
await setA('tok-admin', 'COACH_DEFAULT_WIN_PCT', 62.5)
ok((await aj('tok-admin')).COACH_DEFAULT_WIN_PCT == 62.5, '% WIN por defecto actualizado')
ok((await err(`select public.win_config_setting_set('tok-admin','OTRA',1)`)).includes('CONFIG_INVALID'), 'clave desconocida se rechaza')

// 6. Auditoría y acceso directo
const aud = Number((await one(`select count(*) n from public.win_config_audit`)).n)
ok(aud >= 13, `cada cambio queda auditado (${aud} registros)`)
const priv = (await one(`select has_table_privilege('anon','public.win_catalog_items','select') a, has_table_privilege('authenticated','public.win_coaches','select') b,
  has_function_privilege('anon','public.win_config_list(text)','execute') c`))
ok(!priv.a && !priv.b && !priv.c, 'el navegador (anon/authenticated) no accede a tablas ni funciones')

console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron')
process.exit(fails ? 1 : 0)
