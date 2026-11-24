import {formatMoney,parseMoneyInput,moneyInputValue} from './money.js'
export const COURTS=['C4','C3','C2','C1']
export const ZONE='America/Argentina/Buenos_Aires'
export const money = value => formatMoney(value,'Sin acordar')
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const minutes=time=>{const [h,m]=String(time).split(':').map(Number);return (h<6?h+24:h)*60+m}
export const label=n=>`${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`
export const addDays=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export const monday=date=>addDays(date,-(new Date(date+'T12:00:00Z').getUTCDay()+6)%7)
export const longDate=date=>new Intl.DateTimeFormat('es-AR',{timeZone:'UTC',weekday:'long',day:'numeric',month:'short'}).format(new Date(date+'T12:00:00Z'))
export const timestamp=date=>new Intl.DateTimeFormat('es-AR',{timeZone:ZONE,dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(date))
export const number=value=>parseMoneyInput(value,{empty:0})
export const kindLabel={RESERVA:'Reserva regular',ABONO:'Abono fijo',CLASE:'Clase',EVENTO:'Evento',BLOQUEO:'Bloqueo'}
export const stateLabel=row=>row.status==='CANCELLED'?'Cancelada':row.status==='PERFORMED'?(row.kind==='CLASE'?'Dictada':'Jugada'):'Programada'
export const paymentLabel={PENDING:'Pendiente',PARTIAL:'Parcialmente pagada',PAID:'Pagada'}
export function currentPosition(date,now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]))
 const calendarDate=parts.year+'-'+parts.month+'-'+parts.day
 const minute=Number(parts.hour)*60+Number(parts.minute)
 const businessDate=minute<360?addDays(calendarDate,-1):calendarDate
 return businessDate===date?minute+(minute<360?1440:0):null
}

