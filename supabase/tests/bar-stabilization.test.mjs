import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {readFileSync} from 'node:fs'
let pg,pgClient
if(process.env.BAR_TEST_DATABASE_URL){pg=await import('pg');pgClient=new pg.Client({connectionString:process.env.BAR_TEST_DATABASE_URL});await pgClient.connect()}
const db=pgClient?{exec:s=>pgClient.query(s),query:(s,p)=>pgClient.query(s,p),close:()=>pgClient.end()}:new PGlite({extensions:{btree_gist,pgcrypto}})
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema extensions;create extension pgcrypto schema extensions;
create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
const migrations=['20261123_win_foundation_users_cash.sql','20261123_win_private_username_pin_accounts.sql','20261123_win_backend_sessions_cash.sql','20261123_win_rbac_roles_permissions_initial.sql','20261124_win_court_bookings.sql','20261123_win_rbac_enforce_existing_cash_courts.sql','20261123_win_cash_expense_withdrawal_validation.sql','20261124_win_courts_v2_pricing_payments_abonos.sql','20261124_win_courts_v3_payment_method_at_collection.sql','20261123_win_bar_product_catalog_and_seed.sql','20261123_win_bar_pos_orders_pending_and_court.sql','20261123_win_bar_court_calendar_reception_settlement.sql','20261123_win_bar_daily_court_pending_markers.sql','20261125_win_bar_immediate_court_client.sql']
for(const f of migrations)await db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'))
for(const f of ['20261124_win_courts_v4_prices_60_120.sql','20261125_win_config_catalog_coaches_prices.sql','20261125_win_config_bar_uses_products.sql','20261126_win_settings.sql'])await db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'))
for(const f of ['schema.sql','controls.sql','reports.sql','calendar.sql'])await db.exec(readFileSync(new URL('../operations/'+f,import.meta.url),'utf8'))
for(const f of ['schema.sql','api.sql','integration.sql','compatibility.sql','move.sql'])await db.exec(readFileSync(new URL('../calendar/'+f,import.meta.url),'utf8'))
const q=async(s,p=[])=>(await db.query(s,p)).rows
const scalar=async(s,p=[])=>(await q(s,p))[0].v
await q(`create or replace function public.win_pin_session(p_token text) returns table(account_id uuid,display_name text,role text,expires_at timestamptz) language sql security definer as $$ select id,display_name,role,now()+interval '1h' from win_auth.login_accounts where 'tok-'||username_key=p_token and enabled $$`)
await q(`insert into win_auth.login_accounts(username,display_name,role,pin_hash,enabled) values('Pedro','Pedro Lema','ADMIN','x',true),('bar','Bar','BAR','x',true),('rec','Recepcion','RECEPTION','x',true)`)
await db.exec(readFileSync(new URL('../operations/bar-stock.sql',import.meta.url),'utf8'))
const seed=readFileSync(new URL('../operations/bar-opening-20261124.sql',import.meta.url),'utf8')

await db.exec(seed)
await db.exec(readFileSync(new URL('../operations/bar-employee-pricing.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../migrations/20261124160611_win_bar_provisional_costs.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../migrations/20261124175500_win_bar_simple_purchases.sql',import.meta.url),'utf8'))

