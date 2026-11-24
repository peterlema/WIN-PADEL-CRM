import {COURTS,minutes,label} from './calendarUtils.js'

export const slotTime=(date,start)=>Date.parse(date+'T00:00:00-03:00')+minutes(start)*60000
export const canMoveBooking=(row,now=new Date())=>!row.readOnly&&row.status==='SCHEDULED'&&['RESERVA','CLASE','ABONO'].includes(row.kind)&&slotTime(row.date,row.start)>Number(now)
export const sameSlot=(row,target)=>row.date===target.date&&row.court===target.court&&row.start===target.start
export function destinationAt(date,court,clientY,columnTop,grabOffset,first){
 const minute=first+Math.round((clientY-columnTop-grabOffset)/1.5/15)*15
 return {date,court,start:label(Math.max(0,minute)),minute}
}
// Visual hint only. The server repeats every business-rule and availability check on save.
export function validateMove(row,target,rows,settings,now=new Date()){
 if(!canMoveBooking(row,now))return 'Esta actividad ya comenzó o no se puede mover.'
 if(!/^\d{4}-\d{2}-\d{2}$/.test(target.date)||!COURTS.includes(target.court)||!/^([01][0-9]|2[0-3]):(00|15|30|45)$/.test(target.start))return 'Elegí fecha, cancha y horario válidos.'
 if(row.kind==='ABONO'&&target.date!==row.date)return 'Podés mover sólo esta fecha del abono dentro de la misma jornada.'
 const start=slotTime(target.date,target.start),end=start+Number(row.duration)*60000
 if(start<=Number(now))return 'El nuevo horario debe ser futuro.'
 const minute=target.minute??minutes(target.start)
 if(minute<Number(settings.GRID_OPEN_MIN)||minute+Number(row.duration)>Number(settings.GRID_CLOSE_MIN))return 'Fuera del horario configurado.'
 const overlaps=rows.filter(b=>b.id!==row.id&&b.status!=='CANCELLED'&&slotTime(b.date,b.start)<end&&slotTime(b.date,b.start)+Number(b.duration)*60000>start)
 if(overlaps.some(b=>b.court===target.court))return 'Cancha ocupada en ese horario.'
 if(row.teacherId&&overlaps.some(b=>b.teacherId===row.teacherId))return 'El profesor tiene otra clase en ese horario.'
 return ''
}
export function movePayload(row,target,requestId){
 return {requestId,id:row.id,revision:row.revision,date:target.date,court:target.court,start:target.start,
  from:{date:row.date,court:row.court,start:row.start},scope:row.kind==='ABONO'?'occurrence':'booking'}
}
