import {useCallback,useEffect,useRef,useState} from 'react'
import Modal from './Modal.jsx'
import ValidatedForm from './ValidatedForm.jsx'
import {callApi} from '../api.js'
const money=n=>n==null?'Pendiente':'$ '+Number(n).toLocaleString('es-AR',{maximumFractionDigits:2})
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date())
const labels={OPENING:'Conteo inicial',RECEIPT:'Recepción de compra',SALE:'Venta / entrega',WASTE:'Merma',INTERNAL:'Consumo interno',COMPLIMENTARY:'Cortesía',ADJUSTMENT:'Ajuste'}
const date=v=>new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(v))
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
 const row=()=>({productId:products.find(p=>p.active)?.id||'',quantity:1,totalCost:''})
 const purchases=data?.purchases||[],recon=data?.reconciliation||[]
 return <div className="bar-inventory">
  {error&&<p className="win-bar-message" role="alert">{error}</p>}{notice&&<p className="win-bar-message good" role="status">{notice}</p>}
  <div className="win-bar-row"><h3>{purchasesOnly?'Compras y recepción':'Control de inventario'}</h3><button className="secundario" disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</button></div>
  {!data?<p>Cargando inventario…</p>:<>
  {!purchasesOnly&&<>
   {(data.counts||[]).map(c=><p className="win-bar-message good" key={c.id}>Base física del {c.business_date.split('-').reverse().join('/')}: <strong>{c.total} unidades</strong>. Informado por {c.recordedByName}. Registro: {date(c.recorded_at)}.</p>)}
   {recon.length>0&&<section className="bar-inventory-section"><h4>Conciliación histórica pendiente</h4>
    <p>Compra original: <strong>540 unidades · $ 822.800</strong>. Conteo físico inicial: <strong>393 unidades</strong>. Las diferencias pueden ser ventas, mermas u otras salidas; todavía no están identificadas.</p>
    <div className="bar-table-scroll"><table><thead><tr><th>Grupo</th><th>Compra original</th><th>Conteo inicial</th><th>Diferencia</th><th>Valor potencial</th></tr></thead><tbody>
     {recon.map(r=><tr key={r.id}><td>{r.group_name}</td><td>{r.purchased}</td><td>{r.physical}</td><td>{r.purchased-r.physical}</td><td>{money(r.potential_value)}</td></tr>)}
     <tr><th>Total</th><th>540</th><th>393</th><th>147</th><th>$ 568.000</th></tr>
    </tbody></table></div><p className="win-bar-warning">$ 568.000 es una estimación con los precios aprobados al conteo, no facturación ni dinero cobrado. Esta diferencia no descuenta nuevamente el stock.</p>
   </section>}
   {data.canEdit&&<section className="bar-inventory-section"><h4>Mermas, consumos internos y cortesías</h4><button onClick={()=>setForm({type:'out',...row(),kind:'WASTE',note:''})} disabled={busy}>Registrar salida sin cobro</button>
    <p className="win-bar-muted">Exige motivo y usuario. Reduce existencias; no genera ventas ni movimientos de dinero.</p></section>}
   {data.sales&&<section className="bar-inventory-section"><h4>Ventas registradas desde el inicio operativo</h4>
    <p>Ventas / entregas: <strong>{money(data.sales.revenue)}</strong> · Costo conocido: <strong>{money(data.sales.cogs)}</strong> · Margen sobre líneas con costo conocido: <strong>{money(data.sales.margin)}</strong>.</p>
    <p className="win-bar-muted">{data.sales.unknownCostUnits} unidades vendidas con costo pendiente. El margen sólo incluye ventas con costos suficientes ({money(data.sales.knownCostRevenue)} de ventas). Ventas y cobros pueden ocurrir en fechas diferentes. La diferencia histórica no integra estas cifras.</p>
   </section>}
  </>}
  {data.canEdit&&<section className="bar-inventory-section"><div className="win-bar-row"><h4>Compras registradas</h4><button disabled={busy} onClick={()=>setForm({type:'purchase',supplier:'',purchaseDate:today(),lines:[row()],note:''})}>+ Nueva compra</button></div>
   <p className="win-bar-muted">Registrar un pedido no suma stock. Recibir mercadería suma unidades una sola vez. El pago se confirma por separado en Caja Bar.</p>
   {purchases.map(p=><article className="bar-purchase" key={p.id}><div className="win-bar-row"><strong>{p.kind==='HISTORICAL'?'Compra original histórica':p.supplier}</strong><b>{money(p.total)}</b></div>
    <p>Proveedor: {p.supplier||'Pendiente de confirmar'} · Fecha de compra: {p.purchase_date||'Pendiente de confirmar'} · {p.kind==='HISTORICAL'?'Sólo antecedente; sin ingreso de stock':({ORDERED:'Pedido pendiente de recepción',PARTIAL:'Recibido parcialmente',RECEIVED:'Mercadería recibida'}[p.status]||p.status)}</p>
    <p>Pago: {({UNCONFIRMED:'Sin confirmar; no representa deuda confirmada',UNPAID:'Pendiente',PARTIAL:'Pago parcial',PAID:'Pagado'}[p.payment_status])}</p>
    <div className="bar-table-scroll"><table><thead><tr><th>Producto / grupo</th><th>Unidades</th><th>Costo total individual</th>{p.kind!=='HISTORICAL'&&<th>Recibidas</th>}</tr></thead><tbody>{p.lines.map(l=><tr key={l.id}><td>{l.label}</td><td>{l.quantity}</td><td>{money(l.total_cost)}</td>{p.kind!=='HISTORICAL'&&<td>{l.received_quantity}</td>}</tr>)}</tbody></table></div>
    {(p.cost_groups||[]).map(g=><p className="win-bar-muted" key={g.group}>{g.group}: {money(g.total)} · {g.allocation==='PENDING'?'Costo conjunto, reparto pendiente':'Costo de un único producto'}</p>)}
    {p.note&&<p className="win-bar-muted">{p.note}</p>}
    {p.kind!=='HISTORICAL'&&<div className="bar-catalog-toolbar">
     {p.status!=='RECEIVED'&&<button disabled={busy} onClick={()=>setForm({type:'receive',purchaseId:p.id,lines:p.lines.filter(l=>l.received_quantity<l.quantity).map(l=>({...l,receive:l.quantity-l.received_quantity})),note:''})}>Recibir mercadería</button>}
     {p.payment_status!=='PAID'&&<button className="secundario" disabled={busy||p.total==null} onClick={()=>setForm({type:'pay',purchaseId:p.id,amount:'',method:'CASH',note:''})}>Registrar pago real</button>}
    </div>}
   </article>)}
  </section>}
  {!purchasesOnly&&<section className="bar-inventory-section"><div className="win-bar-row"><h4>Movimientos de stock</h4><label>Producto<select value={movementProduct} onChange={e=>setMovementProduct(e.target.value)}><option value="">Todos</option>{products.map(p=><option value={p.id} key={p.id}>{productName(p.id)}</option>)}</select></label></div>
   <p className="win-bar-muted">Últimos 250 movimientos. Los registros no se borran ni se sobrescriben.</p>
   <div className="bar-table-scroll"><table><thead><tr><th>Fecha de registro</th><th>Producto</th><th>Movimiento</th><th>Unidades</th><th>Responsable / motivo</th></tr></thead><tbody>{(data.movements||[]).filter(m=>!movementProduct||m.product_id===movementProduct).map(m=><tr key={m.id}><td>{date(m.occurred_at)}</td><td>{productName(m.product_id)}</td><td>{labels[m.kind]}</td><td>{m.quantity_change>0?'+':''}{m.quantity_change}</td><td>{m.recorded_by_name}<small>{m.note}</small></td></tr>)}</tbody></table></div>
  </section>}
  </>}
  {form&&<Modal titulo={{out:'Salida de mercadería',purchase:'Registrar pedido de compra',receive:'Confirmar recepción física',pay:'Confirmar pago a proveedor'}[form.type]} onCerrar={()=>{if(!busy)setForm(null)}} footer={<><button type="submit" form="bar-inventory-form" disabled={busy}>{busy?'Registrando…':form.type==='receive'?'Confirmar recepción y sumar stock':form.type==='pay'?'Confirmar pago real':'Guardar'}</button><button type="button" className="secundario" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button></>}><ValidatedForm id="bar-inventory-form" className="bar-inventory-form" error={error} onSubmit={e=>{e.preventDefault();if(form.type==='out')run('stock.out',{productId:form.productId,quantity:Number(form.quantity),kind:form.kind,note:form.note});if(form.type==='purchase')run('purchase.create',{supplier:form.supplier,purchaseDate:form.purchaseDate,note:form.note,lines:form.lines.map(l=>({productId:l.productId,quantity:Number(l.quantity),totalCost:l.totalCost===''?null:Number(l.totalCost)}))});if(form.type==='receive')run('purchase.receive',{purchaseId:form.purchaseId,note:form.note,lines:form.lines.filter(l=>Number(l.receive)>0).map(l=>({lineId:l.id,quantity:Number(l.receive)}))});if(form.type==='pay')run('purchase.pay',{purchaseId:form.purchaseId,amount:Number(form.amount),method:form.method,note:form.note})}}>
   {error&&<p role="alert" className="win-bar-message">{error}</p>}
   {form.type==='out'&&<div className="bar-product-fields"><label>Producto<select value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})}>{products.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{productName(p.id)} · {p.stock} disponibles</option>)}</select></label><label>Tipo<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}>{['WASTE','INTERNAL','COMPLIMENTARY'].map(k=><option value={k} key={k}>{labels[k]}</option>)}</select></label><label>Unidades<input required min="1" step="1" type="number" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label></div>}
   {form.type==='purchase'&&<><div className="bar-product-fields"><label>Proveedor confirmado<input required minLength={2} maxLength={160} value={form.supplier} onChange={e=>setForm({...form,supplier:e.target.value})}/></label><label>Fecha de compra<input required type="date" value={form.purchaseDate} onChange={e=>setForm({...form,purchaseDate:e.target.value})}/></label></div>
    {form.lines.map((l,i)=><div className="bar-purchase-line" key={i}><label>Producto<select value={l.productId} onChange={e=>setForm({...form,lines:form.lines.map((x,j)=>j===i?{...x,productId:e.target.value}:x)})}>{products.filter(p=>p.active).map(p=><option value={p.id} key={p.id}>{productName(p.id)}</option>)}</select></label><label>Unidades<input type="number" required min="1" step="1" value={l.quantity} onChange={e=>setForm({...form,lines:form.lines.map((x,j)=>j===i?{...x,quantity:e.target.value}:x)})}/></label><label>Costo total de esta línea ($)<input type="number" min="0" step="0.01" placeholder="Pendiente" value={l.totalCost} onChange={e=>setForm({...form,lines:form.lines.map((x,j)=>j===i?{...x,totalCost:e.target.value}:x)})}/></label><button type="button" className="secundario" disabled={form.lines.length===1} onClick={()=>setForm({...form,lines:form.lines.filter((_,j)=>j!==i)})}>Quitar</button></div>)}
    <button type="button" className="secundario" onClick={()=>setForm({...form,lines:[...form.lines,row()]})}>+ Agregar línea</button><p className="win-bar-muted">Un costo sin confirmar queda vacío. Un costo conjunto no debe repartirse sin confirmación. Esta operación no recibe mercadería ni registra un pago.</p></>}
   {form.type==='receive'&&form.lines.map((l,i)=><label key={l.id}>{l.label} · faltan {l.quantity-l.received_quantity}<input type="number" min="0" max={l.quantity-l.received_quantity} step="1" required value={l.receive} onChange={e=>setForm({...form,lines:form.lines.map((x,j)=>j===i?{...x,receive:e.target.value}:x)})}/></label>)}
   {form.type==='pay'&&<><p className="win-bar-warning">Sólo confirmar si el dinero se pagó realmente. Se registra exclusivamente en la Caja Bar abierta.</p><div className="bar-product-fields"><label>Importe realmente pagado ($)<input type="number" required min="0.01" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><label>Medio<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia de Bar</option><option value="CARD">Tarjeta</option></select></label></div></>}
   <label>Motivo / comprobante{form.type==='out'?' (obligatorio)':''}<input required={form.type==='out'} minLength={form.type==='out'?5:0} maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
  </ValidatedForm></Modal>}
 </div>
}