process.on('uncaughtException',e=>{console.error('STABILIZATION',e.message,e.position,e.where);process.exit(1)})
await db.exec(readFileSync(new URL('../migrations/20261124182900_win_bar_checkout_snapshot.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../migrations/20261124183000_win_bar_checkout_recovery.sql',import.meta.url),'utf8'))
const id=()=>crypto.randomUUID()
const inv=(action,p={},token='tok-pedro')=>scalar('select win_bar_inventory_api($1,$2,$3::jsonb) v',[token,action,JSON.stringify(p)])
const mutate=(action,p={})=>inv(action,{requestId:id(),...p})
const reject=async(f,code)=>assert.rejects(f,e=>e.message.includes(code))
const previous=(await mutate('cash.open',{openingCash:0})).id
await mutate('cash.close',{shiftId:previous,countedCash:0})
const before=await scalar('select to_jsonb(s) v from win_bar_cash_shifts s where id=$1',[previous])
await db.exec(readFileSync(new URL('../operations/bar-stabilization.sql',import.meta.url),'utf8'))
assert.equal(Number(await scalar('select sum(quantity_change) v from win_bar_stock_movements')),393)
const after=await scalar('select to_jsonb(s) v from win_bar_cash_shifts s where id=$1',[previous]);delete after.closing_snapshot;assert.deepEqual(after,before)
await db.exec(readFileSync(new URL('../operations/bar-costs-initial-20261124.sql',import.meta.url),'utf8'))
const water=await scalar("select id v from win_products where name='Agua Manaos'")
const customer=(await scalar("select win_bar_customer_create('tok-pedro','Cliente aislado') v")).id
const shift=(await mutate('cash.open',{openingCash:1000})).id
const payload=(dest='IMMEDIATE',method='CASH')=>({requestId:id(),items:[{id:water,quantity:1}],destination:dest,customerId:dest==='ACCOUNT'?customer:null,bookingId:null,court:dest==='COURT'?'C1':null,courtDate:dest==='COURT'?'2026-11-24':null,courtStart:dest==='COURT'?'18:00':null,note:'',method:dest==='IMMEDIATE'?method:null,clientUnknown:dest==='IMMEDIATE'})
const place=p=>scalar('select win_bar_order_place($1,$2,$3::jsonb,$4,$5,$6,$7,$8::date,$9::time,$10,$11,$12) v',['tok-pedro',p.requestId,JSON.stringify(p.items),p.destination,p.customerId,p.bookingId,p.court,p.courtDate,p.courtStart,p.note,p.method,p.clientUnknown])
const pay=p=>scalar("select win_bar_order_pay('tok-pedro',$1,$2,$3,$4) v",[p.requestId,p.orderId,p.amount,p.method])
const stock=()=>scalar('select sum(quantity_change)::int v from win_bar_stock_movements')
await reject(()=>inv('cash.state',{},'tok-rec'),'NOT_AUTHORIZED')
await reject(()=>inv('dashboard',{},'tok-bar'),'NOT_AUTHORIZED')
await reject(()=>mutate('bank.save',{accountLabel:'Texto libre insuficiente'}),'BAR_BANK_INVALID')
await reject(()=>place(payload('IMMEDIATE','TRANSFER')),'BAR_BANK_REQUIRED')
assert.equal(await stock(),393)
const bank={requestId:id(),bank:'Banco de prueba',holder:'Titular de prueba',identifierType:'ALIAS',identifier:'bar.pruebas',confirmed:true}
await inv('bank.save',bank);await inv('bank.save',bank)
assert.equal((await inv('cash.state')).bankConfigured,true)
assert.equal(await scalar("select count(*)::int v from win_bar_inventory_audit where action='bank.save'"),1)
for(const method of ['CASH','TRANSFER','CARD']){const p=payload('IMMEDIATE',method),a=await place(p);await place(p);assert.equal(await scalar('select count(*)::int v from win_bar_order_payments where order_id=$1',[a.id]),1)}
assert.equal(await stock(),390)
const snapshot=await scalar("select bank_details_snapshot v from win_bar_cash_movements where payment_method='TRANSFER' limit 1")
assert.equal(snapshot.identifier,'bar.pruebas')
await mutate('bank.save',{...bank,requestId:id(),identifier:'bar.nueva'})
assert.deepEqual(await scalar("select bank_details_snapshot v from win_bar_cash_movements where payment_method='TRANSFER' limit 1"),snapshot)
await place({...payload(),court:'C4',courtDate:null,courtStart:null,clientUnknown:false})
const courtOrder=await place(payload('COURT')),account=await place(payload('ACCOUNT')),beforePay=await stock()
for(const [amount,method] of [[500,'CASH'],[1500,'TRANSFER']]){const p={requestId:id(),orderId:account.id,amount,method};await pay(p);await pay(p)}
await pay({requestId:id(),orderId:courtOrder.id,amount:2000,method:'CASH'})
assert.equal(await stock(),beforePay)
assert.equal((await inv('accounts',{status:'PENDING'})).total,0)
const paid=await inv('accounts',{status:'PAID'});assert.equal(paid.total,6)
assert.equal((await inv('accounts',{status:'ALL',audience:'COURT'})).total,1)
assert.equal((await inv('accounts',{status:'ALL',person:'Cliente aislado'})).total,1)
assert.equal(paid.orders.find(o=>o.id===account.id).payments.length,2)
const purchase={requestId:id(),supplier:'Proveedor aislado',purchaseDate:new Date().toISOString().slice(0,10),state:'ORDERED',payment:'UNPAID',totalCost:500,lines:[{productId:water,quantity:2,costMode:'TOTAL',cost:500}]}
const p=await inv('purchase.save',purchase);await inv('purchase.save',purchase)
assert.equal(await stock(),beforePay)
const line=(await inv('snapshot')).purchases.find(x=>x.id===p.id).lines[0]
const receive={requestId:id(),purchaseId:p.id,lines:[{lineId:line.id,quantity:2}],note:'Recepción aislada'}
await inv('purchase.receive',receive);await inv('purchase.receive',receive)
assert.equal(await stock(),beforePay+2)
const supplierPay={requestId:id(),purchaseId:p.id,amount:500,method:'CASH'};await inv('purchase.pay',supplierPay);await inv('purchase.pay',supplierPay)
for(const [kind,amount] of [['EXPENSE',100],['WITHDRAWAL',200]]){
 const out={requestId:id(),shiftId:shift,kind,amount,method:'CASH',note:'Salida sólo en prueba'};await inv('cash.out',out);await inv('cash.out',out)
 assert.equal((await scalar("select win_bar_request_status('tok-pedro',$1,'INVENTORY',$2::jsonb) v",[out.requestId,JSON.stringify({...out,action:'bar.inventory.cash.out'})])).state,'FOUND')
}
const view=await inv('cash.state')
assert.equal(Number(view.totals.cashExpected),6700);assert.equal(Number(view.totals.cashSales),6500);assert.equal(Number(view.totals.transferSales),3500);assert.equal(Number(view.totals.cardSales),2000)
const report=await inv('dashboard');assert.equal(Number(report.current.sales),12000);assert.equal(Number(report.current.collected),12000)
assert.ok(Number(report.current.estimatedCostUnits)>0);assert.equal(Number(report.previous.sales),0);assert.equal(Number(report.current.supplierPayments),500)
assert.equal(Number(await scalar("select total v from win_bar_purchases where kind='HISTORICAL'")),822800);assert.equal(Number(await scalar('select sum(quantity) v from win_bar_stock_count_lines')),393)
await reject(()=>mutate('cash.close',{shiftId:shift,countedCash:1}),'BAR_CLOSE_INVALID')
const close={requestId:id(),shiftId:shift,countedCash:6700};await inv('cash.close',close);await inv('cash.close',close)
assert.equal(Number(await scalar("select closing_snapshot->>'difference' v from win_bar_cash_shifts where id=$1",[shift])),0)
await reject(()=>mutate('cash.out',{shiftId:shift,amount:1,kind:'EXPENSE',method:'CASH',note:'Turno cerrado'}),'BAR_SHIFT_NOT_OPEN')
assert.equal(await scalar('select count(*)::int v from win_cash_movements'),0)
await q('set role service_role');assert.equal((await inv('accounts',{status:'ALL'})).total,6);await q('reset role')
for(const f of ['win_bar_inventory_api(text,text,jsonb)','win_bar_accounts(text,jsonb)','win_bar_shift_totals(uuid)','win_bar_period_summary(date,date)'])assert.equal(await scalar("select has_function_privilege('anon',$1,'EXECUTE') v",[f]),false)
console.log('PASS Bar diario: banco confirmado, tres medios, deudas, cobros parciales/finales, stock único, compras/recepción/pago, egresos, arqueo y permisos; sin producción.')
await db.close()
