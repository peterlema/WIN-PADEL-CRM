import {useCallback,useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'

const MONEY=n=>'$ '+Number(n||0).toLocaleString('es-AR',{maximumFractionDigits:2})
const TODAY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date())
const payMethods=[['CASH','Efectivo'],['TRANSFER','Transferencia'],['CARD','Tarjeta']]
const courts=['C1','C2','C3','C4']
function positive(value){
 const n=Number(String(value||'').trim().replace(/\./g,'').replace(',','.'))
 return Number.isFinite(n)&&n>0&&Math.round(n*100)/100===n?n:null
}
export default function QuickBar(){
 const [products,setProducts]=useState([])
 const [customers,setCustomers]=useState([])
 const [bookings,setBookings]=useState([])
 const [pending,setPending]=useState([])
 const [shift,setShift]=useState(undefined)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [uncertain,setUncertain]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [category,setCategory]=useState('Todas')
 const [search,setSearch]=useState('')
 const [cart,setCart]=useState({})
 const [destination,setDestination]=useState('IMMEDIATE')
 const [method,setMethod]=useState('CASH')
 const [accountId,setAccountId]=useState('')
 const [newName,setNewName]=useState('')
 const [showNew,setShowNew]=useState(false)
 const [day,setDay]=useState(TODAY())
 const [bookingId,setBookingId]=useState('')
 const [court,setCourt]=useState('C1')
 const [courtStart,setCourtStart]=useState('')
 const [note,setNote]=useState('')
 const [paymentOrder,setPaymentOrder]=useState(null)
 const [paymentAmount,setPaymentAmount]=useState('')
 const [paymentMethod,setPaymentMethod]=useState('CASH')
 const requestId=useRef(crypto.randomUUID())
 const paymentRequest=useRef(crypto.randomUUID())
 const [showPending,setShowPending]=useState(true)

 const reload=useCallback(async()=>{
  setLoading(true);setError('')
  try {
   const [p,c,o,sh]=await Promise.all([
    callApi('bar.products'),callApi('bar.customers'),callApi('bar.pending'),callApi('cash.state')
   ])
   setProducts(p.products||[]);setCustomers(c.customers||[])
   setPending(o.orders||[]);setShift(sh.shift||null);setUncertain(false)
  }catch(e){setError(e.message||'No se pudo actualizar el Bar.')}
  finally{setLoading(false)}
 },[])
 const loadCourts=useCallback(async d=>{
  try {const r=await callApi('bar.courts',{date:d});setBookings(r.bookings||[])}
  catch(e){setBookings([]);setError(e.message||'No se pudo consultar el calendario.')}
 },[])
 useEffect(()=>{reload()},[reload])
 useEffect(()=>{loadCourts(day)},[day,loadCourts])

 const all=products.filter(p=>p.active)
 const categories=['Todas',...new Set(all.map(p=>p.category||'Otros'))]
 const shown=all.filter(p=>(category==='Todas'||p.category===category)&&[p.name,p.variant].join(' ').toLowerCase().includes(search.toLowerCase()))
 const items=Object.entries(cart).map(([id,qty])=>({...products.find(p=>p.id===id),quantity:qty})).filter(p=>p.id)
 const total=items.reduce((v,p)=>v+Number(p.salePrice||0)*p.quantity,0)
 const selected=bookings.find(b=>b.id===bookingId)
 const selectedCourt=selected?.court||court
 const selectedStart=selected?.start||courtStart
 const cannotSubmit=items.some(x=>x.salePrice==null||Number(x.salePrice)<=0)
 const groupedPending=pending.filter(p=>p.balance>0).sort((a,b)=>new Date(b.date)-new Date(a.date))
 const pendingSum=groupedPending.reduce((x,o)=>x+Number(o.balance),0)
 const [pendingFilter,setPendingFilter]=useState('ALL')
 const visiblePending=groupedPending.filter(x=>pendingFilter==='ALL'||x.destination===pendingFilter)

 function put(p){
  if(p.salePrice==null||Number(p.salePrice)<=0){setError('Configurá el precio de '+p.name+' desde Stock antes de venderlo.');return}
  setCart(old=>({...old,[p.id]:Math.min((old[p.id]||0)+1,100)}))
  setError('')
 }
 function changeQty(id,delta){
  setCart(old=>{const next={...old},n=(next[id]||0)+delta;if(n<=0)delete next[id];else next[id]=Math.min(n,100);return next})
 }
 async function addCustomer(e){
  e.preventDefault()
  if(busy)return
  setBusy(true);setError('')
  try {
   const r=await callApi('bar.customer.create',{name:newName.trim()})
   const response=await callApi('bar.customers')
   setCustomers(response.customers||[]);setAccountId(r.id);setShowNew(false);setNewName('')
   setNotice('Cuenta creada para '+r.name+'.')
  }catch(e){setError(e.message||'No se pudo crear la persona.')}
  finally{setBusy(false)}
 }
 async function place(e){
  e.preventDefault()
  if(busy||uncertain||!shift)return
  if(!items.length){setError('Seleccioná al menos un producto.');return}
  if(cannotSubmit){setError('Hay productos sin precio de venta.');return}
  if(destination==='ACCOUNT'&&!accountId){setError('Elegí o agregá una persona.');return}
  if(destination==='COURT'&&(!selectedCourt||!selectedStart)){setError('Seleccioná una reserva o indicá cancha y horario.');return}
  if(!window.confirm(destination==='IMMEDIATE'?'¿Confirmar cobro de '+MONEY(total)+'?':'¿Registrar consumo pendiente por '+MONEY(total)+'?'))return
  setBusy(true);setError('');setNotice('')
  try {
   const r=await callApi('bar.order.place',{
    requestId:requestId.current,items:items.map(p=>({id:p.id,quantity:p.quantity})),
    destination,customerId:destination==='ACCOUNT'?accountId:null,
    bookingId:destination==='COURT'&&selected?.id?selected.id:null,
    court:destination==='COURT'?selectedCourt:null,
    courtDate:destination==='COURT'?day:null,
    courtStart:destination==='COURT'?selectedStart:null,
    method:destination==='IMMEDIATE'?method:null,note:note.trim()
   })
   setCart({});setNote('');requestId.current=crypto.randomUUID()
   setNotice(destination==='IMMEDIATE'?'Cobro registrado: '+MONEY(r.total):'Consumo pendiente registrado: '+MONEY(r.total))
   await reload()
  }catch(e){setUncertain(true);setError((e.message||'No se pudo confirmar.')+' Consultá los pendientes y la caja antes de intentar otra vez.')}
  finally{setBusy(false)}
 }
 async function settle(e){
  e.preventDefault()
  if(busy||uncertain||!paymentOrder||!shift)return
  const n=positive(paymentAmount)
  if(n==null||n>Number(paymentOrder.balance)){setError('El importe debe ser mayor a cero y no superar el saldo pendiente.');return}
  if(!window.confirm('¿Registrar cobro de '+MONEY(n)+'?'))return
  setBusy(true);setError('');setNotice('')
  try{
   const r=await callApi('bar.order.pay',{requestId:paymentRequest.current,orderId:paymentOrder.id,amount:n,method:paymentMethod})
   paymentRequest.current=crypto.randomUUID()
   setPaymentOrder(null);setPaymentAmount('')
   setNotice('Cobro registrado. Saldo restante: '+MONEY(r.remaining))
   await reload()
  }catch(e){setUncertain(true);setError((e.message||'No se pudo confirmar el cobro.')+' Verificá la caja antes de repetir.')}
  finally{setBusy(false)}
 }
 function chooseSettle(p){setPaymentOrder(p);setPaymentAmount(String(p.balance).replace('.',','));paymentRequest.current=crypto.randomUUID();setError('')}
 const formatDate=v=>new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v))
 return <div className="bar-pos">
  <section className="win-bar-card">
   <div className="win-bar-row"><div><h3>Venta rápida por productos</h3><p className="win-bar-muted">Elegí una categoría y tocá cada bebida. El precio se toma de Stock.</p></div><button type="button" className="secundario" onClick={reload} disabled={busy||loading}>Actualizar</button></div>
   <div className="win-bar-row"><span className="win-bar-status">{loading?'Cargando…':shift?'Caja abierta · '+shift.business_date:'Caja cerrada'}</span><span className="win-bar-status">{products.length} productos · {pending.length} consumos pendientes</span></div>
   {error&&<p className="win-bar-message" role="alert">{error}</p>}
   {notice&&<p className="win-bar-message good" role="status">{notice}</p>}
   {uncertain&&<div className="win-bar-warning">El resultado de la última operación no pudo confirmarse. Revisá movimientos y pendientes con Actualizar. No la repitas sin comprobar que no se registró.</div>}
   <div className="bar-pos-filters">{categories.map(x=><button key={x} type="button" aria-pressed={category===x} onClick={()=>setCategory(x)}>{x}</button>)}</div>
   <label className="bar-pos-search">Buscar producto<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ej. Gatorade, Patagonia, Coca" /></label>
   <div className="bar-pos-products">{shown.map(p=><button className="bar-pos-product" type="button" key={p.id} disabled={p.salePrice==null||Number(p.salePrice)<=0} onClick={()=>put(p)}>
    <span>{p.name}{p.variant&&<small>{p.variant}</small>}</span>
    <strong>{p.salePrice==null||Number(p.salePrice)<=0?'Sin precio':MONEY(p.salePrice)}</strong>
   </button>)}</div>
   {!loading&&!shown.length&&<p className="win-bar-empty">No hay productos para este filtro.</p>}
  </section>
  <section className="win-bar-card">
   <h3>Carrito <span className="bar-pos-count">{items.reduce((n,p)=>n+p.quantity,0)} unidades</span></h3>
   {!items.length?<p className="win-bar-empty">Tocá una bebida para agregarla.</p>:<div className="bar-pos-cart">
    {items.map(p=><div className="bar-pos-cart-line" key={p.id}><div><strong>{p.name}{p.variant?' · '+p.variant:''}</strong><small>{MONEY(p.salePrice)} c/u</small></div><div className="bar-pos-qty"><button type="button" onClick={()=>changeQty(p.id,-1)}>−</button><b>{p.quantity}</b><button type="button" onClick={()=>changeQty(p.id,1)}>+</button></div><b>{MONEY(p.quantity*Number(p.salePrice))}</b></div>)}
   </div>}
   <div className="bar-pos-total"><span>Total</span><strong>{MONEY(total)}</strong></div>
   <form className="win-bar-form bar-pos-checkout" onSubmit={place}>
    <fieldset className="bar-pos-choice"><legend>¿Cómo se registra?</legend>
     {[['IMMEDIATE','Cobrar ahora'],['COURT','Pendiente de cancha'],['ACCOUNT','Cuenta corriente']].map(([id,label])=><button type="button" key={id} aria-pressed={destination===id} onClick={()=>setDestination(id)}>{label}</button>)}
    </fieldset>
    {destination==='IMMEDIATE'&&<fieldset className="win-bar-methods"><legend>Medio de pago</legend>{payMethods.map(([v,label])=><button key={v} type="button" className={method===v?'selected':''} onClick={()=>setMethod(v)}>{label}</button>)}</fieldset>}
    {destination==='ACCOUNT'&&<div className="bar-pos-inline">
      <label>Persona / socio<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Elegir una persona</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button type="button" className="secundario" onClick={()=>setShowNew(s=>!s)}>+ Nueva persona</button>
      {showNew&&<div className="bar-pos-inline-form"><label>Nombre de la persona<input value={newName} maxLength={120} onChange={e=>setNewName(e.target.value)}/></label><button type="button" disabled={busy||newName.trim().length<2} onClick={addCustomer}>Crear cuenta</button></div>}
    </div>}
    {destination==='COURT'&&<div className="bar-pos-inline">
     <label>Fecha del turno<input type="date" value={day} onChange={e=>{setDay(e.target.value);setBookingId('')}}/></label>
     <label>Reserva del calendario<select value={bookingId} onChange={e=>setBookingId(e.target.value)}><option value="">Asignar manualmente si no figura</option>{bookings.map(b=><option key={b.id} value={b.id}>{b.court} · {b.start} · {b.holder} ({b.kind})</option>)}</select></label>
     {!bookingId&&<div className="bar-pos-court-manual"><label>Cancha<select value={court} onChange={e=>setCourt(e.target.value)}>{courts.map(x=><option key={x}>{x}</option>)}</select></label><label>Inicio del turno<input type="time" value={courtStart} onChange={e=>setCourtStart(e.target.value)} required/></label></div>}
     <p className="win-bar-muted">{selected?'Vinculado a la reserva '+selected.holder+'. Se mostrará como pendiente hasta cobrarlo.':'Si no aparece una reserva, registrá cancha y horario para localizar el consumo después.'}</p>
    </div>}
    <label>Observación (opcional)<input value={note} maxLength={400} onChange={e=>setNote(e.target.value)} placeholder="Ej. Llevó a la cancha; cobra Recepción" /></label>
    <button type="submit" disabled={!shift||!items.length||cannotSubmit||busy||uncertain}>{busy?'Guardando…':destination==='IMMEDIATE'?'Cobrar '+MONEY(total):'Guardar pendiente '+MONEY(total)}</button>
    {!shift&&<p className="win-bar-warning">Para registrar entregas o cobros debe haber una caja abierta por Recepción.</p>}
   </form>
  </section>
  <section className="win-bar-card">
   <div className="win-bar-row"><div><h3>Consumos pendientes</h3><p className="win-bar-muted">Mercadería entregada y todavía no cobrada; pagar no vuelve a descontar stock.</p></div><strong>{MONEY(pendingSum)}</strong></div>
   <div className="bar-pos-filters">{[['ALL','Todos'],['COURT','Por cancha'],['ACCOUNT','Por persona']].map(([id,label])=><button type="button" key={id} aria-pressed={pendingFilter===id} onClick={()=>setPendingFilter(id)}>{label}</button>)}</div>
   {!visiblePending.length?<p className="win-bar-empty">Sin consumos pendientes en este filtro.</p>:visiblePending.map(p=><div className="bar-pos-pending" key={p.id}><div>
    <strong>{p.destination==='COURT'?p.court+' · '+p.courtDate+' · '+(p.courtStart||'')+(p.holder?' · '+p.holder:''):p.customerName||'Cuenta corriente'}</strong>
    <small>{formatDate(p.date)} · {(p.items||[]).map(i=>i.quantity+'× '+i.name).join(', ')}</small>
    {p.note&&<small>{p.note}</small>}
   </div><div className="bar-pos-pending-amount"><strong>{MONEY(p.balance)}</strong><button type="button" disabled={!shift||busy||uncertain} onClick={()=>chooseSettle(p)}>Cobrar</button></div></div>)}
   {paymentOrder&&<form className="bar-pos-payment" onSubmit={settle}>
    <div className="win-bar-row"><h3>Cobrar consumo pendiente</h3><button type="button" className="secundario" onClick={()=>setPaymentOrder(null)}>Cerrar</button></div>
    <p className="win-bar-muted">Saldo: {MONEY(paymentOrder.balance)}. Podés cobrar una parte y dejar el resto pendiente.</p>
    <label>Importe que se recibe ($)<input inputMode="decimal" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} required/></label>
    <fieldset className="win-bar-methods"><legend>Medio</legend>{payMethods.map(([id,label])=><button key={id} type="button" className={paymentMethod===id?'selected':''} onClick={()=>setPaymentMethod(id)}>{label}</button>)}</fieldset>
    <button disabled={busy||uncertain}>Confirmar cobro</button>
   </form>}
  </section>
  <p className="win-bar-warning">Control de stock: cada entrega crea una salida en Supabase. Las existencias físicas seguirán sin saldo calculado hasta registrar el conteo inicial. No usar esta versión para cobrar operaciones reales sin probar antes la conciliación con Recepción.</p>
 </div>
}
