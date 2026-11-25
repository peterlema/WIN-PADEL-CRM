import {barDateTime} from '../barDisplay.js'
import BarPurchases from './BarPurchases.jsx'
import MoneyInput from './MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import {useCallback,useEffect,useRef,useState} from 'react'
import Modal from './Modal.jsx'
import ValidatedForm from './ValidatedForm.jsx'
import {callApi} from '../api.js'
const money = value => formatMoney(value,'Pendiente')
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date())
const labels={OPENING:'Conteo inicial',RECEIPT:'Recepción de compra',SALE:'Venta / entrega',WASTE:'Merma',INTERNAL:'Consumo interno',COMPLIMENTARY:'Cortesía',ADJUSTMENT:'Ajuste'}
const date=barDateTime
export default function BarInventory({purchasesOnly=false,onStockChanged=()=>{}}){
 const [data,setData]=useState(null),[products,setProducts]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const [form,setForm]=useState(null),[movementProduct,setMovementProduct]=useState('')
 const requests=useRef(new Map())
 const load=useCallback(async()=>{const [d,p]=await Promise.all([callApi('bar.inventory.snapshot'),callApi('bar.products')]);setData(d);setProducts(p.products||[])},[])
 useEffect(()=>{load().catch(e=>setError(e.message))},[load])
 async function run(action,p){
  if(busy)return;setBusy(true);setError('');setNotice('')
  const key=JSON.stringify([action,p]);if(!requests.current.has(key))requests.current.set(key,crypto.randomUUID())
  try{await callApi('bar.inventory.'+action,{...p,requestId:requests.current.get(key)});requests.current.delete(key);setForm(null);await load();onStockChanged();setNotice('Operación registrada. El stock y la caja se actualizan sólo cuando corresponde.')}
  catch(e){setError(e.message+(e.network?' Consultá Actualizar antes de reintentar; se conserva la misma solicitud.':''))}
  finally{setBusy(false)}
 }

 const productName=id=>{const p=products.find(p=>p.id===id);return p?[p.name,p.variant].filter(Boolean).join(' · '):'Producto'}
 return <div className="bar-inventory">
 {error&&<p role="alert" className="win-bar-message">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="win-bar-row"><h3>{purchasesOnly?'Compras':'Inventario y compras'}</h3><button className="secundario" disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</button></div>
 {!data?<p>Cargando…</p>:<>
 {data.canEdit&&<BarPurchases data={data} products={products} onChanged={async()=>{await load();onStockChanged()}}/>}
 <details className="bar-inventory-section"><summary>Inventario inicial, antecedentes y movimientos</summary>
 {(data.counts||[]).map(c=><p key={c.id}>Conteo físico inicial del {c.business_date.split('-').reverse().join('/')}: <strong>{c.total} unidades</strong>. Los movimientos posteriores se conservan y afectan las existencias actuales.</p>)}
 {(data.purchases||[]).filter(p=>p.kind==='HISTORICAL').map(p=><article key={p.id}><h4>Compra histórica · {money(p.total)}</h4><p>540 unidades originales. Antecedente informativo; no genera stock ni pagos.</p>{(p.cost_groups||[]).map(g=><p key={g.group}>{g.group}: {money(g.total)}</p>)}</article>)}
 {(data.reconciliation||[]).length>0&&<details><summary>Diferencias de unidades anteriores al conteo</summary><p>Información pendiente de explicar. No genera salidas adicionales ni bloquea la operación.</p><table><thead><tr><th>Grupo</th><th>Compradas</th><th>Contadas</th></tr></thead><tbody>{data.reconciliation.map(r=><tr key={r.id}><td>{r.group_name}</td><td>{r.purchased}</td><td>{r.physical}</td></tr>)}</tbody></table></details>}
 <label>Filtrar movimientos<select value={movementProduct} onChange={e=>setMovementProduct(e.target.value)}><option value="">Todos</option>{products.map(p=><option key={p.id} value={p.id}>{productName(p.id)}</option>)}</select></label>
 <div className="bar-table-scroll"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th>Unidades</th><th>Responsable / motivo</th></tr></thead><tbody>{(data.movements||[]).filter(m=>!movementProduct||m.product_id===movementProduct).map(m=><tr key={m.id}><td>{date(m.occurred_at)}</td><td>{productName(m.product_id)}</td><td>{labels[m.kind]}</td><td>{m.quantity_change}</td><td>{m.recorded_by_name} {m.note}</td></tr>)}</tbody></table></div>
 </details>
 {!purchasesOnly&&<details className="bar-inventory-section"><summary>Mermas, consumos internos y márgenes registrados</summary>
 {data.canEdit&&<button disabled={busy} onClick={()=>setForm({type:'out',productId:products.find(p=>p.active)?.id||'',quantity:1,kind:'WASTE',note:''})}>Registrar salida sin cobro</button>}
 {data.sales&&<p>Ventas: {money(data.sales.revenue)} · Costo registrado: {money(data.sales.cogs)} · Margen bruto: {money(data.sales.margin)}. {data.sales.estimatedCostUnits||0} unidades con costo estimado y {data.sales.unknownCostUnits} con costo pendiente. El margen bruto no es utilidad neta.</p>}
 </details>}
 </>}
 {form&&<Modal titulo="Salida de mercadería" onCerrar={()=>{if(!busy)setForm(null)}} footer={<><button type="submit" form="bar-inventory-form" disabled={busy}>Registrar salida</button><button type="button" className="secundario" onClick={()=>setForm(null)}>Cancelar</button></>}>
 <ValidatedForm id="bar-inventory-form" error={error} onSubmit={e=>{e.preventDefault();run('stock.out',{productId:form.productId,quantity:Number(form.quantity),kind:form.kind,note:form.note})}}>
 <label>Producto<select value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})}>{products.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{productName(p.id)} · {p.stock} disponibles</option>)}</select></label>
 <label>Tipo<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}>{['WASTE','INTERNAL','COMPLIMENTARY'].map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
 <label>Unidades<input required type="number" min="1" step="1" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
 <label>Motivo obligatorio<input required minLength={5} maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
 </ValidatedForm></Modal>}
 </div>
}
