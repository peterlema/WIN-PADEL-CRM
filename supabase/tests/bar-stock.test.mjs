import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {readFileSync} from 'node:fs'
const db=new PGlite({extensions:{btree_gist,pgcrypto}})
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
const originalId=await scalar(`select id v from public.win_products where name='Villa Manaos'`)
await db.exec(seed);await db.exec(seed)
assert.equal(await scalar(`select count(*)::int v from public.win_bar_purchases`),1)
assert.equal(await scalar(`select count(*)::int v from public.win_bar_stock_counts`),1)
assert.equal(await scalar(`select sum(quantity_change)::int v from public.win_bar_stock_movements`),393)
assert.equal(await scalar(`select sum(quantity)::int v from public.win_bar_purchase_lines`),540)
assert.equal(await scalar(`select sum(purchased-physical)::int v from public.win_bar_reconciliation`),147)
assert.equal(Number(await scalar(`select sum(potential_value) v from public.win_bar_reconciliation`)),568000)
assert.equal(await scalar(`select id v from public.win_products where name='Agua Manaos'`),originalId)
assert.equal(await scalar(`select count(*)::int v from public.win_products`),11)
assert.equal(await scalar(`select count(*)::int v from public.win_bar_cash_movements`),0)
assert.equal(await scalar(`select count(*)::int v from public.win_cash_movements`),0)
assert.equal(await scalar(`select count(*)::int v from public.win_bar_purchases where supplier is null and purchase_date is null and payment_status='UNCONFIRMED'`),1)
assert.equal(await scalar(`select count(*)::int v from public.win_products where unit_cost is null`),10)
const id=()=>crypto.randomUUID()
const api=(action,p={},tok='tok-pedro')=>scalar(`select public.win_bar_inventory_api($1,$2,$3::jsonb) v`,[tok,action,JSON.stringify(p)])
const mutate=(action,p={})=>api(action,{requestId:id(),...p})
const reject=async(f,code)=>assert.rejects(f,e=>e.message.includes(code))
await reject(()=>api('snapshot',{},'tok-rec'),'NOT_AUTHORIZED')
assert.equal((await api('access',{},'tok-rec')).allowed,false)
const snapshot=await api('snapshot');assert.equal(snapshot.counts[0].total,393)
await reject(()=>mutate('purchase.receive',{purchaseId:snapshot.purchases[0].id,lines:[]}),'BAR_RECEIPT_INVALID')
const water=originalId,coca=await scalar(`select id v from public.win_products where name='Coca Zero'`)
const place=(req,quantity=2,product=water,destination='IMMEDIATE')=>scalar(`select public.win_bar_order_place('tok-pedro',$1,$2::jsonb,$3,null,null,$4,$5::date,$6::time,'',$7,$8) v`,[req,JSON.stringify([{id:product,quantity}]),destination,destination==='COURT'?'C1':null,destination==='COURT'?'2026-11-24':null,destination==='COURT'?'18:00':null,destination==='IMMEDIATE'?'CASH':null,destination==='IMMEDIATE'])
await reject(()=>place(id()),'BAR_SHIFT_NOT_OPEN')
const shift=(await mutate('cash.open',{openingCash:0})).id
await scalar(`select public.win_bar_product_save('tok-pedro',$1,'Agua Manaos','','Agua',2000,$2,null,true) v`,[water,await scalar(`select unit_cost v from public.win_products where id=$1`,[water])]);
let saleReq=id();const sale=await place(saleReq);await place(saleReq)
await reject(()=>place(saleReq,3),'REQUEST_ID_REUSED')
assert.equal(await scalar(`select sum(quantity_change)::int v from public.win_bar_stock_movements where product_id=$1`,[water]),90)
assert.equal(await scalar(`select count(*)::int v from public.win_cash_movements`),0)
assert.equal(await scalar(`select count(*)::int v from public.win_bar_cash_movements`),1)
const pending=await place(id(),1,coca,'COURT')
const payReq=id();const pay=()=>scalar(`select public.win_bar_order_pay('tok-pedro',$1,$2,3000,'CASH') v`,[payReq,pending.id])
await pay();await pay()
assert.equal(await scalar(`select sum(quantity_change)::int v from public.win_bar_stock_movements where product_id=$1`,[coca]),36)
await reject(()=>place(id(),100,coca),'BAR_STOCK_INSUFFICIENT')
const out={requestId:id(),productId:water,quantity:1,kind:'WASTE',note:'Botella dañada'}
await api('stock.out',out);await api('stock.out',out)
assert.equal(await scalar(`select sum(quantity_change)::int v from public.win_bar_stock_movements where product_id=$1`,[water]),89)
let purchase=(await mutate('purchase.create',{supplier:'Proveedor de prueba',purchaseDate:'2026-11-24',lines:[{productId:water,quantity:11,totalCost:11000},{productId:coca,quantity:4,totalCost:4000}]})).id
let purchased=(await api('snapshot')).purchases.find(p=>p.id===purchase)
const receipt={requestId:id(),purchaseId:purchase,lines:purchased.lines.map(l=>({lineId:l.id,quantity:l.quantity}))}
await api('purchase.receive',receipt);await api('purchase.receive',receipt)
assert.equal(await scalar(`select sum(quantity_change)::int v from public.win_bar_stock_movements where product_id=$1`,[water]),100)
assert.equal(await scalar(`select unit_cost v from public.win_products where id=$1`,[coca]),null)
const avg=Number(await scalar(`select unit_cost v from public.win_products where id=$1`,[water]))
assert.ok(Math.abs(avg-(89*(54800/132)+11000)/100)<0.000001)
const report=(await api('snapshot')).sales
assert.equal(report.unknownCostUnits,1);assert.equal(Number(report.revenue),7000);assert.equal(Number(report.knownCostRevenue),4000)
await reject(()=>mutate('purchase.pay',{purchaseId:purchase,amount:100,method:'TRANSFER'}),'BAR_BANK_REQUIRED')
await mutate('bank.save',{accountLabel:'Cuenta Bar confirmada (prueba)'})
const payment={requestId:id(),purchaseId:purchase,amount:500,method:'TRANSFER'};await api('purchase.pay',payment);await api('purchase.pay',payment)
await reject(()=>mutate('cash.close',{shiftId:shift,countedCash:10}),'BAR_CLOSE_INVALID')
await mutate('cash.close',{shiftId:shift,countedCash:7000})
await reject(()=>place(id()),'BAR_SHIFT_NOT_OPEN')
assert.equal(await scalar(`select count(*)::int v from public.win_cash_movements`),0)
assert.equal(await scalar(`select count(*)::int v from public.win_bar_cash_movements where purchase_id=$1`,[purchase]),1)
assert.equal(await scalar(`select has_function_privilege('anon','public.win_bar_inventory_api(text,text,jsonb)','EXECUTE') v`),false)
await reject(()=>q(`update public.win_bar_stock_movements set note='changed'`),'BAR_IMMUTABLE')
await q(`set role service_role`);assert.equal((await api('snapshot')).canEdit,true);await q(`reset role`);
console.log('PASS Bar M06: 393 physical, 540 historical, no duplicate seed/receipts/payments, weighted/unknown costs, cash isolation, stock limits, permissions, immutable audit.')
await db.close()
