// Bar: "Cobrar ahora" con cancha y horario del cliente o "No conozco cliente" (migración 20261125_win_bar_immediate_court_client).
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
const dir=new URL('../migrations/', import.meta.url).pathname
const db=new PGlite({extensions:{btree_gist,pgcrypto}})
await db.exec(`create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto schema extensions;
create schema auth; create table auth.users(id uuid primary key); create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`)
const order=['20261123_win_foundation_users_cash.sql','20261123_win_private_username_pin_accounts.sql','20261123_win_backend_sessions_cash.sql','20261123_win_rbac_roles_permissions_initial.sql','20261124_win_court_bookings.sql','20261123_win_rbac_enforce_existing_cash_courts.sql','20261123_win_cash_expense_withdrawal_validation.sql','20261124_win_courts_v2_pricing_payments_abonos.sql','20261124_win_courts_v3_payment_method_at_collection.sql','20261123_win_bar_product_catalog_and_seed.sql','20261123_win_bar_pos_orders_pending_and_court.sql','20261123_win_bar_court_calendar_reception_settlement.sql','20261125_win_bar_immediate_court_client.sql','20261125_win_bar_immediate_court_client.sql']
for(const f of order){try{await db.exec(readFileSync(dir+f,'utf8'))}catch(e){console.log('MIGRATION FAIL',f,e.message.slice(0,200));process.exit(1)}}
console.log('migrations ok')
const q=async(s,p)=>(await db.query(s,p)).rows
await q(`create or replace function public.win_pin_session(p_token text) returns table(account_id uuid, display_name text, role text, expires_at timestamptz) language sql as $$ select id,display_name,role,now()+interval '1h' from win_auth.login_accounts where 'tok-'||username_key=p_token $$`)
await q(`insert into win_auth.login_accounts(username,display_name,role,pin_hash,enabled) values('admin','Admin','ADMIN','x',true)`)
const a=(await q(`select id from win_auth.login_accounts where username='admin'`))[0].id
await q(`insert into public.win_staff(user_id,display_name,role,active) values($1,'Admin','ADMIN',true)`,[a])
await q(`insert into public.win_cash_shifts(opened_by,business_date,opening_cash) values($1,current_date,0)`,[a])
const p=(await q(`update public.win_products set sale_price=3000 where id=(select id from public.win_products limit 1) returning id`))[0].id
const items=JSON.stringify([{id:p,quantity:2}])
const place=(unk,court,start)=>q(`select public.win_bar_order_place('tok-admin',gen_random_uuid(),$1::jsonb,'IMMEDIATE',null,null,$2,$3::date,$4::time,'','CASH',$5) r`,[items,court,court?new Date().toISOString().slice(0,10):null,start,unk])
const err=async f=>{try{await f();return ''}catch(e){return e.message}}
await place(false,'C2','18:00'); console.log('OK cobrar ahora con cancha y horario')
await place(true,null,null); console.log('OK cobrar ahora con No conozco cliente')
console.log((await err(()=>place(true,'C1','19:00'))).includes('ORDER_INVALID')?'OK no se aceptan las dos cosas':'FAIL ambas')
console.log((await err(()=>place(false,'C9','19:00'))).includes('COURT_INVALID')?'OK cancha invalida rechazada':'FAIL cancha')
const r=await q(`select court,to_char(court_start,'HH24:MI') s,client_unknown,status from public.win_bar_orders order by created_at`)
console.log(JSON.stringify(r))
const m=await q(`select count(*)::int n, sum(amount_signed)::int t from public.win_cash_movements`); console.log('caja',JSON.stringify(m))
const pend=await q(`select count(*)::int n from public.win_bar_orders where status='OPEN'`); console.log(pend[0].n===0?'OK no quedan como pendientes':'FAIL pendientes')
