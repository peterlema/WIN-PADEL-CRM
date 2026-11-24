process.on('uncaughtException',e=>{console.error('ERROR',e.message,e.where||'',e.position||'');process.exit(1)})
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const db=new PGlite({extensions:{btree_gist}})
const dir=new URL('../migrations/',import.meta.url)
const source=new URL('../operations/',import.meta.url)
const q=async(sql,p=[])=>(await db.query(sql,p)).rows
const one=async(sql,p=[])=>(await q(sql,p))[0]
const fail=async(fn,code)=>{await assert.rejects(fn,e=>e.message.includes(code));console.log('OK rechazo '+code)}
const uuid=()=>crypto.randomUUID()
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
await db.exec(readFileSync(new URL('20261123_win_private_username_pin_accounts.sql',dir),'utf8'))
await db.exec(`create function public.win_pin_session(t text) returns table(account_id uuid,display_name text,role text,expires_at timestamptz) language sql as $$select id,display_name,role,now()+interval '1 hour' from win_auth.login_accounts where username='test-'||t and enabled$$;
create function public.win_can_access(a uuid,m text,act text) returns boolean language sql stable as $$select exists(select 1 from win_auth.login_accounts where id=a and enabled and (role='ADMIN' or(role in ('RECEPTION','MANAGER') and m in ('CASH','COURTS'))))$$;
insert into win_auth.login_accounts(username,pin_hash,display_name,role,enabled)values('test-admin','x','Admin prueba','ADMIN',true),('test-one','x','Recepción uno','RECEPTION',true),('test-two','x','Recepción dos','RECEPTION',true),('test-bar','x','Bar prueba','BAR',true);`)
await db.exec(readFileSync(new URL('20261123_win_foundation_users_cash.sql',dir),'utf8'))
await db.exec(`alter table public.win_staff drop constraint win_staff_user_id_fkey;alter table public.win_staff add foreign key(user_id) references win_auth.login_accounts(id);insert into public.win_staff(user_id,display_name,role)select id,display_name,role from win_auth.login_accounts;`)
for(const f of ['20261124_win_court_bookings.sql','20261124_win_courts_v2_pricing_payments_abonos.sql','20261124_win_courts_v3_payment_method_at_collection.sql','20261124_win_courts_v4_prices_60_120.sql','20261125_win_config_catalog_coaches_prices.sql'])await db.exec(readFileSync(new URL(f,dir),'utf8'))

for(const f of ['20261123_win_bar_product_catalog_and_seed.sql','20261123_win_bar_pos_orders_pending_and_court.sql','20261125_win_config_bar_uses_products.sql','20261126_win_settings.sql'])await db.exec(readFileSync(new URL(f,dir),'utf8'))
for(const f of ['schema.sql','controls.sql','reports.sql','calendar.sql'])await db.exec(readFileSync(new URL(f,source),'utf8'))
const calDir=new URL('../calendar/',import.meta.url)
for(let repeat=0;repeat<2;repeat++)for(const f of ['schema.sql','api.sql','integration.sql','compatibility.sql']){try{await db.exec(readFileSync(new URL(f,calDir),'utf8'))}catch(e){console.error('M05 SQL',f,e.message);throw e}}
console.log('OK M05 aplicado dos veces')
const api=async(token,action,data={})=>{await db.exec('set role service_role');try{return (await one('select public.win_calendar_api($1,$2,$3::jsonb) r',[token,action,JSON.stringify(data)])).r}finally{await db.exec('reset role')}}
const ops=async(token,action,data={})=>(await one('select public.win_ops_api($1,$2,$3::jsonb) r',[token,action,JSON.stringify(data)])).r
const day=(await one('select public.win_config_today_()::text d')).d
const add=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
const yesterday=add(day,-1),future=add(day,3)
const adminId=(await one("select id from win_auth.login_accounts where username='test-admin'")).id
await db.exec(`update public.win_ops_coach_rates set valid_from='2020-01-01';`)
const coaches=(await ops('admin','context',{date:day})).coaches
const coach=coaches[0]
const opened=await ops('one','control',{requestId:uuid(),operation:'open',date:day,cash:0})
const write=(token,action,p)=>api(token,action,{requestId:uuid(),...p})
const book=(extra={})=>({kind:'RESERVA',date:future,court:'C4',start:'10:00',duration:90,customerName:'Cliente de prueba',phone:'11 5555 0101',price:100000,...extra})
await fail(()=>api('bar','range',{start:day,end:day}),'NOT_AUTHORIZED')
await fail(()=>api('invalid','range',{start:day,end:day}),'SESSION_INVALID')

