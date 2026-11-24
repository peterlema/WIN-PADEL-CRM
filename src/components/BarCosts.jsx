import MoneyInput from './MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import {useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
export const costMoney=n=>formatMoney(n,'Pendiente')
export function parseCost(raw){
 if(raw==null||String(raw).trim()==='')throw new Error('Completá el costo unitario.')
 const n=parseMoneyInput(raw)
 if(!Number.isFinite(n))throw new Error('Usá un importe argentino: 1.435 o 415,15. Podés pegarlo con $.')
 if(n<0||n>1000000000)throw new Error('El costo debe estar entre $0 y $1.000.000.000.')
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
   if(p.cost===Number(product.provisionalInitialCost)){setError('El costo ya está guardado con ese importe. No hace falta volver a cargarlo.');return}
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

export default function BarCosts({products}){
 const [data,setData]=useState(null),[error,setError]=useState('')
 useEffect(()=>{let active=true;callApi('bar.inventory.cost.snapshot').then(d=>{if(active){setData(d);setError('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[products])
 return <details className="bar-inventory-section"><summary>Historial de costos y diferencias históricas (informativo)</summary>
 <p>Los costos vigentes ya se pueden usar. Las diferencias entre referencias aproximadas y facturas históricas no bloquean ventas, inventario, compras ni pagos. No hace falta conciliarlas para operar.</p>
 {error&&<p role="alert">{error}</p>}
 {data&&<><div className="bar-table-scroll"><table><thead><tr><th>Grupo</th><th>Importe histórico exacto</th><th>Referencia provisional</th><th>Diferencia informativa</th></tr></thead><tbody>
 {data.groups.map(g=><tr key={g.purchaseId+g.group}><td>{g.group}</td><td>{costMoney(g.originalTotal)}</td><td>{costMoney(g.referenceTotal)}</td><td>{g.referenceTotal==null?'Sin distribución confirmada':costMoney(g.referenceTotal-g.originalTotal)}</td></tr>)}
 </tbody></table></div>
 <details><summary>Historial completo de modificaciones ({data.history.length})</summary><div className="bar-table-scroll"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Producto</th><th>Costo anterior</th><th>Costo nuevo</th><th>Motivo</th></tr></thead><tbody>
 {data.history.map(a=><tr key={a.id}><td>{new Date(a.created_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})}</td><td>{a.actorName}</td><td>{a.after_record.name} {a.after_record.variant}</td><td>{costMoney(a.before_record?.unit_cost)}</td><td>{costMoney(a.after_record.unit_cost)}</td><td>{a.after_record.reason||a.after_record.evidence}</td></tr>)}
 </tbody></table></div></details></>}
 </details>
}
