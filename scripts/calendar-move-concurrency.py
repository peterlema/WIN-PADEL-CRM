"""Only disposable PostgreSQL CI: independent sessions competing for the same slots."""
import runpy,pathlib,json,uuid
scope=runpy.run_path(str(pathlib.Path(__file__).with_name('calendar-concurrency.py')))
# Reuse the existing disposable schema and proven multi-session race harness.
sql,value,call,request,race,root,future=(scope[k] for k in ['sql','value','call','request','race','r','future'])
sql((root/'supabase/calendar/move.sql').read_text())
def reserve(court,start):
 return value(call('one','create',request(kind='RESERVA',date=future,court=court,start=start,duration=60,customerName='Prueba mover',phone='1155559090',price=60000)))
def moving(b,**changes):
 return request(id=b['id'],revision=b['revision'],date=b['date'],court=b['court'],start=b['start'],scope='occurrence' if b['kind']=='ABONO' else 'booking',**{'from':{k:b[k] for k in ['date','court','start']}})|changes
def move_sql(actor,p):
 return "select public.win_calendar_move('%s','%s'::jsonb);"%(actor,json.dumps(p).replace("'","''"))
# Reserve first while holding the common lock; the moving employee must recheck occupancy.
b=reserve('C3','14:00')
new=request(kind='RESERVA',date=future,court='C2',start='14:00',duration=60,customerName='Otra recepción',phone='1155559091',price=60000)
_,second=race(call('two','create',new),move_sql('one',moving(b,court='C2')))
assert second.returncode and 'COURT_TAKEN' in second.stderr,second.stderr
assert sql("select court from public.win_court_bookings where id='%s'"%b['id']).stdout.strip()=='C3'
# Moving first blocks a second booking of that destination.
new['court']='C1';new['start']='14:15';new['requestId']=str(uuid.uuid4())
_,second=race(move_sql('one',moving(b,court='C1',start='14:15')),call('two','create',new))
assert second.returncode and 'COURT_TAKEN' in second.stderr,second.stderr
booking_id=b['id']
b=next(x for x in value(call('one','range',{'start':future,'end':future}))['rows'] if x['id']==booking_id)
# Two moves based on the same revision: only one wins, rather than overwriting.
_,second=race(move_sql('one',moving(b,court='C3',start='15:30')),move_sql('two',moving(b,court='C2',start='15:30')))
assert second.returncode and 'STALE_REVISION' in second.stderr,second.stderr
# Distinct bookings compete for an empty target.
a=reserve('C4','16:30');b=reserve('C3','16:30')
_,second=race(move_sql('one',moving(a,court='C1',start='16:30')),move_sql('two',moving(b,court='C1',start='16:30')))
assert second.returncode and 'COURT_TAKEN' in second.stderr,second.stderr
# A simultaneous class creation must block a move with the same teacher on another court.
coach=scope['coach']
lesson=lambda court,start:request(kind='CLASE',date=future,court=court,start=start,duration=60,teacherId=coach,lesson={'participants':2,'classKind':'TRADICIONAL'})
l=value(call('one','create',lesson('C4','18:00')))
_,second=race(call('two','create',lesson('C3','19:00')),move_sql('one',moving(l,court='C2',start='19:15')))
assert second.returncode and 'COACH_OVERLAP' in second.stderr,second.stderr
# A virtual abono occurrence can be materialized and moved only once for a stale reader.
ab=value(call('one','abono.create',request(kind='RESERVA',date=future,court='C1',start='21:00',duration=60,customerName='Abono concurrente',phone='1155559092',price=60000)))
next_week=sql("select '%s'::date+7"%future).stdout.strip()
v=next(x for x in value(call('one','range',{'start':next_week,'end':next_week}))['rows'] if x.get('abonoId')==ab['abonoId'])
_,second=race(move_sql('one',moving(v,court='C2')),move_sql('two',moving(v,court='C3')))
assert second.returncode and 'STALE_REVISION' in second.stderr,second.stderr
assert sql("select count(*) from public.win_court_bookings where source_abono_id='%s' and business_date='%s'"%(ab['abonoId'],next_week)).stdout.strip()=='1'
assert sql('select sum(amount_signed) from public.win_cash_movements').stdout.strip()=='90000.00'
print('PASS concurrencia real: reserva/movimiento, dos movimientos, revisión, profesor, abono virtual y caja intacta')