for(let n=0;n<2;n++)await db.exec(readFileSync(new URL('move.sql',calDir),'utf8'))
const move=async(token,p)=>{await db.exec('set role service_role');try{return (await one('select public.win_calendar_move($1,$2::jsonb) r',[token,JSON.stringify(p)])).r}finally{await db.exec('reset role')}}
const payload=(b,extra={})=>({requestId:uuid(),id:b.id,revision:b.revision,from:{date:b.date,court:b.court,start:b.start},date:b.date,court:b.court,start:b.start,scope:b.kind==='ABONO'?'occurrence':'booking',...extra})
const finance=async()=>one(`select jsonb_build_object('cash',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.win_cash_movements m),'ledger',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.win_ops_ledger m),'payments',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.win_court_payments m)) as data`)
const preserved=async id=>(await one(`select to_jsonb(b)-array['business_date','court','start_time','starts_at','ends_at','revision'] as data from public.win_court_bookings b where id=$1`,[id])).data
let b=await write('one','create',book({note:'Conservar esta nota',participants:[{customerName:'Participante agregado',phone:'11 5555 3333'}]}))
b=await write('one','pay',{id:b.id,shiftId:opened.id,cash:20000})
const orderIds=[]
for(const [state,linked] of [['OPEN',true],['OPEN',false],['PAID',true]]){
 const o=await one(`insert into public.win_bar_orders(request_id,created_by,status,destination,booking_id,court,court_date,court_start,total) values($1,$2,$3,'COURT',$4,$5,$6,$7,5000) returning id`,[uuid(),adminId,state,linked?b.id:null,b.court,b.date,b.start]);orderIds.push(o.id)
}
const completedOrder=await one('select to_jsonb(o) data from public.win_bar_orders o where id=$1',[orderIds[2]])
const beforeRow=await preserved(b.id),beforeFinance=await finance(),participantsBefore=await q('select * from public.win_calendar_participants where booking_id=$1',[b.id])
const req=payload(b,{court:'C3',start:'11:15',price:1,phone:'IGNORAR',duration:15})
let moved=await move('two',req)
assert.equal(moved.id,b.id);assert.equal(moved.duration,90);assert.equal(moved.price,100000);assert.equal(moved.paid,20000)
assert.deepEqual(await preserved(b.id),beforeRow);assert.deepEqual(await finance(),beforeFinance);assert.deepEqual(await q('select * from public.win_calendar_participants where booking_id=$1',[b.id]),participantsBefore)
for(const id of orderIds.slice(0,2)){
 const o=await one('select booking_id,court,court_start::text start,total from public.win_bar_orders where id=$1',[id]);assert.equal(o.booking_id,b.id);assert.equal(o.court,'C3');assert.equal(o.start,'11:15:00');assert.equal(Number(o.total),5000)
}
assert.deepEqual(await one('select to_jsonb(o) data from public.win_bar_orders o where id=$1',[orderIds[2]]),completedOrder)
console.log('OK cuentas pendientes de Bar acompañan al turno; pedidos cerrados e importes intactos')
assert.deepEqual(await move('two',req),moved)
assert.equal((await one("select count(*)::int n from public.win_cash_audit where action='CALENDAR_MOVE'")).n,1)
await fail(()=>move('two',{...req,court:'C2'}),'REQUEST_ID_REUSED')
await fail(()=>move('one',payload(b,{court:'C2'})),'STALE_REVISION')
await fail(()=>move('bar',payload(moved,{court:'C2'})),'NOT_AUTHORIZED')
await fail(()=>move('invalid',payload(moved,{court:'C2'})),'SESSION_INVALID')
console.log('OK misma reserva, duración, participantes, cliente, teléfono, precio, pagos, notas, idempotencia y cero movimientos financieros')
moved=await move('one',payload(moved,{start:'13:00'}));assert.equal(moved.court,'C3');assert.equal(moved.start,'13:00')
moved=await move('one',payload(moved,{court:'C2'}));assert.equal(moved.court,'C2')
moved=await move('one',payload(moved,{date:add(future,1),court:'C1',start:'13:15'}));assert.equal(moved.date,add(future,1))
await fail(()=>move('one',payload(moved,{start:'13:10'})),'BOOKING_INVALID')
await fail(()=>move('one',payload(moved,{start:'23:45'})),'OUTSIDE_HOURS')
await fail(()=>move('one',payload(moved,{date:yesterday})),'MOVE_IN_PAST')
await fail(()=>move('one',payload(moved)),'MOVE_UNCHANGED')
const occupied=await write('one','create',book({court:'C2',start:'15:00',date:add(future,1)}))
const old=await preserved(moved.id),revision=moved.revision
await fail(()=>move('one',payload(moved,{court:'C2',start:'15:15'})),'COURT_TAKEN')
assert.deepEqual(await preserved(moved.id),old);assert.equal((await one('select revision from public.win_court_bookings where id=$1',[moved.id])).revision,revision)
console.log('OK cancha, horario, día, pasos de 15 minutos, horarios configurados, destino ocupado y reversión completa')
let lesson=await write('one','create',{kind:'CLASE',date:future,court:'C4',start:'08:00',duration:60,teacherId:coach.id,lesson:{participants:2,classKind:'TRADICIONAL'},participants:[{customerName:'Alumno incluido',phone:'11 5555 4444'}],note:'Nota de clase'})
const second=await write('one','create',{kind:'CLASE',date:future,court:'C3',start:'09:00',duration:60,teacherId:coach.id,lesson:{participants:3,classKind:'TRADICIONAL'}})
const lessonBefore=await preserved(lesson.id)
await fail(()=>move('one',payload(second,{court:'C2',start:'08:15'})),'COACH_OVERLAP')
lesson=await move('one',payload(lesson,{court:'C1',start:'08:00'}));assert.deepEqual(await preserved(lesson.id),lessonBefore)
lesson=await move('one',payload(lesson,{date:add(future,1)}));assert.equal(lesson.teacherId,coach.id)
await q("insert into public.win_price_list(code,duration_min,valid_from,amount_cash,amount_transfer) values('CLASS_2',60,$1,80000,80000)",[add(future,2)])
await fail(()=>move('one',payload(lesson,{date:add(future,2)})),'MOVE_CLASS_RATE_CHANGE')
console.log('OK clases, profesor, participantes y precio conservados; conflictos y cambio de tarifa rechazados')
let abono=await write('one','abono.create',book({court:'C1',start:'18:00',phone:'11 5555 2222'}))
abono=await write('one','pay',{id:abono.id,shiftId:opened.id,transfer:100000})
const seriesBefore=(await one('select to_jsonb(s) data from public.win_court_abonos s where id=$1',[abono.abonoId])).data
const abonoBefore=await preserved(abono.id),financeAbono=await finance()
await fail(()=>move('one',payload(abono,{court:'C2',scope:'series'})),'ABONO_MOVE_SCOPE')
await fail(()=>move('one',payload(abono,{date:add(future,1),court:'C2'})),'ABONO_MOVE_SCOPE')
let movedAbono=await move('one',payload(abono,{court:'C2',start:'18:30'}))
assert.equal(movedAbono.id,abono.id);assert.equal(movedAbono.paid,100000);assert.deepEqual(await preserved(abono.id),abonoBefore);assert.deepEqual(await finance(),financeAbono)
assert.deepEqual((await one('select to_jsonb(s) data from public.win_court_abonos s where id=$1',[abono.abonoId])).data,seriesBefore)
await write('one','create',book({court:'C1',start:'18:00'}))
await fail(()=>write('one','create',book({court:'C1',start:'18:00',date:add(future,7)})),'ABONO_CONFLICT')
const virtual=(await api('one','range',{start:add(future,7),end:add(future,7)})).rows.find(r=>r.abonoId===abono.abonoId)
assert.equal(virtual.revision,0)
const v=await move('one',payload(virtual,{court:'C3',start:'20:00'}))
assert.equal(v.abonoId,abono.abonoId);assert.equal(v.date,virtual.date)
assert.equal((await one('select count(*)::int n from public.win_court_bookings where source_abono_id=$1 and business_date=$2',[abono.abonoId,virtual.date])).n,1)
await fail(()=>move('one',payload(virtual,{court:'C4',start:'20:00'})),'STALE_REVISION')
await write('one','create',book({court:'C1',start:'18:00',date:virtual.date}))
await fail(()=>write('one','create',book({court:'C3',start:'20:00',date:virtual.date})),'COURT_TAKEN')
const following=(await api('one','range',{start:add(future,14),end:add(future,14)})).rows.find(r=>r.abonoId===abono.abonoId)
assert.equal(following.court,'C1');assert.equal(following.start,'18:00')
console.log('OK abono pago, fecha proyectada materializada una vez, horario original liberado y otras semanas intactas')
const cancelled=await write('one','cancel',{id:occupied.id,note:'Cancelación para validar restricción'})
await fail(()=>move('one',payload({...occupied,status:'CANCELLED'},{court:'C4'})),'MOVE_NOT_ALLOWED')
const blocking=await write('admin','create',{kind:'BLOQUEO',date:future,court:'C4',start:'22:00',duration:60,name:'Mantenimiento'})
await fail(()=>move('admin',payload(blocking,{court:'C3'})),'MOVE_NOT_ALLOWED')
const history=await write('admin','create',book({date:yesterday,court:'C4',start:'10:00'}))
await fail(()=>move('admin',payload(history,{court:'C3'})),'MOVE_NOT_ALLOWED')
let performed=await write('admin','create',book({date:yesterday,court:'C3',start:'10:00'}))
performed=await write('admin','confirm',{id:performed.id})
await fail(()=>move('admin',payload(performed,{date:future,court:'C1'})),'MOVE_NOT_ALLOWED')
assert.equal((await one("select has_function_privilege('anon','public.win_calendar_move(text,jsonb)','execute') allowed")).allowed,false)
const audit=(await api('one','audit',{id:abono.id})).rows.find(r=>r.action==='CALENDAR_MOVE')
assert.equal(audit.detail.from.court,'C1');assert.equal(audit.detail.to.court,'C2');assert.equal(audit.detail.scope,'occurrence');assert.ok(audit.actor_id&&audit.occurred_at)
console.log('OK canceladas, bloqueos, actividades pasadas y realizadas inmóviles; permisos y auditoría verificados')
await db.close()
