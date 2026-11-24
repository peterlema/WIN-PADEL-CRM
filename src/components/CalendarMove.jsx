import {useEffect,useRef,useState} from 'react'
import Modal from './Modal.jsx'
import {CourtPicker,TimePicker,EndTime} from './ActivityControls.jsx'
import {longDate,label,minutes,addDays} from '../calendarUtils.js'
import {activityEnd} from '../activityTime.js'
import {canMoveBooking,destinationAt,validateMove,sameSlot,movePayload} from '../calendarMove.js'
import './calendar-move.css'

export function useGridMove({rows,settings,now,disabled,onMove,onReject}){
 const [drag,setDrag]=useState(null),active=useRef(null),press=useRef(null),suppressUntil=useRef(0),pointer=useRef(null)
 function clear(){
  const p=press.current;active.current=null;press.current=null;pointer.current=null;setDrag(null)
  if(p?.node.hasPointerCapture?.(p.pointerId))p.node.releasePointerCapture(p.pointerId)
 }
 function locate(x,y){
  const column=document.elementFromPoint(x,y)?.closest('[data-move-court]')
  if(!column)return null
  const target=destinationAt(column.dataset.moveDate,column.dataset.moveCourt,y,column.getBoundingClientRect().top,active.current.offset,Number(settings.GRID_OPEN_MIN))
  return {target,error:validateMove(active.current.row,target,rows,settings,now)}
 }
 function preview(x,y){
  if(!active.current)return
  const candidate=locate(x,y)
  setDrag({row:active.current.row,...candidate,x,y})
 }
 useEffect(()=>{if(disabled)clear()},[disabled])
 useEffect(()=>{const cancel=e=>{if(e.key==='Escape'&&press.current){suppressUntil.current=Date.now()+500;clear()}};window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel)},[])
 // Continuous edge scrolling while the pointer stays still at the edge of a long day/week.
 useEffect(()=>{
  if(!drag)return;let frame
  function scroll(){
   const point=pointer.current,host=press.current?.node.closest('.m05-day-scroll,.m05-week-scroll')
   if(point&&host&&active.current){
    const r=host.getBoundingClientRect(),top=Math.max(0,r.top)+48,bottom=Math.min(window.innerHeight,r.bottom),left=Math.max(0,r.left)+70,right=Math.min(window.innerWidth,r.right)
    const dy=point.y<top+28?-12:point.y>bottom-28?12:0,dx=point.x<left+28?-12:point.x>right-28?12:0
    if(dx||dy){const x=host.scrollLeft,y=host.scrollTop;host.scrollBy(dx,dy);if(x!==host.scrollLeft||y!==host.scrollTop)preview(point.x,point.y)}
   }
   frame=requestAnimationFrame(scroll)
  }
  frame=requestAnimationFrame(scroll);return()=>cancelAnimationFrame(frame)
 },[Boolean(drag)])
 function bookingProps(row,onOpen){return {
  'data-move-id':row.id,'data-movable':!disabled&&canMoveBooking(row,now),
  draggable:false,onDragStart:e=>e.preventDefault(),
  onPointerDown:e=>{
   if(disabled||e.pointerType==='touch'||e.button!==0||!canMoveBooking(row,now))return
   press.current={row,node:e.currentTarget,pointerId:e.pointerId,x:e.clientX,y:e.clientY,offset:e.clientY-e.currentTarget.getBoundingClientRect().top}
   e.currentTarget.setPointerCapture(e.pointerId)
  },
  onPointerMove:e=>{
   const p=press.current;if(!p||p.pointerId!==e.pointerId||disabled)return
   if(!active.current&&Math.hypot(e.clientX-p.x,e.clientY-p.y)<8)return
   e.preventDefault();active.current={row:p.row,offset:p.offset};pointer.current={x:e.clientX,y:e.clientY};preview(e.clientX,e.clientY)
  },
  onPointerUp:e=>{
   if(!press.current||press.current.pointerId!==e.pointerId)return
   if(!active.current){clear();return}
   const row=active.current.row,candidate=locate(e.clientX,e.clientY)
   suppressUntil.current=Date.now()+500;clear()
   if(!candidate)return
   if(candidate.error){onReject(candidate.error);return}
   if(!sameSlot(row,candidate.target))onMove(row,candidate.target)
  },
  onPointerCancel:()=>{if(active.current)suppressUntil.current=Date.now()+500;clear()},
  onLostPointerCapture:()=>{if(press.current){if(active.current)suppressUntil.current=Date.now()+500;clear()}},
  onClick:()=>{if(Date.now()>=suppressUntil.current)onOpen(row)}
 }}
 function columnProps(date,court){return {'data-move-date':date,'data-move-court':court}}
 return {drag,bookingProps,columnProps}
}

export function MoveGhost({drag}){
 if(!drag)return null
 return <div className="m05-move-ghost" style={{left:Math.min(drag.x+14,window.innerWidth-220),top:Math.min(drag.y+14,window.innerHeight-100)}} aria-hidden="true"><strong>{drag.row.name}</strong><span>{drag.row.duration} min · {drag.target?drag.target.court+' '+drag.target.start:'Elegí un destino'}</span></div>
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
 const format=b=>{const startDate=b.date?(minutes(b.start)>=1440?addDays(b.date,1):b.date):null,end=activityEnd(b.date,b.start,booking.duration);return (startDate?longDate(startDate):'Sin fecha')+' · '+b.court+' · '+b.start+'–'+(end?.time||'—')+(end&&end.date!==startDate?' · termina '+longDate(end.date):'')}
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
