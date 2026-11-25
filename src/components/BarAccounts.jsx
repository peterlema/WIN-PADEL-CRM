import {useCallback,useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import {barDateTime,barDate,barMethods} from '../barDisplay.js'
import Modal from './Modal.jsx'
import MoneyInput from './MoneyInput.jsx'
import ValidatedForm from './ValidatedForm.jsx'
import useBarTransaction from './useBarTransaction.js'
import BarTransactionNotice from './BarTransactionNotice.jsx'
export default function BarAccounts(){
 const [filter,setFilter]=useState({status:'PENDING',audience:'ALL',person:'',court:'',start:'',end:'',offset:0}),[data,setData]=useState(null),[cash,setCash]=useState(null),[form,setForm]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const epoch=useRef(0)
 const load=useCallback(async()=>{const e=++epoch.current;setLoading(true);setError('');try{const [d,s]=await Promise.all([callApi('bar.inventory.accounts',filter),callApi('bar.inventory.cash.state')]);if(e===epoch.current){setData(d);setCash(s)}}catch(err){if(e===epoch.current)setError(err.message)}finally{if(e===epoch.current)setLoading(false)}},[filter])
 useEffect(()=>{const timer=setTimeout(load,200);return()=>clearTimeout(timer)},[load])
 const tx=useBarTransaction(async()=>{setForm(null);await load()}),locked=tx.busy||tx.uncertain
 const update=(k,v)=>setFilter(f=>({...f,[k]:v,offset:0}))
 return <section className="win-bar-card"><div className="win-bar-row"><div><h3>Cuentas corrientes y consumos</h3><p className="win-bar-muted">Entregas, cobros parciales y saldos por persona o cancha. Cobrar una deuda no vuelve a descontar stock.</p></div><button className="secundario" disabled={locked||loading} onClick={load}>Actualizar</button></div>
  <BarTransactionNotice transaction={tx}/>{error&&<p role="alert" className="win-bar-message">{error}</p>}
  <div className="bar-account-filters">
   <label>Estado<select value={filter.status} onChange={e=>update('status',e.target.value)}><option value="ALL">Todos</option><option value="PENDING">Pendientes</option><option value="PAID">Pagados</option></select></label>
   <label>Tipo<select value={filter.audience} onChange={e=>update('audience',e.target.value)}><option value="ALL">Todos</option><option value="CLIENT">Por persona / clientes</option><option value="EMPLOYEE">Empleados</option><option value="COURT">Pendientes de cancha</option></select></label>
   <label>Persona<input type="search" value={filter.person} onChange={e=>update('person',e.target.value)} placeholder="Cliente o empleado"/></label>
   <label>Cancha<select value={filter.court} onChange={e=>update('court',e.target.value)}><option value="">Todas</option>{['C4','C3','C2','C1'].map(k=><option key={k}>{k}</option>)}</select></label>
   <label>Desde<input type="date" value={filter.start} onChange={e=>update('start',e.target.value)}/></label><label>Hasta<input type="date" value={filter.end} onChange={e=>update('end',e.target.value)}/></label>
  </div>
  <p>{data?.total||0} consumos · Saldo del filtro: <strong>{formatMoney(data?.pending||0)}</strong>{loading?' · Actualizando…':''}</p>
  {!cash?.shift&&<p className="win-bar-warning">Abrí Caja Bar para registrar cobros. Podés consultar las cuentas con la caja cerrada.</p>}
  <div className="bar-table-scroll"><table><thead><tr><th>Cliente / tipo</th><th>Consumo</th><th>Fecha / antigüedad</th><th className="num">Total</th><th className="num">Pagado</th><th className="num">Saldo</th><th>Acción</th></tr></thead><tbody>
   {(data?.orders||[]).map(o=><tr key={o.id}><td><strong>{o.customerName}</strong><small>{{CLIENT:'Cliente',EMPLOYEE:'Empleado',COURT:'Pendiente de cancha'}[o.audience]}{o.court?' · '+o.court:''}{o.courtStart?' · '+o.courtStart:''}</small>{o.courtDate&&<small>Turno {barDate(o.courtDate)}</small>}</td>
    <td><details><summary>{o.items.map(i=>i.quantity+'× '+i.name).join(', ')}</summary>{o.items.map((i,n)=><p key={n}>{i.quantity}× {i.name} · {formatMoney(i.price)} c/u · {formatMoney(i.amount)}</p>)}{o.note&&<p>{o.note}</p>}<h4>Cobros</h4>{o.payments.map(p=><p key={p.id}>{barDateTime(p.date)} · {p.author} · {barMethods.find(m=>m[0]===p.method)?.[1]} · {formatMoney(p.amount)}</p>)}</details></td>
    <td className="bar-nowrap">{barDateTime(o.date)}<small>{o.balance>0?(o.ageDays===0?'Hoy':o.ageDays+' días pendiente'):'Pagado'}</small></td><td className="num">{formatMoney(o.total)}</td><td className="num">{formatMoney(o.paid)}</td><td className="num">{formatMoney(o.balance)}</td>
    <td>{o.balance>0&&<button disabled={locked||!cash?.shift||!tx.ready} onClick={()=>setForm({order:o,amount:moneyInputValue(o.balance),method:'CASH'})}>Cobrar</button>}</td></tr>)}
  </tbody></table>{data&&!data.orders.length&&<p>Sin consumos para estos filtros.</p>}</div>
  {data&&data.total>data.limit&&<div className="win-bar-row"><button className="secundario" disabled={!filter.offset||loading} onClick={()=>setFilter({...filter,offset:Math.max(0,filter.offset-data.limit)})}>Anterior</button><span>{filter.offset+1}–{Math.min(data.total,filter.offset+data.limit)} de {data.total}</span><button className="secundario" disabled={filter.offset+data.limit>=data.total||loading} onClick={()=>setFilter({...filter,offset:filter.offset+data.limit})}>Siguiente</button></div>}
  {form&&<Modal titulo="Cobrar cuenta pendiente" onCerrar={()=>{if(!locked)setForm(null)}} footer={<><button form="bar-account-pay" disabled={locked} type="submit">Confirmar cobro {formatMoney(parseMoneyInput(form.amount))}</button><button type="button" className="secundario" disabled={locked} onClick={()=>setForm(null)}>Cancelar</button></>}>
   <BarTransactionNotice transaction={tx}/><ValidatedForm id="bar-account-pay" error={tx.error} onSubmit={e=>{e.preventDefault();tx.run('bar.order.pay',{orderId:form.order.id,amount:parseMoneyInput(form.amount),method:form.method})}}><fieldset disabled={locked} className="bar-plain-fields"><p>{form.order.customerName} · Pendiente: <strong>{formatMoney(form.order.balance)}</strong></p><label>Importe a cobrar ($)<MoneyInput required min={0.01} max={form.order.balance} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><fieldset className="win-bar-methods"><legend>Medio de pago</legend>{barMethods.map(([k,l])=><button type="button" aria-pressed={form.method===k}  key={k} onClick={()=>setForm({...form,method:k})}>{l}</button>)}</fieldset>{form.method==='TRANSFER'&&<p>Verificá el ingreso y compartí la foto del comprobante en el grupo.</p>}<p className="win-bar-muted">Podés cobrar una parte o el saldo completo. No se vuelve a descontar mercadería.</p></fieldset></ValidatedForm>
  </Modal>}
 </section>
}
