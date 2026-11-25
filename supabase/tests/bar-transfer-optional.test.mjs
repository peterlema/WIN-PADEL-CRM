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
const id=()=>crypto.randomUUID()
const reject=async(f,code)=>assert.rejects(f,e=>e.message.includes(code))
const inv=(action,p={},token='tok-pedro')=>scalar('select win_bar_inventory_api($1,$2,$3::jsonb) v',[token,action,JSON.stringify(p)])
await inv('cash.open',{requestId:id(),openingCash:19200})
const water=await scalar("select id v from win_products where name='Agua Manaos'")
const customer=(await scalar("select win_bar_customer_create('tok-pedro','Cliente de prueba') v")).id
function payload(destination='IMMEDIATE',method='CASH'){
 return {requestId:id(),items:[{id:water,quantity:1}],destination,customerId:destination==='ACCOUNT'?customer:null,bookingId:null,court:null,courtDate:null,courtStart:null,note:'',method:destination==='IMMEDIATE'?method:null,clientUnknown:destination==='IMMEDIATE'}
}
const place=(p,token='tok-pedro',conn=db)=>conn.query('select win_bar_order_place($1,$2,$3::jsonb,$4,$5,$6,$7,$8::date,$9::time,$10,$11,$12) v',[token,p.requestId,JSON.stringify(p.items),p.destination,p.customerId,p.bookingId,p.court,p.courtDate,p.courtStart,p.note,p.method,p.clientUnknown]).then(r=>r.rows[0].v)
const pay=(p,token='tok-pedro',conn=db)=>conn.query('select win_bar_order_pay($1,$2,$3,$4,$5) v',[token,p.requestId,p.orderId,p.amount,p.method]).then(r=>r.rows[0].v)
const status=(p,kind='PLACE',token='tok-pedro',conn=db)=>conn.query('select win_bar_request_status($1,$2,$3,$4::jsonb) v',[token,p.requestId,kind,JSON.stringify(p)]).then(r=>r.rows[0].v)
const counts=()=>scalar(`select jsonb_build_object('orders',(select count(*) from win_bar_orders),'stock',(select sum(quantity_change) from win_bar_stock_movements),'payments',(select count(*) from win_bar_order_payments),'cash',(select count(*) from win_bar_cash_movements)) v`)
const originalPayload=payload('ACCOUNT')
const original=await place(originalPayload)
await db.exec(readFileSync(new URL('../operations/bar-costs-initial-20261124.sql',import.meta.url),'utf8'))
const before=await counts()
assert.deepEqual(before,{orders:1,stock:392,payments:0,cash:0})
await reject(()=>place(payload()),'BAR_PRICE_IMMUTABLE')
assert.deepEqual(await counts(),before)
await db.exec(readFileSync(new URL('../migrations/20261124183000_win_bar_checkout_recovery.sql',import.meta.url),'utf8'))
assert.deepEqual(await counts(),before)
assert.equal((await status(originalPayload)).state,'FOUND')
const missing=payload()
assert.equal((await status(missing)).state,'NOT_FOUND')
await reject(()=>status(originalPayload,'PLACE','tok-rec'),'NOT_AUTHORIZED')
const cashPayload=payload()
await q('set role service_role')
const sale=await place(cashPayload)
assert.equal((await place(cashPayload)).id,sale.id)
assert.equal((await status(cashPayload)).state,'FOUND')
await q('reset role')
assert.deepEqual(await counts(),{orders:2,stock:391,payments:1,cash:1})
assert.equal(Number(await scalar('select amount_signed v from win_bar_cash_movements where order_id=$1',[sale.id])),2000)
assert.equal(await scalar('select cost_is_provisional v from win_bar_order_items where order_id=$1',[sale.id]),true)
await reject(()=>q("update win_bar_order_items set cost_is_provisional=false where order_id=$1",[sale.id]),'BAR_PRICE_IMMUTABLE')
await reject(()=>q("update win_bar_order_items set unit_cost=0 where order_id=$1",[sale.id]),'BAR_PRICE_IMMUTABLE')
await reject(()=>q("update win_bar_order_items set unit_price=1 where order_id=$1",[sale.id]),'BAR_PRICE_IMMUTABLE')
await reject(()=>status({...cashPayload,method:'CARD'}),'REQUEST_ID_REUSED')
const originalItem=await scalar('select to_jsonb(i) v from win_bar_order_items i where order_id=$1',[original.id])
const transfer=payload('IMMEDIATE','TRANSFER'),noBank=await counts()
await reject(()=>place(transfer),'BAR_BANK_REQUIRED')
assert.deepEqual(await counts(),noBank)
assert.equal((await status(transfer)).state,'NOT_FOUND')
await inv('bank.save',{requestId:id(),accountLabel:'Cuenta de prueba aislada'})
for(const method of ['TRANSFER','CARD']){
 const p=payload('IMMEDIATE',method),c=await counts()
 const s=await place(p);await place(p)
 assert.equal((await status(p)).state,'FOUND')
 const after=await counts()
 assert.equal(after.orders,c.orders+1);assert.equal(after.stock,c.stock-1);assert.equal(after.payments,c.payments+1);assert.equal(after.cash,c.cash+1)
 assert.equal(await scalar('select payment_method v from win_bar_cash_movements where order_id=$1',[s.id]),method)
}
const accountPayload=payload('ACCOUNT'),c=await counts()
const account=await place(accountPayload);await place(accountPayload)
assert.deepEqual(await counts(),{orders:c.orders+1,stock:c.stock-1,payments:c.payments,cash:c.cash})
const historicalCost=await scalar('select unit_cost v from win_bar_order_items where order_id=$1',[account.id])
for(const [amount,method] of [[500,'CASH'],[750,'TRANSFER'],[750,'CARD']]){
 const p={requestId:id(),orderId:account.id,amount,method},stockBefore=(await counts()).stock
 const r=await pay(p);assert.equal(Number((await pay(p)).remaining),Number(r.remaining))
 assert.equal((await status(p,'PAY')).state,'FOUND')
 assert.equal((await counts()).stock,stockBefore)
 await reject(()=>status({...p,amount:amount+1},'PAY'),'REQUEST_ID_REUSED')
}
assert.equal(await scalar('select status v from win_bar_orders where id=$1',[account.id]),'PAID')
assert.equal(Number(await scalar('select sum(amount) v from win_bar_order_payments where order_id=$1',[account.id])),2000)
assert.equal(await scalar('select unit_cost v from win_bar_order_items where order_id=$1',[account.id]),historicalCost)
assert.deepEqual(await scalar('select to_jsonb(i) v from win_bar_order_items i where order_id=$1',[original.id]),originalItem)
assert.equal(Number(await scalar('select sum(quantity) v from win_bar_stock_count_lines')),393)
assert.equal(Number(await scalar('select total v from win_bar_purchases where kind=\'HISTORICAL\'')),822800)
assert.equal(await scalar("select has_function_privilege('anon','win_bar_request_status(text,uuid,text,jsonb)','EXECUTE') v"),false)
assert.equal(await scalar("select has_function_privilege('authenticated','win_bar_request_status(text,uuid,text,jsonb)','EXECUTE') v"),false)
if(pgClient){
 const other=new pg.Client({connectionString:process.env.BAR_TEST_DATABASE_URL});await other.connect()
 try{
  const locked=payload()
  await pgClient.query('begin')
  await pgClient.query("select pg_advisory_xact_lock(hashtextextended('bar-order:'||$1::text,0))",[locked.requestId])
  assert.equal((await status(locked,'PLACE','tok-pedro',other)).state,'IN_PROGRESS')
  await pgClient.query('rollback')
  assert.equal((await status(locked)).state,'NOT_FOUND')
  const simultaneous=payload(),c=await counts()
  const [a,b]=await Promise.all([place(simultaneous),place(simultaneous,'tok-pedro',other)])
  assert.equal(a.id,b.id)
  assert.deepEqual(await counts(),{orders:c.orders+1,stock:c.stock-1,payments:c.payments+1,cash:c.cash+1})
  console.log('PASS PostgreSQL concurrente: misma solicitud, una venta/entrega/cobro; consulta IN_PROGRESS durante transacción abierta.')
 }finally{await other.end()}
}
console.log('PASS checkout integrado: reproduce BAR_PRICE_IMMUTABLE; efectivo/transferencia/tarjeta, cuenta corriente sin dinero, pagos parciales idempotentes, consulta del mismo requestId, rol service_role, costos y datos históricos intactos.')


