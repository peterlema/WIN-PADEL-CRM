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
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key);
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
await db.exec(readFileSync(new URL('20261123_win_private_username_pin_accounts.sql',dir),'utf8'))
await db.exec(`create function public.win_pin_session(t text) returns table(account_id uuid,display_name text,role text,expires_at timestamptz) language sql as $$select id,display_name,role,now()+interval '1 hour' from win_auth.login_accounts where username='test-'||t and enabled$$;
create function public.win_can_access(a uuid,m text,act text) returns boolean language sql stable as $$select exists(select 1 from win_auth.login_accounts where id=a and enabled and (role='ADMIN' or(role in ('RECEPTION','MANAGER') and m in ('CASH','COURTS'))))$$;
insert into win_auth.login_accounts(username,pin_hash,display_name,role,enabled)values('test-admin','x','Admin prueba','ADMIN',true),('test-one','x','Recepción uno','RECEPTION',true),('test-two','x','Recepción dos','RECEPTION',true),('test-bar','x','Bar prueba','BAR',true);`)
await db.exec(readFileSync(new URL('20261123_win_foundation_users_cash.sql',dir),'utf8'))
await db.exec(`alter table public.win_staff drop constraint win_staff_user_id_fkey;alter table public.win_staff add foreign key(user_id) references win_auth.login_accounts(id);insert into public.win_staff(user_id,display_name,role)select id,display_name,role from win_auth.login_accounts;`)
for(const f of ['20261124_win_court_bookings.sql','20261124_win_courts_v2_pricing_payments_abonos.sql','20261124_win_courts_v3_payment_method_at_collection.sql','20261124_win_courts_v4_prices_60_120.sql','20261125_win_config_catalog_coaches_prices.sql'])await db.exec(readFileSync(new URL(f,dir),'utf8'))
for(let repeat=0;repeat<2;repeat++)for(const f of ['schema.sql','controls.sql','reports.sql','calendar.sql'])await db.exec(readFileSync(new URL(f,source),'utf8'))
console.log('OK esquema operativo aplicado dos veces')
const api=async(token,action,data={})=>(await one('select public.win_ops_api($1,$2,$3::jsonb) r',[token,action,JSON.stringify(data)])).r
const day=(await one('select public.win_config_today_()::text d')).d
const control=(actor,action,data={})=>api(actor,'control',{requestId:uuid(),action,...data})
await fail(()=>api('bar','overview'),'NOT_AUTHORIZED')
await fail(()=>api('invalid','overview'),'SESSION_INVALID')
const opened=await control('one','open',{cash:1000,date:day})
await fail(()=>control('two','open',{cash:0,date:day}),'SHIFT_ALREADY_OPEN')
const data=(type,extra={})=>({requestId:uuid(),shiftId:opened.id,type,date:day,start:'09:00',duration:60,courts:['C1'],played:true,cash:0,transfer:0,note:'Prueba aislada',...extra})
const save=(actor,p)=>api(actor,'save',p)
const court=await save('one',data('RESERVA',{cash:60000}))
await fail(()=>save('two',data('ABONO',{cash:50000,activityValue:50000})),'COURT_ACTIVITY_OVERLAP')
const free=await save('two',data('RESERVA',{start:'10:00',exceptionReason:'Cortesía autorizada'}))
const pre=await save('one',data('ABONO',{played:false,cash:50000}))
let view=await api('one','overview');assert.equal(view.totals.reservations,2);assert.equal(Number(view.totals.cashExpected),111000)
console.log('OK anticipo sin ocupación y cortesía sin cobro')
await save('one',data('ABONO',{start:'11:00',activityValue:90000}))
view=await api('one','overview');assert.equal(view.totals.reservations,3);assert.equal(Number(view.totals.reservationHours),3)
const context=await api('one','context',{date:day});const coach=context.coaches.find(x=>x.name==='Chino')
const lesson=data('CLASE',{start:'12:00',teacherId:coach.id,participants:2,classKind:'TRADICIONAL'})
const cls=await save('one',lesson)
const before=await api('one','overview');assert.equal(before.totals.classes,1);assert.equal(Number(before.totals.cashExpected),111000)
assert.equal(Number((await api('one','balance',{teacherId:coach.id})).balance),38500)
await fail(()=>save('one',data('CLASE',{start:'12:30',courts:['C2'],teacherId:coach.id,participants:1})),'COACH_OVERLAP')
await fail(()=>save('one',data('CLASE',{start:'13:00',teacherId:coach.id,participants:1,cash:100})),'CLASS_IS_NOT_CASH')
const rend=data('RENDICION',{teacherId:coach.id,cash:40000,allocations:[{date:day,amount:38500}]})
await save('two',rend);await save('two',rend)
assert.equal(Number((await api('one','overview')).totals.cashExpected),151000)
let balance=await api('one','balance',{teacherId:coach.id});assert.equal(Number(balance.credit),1500);assert.equal(Number(balance.balance),-1500)
console.log('OK clase devenga pendiente, rendición mixta/anticipo no duplica y excedente queda a favor')
await fail(()=>save('two',{...rend,cash:45000}),'REQUEST_ID_REUSED')
await fail(()=>save('one',data('GASTO',{cash:999999999,category:'Otros gastos'})),'INSUFFICIENT_CASH')
await fail(()=>save('one',data('GASTO',{cash:50,transfer:50,category:'Otros gastos'})),'CASH_EXPENSE_INVALID')
await save('one',data('GASTO',{cash:1000,category:'Otros gastos'}))
await save('one',data('RETIRO',{cash:1000,note:'Entrega de efectivo al titular'}))
const ev=await save('one',data('EVENTO',{start:'14:00',duration:90,courts:['C1','C2','C3'],participants:12,transfer:30000,receipts:[{reference:'grupo/comprobante-1',amount:30000}]}))
assert.equal((await one('select count(*)::int n from public.win_ops_resources where operation_id=$1',[ev.id])).n,3)
console.log('OK evento único con tres recursos y un ingreso')
await save('two',data('OTRO',{transfer:5000,receipts:[{reference:'grupo/comprobante-1',amount:5000}]}))
assert.equal((await one('select count(distinct reference)::int n from public.win_ops_receipts where verified')).n,1)
console.log('OK comprobante compartido contado una sola vez')
await control('one','notice',{note:'Revisar una red al abrir mañana'})
view=await api('two','overview');const notice=view.notices.find(x=>!x.sourceType);assert.ok(notice)
await control('two','resolve',{id:notice.id,note:'Red revisada'})
assert.ok((await api('one','overview')).notices.find(x=>x.id===notice.id).resolvedAt)
await fail(()=>control('two','close',{shiftId:opened.id,cash:149000,transfer:35000,count:1}),'NOT_AUTHORIZED')
await fail(()=>control('one','close',{shiftId:opened.id,cash:0,transfer:0,count:0}),'CLOSE_EXCEPTION_REQUIRED')
await control('one','void',{id:free.id,note:'Se eligió el horario equivocado'})
const close=await control('one','close',{shiftId:opened.id,cash:149000,transfer:35000,count:1})
assert.equal(Number(close.cashExpected),149000)
await fail(()=>save('one',data('TIENDA',{cash:100})),'SHIFT_NOT_OPEN')
await save('two',rend) // reintento idéntico después del cierre: mismo recibo, ningún cobro nuevo.
await fail(()=>control('two','open',{cash:140000,date:day}),'OPENING_DIFFERENCE_REASON')
const newShift=await control('two','open',{cash:140000,date:day,note:'Diferencia física investigada al traspaso'})
assert.ok((await api('two','overview')).notices.some(x=>x.sourceType==='HANDOVER'))
await fail(()=>control('one','day',{date:day,transfer:35000,count:1}),'DAY_HAS_OPEN_SHIFT')
await control('two','close',{shiftId:newShift.id,cash:140000,transfer:0,count:0})
await control('two','day',{date:day,transfer:35000,count:1})
const mv=await one("select id,amount_signed from public.win_cash_movements where reference_type='OPERATION' and reference_id=$1 and payment_method='CASH'",[court.id])
const correction=await control('two','correction',{id:mv.id,amount:59000,method:'CASH',note:'Error de digitación detectado al revisar'})
await fail(()=>control('two','decide',{id:correction.id,approve:true,note:'Revisado'}),'NOT_AUTHORIZED')
await control('admin','decide',{id:correction.id,approve:false,note:'Comprobante original correcto'})
assert.equal(Number((await one('select amount_signed from public.win_ops_ledger where id=$1',[mv.id])).amount_signed),60000)
console.log('OK cierre, traspaso, jornada y rechazo de corrección conservan trazabilidad')
const report=await api('admin','admin',{start:day,end:day})
assert.equal(Number(report.totals.expenses),1000);assert.equal(Number(report.totals.withdrawals),1000)
assert.equal(report.academy.find(x=>x.id===coach.id).classes,1)
assert.equal(report.events.length,1);assert.equal(report.occupancy.capacityHours,null)
await fail(()=>api('one','admin',{start:day,end:day}),'NOT_AUTHORIZED')
await api('admin','availability',{requestId:uuid(),startDate:day,endDate:day,open:'08:00',close:'23:00',courts:['C1','C2','C3','C4']})
assert.equal(Number((await api('admin','admin',{start:day,end:day})).occupancy.capacityHours),60)
const history=await api('one','history',{start:day,end:day,method:'TRANSFER'})
assert.ok(history.rows.every(x=>Number(x.transfer)!==0))
assert.equal((await api('one','quote',{date:day,teacherId:coach.id,participants:2,duration:60})).winNet,38500)
assert.equal((await api('one','status',{requestId:lesson.requestId})).found,true)
assert.equal((await api('two','status',{requestId:lesson.requestId})).found,false)
assert.ok((await api('one','detail',{id:'op:'+cls.id})).events.length)
await fail(()=>api('one','export',{start:day,end:day}),'NOT_AUTHORIZED')
assert.ok((await api('admin','export',{start:day,end:day})).rows.length)
const third=await control('one','open',{cash:140000,date:day})
const book=async(start)=> (await one("select public.win_courts_book('admin',$1,'C4',$2::date,$3,60,'RESERVA','Prueba integración','','Ada Prueba','1155551234',null) b",[uuid(),day,start])).b
const booked=await book('18:00')
await save('one',data('RESERVA',{shiftId:third.id,bookingId:booked.id,start:'18:00',courts:['C4'],cash:10000,transfer:20000,receipts:[{reference:'integracion-mixto',amount:20000}]}))
const calendar=(await one("select public.win_courts_day('one',$1::date) d",[day])).d
assert.equal(calendar.reservas.find(x=>x.id===booked.id).pago.metodo,'MIXTO')
await fail(()=>q("select public.win_courts_pay('admin',$1,$2,null,null,'CASH',null,null)",[uuid(),booked.id]),'BOOKING_ALREADY_PAID')
const later=await book('20:00')
await q("select public.win_courts_pay('admin',$1,$2,null,null,'CASH',null,null)",[uuid(),later.id])
assert.equal(Number((await api('one','overview')).totals.cashExpected),210000)
await save('one',data('RESERVA',{shiftId:third.id,bookingId:later.id,start:'20:00',courts:['C4']}))
assert.equal(Number((await api('one','overview')).totals.cashExpected),210000)
console.log('OK calendario y recepción comparten cobro sin duplicarlo, incluso pago mixto')
const leo=context.coaches.find(x=>x.name==='Leo')
await save('one',data('CLASE',{shiftId:third.id,start:'17:00',courts:['C2'],teacherId:leo.id,participants:1,exception:true,gross:0,teacherPay:20000,exceptionReason:'Clase gratuita de empleado; profesor remunerado'}))
await save('one',data('RENDICION',{shiftId:third.id,teacherId:leo.id,allocations:[{date:day,amount:-20000}]}))
assert.equal(Number((await api('one','balance',{teacherId:leo.id})).credit),20000)
await save('one',data('RENDICION',{shiftId:third.id,teacherId:leo.id,refundCash:20000}))
assert.equal(Number((await api('one','balance',{teacherId:leo.id})).balance),0)
assert.equal(Number((await api('one','overview')).totals.cashExpected),190000)
await q('update public.win_coaches set win_pct=60 where id=$1',[coach.id])
assert.equal((await api('one','quote',{date:day,teacherId:coach.id,participants:2,duration:60})).winNet,42000)
assert.equal(Number((await one('select win_pct from public.win_ops_records where id=$1',[cls.id])).win_pct),55)
console.log('OK cortesía remunerada, compensación, devolución real e historia de porcentajes')
assert.equal((await one("select has_function_privilege('anon','public.win_ops_api(text,text,jsonb)','EXECUTE') allowed")).allowed,false)
assert.equal((await one("select has_table_privilege('authenticated','public.win_ops_records','SELECT') allowed")).allowed,false)
console.log('OK reportes, disponibilidad real, historial, RLS y permisos')

