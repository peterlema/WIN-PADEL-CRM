import useBarTransaction from './useBarTransaction.js'
import BarTransactionNotice from './BarTransactionNotice.jsx'
import {barDate} from '../barDisplay.js'
import {useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import MoneyInput from './MoneyInput.jsx'
import Modal from './Modal.jsx'
import ValidatedForm from './ValidatedForm.jsx'
const money=n=>formatMoney(n,'Pendiente')
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date())
function amount(raw){
 if(raw==null||String(raw).trim()==='')return null
 const n=parseMoneyInput(raw)
 if(!Number.isFinite(n))throw new Error('Revisá el importe. Usá puntos para miles y coma para decimales: 36.000 o 415,15.')
 if(n<0||n>1000000000)throw new Error('El importe debe estar entre $0 y $1.000.000.000.')
 return n
}
export default function BarPurchases({data,products,onChanged}){
 const [form,setForm]=useState(null),[quote,setQuote]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const requests=useRef(new Map())
 const row=()=>({productId:products.find(p=>p.active)?.id||'',quantity:1,costMode:'TOTAL',cost:'',estimated:false})
 const open=()=>{setError('');setQuote(null);setForm({type:'purchase',supplier:'',purchaseDate:today(),state:'RECEIVED',payment:'UNPAID',method:'CASH',totalCost:'',lines:[row()],note:''})}
 const change=(i,patch)=>setForm(f=>({...f,lines:f.lines.map((l,j)=>i===j?{...l,...patch,estimated:false}:l)}))
 const payload=()=>{
  const totalCost=amount(form.totalCost)
  const lines=form.lines.map(l=>({productId:l.productId,quantity:Number(l.quantity),costMode:l.costMode,cost:l.costMode==='REFERENCE'?null:amount(l.cost),estimated:l.estimated}))
  if(totalCost==null&&lines.some(l=>l.cost==null&&products.find(p=>p.id===l.productId)?.provisionalInitialCost==null&&products.find(p=>p.id===l.productId)?.unitCost==null))throw new Error('Indicá el total del pedido o un costo para los productos sin referencia.')
  return {totalCost,lines}
 }
 const signature=JSON.stringify(form?.type==='purchase'?{lines:form.lines,totalCost:form.totalCost}:null)
 useEffect(()=>{
  if(form?.type!=='purchase')return
  let active=true;setQuote(null)
  const timer=setTimeout(async()=>{try{const d=await callApi('bar.inventory.purchase.preview',payload());if(active)setQuote(d)}catch(e){if(active)setQuote({error:e.message})}},300)
  return()=>{active=false;clearTimeout(timer)}
 },[signature])
 const tx=useBarTransaction(async()=>{setForm(null);await onChanged()})
 const busy=tx.busy||tx.uncertain
 async function run(action,p){await tx.run('bar.inventory.'+action,p)}
 async function submit(e){
  e.preventDefault();setError('')
  try{
   if(form.type==='purchase'){
    const p=payload()
    // The server repeats the calculation in the same transaction as saving.
    await run('purchase.save',{...p,supplier:form.supplier,purchaseDate:form.purchaseDate,state:form.state,payment:form.payment,confirmPayment:form.payment==='PAID',method:form.method,note:form.note})
   }else if(form.type==='receive')await run('purchase.receive',{purchaseId:form.purchaseId,lines:form.lines.filter(l=>Number(l.receive)>0).map(l=>({lineId:l.id,quantity:Number(l.receive)})),note:form.note})
   else await run('purchase.pay',{purchaseId:form.purchaseId,amount:amount(form.amount),method:form.method,note:form.note})
  }catch(e){setError(e.message)}
 }
 const purchases=(data.purchases||[]).filter(p=>p.kind==='OPERATIONAL')
 const pending=purchases.filter(p=>p.status!=='RECEIVED'||p.payment_status!=='PAID'),complete=purchases.filter(p=>!pending.includes(p))
 const article=p=><article className="bar-purchase" key={p.id}><div className="win-bar-row"><strong>{p.supplier}</strong><b>{money(p.total)}</b></div>
  <p>{barDate(p.purchase_date)} · {({ORDERED:'Pedido',PARTIAL:'Recibido parcialmente',RECEIVED:'Recibido'})[p.status]} · {p.payment_status==='PAID'?'Pagado':p.payment_status==='PARTIAL'?'Pago parcial':'Pendiente de pago'}</p>
  <div className="bar-table-scroll"><table><thead><tr><th>Producto</th><th>Pedidas</th><th>Recibidas</th><th>Costo unitario</th><th>Total</th><th>Origen</th></tr></thead><tbody>{p.lines.map(l=><tr key={l.id}><td>{l.label}</td><td>{l.quantity}</td><td>{l.received_quantity}</td><td>{money(l.total_cost==null?null:l.total_cost/l.quantity)}</td><td>{money(l.total_cost)}</td><td>{l.cost_estimated?'Estimado editable · ':''}{l.cost_origin||'Costo informado'}</td></tr>)}</tbody></table></div>
  <div className="bar-catalog-toolbar">{p.status!=='RECEIVED'&&<button disabled={busy} onClick={()=>{setError('');setForm({type:'receive',purchaseId:p.id,note:'',lines:p.lines.filter(l=>l.received_quantity<l.quantity).map(l=>({...l,receive:l.quantity-l.received_quantity}))})}}>Recibir mercadería</button>}
  {p.payment_status!=='PAID'&&<button className="secundario" disabled={busy||p.total==null} onClick={()=>{setError('');setForm({type:'pay',purchaseId:p.id,amount:'',method:'CASH',note:''})}}>Registrar pago realizado</button>}</div>
 </article>
 return <section className="bar-inventory-section"><div className="win-bar-row"><h4>Compras y pagos pendientes</h4><button disabled={busy} onClick={open}>+ Nueva compra</button></div>
 <p className="win-bar-muted">Las diferencias históricas son informativas. Un pedido no suma stock; una recepción no genera pagos.</p>
 <BarTransactionNotice transaction={tx}/>{error&&<p role="alert" className="win-bar-message">{error}</p>}{notice&&<p role="status" className="win-bar-message good">{notice}</p>}
 {pending.length?pending.map(article):<p>No hay compras ni pagos pendientes.</p>}
 {complete.length>0&&<details><summary>Compras completas y pagadas ({complete.length})</summary>{complete.map(article)}</details>}
 {form&&<Modal titulo={form.type==='purchase'?'Nueva compra':form.type==='receive'?'Recibir mercadería':'Registrar pago realizado'} onCerrar={()=>{if(!busy)setForm(null)}} footer={<><button type="submit" form="bar-purchase-simple" disabled={busy}>{busy?'Guardando…':form.type==='purchase'?(form.payment==='PAID'?'Guardar compra y registrar pago real':'Guardar compra'):form.type==='receive'?'Confirmar recepción':'Confirmar pago real'}</button><button type="button" className="secundario" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button></>}>
 <BarTransactionNotice transaction={tx}/><ValidatedForm id="bar-purchase-simple" error={error||tx.error} onSubmit={submit} className="bar-inventory-form"><fieldset disabled={busy} className="bar-plain-fields">
 {form.type==='purchase'&&<>
 <div className="bar-product-fields"><label>Proveedor<input required minLength={2} maxLength={160} value={form.supplier} onChange={e=>setForm({...form,supplier:e.target.value})}/></label>
 <label>Fecha<input required type="date" value={form.purchaseDate} onChange={e=>setForm({...form,purchaseDate:e.target.value})}/></label>
 <label>Estado de mercadería<select value={form.state} onChange={e=>setForm({...form,state:e.target.value})}><option value="RECEIVED">Recibido: sumar unidades al stock</option><option value="ORDERED">Pedido: todavía no recibido</option></select></label></div>
 {form.lines.map((l,i)=><div className="bar-purchase-line" key={i}><label>Producto<select value={l.productId} onChange={e=>change(i,{productId:e.target.value})}>{products.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name} {p.variant}</option>)}</select></label>
 <label>Cantidad {form.state==='RECEIVED'?'recibida':'pedida'}<input required type="number" min="1" max="1000000" step="1" value={l.quantity} onChange={e=>change(i,{quantity:e.target.value})}/></label>
 <label>Dato de costo<select value={l.costMode} onChange={e=>change(i,{costMode:e.target.value})}><option value="TOTAL">Conozco el costo total del producto</option><option value="UNIT">Conozco el costo unitario</option><option value="REFERENCE">Sólo total del pedido / usar referencia</option></select></label>
 {l.costMode!=='REFERENCE'&&<label>{l.costMode==='UNIT'?'Costo unitario':'Costo total del producto'}<MoneyInput min={0} max={1000000000} value={l.cost} placeholder="Opcional si indicás el total del pedido" onChange={e=>change(i,{cost:e.target.value})}/></label>}
 <small>{quote?.lines?.[i]&&<>Unitario: {money(quote.lines[i].unitCost)} · Total: {money(quote.lines[i].totalCost)} · {quote.lines[i].estimated?'Estimado':quote.lines[i].origin}</>}</small>
 <button type="button" className="secundario" disabled={form.lines.length===1} onClick={()=>setForm({...form,lines:form.lines.filter((_,j)=>j!==i)})}>Quitar</button></div>)}
 <button type="button" className="secundario" onClick={()=>setForm({...form,lines:[...form.lines,row()]})}>+ Agregar producto</button>
 <label>Total del pedido / factura (opcional si ya cargaste los costos)<MoneyInput min={0} max={1000000000} value={form.totalCost} onChange={e=>setForm({...form,totalCost:e.target.value})}/></label>
 {quote?.error?<p className="win-bar-muted">{quote.error}</p>:quote&&<section><strong>Total: {money(quote.total)}</strong><p>{quote.estimated?'Reparto estimado y editable.':'Costos calculados desde los importes informados.'} Los redondeos se distribuyen automáticamente y se conserva el total de la factura.</p>
 {quote.estimated&&<button type="button" className="secundario" onClick={()=>setForm({...form,lines:form.lines.map((l,i)=>({...l,costMode:'TOTAL',cost:moneyInputValue(quote.lines[i].totalCost),estimated:quote.lines[i].estimated}))})}>Editar reparto sugerido</button>}</section>}
 <label>Pago<select value={form.payment} onChange={e=>setForm({...form,payment:e.target.value})}><option value="UNPAID">Pendiente de pago: no mover dinero</option><option value="PAID">Ya lo pagué: registrar egreso real</option></select></label>
 </>}
 {form.type==='receive'&&form.lines.map((l,i)=><label key={l.id}>{l.label} · pendientes {l.quantity-l.received_quantity}<input required type="number" min="0" max={l.quantity-l.received_quantity} step="1" value={l.receive} onChange={e=>setForm({...form,lines:form.lines.map((x,j)=>j===i?{...x,receive:e.target.value}:x)})}/></label>)}
 {form.type==='pay'&&<label>Importe pagado<MoneyInput required min={0.01} max={1000000000} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>}
 {(form.type==='pay'||form.payment==='PAID')&&<><p className="win-bar-warning">Confirmá únicamente un pago efectivamente realizado. Se registra un egreso en Caja Bar; las transferencias usan la cuenta bancaria configurada del Bar.</p><label>Medio de pago<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option value="CASH">Efectivo de Caja Bar</option><option value="TRANSFER">Cuenta bancaria del Bar</option><option value="CARD">Tarjeta</option></select></label></>}
 <label>Nota / comprobante (opcional)<input maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
 </fieldset></ValidatedForm></Modal>}
 </section>
}
