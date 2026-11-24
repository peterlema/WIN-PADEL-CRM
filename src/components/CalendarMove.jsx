import {useEffect,useRef,useState} from 'react'
import Modal from './Modal.jsx'
import {CourtPicker,TimePicker,EndTime} from './ActivityControls.jsx'
import {longDate,label,minutes} from '../calendarUtils.js'
import {canMoveBooking,destinationAt,validateMove,sameSlot,movePayload} from '../calendarMove.js'
import './calendar-move.css'

export function useGridMove({rows,settings,now,disabled,onMove,onReject}){
 const [drag,setDrag]=useState(null),active=useRef(null),press=useRef(null),suppressUntil=useRef(0)
 function clear(){active.current=null;setDrag(null)}
 useEffect(()=>{if(disabled)clear()},[disabled])
 useEffect(()=>{const cancel=e=>{if(e.key==='Escape'&&active.current){suppressUntil.current=Date.now()+500;clear()}};window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel)},[])
 function bookingProps(row,onOpen){return {
  'data-move-id':row.id,
  draggable:!disabled&&canMoveBooking(row,now),
  onPointerDown:e=>{press.current={id:row.id,offset:e.clientY-e.currentTarget.getBoundingClientRect().top}},
  onDragStart:e=>{
   if(disabled||!canMoveBooking(row,now)){e.preventDefault();return}
   const offset=press.current?.id===row.id?press.current.offset:e.clientY-e.currentTarget.getBoundingClientRect().top
   active.current={row,offset};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',row.id)
   suppressUntil.current=Date.now()+500;setDrag({row,target:null})
  },
  onDragEnd:()=>{if(active.current)suppressUntil.current=Date.now()+500;clear()},
  onClick:()=>{if(Date.now()>=suppressUntil.current)onOpen(row)}
 }}
 function columnProps(date,court){return {
  'data-move-date':date,'data-move-court':court,
  onDragOver:e=>{
   if(!active.current||disabled)return;e.preventDefault()
   const {row,offset}=active.current,target=destinationAt(date,court,e.clientY,e.currentTarget.getBoundingClientRect().top,offset,Number(settings.GRID_OPEN_MIN))
   const error=validateMove(row,target,rows,settings,now)
   e.dataTransfer.dropEffect='move'
   // Even invalid cells accept a drop so we can explain the rejection and reset the source.
   setDrag({row,target,error})
  },
  onDrop:e=>{
   if(!active.current||disabled)return;e.preventDefault();e.stopPropagation()
   const {row,offset}=active.current,target=destinationAt(date,court,e.clientY,e.currentTarget.getBoundingClientRect().top,offset,Number(settings.GRID_OPEN_MIN))
   const error=validateMove(row,target,rows,settings,now)
   suppressUntil.current=Date.now()+500;clear()
   if(error){onReject(error);return}
   if(!sameSlot(row,target))onMove(row,target)
  }
 }}
 return {drag,bookingProps,columnProps}
}

export function MovePreview({drag,date,court,first}){
 if(!drag?.target||drag.target.date!==date||drag.target.court!==court)return null
 const {row,target,error}=drag
 return <div className={'m05-move-preview'+(error?' invalid':'')} style={{top:(target.minute-first)*1.5,height:Number(row.duration)*1.5}} role="img" aria-label={court+' '+target.start+' · '+(error||'Disponible')}>
  <strong>{target.court} · {target.start}–{label(minutes(target.start)+Number(row.duration))}</strong><span>{error||'Disponible · soltar para revisar'}</span>
 </div>
}

export function MoveActivityDialog({booking,initialTarget,rows,settings,now,busy,error,uncertain,onClose,onConfirm}){
 const [target,setTarget]=useState(initialTarget),request=useRef(crypto.randomUUID())
 const problem=validateMove(booking,target,rows,settings,now),unchanged=sameSlot(booking,target)
 function change(patch){setTarget(t=>{const next={...t,...patch};delete next.minute;return next});request.current=crypto.randomUUID()}
 const format=b=>(b.date?longDate(b.date):'Sin fecha')+' · '+b.court+' · '+b.start+'–'+label(minutes(b.start)+Number(booking.duration))
 return <Modal titulo="Mover actividad" onCerrar={onClose} footer={<><button type="button" className="secundario" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" form="calendar-move-form" disabled={busy||Boolean(problem)||unchanged}>{busy?'Guardando…':'Confirmar movimiento'}</button></>}>
  <form id="calendar-move-form" onSubmit={e=>{e.preventDefault();if(!busy&&!problem&&!unchanged)onConfirm(movePayload(booking,target,request.current))}}>
   <h3>{booking.name}</h3>
   {error&&<p className="error" role="alert">{error}</p>}{uncertain}
   <dl className="m05-move-comparison"><dt>Antes</dt><dd>{format(booking)}</dd><dt>Después</dt><dd>{format(target)}</dd></dl>
   <fieldset disabled={busy} className="m05-move-fields"><label>Fecha<input type="date" required value={target.date} disabled={booking.kind==='ABONO'} onChange={e=>change({date:e.target.value})}/></label><CourtPicker value={target.court} onChange={court=>change({court})}/><TimePicker label="Nuevo inicio" value={target.start} required onChange={start=>change({start})}/><EndTime date={target.date} start={target.start} duration={booking.duration}/></fieldset>
   {booking.kind==='ABONO'&&<p className="m05-warning">Sólo esta fecha del abono. La cancha y el horario de las otras semanas se conservan. Cambiar el abono semanal requiere una gestión aparte.</p>}
   <p className={problem?'m05-warning':'m05-help'} role="status">{problem||'Se conserva la duración de '+booking.duration+' minutos, el precio acordado y los pagos. La disponibilidad se vuelve a validar al confirmar.'}</p>
  </form>
 </Modal>
}
