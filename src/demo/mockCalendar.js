// Ejemplos explícitos para inspeccionar la interfaz. Ninguna escritura simulada se confirma.
import {today,addDays,monday} from '../calendarUtils.js'
const day=today(),name='Cliente de ejemplo',teacher={id:'demo-leo',name:'Leo',active:true,winPct:60}
const rows=[
 {id:'demo-reservation',date:day,court:'C4',start:'18:30',end:'20:00',duration:90,kind:'RESERVA',name,phone:'',price:90000,paid:30000,balance:60000,paymentStatus:'PARTIAL',status:'SCHEDULED',revision:1,participants:[],payments:[],startsAt:day+'T18:30:00-03:00',endsAt:day+'T20:00:00-03:00'},
 {id:'demo-lesson',date:day,court:'C3',start:'16:00',end:'17:00',duration:60,kind:'CLASE',name:'Clase de ejemplo',teacherId:teacher.id,lesson:{participants:2,classKind:'TRADICIONAL'},status:'SCHEDULED',revision:1,participants:[],payments:[],economics:{gross:70000,teacherPay:28000,winNet:42000},startsAt:day+'T16:00:00-03:00',endsAt:day+'T17:00:00-03:00'},
 {id:'demo-abono',abonoId:'demo-series',date:day,court:'C2',start:'20:00',end:'21:30',duration:90,kind:'ABONO',name:'Abono de ejemplo',phone:'',price:90000,paid:90000,balance:0,paymentStatus:'PAID',status:'SCHEDULED',revision:1,participants:[],payments:[],startsAt:day+'T20:00:00-03:00',endsAt:day+'T21:30:00-03:00'}
]
export function calendarDemo(body){
 const action=body.action.replace('calendar.','')
 if(action==='range')return {rows:rows.filter(r=>r.date>=body.start&&r.date<=body.end),settings:{GRID_OPEN_MIN:480,GRID_CLOSE_MIN:1500,BOOKING_DEFAULT_DURATION:90},context:{coaches:[teacher],prices:[]}}
 if(action==='pending')return {rows:rows.filter(r=>Date.parse(r.endsAt)<=Date.now()&&r.kind!=='ABONO')}
 if(action==='quote'){if(body.kind!=='CLASE')return {cash:90000,transfer:100000};const gross=[0,60000,70000,90000,100000][Number(body.lesson?.participants)]||0;return {gross,teacherPay:gross*.4,winNet:gross*.6}}
 if(action==='customers')return {rows:[{id:'demo-customer',name,first_name:'Cliente',last_name:'de ejemplo',phone:'',note:'Ejemplo visual'}]}
 if(action==='customer.detail')return {customer:{id:'demo-customer',name,phone:'',note:'Ejemplo visual'},bookings:rows.slice(0,1),abonos:[]}
 if(action==='waitlist')return {rows:[],opportunities:[]}
 if(action==='abonos')return {rows:[{id:'demo-series',court:'C2',start_time:'20:00:00',duration_min:90,customer_name:'Abono de ejemplo',starts_on:day,ends_on:null}]}
 if(action==='audit')return {rows:[]}
 if(action==='request')return {found:false}
 throw new Error('La demo permite revisar la interfaz. Las operaciones se guardan sólo con tu usuario en la aplicación conectada.')
}
