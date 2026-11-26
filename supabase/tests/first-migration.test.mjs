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
const admin=(await one("select id from win_auth.login_accounts where username='test-admin'")).id
const row=(kind,cell,extra={})=>({sourceKey:'fixture:'+cell,sha256:'fixture',file:'isolated.xlsx',sheet:'sheet',cell,kind,status:'CONFIRMED',name:'Persona Completa',phone:'5491155550901',reasons:[],...extra})
const client=row('CLIENT','A1')
const abon=row('ABONO','B1',{clientSourceKey:client.sourceKey,court:'C1',weekday:2,start:'18:30',duration:90,note:'Observación original, sin cobro'})
const waiting=row('WAITLIST','A2',{status:'REVIEW',name:'Sólo nombre',phone:null,days:'Martes o jueves',times:['19:00'],channel:'IG',reference:'Origen'})
const importRows=async rows=>(await one('select public.win_first_migration_import($1,$2) r',[admin,JSON.stringify(rows)])).r
const financial=()=>one(`select (select count(*) from public.win_cash_movements) cash,(select count(*) from public.win_court_payments) payments,(select count(*) from public.win_ops_records) operations,(select count(*) from public.win_bar_orders) bar`)
const before=await financial()
assert.equal((await importRows([client,abon,waiting])).inserted,3)
assert.equal((await importRows([client,abon,waiting])).inserted,0)
assert.equal((await one('select count(*)::int n from public.win_court_abonos')).n,1)
assert.deepEqual(await financial(),before)
assert.equal((await one('select count(*)::int n from public.win_court_bookings')).n,0)
await fail(()=>importRows([{...client,raw:{changed:true}}]),'IMPORT_SOURCE_CHANGED')
assert.equal((await importRows([{...client,status:'REVIEW',reasons:['La vista previa ahora encuentra la ficha incorporada']}])).inserted,0)
const aid=(await one('select abono_id from public.win_migration_rows where source_key=$1',[abon.sourceKey])).abono_id
const series=await one('select * from public.win_court_abonos where id=$1',[aid])
assert.equal(series.agreed_amount,null);assert.equal(series.expected_method,null)
series.starts_on=new Date(series.starts_on).toISOString().slice(0,10)
assert.ok(series.starts_on>='2026-12-01')
const futureRows=(await api('admin','range',{start:series.starts_on,end:series.starts_on})).rows
assert.equal(futureRows.length,1);assert.equal(futureRows[0].price,null);assert.equal(Number(futureRows[0].paid),0)
assert.equal((await one('select court from public.win_calendar_waitlist')).court,null)
await fail(()=>api('bar','registry.list',{}),'NOT_AUTHORIZED')
await fail(()=>api('one','registry.list',{kind:'CLIENT'}),'NOT_AUTHORIZED')
const listed=await api('one','registry.list',{kind:'ABONO'})
assert.equal(listed.series.length,1);assert.equal(listed.waitlist.length,1)
const conflict=row('ABONO','B2',{...abon,sourceKey:'fixture:B2',cell:'B2'})
await importRows([conflict])
assert.equal((await one('select status from public.win_migration_rows where source_key=$1',[conflict.sourceKey])).status,'REVIEW')
const ambiguous=row('CLIENT','A3',{name:'Otra Persona'})
await importRows([ambiguous])
assert.equal((await one('select status from public.win_migration_rows where source_key=$1',[ambiguous.sourceKey])).status,'REVIEW')
assert.equal((await one('select count(*)::int n from public.win_customers')).n,1)
const typo=row('CLIENT','A4',{name:'Alias Completa',phone:'5491155550902'})
await importRows([typo])
assert.equal((await one('select status from public.win_migration_rows where source_key=$1',[typo.sourceKey])).status,'REVIEW')
// Same number can be stored for two distinct people, but is never selected by phone alone.
await q("insert into public.win_customers(name,phone,created_by) values('Otra Persona',$1,$2)",[client.phone,admin])
await fail(()=>q('select public.win_calendar_customer($1,$2)',[admin,JSON.stringify({customerName:'Sin coincidencia',phone:client.phone})]),'CUSTOMER_AMBIGUOUS')
const id=(await one('select id from public.win_customers where name=$1',[client.name])).id
assert.equal((await one('select public.win_calendar_customer($1,$2) id',[admin,JSON.stringify({customerId:id})])).id,id)
const wr=await one('select * from public.win_migration_rows where kind=\'WAITLIST\'')
const payload={requestId:uuid(),id:wr.id,revision:wr.revision,name:'Nombre Completo',status:'REVIEW',reason:'Revisión manual de identificación'}
await fail(()=>api('one','registry.save',payload),'NOT_AUTHORIZED')
const reviewed=await api('admin','registry.save',payload)
assert.equal(reviewed.revision,2)
assert.deepEqual(await api('admin','registry.save',payload),reviewed)
await fail(()=>api('admin','registry.save',{...payload,requestId:uuid()}),'STALE_REVISION')
assert.deepEqual((await one('select original from public.win_migration_rows where id=$1',[wr.id])).original,waiting)
assert.deepEqual(await financial(),before)
assert.equal((await api('admin','request',{requestId:payload.requestId})).found,true)
const cr=await one('select * from public.win_migration_rows where source_key=$1',[ambiguous.sourceKey])
for(const name of ['Nombre','Clase Leo'])await fail(()=>api('admin','registry.save',{requestId:uuid(),id:cr.id,revision:cr.revision,name,phone:'11 6666 0123',status:'CONFIRMED',reason:'Comprobar identificación incompleta'}),'CUSTOMER_REQUIRED')
const approved=await api('admin','registry.save',{requestId:uuid(),id:cr.id,revision:cr.revision,name:'Identidad Verificada',phone:'11 6666 0123',status:'CONFIRMED',reason:'Nombre completo y teléfono confirmados'})
assert.ok(approved.customer_id)
assert.equal((await one('select phone from public.win_customers where id=$1',[approved.customer_id])).phone,'5491166660123')
assert.deepEqual(await financial(),before)
await db.exec("delete from public.win_calendar_requests;delete from public.win_cash_audit;delete from public.win_migration_rows;delete from public.win_calendar_waitlist;delete from public.win_court_abonos;delete from public.win_customers")
if(process.argv[2]){
 const actual=JSON.parse(readFileSync(process.argv[2],'utf8'))
 for(const old of actual.existing.customers||[])await q('insert into public.win_customers(id,name,phone,created_by) values($1,$2,$3,$4)',[old.id,old.name,old.phone,admin])
 const identitiesBefore=await q('select id,name,phone from public.win_customers order by id')
 // Private, local-only dry run of the actual payload; never committed as fixtures.
 await importRows([...actual.clients,...actual.abonos,...actual.waitlist])
 console.log('ACTUAL_PREVIEW',JSON.stringify(await q('select kind,status,count(*)::int n from public.win_migration_rows where source_file<>\'isolated.xlsx\' group by kind,status order by kind,status')))
 assert.deepEqual(await financial(),before)
 assert.equal((await importRows([...actual.clients,...actual.abonos,...actual.waitlist])).inserted,0)
 const ids=identitiesBefore.map(x=>x.id)
 assert.deepEqual(await q('select id,name,phone from public.win_customers where id=any($1::uuid[]) order by id',[ids]),identitiesBefore)
}
console.log('OK importación idempotente, origen inmutable, 0 movimientos, recurrencias sin precio/deuda, conflicto, teléfonos compartidos, espera incompleta, permisos y revisión concurrente')
await db.close()