const approved1=await control('two','correction',{id:mv.id,amount:59000,method:'CASH',note:'Importe revisado con documento original'});
await control('admin','decide',{id:approved1.id,approve:true,note:'Importe confirmado por Administración'});
assert.equal(Number((await one('select win_net from public.win_ops_records where id=$1',[court.id])).win_net),59000);
const approved2=await control('two','correction',{id:mv.id,amount:58000,method:'TRANSFER',note:'Verificación de medio y monto definitivos'});
await control('admin','decide',{id:approved2.id,approve:true,note:'Comprobante bancario confirmado'});
assert.equal(Number((await one('select amount_signed from public.win_ops_ledger where id=$1',[mv.id])).amount_signed),58000);
assert.equal((await one('select count(*)::int n from public.win_ops_ledger where id=$1',[mv.id])).n,1);
assert.equal(Number((await one('select transfer from public.win_ops_records where id=$1',[court.id])).transfer),58000);
const proposed=await control('two','correction',{id:mv.id,amount:57000,method:'CASH',note:'Nueva propuesta pendiente de validación'});
assert.equal(Number((await api('one','day',{date:day})).provisional),-58000);
await control('admin','decide',{id:proposed.id,approve:false,note:'No corresponde esta nueva modificación'});
assert.equal(Number((await one('select amount_signed from public.win_ops_ledger where id=$1',[mv.id])).amount_signed),58000);
console.log('OK aprobación sucesiva, efecto provisional y rechazo sin duplicar dinero');

