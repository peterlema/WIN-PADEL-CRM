import {TimePicker} from './ActivityControls.jsx'
import ValidatedForm from './ValidatedForm.jsx'
import {useEffect,useState} from 'react'
import {callApi} from '../api.js'
import {callCourts} from '../courtsApi.js'
import {money,number} from '../calendarUtils.js'
import Modal from './Modal.jsx'

export function CalendarBar({booking,onChanged}){
 const [orders,setOrders]=useState(null),[payment,setPayment]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function load(){const r=await callApi('bar.court.pending',{court:booking.court,date:booking.date,start:booking.start});setOrders(r.orders||[])}
 useEffect(()=>{let alive=true;callApi('bar.court.pending',{court:booking.court,date:booking.date,start:booking.start}).then(r=>alive&&setOrders(r.orders||[])).catch(e=>alive&&setError(e.message));return()=>{alive=false}},[booking.id])
 async function pay(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await callApi('bar.order.pay',{requestId:payment.requestId,orderId:payment.id,amount:number(payment.amount),method:payment.method});setPayment(null);await load();onChanged()}catch(e){setError(e.message+' Revisá la caja antes de volver a intentar.')}finally{setBusy(false)}}
 return <section className="m05-detail"><h3>Bar / Buffet · cuenta del turno</h3>{error&&<p className="error">{error}</p>}{orders===null&&!error&&<p>Consultando consumos…</p>}{orders?.length===0&&<p>No hay consumos pendientes asociados.</p>}{orders?.map(o=><div className="m05-heading" key={o.id}><span>{o.description} · {money(o.balance)}</span><button type="button" className="secundario" onClick={()=>setPayment({id:o.id,amount:String(o.balance),method:'CASH',requestId:crypto.randomUUID()})}>Cobrar Bar</button></div>)}{payment&&<form onSubmit={pay}><label>Importe recibido ($)<input inputMode="decimal" required value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})}/></label><label>Medio<select value={payment.method} onChange={e=>setPayment({...payment,method:e.target.value})}><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia</option><option value="CARD">Tarjeta</option></select></label><button disabled={busy}>Confirmar cobro del Bar</button></form>}<small>Los consumos del Bar se cobran por separado y conservan su propia referencia.</small></section>
}

export function ReceiverSchedules({onClose}){
 const [rows,setRows]=useState([]),[people,setPeople]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [form,setForm]=useState({accountId:'',weekday:1,from:'09:00',to:'17:00'})
 async function load(){const [r,p]=await Promise.all([callCourts('courts.schedule.list'),callCourts('courts.receivers')]);setRows(r);setPeople(p.personas);setForm(f=>({...f,accountId:f.accountId||p.personas[0]?.id||''}))}
 useEffect(()=>{load().catch(e=>setError(e.message))},[])
 async function run(action,data){setBusy(true);try{await callCourts(action,data);await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <Modal titulo="Horarios de recepción" onCerrar={()=>!busy&&onClose()} footer={<><button type="button" className="secundario" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" form="receiver-schedule-form" disabled={busy}>Agregar horario</button></>}>{error&&<p className="error">{error}</p>}{rows.map(r=><div className="m05-heading" key={r.id}><span>{r.nombre} · Día {r.diaSemana} · {r.desde}–{r.hasta}</span><button className="secundario" disabled={busy} onClick={()=>run('courts.schedule.delete',{id:r.id})}>Quitar</button></div>)}<ValidatedForm id="receiver-schedule-form" error={error} onSubmit={e=>{e.preventDefault();run('courts.schedule.set',form)}}><fieldset disabled={busy}><label>Persona<select value={form.accountId} onChange={e=>setForm({...form,accountId:e.target.value})}>{people.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label><label>Día<select value={form.weekday} onChange={e=>setForm({...form,weekday:Number(e.target.value)})}>{['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'].map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></label><div className="m05-form-grid"><TimePicker label="Desde" value={form.from} required onChange={time=>setForm({...form,from:time})}/><TimePicker label="Hasta" value={form.to} required allowAfterMidnight onChange={time=>setForm({...form,to:time})}/></div></fieldset></ValidatedForm></Modal>
}

