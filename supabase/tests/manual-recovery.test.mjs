import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

let pgClient
if(process.env.BAR_TEST_DATABASE_URL){const pg=await import('pg');pgClient=new pg.Client({connectionString:process.env.BAR_TEST_DATABASE_URL});await pgClient.connect();await pgClient.query('create extension if not exists btree_gist')}
const db=pgClient?{exec:s=>pgClient.query(s),query:(s,p)=>pgClient.query(s,p),close:()=>pgClient.end()}:new PGlite({extensions:{btree_gist}})
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

await db.exec(readFileSync(new URL("../operations/first-migration.sql",import.meta.url),"utf8"));
await db.exec(readFileSync(new URL("../operations/first-migration.sql",import.meta.url),"utf8"));
for(let i=0;i<2;i++)await db.exec(readFileSync(new URL("../migrations/20261126194407_win_migration_review_phone.sql",import.meta.url),"utf8"))

const admin=(await one("select id from win_auth.login_accounts where username='test-admin'")).id;
await db.exec(`create table if not exists public.win_bar_private_accounts(id uuid primary key default gen_random_uuid(),customer_id uuid references public.win_customers);
create table if not exists public.win_bar_employee_access(id uuid primary key default gen_random_uuid(),customer_id uuid references public.win_customers);`);
for(const name of ['win_resumen_admin','win_clases_profesor_dia','win_turnos','win_movimientos','win_cobros_distribuidos','win_incidencias'])await db.exec('create table if not exists public.'+name+'(capture text);insert into public.'+name+"(capture)values('Apps Script fixture')");
await db.exec(`create table if not exists public.win_bar_cash_movements(id uuid primary key default gen_random_uuid(),request_id uuid,shift_id uuid,recorded_by uuid,occurred_at timestamptz default now(),kind text,payment_method text,amount_signed numeric,note text,order_id uuid);
create table if not exists public.win_bar_order_payments(id uuid primary key default gen_random_uuid(),cash_movement_id uuid,bar_cash_movement_id uuid);
alter table public.win_bar_order_payments add column if not exists cash_movement_id uuid;
alter table public.win_bar_order_payments add column if not exists bar_cash_movement_id uuid;
grant select on public.win_bar_cash_movements,public.win_bar_order_payments to service_role;`);
await q("insert into public.win_bar_cash_movements(request_id,shift_id,recorded_by,kind,payment_method,amount_signed,note)values($1,$2,$3,'SALE','CASH',5000,'Cobro Bar real en base aislada')",[uuid(),uuid(),admin]);
const row=(kind,cell,extra={})=>({sourceKey:'fixture:'+cell,sha256:'fixture',file:'isolated.xlsx',sheet:'sheet',cell,kind,status:'CONFIRMED',name:'Persona Importada',phone:'5491155550301',raw:{value:cell},reasons:[],...extra});
const client=row('CLIENT','A1'),abon=row('ABONO','B1',{clientSourceKey:client.sourceKey,court:'C1',weekday:1,start:'18:30',duration:90}),waiting=row('WAITLIST','A2',{status:'REVIEW',name:'',phone:null,days:'Martes',times:['19:00']});
await one('select public.win_first_migration_import($1,$2)',[admin,JSON.stringify([client,abon,waiting])]);
const sourceId='1kYR8t-3dyXC0gFRiMMjBV7sV-byOgfIlGl2mCMwP-zE';
await q("insert into public.win_history_rows(source_id,entity,origin_id,source_row,raw,facts,content_hash)values($1,'entry','old-income',2,'[]',$2,'fixture')",[sourceId,JSON.stringify({type:'RESERVA',status:'ACTIVE',activity_date:'2026-01-01',payment_date:'2026-01-02',occurred_at:'2026-01-02T12:00:00-03:00',cash:999999,transfer:0,quantity:1,courts:[]})]);
const day=(await one('select public.win_config_today_()::text d')).d;
const shift=await ops('one','control',{operation:'open',date:day,cash:0,requestId:uuid()});
const manual=await api('one','create',{requestId:uuid(),kind:'RESERVA',date:'2030-02-04',court:'C4',start:'09:00',duration:90,customerName:'Cliente Manual',phone:'11 5555 0101',price:100000});
await api('one','pay',{requestId:uuid(),id:manual.id,shiftId:shift.id,cash:10000});
const imported=(await one("select customer_id from public.win_migration_rows where kind='CLIENT'")).customer_id;
const signatures=async()=>({reception:await q(`select id,amount_signed,payment_method,shift_id from public.win_cash_movements order by id`),bar:await q(`select id,amount_signed,payment_method,shift_id from public.win_bar_cash_movements order by id`),products:await q('select * from public.win_products order by id')});
const before=await signatures();
assert.ok(before.reception.length>0&&before.bar.length>0);
await db.exec(`create schema win_backup_20261126_manual;
create table win_backup_20261126_manual.archive(verified boolean);insert into win_backup_20261126_manual.archive values(true);`);
for(const table of await q("select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','win_auth') and c.relkind='r'"))await db.exec('create table win_backup_20261126_manual."'+table.nspname+'__'+table.relname+'" as table "'+table.nspname+'"."'+table.relname+'"');
const cleanup=readFileSync(new URL('../operations/retire-imported-data.sql',import.meta.url),'utf8');
// A financial account linked after the snapshot must abort cleanup, never cascade.
await q('insert into public.win_bar_private_accounts(customer_id)values($1)',[imported]);
await fail(()=>db.exec(cleanup),'IMPORTED_RECORD_HAS_OPERATIONAL_REFERENCE');await db.exec('rollback');
assert.equal((await one("select count(*)::int n from public.win_migration_rows")).n,3);
assert.deepEqual(await signatures(),before);
await q('delete from public.win_bar_private_accounts where customer_id=$1',[imported]);
if(!(await one("select to_regprocedure('public.win_admin_report_(date,date)') exists")).exists){
 await db.exec("alter function public.win_ops_admin(text,jsonb) rename to win_test_admin_base");
 await db.exec(`create function public.win_admin_report_(d1 date,d2 date) returns jsonb language sql as $$select public.win_test_admin_base('admin',jsonb_build_object('start',d1,'end',d2))$$`);
}
const mode=readFileSync(new URL('../operations/manual-mode.sql',import.meta.url),'utf8');
await db.exec(mode);await db.exec(mode);
await fail(()=>q('select public.win_first_migration_import($1,$2)',[admin,JSON.stringify([client])]),'IMPORT_DISABLED');
await fail(()=>api('admin','registry.list',{}),'IMPORT_DISABLED');
assert.equal((await one("select count(*)::int n from public.win_admin_ledger where source='APPS_SCRIPT'")).n,0);
assert.equal(Number((await one('select sum(amount_signed) n from public.win_admin_ledger')).n),15000);
await db.exec(cleanup);
assert.equal((await one('select count(*)::int n from public.win_migration_rows')).n,0);
assert.equal((await one('select count(*)::int n from public.win_calendar_waitlist')).n,0);
assert.equal((await one('select count(*)::int n from public.win_history_rows')).n,0);
assert.equal((await one('select count(*)::int n from public.win_court_abonos')).n,0);
assert.equal((await one('select count(*)::int n from public.win_customers')).n,1);
assert.deepEqual(await signatures(),before);
assert.equal((await one('select count(*)::int n from public.win_court_bookings')).n,1);
// Exact source restoration in isolation proves the data copy can recover selected records.
for(const table of ['win_customers','win_court_abonos','win_calendar_waitlist','win_migration_rows','win_history_rows'])await db.exec('insert into public.'+table+' select b.* from win_backup_20261126_manual.public__'+table+' b where not exists(select 1 from public.'+table+" t where to_jsonb(t)=to_jsonb(b))");
assert.equal((await one('select count(*)::int n from public.win_migration_rows')).n,3);
await db.exec(cleanup);await db.exec(cleanup);
assert.deepEqual(await signatures(),before);
const report=await ops('admin','admin',{start:'2020-01-01',end:'2020-01-02'});
assert.deepEqual(report.history,{});assert.deepEqual(report.historicalShifts,[]);assert.ok(report.coverage.start);
const coach=(await one('select id from public.win_coaches where active order by name limit 1')).id;
const classPayload={requestId:uuid(),kind:'CLASE',date:'2030-03-04',classUntil:'2030-03-18',court:'C2',start:'10:00',duration:60,teacherId:coach,lesson:{participants:2,classKind:'TRADICIONAL'},participants:[]};
const classSeries=await api('one','class.series.create',classPayload);
assert.equal(classSeries.count,3);
assert.deepEqual(await api('one','class.series.create',classPayload),classSeries);
assert.equal((await one("select count(*)::int n from public.win_court_bookings where lesson ? 'manualSeriesId'")).n,3);
await fail(()=>api('bar','class.series.create',{...classPayload,requestId:uuid()}),'NOT_AUTHORIZED');
await fail(()=>api('one','class.series.create',{...classPayload,requestId:uuid(),classUntil:''}),'CLASS_SERIES_INVALID');
await fail(()=>api('one','class.series.create',{...classPayload,classUntil:'2030-03-25'}),'REQUEST_ID_REUSED');
const reservation=await api('one','create',{requestId:uuid(),kind:'RESERVA',date:'2030-04-08',court:'C3',start:'10:00',duration:90,customerName:'Reserva Existente',phone:'11 5555 0102',price:100000});
const countBefore=(await one('select count(*)::int n from public.win_court_bookings')).n;
await fail(()=>api('one','class.series.create',{...classPayload,requestId:uuid(),date:'2030-04-01',classUntil:'2030-04-15',court:'C3'}),'COURT_TAKEN');
assert.equal((await one('select count(*)::int n from public.win_court_bookings')).n,countBefore);
const abono=await api('one','abono.create',{requestId:uuid(),kind:'RESERVA',date:'2030-05-06',court:'C1',start:'17:00',duration:90,customerName:'Abono Manual',phone:'11 5555 0103',price:100000});
assert.ok(abono.abonoId);
assert.deepEqual(await signatures(),before);
assert.equal((await one('select count(*)::int n from public.win_ops_records')).n,0);
console.log('PASS recuperación: origen, abortar relaciones reales, dinero/stock/usuarios preservados, respaldo restaurable, limpieza repetible, reportes LIVE, reserva/abono manuales y clases semanales atómicas e idempotentes');
await db.close();
