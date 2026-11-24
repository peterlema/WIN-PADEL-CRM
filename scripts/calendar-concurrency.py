"""Pruebas con sesiones PostgreSQL independientes. Sólo PostgreSQL efímero de CI."""
import concurrent.futures,json,pathlib,subprocess,time,uuid
r=pathlib.Path(__file__).resolve().parents[1]
def sql(query,check=True):
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True)
 if check and p.returncode:raise AssertionError(p.stderr[-2000:])
 return p
sql('create role anon;create role authenticated;create role service_role bypassrls;create schema extensions;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);')
for f in ['20261123_win_private_username_pin_accounts.sql','20261123_win_foundation_users_cash.sql']:
 sql((r/'supabase/migrations'/f).read_text())
sql("""alter table public.win_staff drop constraint win_staff_user_id_fkey;
alter table public.win_staff add foreign key(user_id) references win_auth.login_accounts(id);
create function public.win_pin_session(t text) returns table(account_id uuid,display_name text,role text,expires_at timestamptz) language sql as $$select id,display_name,role,now()+interval '1 hour' from win_auth.login_accounts where username='test-'||t and enabled$$;
create function public.win_can_access(a uuid,m text,act text) returns boolean language sql stable as $$select exists(select 1 from win_auth.login_accounts where id=a and enabled and (role='ADMIN' or(role='RECEPTION' and m in ('CASH','COURTS'))))$$;
insert into win_auth.login_accounts(username,pin_hash,display_name,role,enabled)values('test-admin','x','Admin prueba','ADMIN',true),('test-one','x','Recepción uno','RECEPTION',true),('test-two','x','Recepción dos','RECEPTION',true);
insert into public.win_staff(user_id,display_name,role)select id,display_name,role from win_auth.login_accounts;
""")
for f in ['20261124_win_court_bookings.sql','20261124_win_courts_v2_pricing_payments_abonos.sql','20261124_win_courts_v3_payment_method_at_collection.sql','20261124_win_courts_v4_prices_60_120.sql','20261125_win_config_catalog_coaches_prices.sql','20261123_win_bar_product_catalog_and_seed.sql','20261123_win_bar_pos_orders_pending_and_court.sql','20261125_win_config_bar_uses_products.sql','20261126_win_settings.sql']:
 sql((r/'supabase/migrations'/f).read_text())
for f in ['schema.sql','controls.sql','reports.sql','calendar.sql']:sql((r/'supabase/operations'/f).read_text())
for f in ['schema.sql','api.sql','integration.sql','compatibility.sql']:sql((r/'supabase/calendar'/f).read_text())
sql("update public.win_ops_coach_rates set valid_from='2020-01-01'")
def call(actor,action,data,namespace='calendar'):
 body=json.dumps(data).replace("'","''")
 return f"select public.win_{namespace}_api('{actor}','{action}','{body}'::jsonb);"
def value(q):return json.loads(sql(q).stdout.strip().splitlines()[-1])
def request(**kw):return {'requestId':str(uuid.uuid4()),**kw}
day=sql('select public.win_config_today_()').stdout.strip();future=sql("select public.win_config_today_()+3").stdout.strip()
opened=value(call('one','control',request(operation='open',date=day,cash=0),'ops'))['id']
def book(**kw):return request(kind='RESERVA',date=future,court='C4',start='10:00',duration=90,customerName='Prueba concurrente',phone='11 5555 4040',price=100000,**kw)
def race(q1,q2):
 # La primera sesión conserva el bloqueo hasta COMMIT; la segunda debe esperar y revalidar.
 first=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 first.stdin.write('begin;'+q1+'select pg_sleep(1);commit;');first.stdin.close()
 time.sleep(.15)
 second=sql(q2,False)
 out=first.stdout.read();err=first.stderr.read();code=first.wait()
 assert code==0,err
 return out,second
_,second=race(call('one','create',book()),call('two','create',book()))
assert second.returncode and 'COURT_TAKEN' in second.stderr,second.stderr
booking=sql("select id from public.win_court_bookings where court='C4' and start_time='10:00'").stdout.strip()
_,second=race(call('one','pay',request(id=booking,shiftId=opened,cash=70000)),call('two','pay',request(id=booking,shiftId=opened,cash=70000)))
assert second.returncode and 'PAYMENT_EXCEEDS_BALANCE' in second.stderr,second.stderr
assert sql('select sum(amount_signed) from public.win_cash_movements').stdout.strip()=='70000.00'
print('OK dos sesiones: superposición y sobrecobro concurrente rechazados')
repeat=request(id=booking,shiftId=opened,cash=20000)
_,second=race(call('one','pay',repeat),call('one','pay',repeat))
assert second.returncode==0,second.stderr
assert sql('select count(*) from public.win_cash_movements').stdout.strip()=='2'
print('OK dos sesiones: reintento simultáneo registra un solo ingreso')
coach=sql('select id from public.win_coaches where active limit 1').stdout.strip()
lesson=lambda court:request(kind='CLASE',date=future,court=court,start='12:00',duration=60,teacherId=coach,lesson={'participants':2,'classKind':'TRADICIONAL'})
_,second=race(call('one','create',lesson('C4')),call('two','create',lesson('C3')))
assert second.returncode and 'COACH_OVERLAP' in second.stderr,second.stderr
print('OK dos sesiones: profesor no puede tener dos clases simultáneas')
_,second=race(call('one','control',request(operation='close',shiftId=opened,cash=90000,transfer=0,count=0),'ops'),call('two','pay',request(id=booking,shiftId=opened,cash=10000)))
assert second.returncode and 'SHIFT_NOT_OPEN' in second.stderr,second.stderr
assert sql('select sum(amount_signed) from public.win_cash_movements').stdout.strip()=='90000.00'
print('OK dos sesiones: cierre y cobro simultáneos no alteran caja cerrada')
