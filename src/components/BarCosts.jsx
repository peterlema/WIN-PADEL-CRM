import MoneyInput from './MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import {useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
export const costMoney=n=>formatMoney(n,'Pendiente')
export function parseCost(raw){
 const n=parseMoneyInput(raw)
 if(!Number.isFinite(n)||n<0||n>1000000000)throw new Error('El costo debe estar entre $0 y $1.000.000.000.')
 return n
}
const input=moneyInputValue
export function BarProductCost({product,onSaved}){
 const [cost,setCost]=useState(input(product.provisionalInitialCost)),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const request=useRef(null)
 async function save(e){
  e.preventDefault();if(busy)return;setError('')
  try{
   const p={productId:product.id,cost:parseCost(cost),version:product.costVersion,note:note.trim()}
   if(p.note.length<5)throw new Error('Indicá un motivo de al menos cinco caracteres.')
   const key=JSON.stringify(p);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
   setBusy(true);await callApi('bar.inventory.cost.set',{...p,requestId:request.current.id});request.current=null
   await onSaved();setNote('')
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <form className="bar-product-editor" onSubmit={save}>
  <h4>Costo inicial provisional · {product.name} {product.variant}</h4>
  <p>Vigente: <strong>{costMoney(product.unitCost)}</strong> · {product.costOrigin}{product.costEstimated?' · Márgenes estimados':''}</p>
  <p className="win-bar-muted">Costo automático desde compras: {costMoney(product.automaticUnitCost)}. Guardar este costo no cambia el precio, las unidades, las compras ni la caja. Las ventas anteriores conservan su costo.</p>
  <div className="bar-product-fields"><label>Costo provisional manual ($)<MoneyInput required inputMode="decimal" placeholder="1.435 o 415,15" value={cost} onChange={e=>setCost(e.target.value)}/></label>
  <label>Motivo obligatorio<input required minLength={5} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label></div>
  {error&&<p className="win-bar-message" role="alert">{error}</p>}
  <button disabled={busy}>{busy?'Guardando…':'Guardar sólo costo provisional'}</button>
 </form>
}
export default function BarCosts({products,onSaved}){
 const [data,setData]=useState(null),[group,setGroup]=useState(null),[rows,setRows]=useState([]),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const request=useRef(null)
 async function load(){try{setData(await callApi('bar.inventory.cost.snapshot'))}catch(e){setError(e.message)}}
 useEffect(()=>{load()},[products])
 function begin(g){
  setGroup(g);setNote('');setError('')
  setRows(products.filter(pr=>g.lines.some(l=>l.product_id===pr.id||(!l.product_id&&l.label.startsWith(pr.name+' ·')))).map(pr=>({
   productId:pr.id,version:pr.costVersion,quantity:g.lines.find(l=>l.product_id===pr.id)?.quantity??'',totalCost:'',label:pr.name+' '+pr.variant
  })))
 }
 async function reconcile(e){
  e.preventDefault();if(busy)return
  try{
   const lines=rows.filter(l=>Number(l.quantity)>0).map(l=>({productId:l.productId,version:l.version,quantity:Number(l.quantity),totalCost:parseCost(l.totalCost)}))
   if(Math.round(lines.reduce((s,l)=>s+l.totalCost,0)*100)!==Math.round(Number(group.originalTotal)*100))throw new Error('La distribución debe sumar exactamente el importe histórico del grupo.')
   const p={purchaseId:group.purchaseId,group:group.group,lines,note:note.trim()}
   const key=JSON.stringify(p);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
   setBusy(true);setError('');await callApi('bar.inventory.cost.reconcile',{...p,requestId:request.current.id})
   request.current=null;setGroup(null);await onSaved();await load()
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="bar-inventory-section"><h4>Costos iniciales y conciliación de importes</h4>
  <p>Los importes históricos se conservan. Los costos manuales y los márgenes que los usan son estimados. El margen bruto no es utilidad neta.</p>
  {error&&<p className="win-bar-message" role="alert">{error}</p>}
  {data&&<div className="bar-table-scroll"><table><thead><tr><th>Grupo</th><th>Unidades originales</th><th>Importe histórico</th><th>Referencia provisional</th><th>Diferencia de referencia</th><th>Estado</th><th></th></tr></thead><tbody>
   {data.groups.map(g=><tr key={g.purchaseId+g.group}><td>{g.group}</td><td>{g.units}</td><td>{costMoney(g.originalTotal)}</td><td>{costMoney(g.referenceTotal)}</td><td>{g.referenceTotal==null?'Pendiente':costMoney(g.referenceTotal-g.originalTotal)}</td><td>{g.status==='RECONCILED'?'Conciliado con comprobante':'Pendiente de conciliación'}</td><td><button className="secundario" onClick={()=>begin(g)}>Conciliar con costo real</button></td></tr>)}
  </tbody></table></div>}
  {group&&<form className="bar-product-editor" onSubmit={reconcile}><h4>Conciliar {group.group}</h4>
   <p>Distribuí {group.units} unidades y {costMoney(group.originalTotal)} según el comprobante. Indicá las cantidades originales por variante, no las existencias actuales. No suma stock ni modifica ventas o caja.</p>
   {rows.map((l,i)=><div className="bar-product-fields" key={l.productId}><strong>{l.label}</strong><label>Unidades originales<input type="number" min="0" step="1" value={l.quantity} onChange={e=>setRows(rows.map((r,j)=>i===j?{...r,quantity:e.target.value}:r))}/></label><label>Importe total real de la variante ($)<MoneyInput inputMode="decimal" value={l.totalCost} onChange={e=>setRows(rows.map((r,j)=>i===j?{...r,totalCost:e.target.value}:r))}/></label></div>)}
   <label>Comprobante / motivo obligatorio<input required minLength={5} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <button disabled={busy}>{busy?'Conciliando…':'Guardar conciliación auditada'}</button><button type="button" className="secundario" disabled={busy} onClick={()=>setGroup(null)}>Cancelar</button>
  </form>}
  {data&&<details><summary>Historial completo de costos ({data.history.length})</summary><div className="bar-table-scroll"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Producto</th><th>Acción</th><th>Costo anterior</th><th>Costo nuevo</th><th>Motivo / comprobante</th></tr></thead><tbody>
   {data.history.map(a=><tr key={a.id}><td>{new Date(a.created_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})}</td><td>{a.actorName}</td><td>{a.after_record.name} {a.after_record.variant}</td><td>{a.action==='cost.set'?'Costo provisional manual':'Conciliación real'}</td><td>{costMoney(a.before_record?.unit_cost)}</td><td>{costMoney(a.after_record.unit_cost)}</td><td>{a.after_record.reason||a.after_record.evidence}</td></tr>)}
  </tbody></table></div></details>}
 </section>
}
