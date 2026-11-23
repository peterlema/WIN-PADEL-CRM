// Fixture de lectura para revisar el diseño. Sólo se carga con #/demo.
// No simula confirmaciones de operaciones financieras ni llama a la base real.
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date())
const stamp=new Date().toISOString()
const coaches=[{id:'demo-leo',name:'Leo',active:true,winPct:60},{id:'demo-chino',name:'Chino',active:true,winPct:55}]
const shift={id:'demo-ops',business_date:date,opened_by:'demo',opened_at:stamp,opening_cash:50000,responsible:'Usuario demo',status:'OPEN'}
const totals={cashExpected:140000,transferReceived:0,cashIncome:90000,cashOut:0,reservations:1,reservationHours:1.5,classes:1}
const row={id:'op:demo-example',registered_at:stamp,type:'RESERVA',status:'ACTIVE',note:'Ejemplo visual de una reserva',cash:90000,transfer:0,refund_cash:0,activity_date:date,start_time:'09:00',duration_min:90,courts:['C1'],participants:null,teacher:'',author:'Usuario demo',responsible:'Usuario demo',shift_id:shift.id,shift_status:'OPEN',actor_id:'demo',modified:false,amount:90000,payments:[]}
export function operationsDemo(body){
 const action=body.action.replace('ops.','')
 if(action==='overview')return {shift,totals,classesByTeacher:[{name:'Leo',total:1,individual:0,double:1,triple:0,four:0}],notices:[],lastClosed:null,pendingDays:[],settlementPending:1}
 if(action==='context')return {today:date,coaches,prices:[],agenda:[]}
 if(action==='quote'){const gross=[0,60000,70000,90000,100000][Number(body.participants)]||0;const pct=coaches.find(c=>c.id===body.teacherId)?.winPct||60;return {gross,winPct:pct,winNet:gross*pct/100,teacherPay:gross*(100-pct)/100}}
 if(action==='balance')return {teacherId:body.teacherId,days:[{date,due:42000,allocated:0,pending:42000}],credit:0,balance:42000}
 if(action==='history')return {rows:[row],total:1,offset:0,limit:100}
 if(action==='detail')return {events:[]}
 if(action==='status')return {found:false}
 if(action==='day')return {date:body.date,transferExpected:0,provisional:0,shifts:[{id:shift.id,owner:'Usuario demo',status:'OPEN',expected:0}],control:null}
 if(action==='admin')return {start:body.start,end:body.end,totals:{collected:90000,expenses:0,withdrawals:0,result:90000,activityNet:132000,entries:1},daily:[{date,collected:90000,expenses:0,activityNet:132000}],categories:[{unit:'COURTS',category:'RESERVA',kind:'SALE',count:1,collected:90000,expenses:0}],methods:[{method:'CASH',collected:90000,expenses:0}],recent:[{id:'demo-example',date,occurredAt:stamp,category:'RESERVA',kind:'SALE',unit:'COURTS',method:'CASH',amount:90000,note:row.note,user:'Usuario demo',shiftId:shift.id}],activity:[{type:'RESERVA',count:1,net:90000,hours:1.5,participants:null},{type:'CLASE',count:1,net:42000,hours:1,participants:2}],academy:[{id:'demo-leo',name:'Leo',classes:1,individual:0,double:1,triple:0,four:0,average:2,gross:70000,remuneration:28000,net:42000,unknown_gross:0,received:0,balance:{days:[{date,due:42000,allocated:0,pending:42000}],balance:42000,credit:0}}],events:[],occupancy:{occupiedHours:2.5,capacityHours:null,missingCourtDays:4,physicalPercent:null,economicPercent:null,netPerHour:52800},resources:[],operations:[],corrections:[],controls:[],shifts:[{...shift,expected_cash:140000,counted_cash:null,transfer_counted:null,receipt_count:null,note:''}],audit:[]}
 throw new Error('La demo es de lectura. El guardado se usa en la aplicación con tu usuario y PIN.')
}
