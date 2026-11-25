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
await db.exec(readFileSync(new URL('../migrations/20261125010000_win_bar_bank_destination.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../migrations/20261125020000_win_bar_transfer_without_bank_requirement.sql',import.meta.url),'utf8'))
const before=await scalar('select to_jsonb(s) v from win_bar_cash_shifts s where id=$1',[previous])
await db.exec(readFileSync(new URL('../operations/bar-stabilization.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../migrations/20261125011135_win_bar_cash_totals_compatibility.sql',import.meta.url),'utf8'))
assert.equal(Number(await scalar('select sum(quantity_change) v from win_bar_stock_movements')),393)
const after=await scalar('select to_jsonb(s) v from win_bar_cash_shifts s where id=$1',[previous]);delete after.closing_snapshot;assert.deepEqual(after,before)
await db.exec(readFileSync(new URL('../operations/bar-costs-initial-20261124.sql',import.meta.url),'utf8'))

const water=await scalar("select id v from win_products where name='Agua Manaos'")
const legacy=(await scalar("select win_bar_customer_create('tok-pedro','Cliente anterior') v")).id
const shift=(await mutate('cash.open',{openingCash:0})).id
const orderPayload=cid=>({requestId:id(),items:[{id:water,quantity:1}],destination:'ACCOUNT',customerId:cid,bookingId:null,court:null,courtDate:null,courtStart:null,note:'',method:null,clientUnknown:false})
const oldPlace=p=>scalar('select win_bar_order_place($1,$2,$3::jsonb,$4,$5,$6,$7,$8::date,$9::time,$10,$11,$12) v',['tok-pedro',p.requestId,JSON.stringify(p.items),p.destination,p.customerId,p.bookingId,p.court,p.courtDate,p.courtStart,p.note,p.method,p.clientUnknown])
const historical=await oldPlace(orderPayload(legacy))
const historyBefore=await scalar('select to_jsonb(i) v from win_bar_order_items i where order_id=$1',[historical.id])
const stock=()=>scalar('select sum(quantity_change)::int v from win_bar_stock_movements')
const stockBefore=await stock()
await db.exec(readFileSync(new URL('../operations/bar-private-accounts.sql',import.meta.url),'utf8'))
assert.deepEqual(await scalar('select to_jsonb(i)-$2 v from win_bar_order_items i where order_id=$1',[historical.id,'private_policy_snapshot']),historyBefore)
assert.equal(await stock(),stockBefore)
assert.equal((await inv('private.list')).accounts.length,0)
assert.equal((await scalar("select win_bar_products_list('tok-bar') v")).products[0].unitCost,undefined)
assert.ok((await scalar("select win_bar_products_list('tok-pedro') v")).products[0].unitCost!=null)
assert.equal((await scalar("select win_bar_customers('tok-pedro') v")).customers.length,0)
await reject(()=>oldPlace(orderPayload(legacy)),'PRIVATE_ACCOUNT_UNAUTHORIZED')
await reject(()=>scalar("select win_bar_customer_create('tok-bar','No autorizado') v"),'PRIVATE_ACCOUNT_ADMIN_REQUIRED')
const partnerCfg={discountPercent:50,minMarkupPercent:10,rounding:'UP',roundingStep:500,exceptions:{},notes:'Prueba aislada'}
const create={requestId:id(),id:null,customerId:legacy,holder:'Socio autorizado',type:'PARTNER',active:true,configuration:partnerCfg}
await reject(()=>inv('private.save',create,'tok-bar'),'NOT_AUTHORIZED')
const a=await inv('private.save',create);await inv('private.save',create)
assert.equal(await scalar("select count(*)::int v from win_bar_inventory_audit where action='private.save'"),1)
assert.equal((await scalar("select win_bar_customers('tok-bar') v")).customers.length,1)
for(const action of ['preview','configuration','candidates'])await reject(()=>inv('private.'+action,{configuration:partnerCfg,customerId:legacy},'tok-bar'),'NOT_AUTHORIZED')
const quote=p=>inv('private.quote',{customerId:p.customerId,items:p.items},'tok-bar')
const p=orderPayload(legacy),quoted=await quote(p)
assert.equal(quoted.total,1000);assert.equal(quoted.lines[0].unitCost,undefined);assert.equal(quoted.lines[0].grossMargin,undefined)
p.quoteFingerprint=quoted.fingerprint
const place=(p,conn=db)=>conn.query("select win_bar_private_place('tok-bar',$1::jsonb) v",[JSON.stringify(p)]).then(r=>r.rows[0].v)
const sale=await place(p);const afterStock=await stock();assert.equal((await place(p)).id,sale.id);assert.equal(await stock(),afterStock)
const item=await scalar('select to_jsonb(i) v from win_bar_order_items i where order_id=$1',[sale.id])
assert.equal(Number(item.unit_price),1000);assert.equal(Number(item.public_unit_price),2000);assert.equal(Number(item.discount_unit_amount),1000)
assert.ok(Number(item.unit_cost)>0);assert.equal(item.private_policy_snapshot.configuration.discountPercent,50)
assert.equal((await scalar("select win_bar_request_status('tok-bar',$1,'PLACE',$2::jsonb) v",[p.requestId,JSON.stringify(p)])).state,'FOUND')
await reject(()=>place({...p,quoteFingerprint:'changed'}),'REQUEST_ID_REUSED')
const tomorrow=await scalar("select ((now() at time zone 'America/Argentina/Buenos_Aires')::date+1)::text v")
const future=await inv('private.statement',{customerId:legacy,start:tomorrow})
assert.equal(Number(future.openingBalance),3000);assert.equal(future.rows.length,0);assert.equal(Number(future.balance),3000)
const e=await mutate('private.save',{id:null,customerId:null,holder:'Empleado autorizado',type:'EMPLOYEE',active:true,configuration:{...partnerCfg,discountPercent:20,minMarkupPercent:0,rounding:'NONE',roundingStep:1}})
assert.equal((await quote(orderPayload(e.customerId))).total,1600)
const preview=await inv('private.preview',{configuration:partnerCfg});assert.ok(preview.lines[0].unitCost!=null)
const synthetic=async cost=>scalar("select win_bar_private_price_($1::jsonb,jsonb_populate_record(null::win_products,$2::jsonb)) v",[JSON.stringify(partnerCfg),JSON.stringify({id:water,business_unit:'CAFE_BAR',name:'Prueba',variant:'',active:true,sale_price:5000,unit_cost:cost,cost_is_provisional:false})])
assert.equal((await synthetic(3000)).price,3500)
assert.equal((await synthetic(5000)).valid,false)
assert.equal((await synthetic(null)).valid,false)
const full=(await inv('private.configuration',{customerId:legacy})).account
const staleP=orderPayload(legacy);staleP.quoteFingerprint=(await quote(staleP)).fingerprint
await mutate('private.save',{id:full.id,customerId:legacy,holder:full.holder,type:'PARTNER',active:true,expectedRevision:full.revision,configuration:{...partnerCfg,discountPercent:10}})
await reject(()=>place(staleP),'PRIVATE_QUOTE_STALE')
await reject(()=>mutate('private.save',{...create,requestId:id(),id:full.id,expectedRevision:full.revision}),'PRIVATE_CONFIG_STALE')
assert.deepEqual(await scalar('select to_jsonb(i) v from win_bar_order_items i where order_id=$1',[sale.id]),item)
assert.equal((await place(p)).id,sale.id) // exact replay survives subsequent pricing changes
let current=(await inv('private.configuration',{customerId:legacy})).account
await mutate('private.save',{id:current.id,customerId:legacy,holder:current.holder,type:'PARTNER',active:false,expectedRevision:current.revision,configuration:current.configuration})
await reject(()=>quote(orderPayload(legacy)),'PRIVATE_ACCOUNT_UNAUTHORIZED')
const beforePay=await stock()
const pay1={requestId:id(),customerId:legacy,amount:500,method:'TRANSFER'}
const partial=await inv('private.pay',pay1,'tok-bar');await inv('private.pay',pay1,'tok-bar')
assert.equal(Number(partial.remaining),2500);assert.equal(await stock(),beforePay)
assert.equal((await scalar("select win_bar_request_status('tok-bar',$1,'INVENTORY',$2::jsonb) v",[pay1.requestId,JSON.stringify({...pay1,action:'bar.inventory.private.pay'})])).state,'FOUND')
await reject(()=>inv('private.pay',{...pay1,requestId:id(),amount:3000},'tok-bar'),'PAYMENT_EXCEEDS_BALANCE')
await inv('private.pay',{requestId:id(),customerId:legacy,amount:2500,method:'CASH'},'tok-bar')
const ledger=await inv('private.statement',{customerId:legacy},'tok-bar')
assert.equal(Number(ledger.balance),0);assert.equal(ledger.rows.length,5);assert.equal(Number(ledger.rows.at(-1).balance),0)
assert.equal(ledger.rows.filter(r=>r.kind==='PAYMENT').reduce((sum,r)=>sum+Number(r.credit),0),3000)
assert.equal(await stock(),beforePay)
assert.equal(await scalar('select count(*)::int v from win_cash_movements'),0)
await reject(()=>q('update win_bar_order_items set private_policy_snapshot=null where order_id=$1',[sale.id]),'BAR_PRICE_IMMUTABLE')
for(const f of ['win_bar_private_api(text,text,jsonb)','win_bar_private_place(text,jsonb)','win_bar_private_quote_(uuid,jsonb)'])assert.equal(await scalar("select has_function_privilege('anon',$1,'EXECUTE') v",[f]),false)
await reject(()=>inv('private.list',{},'tok-rec'),'NOT_AUTHORIZED')
current=(await inv('private.configuration',{customerId:legacy})).account
await mutate('private.save',{id:current.id,customerId:legacy,holder:current.holder,type:'PARTNER',active:true,expectedRevision:current.revision,configuration:partnerCfg})
if(pgClient){
 const other=new pg.Client({connectionString:process.env.BAR_TEST_DATABASE_URL});await other.connect()
 try{
  const parallel=orderPayload(legacy);parallel.quoteFingerprint=(await quote(parallel)).fingerprint
  const before=await stock();const [s1,s2]=await Promise.all([place(parallel,pgClient),place(parallel,other)])
  assert.equal(s1.id,s2.id);assert.equal(await stock(),before-1)
  const apiOn=(conn,p)=>conn.query("select win_bar_inventory_api('tok-bar','private.pay',$1::jsonb) v",[JSON.stringify(p)])
  const payments=await Promise.allSettled([apiOn(pgClient,{requestId:id(),customerId:legacy,amount:750,method:'CASH'}),apiOn(other,{requestId:id(),customerId:legacy,amount:750,method:'CARD'})])
  assert.equal(payments.filter(r=>r.status==='fulfilled').length,1)
  assert.ok(payments.find(r=>r.status==='rejected').reason.message.includes('PAYMENT_EXCEEDS_BALANCE'))
  assert.equal(await stock(),before-1)
  console.log('PASS cuentas privadas PostgreSQL 17: venta concurrente una sola vez y cobros simultáneos sin exceder saldo.')
 }finally{await other.end()}
}
console.log('PASS cuentas privadas: autorización Admin, cero altas automáticas, reglas individuales, costo mínimo y redondeo, privacidad, cotización obsoleta, historial inmutable, deuda antigua, pagos parciales/finales sin stock, auditoría e idempotencia.')
await db.close()