// Historical data is reporting-only, source-keyed, and never opens or moves cash.
const historyDay=(await one("select (current_date-20)::text d")).d
const collectedDay=(await one("select (current_date-10)::text d")).d
const cashBefore=await one('select count(*)::int n from public.win_cash_movements')
const nativeBalance=await api('one','balance',{teacherId:coach.id})
const historyFacts=[
 ['entry','legacy-reserve',{type:'RESERVA',status:'ACTIVE',activity_date:historyDay,payment_date:historyDay,occurred_at:historyDay+'T12:00:00-03:00',author:'Origen',quantity:2,cash:100,transfer:0,win_net:100,gross:100,courts:[],unknown_price:false,tiny_price:false}],
 ['entry','legacy-class',{type:'CLASE',status:'ACTIVE',teacher:'Docente histórico sin alta',activity_date:historyDay,payment_date:historyDay,occurred_at:historyDay+'T12:00:00-03:00',author:'Origen',quantity:2,participants:3,cash:0,transfer:0,courts:[],unknown_price:true,tiny_price:false}],
 ['allocation','receipt|day|method',{type:'RENDICION',status:'ACTIVE',teacher:'Docente histórico sin alta',activity_date:historyDay,payment_date:collectedDay,occurred_at:collectedDay+'T12:00:00-03:00',author:'Origen',method:'Transferencia',amount:60}],
 ['entry','legacy-void',{type:'RESERVA',status:'VOID',activity_date:historyDay,payment_date:historyDay,occurred_at:historyDay+'T12:00:00-03:00',quantity:1,cash:9999,transfer:0,win_net:9999,courts:[],unknown_price:false,tiny_price:false}]
]
for(let i=0;i<2;i++)for(const [entity,id,facts] of historyFacts)await q(`insert into public.win_history_rows(source_id,entity,origin_id,source_row,raw,facts,content_hash)values('test-source',$1,$2,2,'[]',$3,'test')on conflict(source_id,entity,origin_id)do nothing`,[entity,id,JSON.stringify(facts)])
assert.equal((await one("select count(*)::int n from public.win_history_rows where source_id='test-source'")).n,4)
const historicReport=await api('admin','admin',{start:historyDay,end:historyDay})
assert.equal(Number(historicReport.totals.collected),100)
assert.equal(Number(historicReport.totals.activityNet),100)
assert.equal(Number(historicReport.activity.find(x=>x.type==='RESERVA').count),2)
const historicalTeacher=historicReport.academy.find(x=>x.name==='Docente histórico sin alta')
assert.equal(Number(historicalTeacher.classes),2);assert.equal(Number(historicalTeacher.unknown_price),2)
assert.equal(historicalTeacher.balance.balance,null)
assert.equal(historicReport.occupancy.historyIncomplete,true);assert.equal(historicReport.occupancy.netPerHour,null)
const receiptReport=await api('admin','admin',{start:collectedDay,end:collectedDay})
assert.equal(Number(receiptReport.totals.collected),60);assert.equal(Number(receiptReport.totals.activityNet),0)
assert.equal((await one('select count(*)::int n from public.win_cash_movements')).n,cashBefore.n)
assert.deepEqual(await api('one','balance',{teacherId:coach.id}),nativeBalance)
assert.equal((await one("select has_table_privilege('anon','public.win_admin_ledger','select') allowed")).allowed,false)
assert.equal((await one("select has_function_privilege('anon','public.win_admin_report_(date,date)','execute') allowed")).allowed,false)
await fail(()=>api('one','admin',{start:historyDay,end:collectedDay}),'NOT_AUTHORIZED')
console.log('OK histórico: fuente/IDs, cantidad, dos fechas, anulación, docente, datos incompletos y caja intacta')

await db.close()
console.log('PASS operaciones y conciliación integral')