await db.exec(readFileSync(new URL('../migrations/20261125010000_win_bar_bank_destination.sql',import.meta.url),'utf8'))
await q('delete from win_bar_bank_config') // isolated fixture only; production bank data are never changed
await db.exec(readFileSync(new URL('../migrations/20261125020000_win_bar_transfer_without_bank_requirement.sql',import.meta.url),'utf8'))
const banklessBefore=await counts(),physicalBefore=Number((await inv('cash.state')).cashExpected)
assert.equal((await inv('cash.state')).bankConfigured,false)
assert.equal((await inv('cash.state')).transfersEnabled,true)
const transferWithoutBank=payload('IMMEDIATE','TRANSFER')
const savedWithoutBank=await place(transferWithoutBank);await place(transferWithoutBank)
assert.deepEqual(await counts(),{orders:banklessBefore.orders+1,stock:banklessBefore.stock-1,payments:banklessBefore.payments+1,cash:banklessBefore.cash+1})
assert.equal(Number((await inv('cash.state')).cashExpected),physicalBefore)
assert.equal(await scalar('select bank_account_snapshot v from win_bar_cash_movements where order_id=$1',[savedWithoutBank.id]),null)
assert.equal(await scalar('select bank_destination_snapshot v from win_bar_cash_movements where order_id=$1',[savedWithoutBank.id]),null)
const acc=await place(payload('ACCOUNT')),delivered=(await counts()).stock
for(const amount of [750,1250]){
 const p={requestId:id(),orderId:acc.id,amount,method:'TRANSFER'}
 await pay(p);await pay(p)
 assert.equal((await counts()).stock,delivered)
}
assert.equal(Number((await inv('cash.state')).cashExpected),physicalBefore)
assert.equal(Number(await scalar('select sum(amount) v from win_bar_order_payments where order_id=$1',[acc.id])),2000)
assert.equal(await scalar('select count(*)::int v from win_bar_bank_config'),0)
const receiptBox=await scalar("select count(*)::int v from win_cash_movements")
assert.equal(receiptBox,0)
console.log('PASS transferencia sin banco: inmediata y parcial idempotentes, cuenta no inventada, comprobante externo, efectivo físico y Recepción sin cambios.')
await db.close()
