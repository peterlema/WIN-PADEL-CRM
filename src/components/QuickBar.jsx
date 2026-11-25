import {barDate} from '../barDate.js'
import MoneyInput from './MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import ValidatedForm from './ValidatedForm.jsx'
import {TimePicker,CourtPicker} from './ActivityControls.jsx'
import {useCallback,useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
import {readBarTransaction,submitBarTransaction,recoverBarTransaction} from '../barTransactions.js'

const MONEY = value => formatMoney(value,'Sin definir')
const TODAY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date())
const payMethods=[['CASH','Efectivo'],['TRANSFER','Transferencia'],['CARD','Tarjeta']]
const courts=['C4','C3','C2','C1']
function positive(value){
 const n=parseMoneyInput(value)
 return Number.isFinite(n)&&n>0&&Math.round(n*100)/100===n?n:null
}
export default function QuickBar({soloVenta=false}){
 const [products,setProducts]=useState([])
 const [customers,setCustomers]=useState([])
 const [bookings,setBookings]=useState([])
 const [pending,setPending]=useState([])
 const [shift,setShift]=useState(undefined)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [uncertain,setUncertain]=useState(false)
 const [recoveryStatus,setRecoveryStatus]=useState('')
 const [owner,setOwner]=useState('')
 const transactionBusy=useRef(false)
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
 // Cobrar ahora: de qué cancha y horario era el cliente ('COURT') o 'UNKNOWN' (No conozco cliente). Obligatorio elegir.
 const [cliente,setCliente]=useState('')
 const [paymentOrder,setPaymentOrder]=useState(null)
 const [paymentAmount,setPaymentAmount]=useState('')
 const [paymentMethod,setPaymentMethod]=useState('CASH')
 const requestId=useRef(crypto.randomUUID())
 const paymentRequest=useRef(crypto.randomUUID())
 const [showPending,setShowPending]=useState(true)

 const reload=useCallback(async()=>{
  setLoading(true);setError('')
  try {
   const [p,c,o,sh,me]=await Promise.all([
    callApi('bar.products'),callApi('bar.customers'),callApi('bar.pending'),callApi('bar.inventory.cash.state'),callApi('me')
   ])
   setProducts(p.products||[]);setCustomers(c.customers||[])
   setPending(o.orders||[]);setShift(sh.shift||null);setOwner(me.user.id)
  }catch(e){setError(e.message||'No se pudo actualizar el Bar.')}
  finally{setLoading(false)}
 },[])
 const loadCourts=useCallback(async d=>{
  try {const r=await callApi('bar.courts',{date:d});setBookings(r.bookings||[])}
  catch(e){setBookings([]);setError(e.message||'No se pudo consultar el calendario.')}
 },[])
 useEffect(()=>{reload()},[reload])
 useEffect(()=>{
  if(owner){try{if(readBarTransaction(sessionStorage,owner))recoverLast(false)}catch(e){setUncertain(true);setError(e.message)}}
 },[owner])
 function finish(action,r){
  setUncertain(false);setRecoveryStatus('')
  if(action==='bar.order.place'){
   setCart({});setNote('');setCliente('');setBookingId('');setCourtStart('');requestId.current=crypto.randomUUID()
   setNotice('Venta confirmada: '+MONEY(r.total))
  }else{
   paymentRequest.current=crypto.randomUUID();setPaymentOrder(null);setPaymentAmount('')
   setNotice('Cobro confirmado. Saldo restante: '+MONEY(r.remaining))
  }
 }
 function failed(e){
  setUncertain(e.uncertain===true);setRecoveryStatus(e.recoveryStatus||'')
  if(!e.uncertain){requestId.current=crypto.randomUUID();paymentRequest.current=crypto.randomUUID()}
  setError(e.message||'La operación fue rechazada.')
 }
 async function recoverLast(retry=false){
  if(transactionBusy.current||!owner)return
  transactionBusy.current=true;setBusy(true);setError('')
  try{
   const r=await recoverBarTransaction({call:callApi,storage:sessionStorage,owner,retry})
   if(r.state==='CONFIRMED'){finish(r.action,r.result);await reload()}
   else if(r.state==='EMPTY'){setUncertain(false);setRecoveryStatus('')}
  }catch(e){setUncertain(true);setRecoveryStatus(e.recoveryStatus||'UNAVAILABLE');setError(e.message)}
  finally{transactionBusy.current=false;setBusy(false)}
 }
 async function refresh(){
  await reload()
  if(owner){try{if(readBarTransaction(sessionStorage,owner))await recoverLast(false)}catch(e){setUncertain(true);setError(e.message)}}
 }
 useEffect(()=>{loadCourts(day)},[day,loadCourts])

 const all=products.filter(p=>p.active)
 const categories=['Todas',...new Set(all.map(p=>p.category||'Otros'))]
 const hasPrice=p=>p.salePrice!=null&&Number(p.salePrice)>0
 const matching=all.filter(p=>(category==='Todas'||p.category===category)&&[p.name,p.variant].join(' ').toLowerCase().includes(search.toLowerCase()))
 // Con precio primero; los que no tienen precio no se pueden vender: el empleado los ve aparte, sin botones apagados.
 const shown=soloVenta?matching.filter(hasPrice):[...matching.filter(hasPrice),...matching.filter(p=>!hasPrice(p))]
 const sinPrecio=matching.filter(p=>!hasPrice(p))
 const items=Object.entries(cart).map(([id,qty])=>({...products.find(p=>p.id===id),quantity:qty})).filter(p=>p.id)
 const total=items.reduce((v,p)=>v+Number(p.salePrice||0)*p.quantity,0)
 const selected=bookings.find(b=>b.id===bookingId)
 const selectedCourt=selected?.court||court
 const selectedStart=selected?.start||courtStart
 const conCancha=destination==='COURT'||(destination==='IMMEDIATE'&&cliente==='COURT')
 const cannotSubmit=items.some(x=>x.salePrice==null||Number(x.salePrice)<=0)
 const groupedPending=pending.filter(p=>p.balance>0).sort((a,b)=>new Date(b.date)-new Date(a.date))
 const pendingSum=groupedPending.reduce((x,o)=>x+Number(o.balance),0)
 const [pendingFilter,setPendingFilter]=useState('ALL')
 const visiblePending=groupedPending.filter(x=>pendingFilter==='ALL'||x.destination===pendingFilter)

 function put(p){
  if(busy||uncertain)return
  if(p.salePrice==null||Number(p.salePrice)<=0){setError('Configurá el precio de '+p.name+' desde Stock antes de venderlo.');return}
  setCart(old=>({...old,[p.id]:Math.min((old[p.id]||0)+1,100)}))
  setError('')
 }
 function changeQty(id,delta){
  if(busy||uncertain)return
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
  if(transactionBusy.current||busy||uncertain||!shift||!owner)return
  if(!items.length){setError('Seleccioná al menos un producto.');return}
  if(cannotSubmit){setError('Hay productos sin precio de venta.');return}
  if(destination==='ACCOUNT'&&!accountId){setError('Elegí o agregá una persona.');return}
  if(destination==='IMMEDIATE'&&!cliente){setError('Indicá la cancha y el horario del cliente, o elegí No conozco cliente.');return}
  if(conCancha&&(!selectedCourt||!selectedStart)){setError('Seleccioná una reserva o indicá cancha y horario.');return}
  if(!window.confirm(destination==='IMMEDIATE'?'¿Confirmar cobro de '+MONEY(total)+'?':'¿Registrar consumo pendiente por '+MONEY(total)+'?'))return
  transactionBusy.current=true;setBusy(true);setError('');setNotice('')
  const payload={
    requestId:requestId.current,items:items.map(p=>({id:p.id,quantity:p.quantity})),
    destination,customerId:destination==='ACCOUNT'?accountId:null,
    bookingId:conCancha&&selected?.id?selected.id:null,
    court:conCancha?selectedCourt:null,courtDate:conCancha?day:null,courtStart:conCancha?selectedStart:null,
    clientUnknown:destination==='IMMEDIATE'&&cliente==='UNKNOWN',
    method:destination==='IMMEDIATE'?method:null,note:note.trim()
  }
  try{
   const r=await submitBarTransaction({call:callApi,storage:sessionStorage,owner,action:'bar.order.place',payload})
   finish(r.action,r.result);await reload()
  }catch(e){failed(e)}
  finally{transactionBusy.current=false;setBusy(false)}
 }
 async function settle(e){
  e.preventDefault()
  if(transactionBusy.current||busy||uncertain||!paymentOrder||!shift||!owner)return
  const n=positive(paymentAmount)
  if(n==null||n>Number(paymentOrder.balance)){setError('El importe debe ser mayor a cero y no superar el saldo pendiente.');return}
  if(!window.confirm('¿Registrar cobro de '+MONEY(n)+'?'))return
  transactionBusy.current=true;setBusy(true);setError('');setNotice('')
  try{
   const r=await submitBarTransaction({call:callApi,storage:sessionStorage,owner,action:'bar.order.pay',payload:{requestId:paymentRequest.current,orderId:paymentOrder.id,amount:n,method:paymentMethod}})
   finish(r.action,r.result);await reload()
  }catch(e){failed(e)}
  finally{transactionBusy.current=false;setBusy(false)}
 }
 function chooseSettle(p){setPaymentOrder(p);setPaymentAmount(String(p.balance).replace('.',','));paymentRequest.current=crypto.randomUUID();setError('')}
 const formatDate=barDate
 return <div className={'bar-pos'+(soloVenta?' bar-pos-solo':'')}>
  <div className="bar-pos-main">
  <section className="win-bar-card bar-pos-catalogo">
   <div className="win-bar-row"><div><h3>{soloVenta?'Vender':'Venta rápida por productos'}</h3>{!soloVenta&&<p className="win-bar-muted">Elegí una categoría y tocá cada bebida. El precio se toma de Stock.</p>}</div>
    <div className="bar-pos-head-actions"><span className={'win-bar-status'+(shift?' abierta':shift===null?' cerrada':'')}>{loading?'Cargando…':shift?'Caja abierta':'Caja cerrada'}</span><button type="button" className="secundario" onClick={refresh} disabled={busy||loading}>Actualizar</button></div></div>
   {error&&<p className="win-bar-message" role="alert">{error}</p>}
   {notice&&<p className="win-bar-message good" role="status">{notice}</p>}
   {uncertain&&<div className="win-bar-warning"><p>Conservamos el identificador y los datos de la operación. La consulta comprueba esa misma solicitud; no crea una venta nueva.</p><button type="button" disabled={busy} onClick={()=>recoverLast(false)}>Consultar resultado</button>{recoveryStatus==='NOT_FOUND'&&<button type="button" disabled={busy} onClick={()=>recoverLast(true)}>Reintentar misma operación</button>}</div>}
   <div className="bar-pos-toolbar">
    <div className="bar-pos-filters">{categories.map(x=><button key={x} type="button" aria-pressed={category===x} onClick={()=>setCategory(x)}>{x}</button>)}</div>
    <input className="bar-pos-search-input" type="search" aria-label="Buscar producto" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar: Gatorade, Coca…" />
   </div>
   <div className="bar-pos-products">{shown.map(p=><button className="bar-pos-product" type="button" key={p.id} disabled={busy||uncertain||p.salePrice==null||Number(p.salePrice)<=0||(p.stockKnown&&p.stock<=0)} onClick={()=>put(p)}>
    <span className="bar-pos-name">{p.name}</span>{p.variant&&<small>{p.variant}</small>}
    <strong>{hasPrice(p)?MONEY(p.salePrice):'Sin precio'}</strong><small>{p.stockKnown?p.stock+' disponibles':'Sin conteo'}</small>
    {cart[p.id]>0&&<b className="bar-pos-badge">{cart[p.id]}</b>}
   </button>)}</div>
   {!loading&&!shown.length&&<p className="win-bar-empty">No hay productos para vender con este filtro.</p>}
   {soloVenta&&sinPrecio.length>0&&<p className="bar-pos-sinprecio">Sin precio cargado, no se pueden vender todavía: {sinPrecio.map(p=>p.name+(p.variant?' '+p.variant:'')).join(', ')}. Avisá al encargado.</p>}
  </section>
  <section className="win-bar-card bar-pos-carrito">
   <div className="win-bar-row"><h3>Carrito <span className="bar-pos-count">{items.reduce((n,p)=>n+p.quantity,0)} unidades</span></h3>{items.length>0&&<button type="button" className="enlace" disabled={busy||uncertain} onClick={()=>setCart({})}>Vaciar</button>}</div>
   {!items.length?<p className="win-bar-empty">Tocá una bebida para agregarla.</p>:<div className="bar-pos-cart">
    {items.map(p=><div className="bar-pos-cart-line" key={p.id}><div><strong>{p.name}{p.variant?' · '+p.variant:''}</strong><small>{MONEY(p.salePrice)} c/u</small></div><div className="bar-pos-qty"><button type="button" disabled={busy||uncertain} onClick={()=>changeQty(p.id,-1)}>−</button><b>{p.quantity}</b><button type="button" onClick={()=>changeQty(p.id,1)}>+</button></div><b>{MONEY(p.quantity*Number(p.salePrice))}</b></div>)}
   </div>}
   <div className="bar-pos-total"><span>Total</span><strong>{MONEY(total)}</strong></div>
   <ValidatedForm id="bar-checkout-form" error={error} className="win-bar-form bar-pos-checkout" onSubmit={place}>
    <fieldset disabled={busy||uncertain} style={{border:0,padding:0,minWidth:0}}>
    <fieldset className="bar-pos-choice"><legend>¿Cómo se registra?</legend>
     {[['IMMEDIATE','Cobrar ahora'],['COURT','Pendiente de cancha'],['ACCOUNT','Cuenta corriente']].map(([id,label])=><button type="button" key={id} aria-pressed={destination===id} onClick={()=>setDestination(id)}>{label}</button>)}
    </fieldset>
    {destination==='IMMEDIATE'&&<fieldset className="win-bar-methods"><legend>Medio de pago</legend>{payMethods.map(([v,label])=><button key={v} type="button" className={method===v?'selected':''} onClick={()=>setMethod(v)}>{label}</button>)}</fieldset>}
    {destination==='IMMEDIATE'&&<fieldset className="bar-pos-choice bar-pos-cliente"><legend>¿De qué cancha era?</legend>
     <button type="button" aria-pressed={cliente==='COURT'} onClick={()=>setCliente('COURT')}>Cancha y horario</button>
     <button type="button" aria-pressed={cliente==='UNKNOWN'} onClick={()=>{setCliente('UNKNOWN');setBookingId('')}}>No conozco cliente</button>
    </fieldset>}
    {destination==='ACCOUNT'&&<div className="bar-pos-inline">
      <label>Persona / socio<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Elegir una persona</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button type="button" className="secundario" onClick={()=>setShowNew(s=>!s)}>+ Nueva persona</button>
      {showNew&&<div className="bar-pos-inline-form"><label>Nombre de la persona<input value={newName} maxLength={120} onChange={e=>setNewName(e.target.value)}/></label><button type="button" disabled={busy||newName.trim().length<2} onClick={addCustomer}>Crear cuenta</button></div>}
    </div>}
    {conCancha&&<div className="bar-pos-inline">
     <label>Fecha del turno<input type="date" value={day} onChange={e=>{setDay(e.target.value);setBookingId('')}}/></label>
     <label>Reserva del calendario<select value={bookingId} onChange={e=>setBookingId(e.target.value)}><option value="">Asignar manualmente si no figura</option>{bookings.map(b=><option key={b.id} value={b.id}>{b.court} · {b.start} · {b.holder} ({b.kind})</option>)}</select></label>
     {!bookingId&&<div className="bar-pos-court-manual"><CourtPicker value={court} onChange={setCourt}/><TimePicker label="Inicio del turno" value={courtStart} onChange={setCourtStart} required/></div>}
     <p className="win-bar-muted">{destination==='IMMEDIATE'?(selected?'Se cobra ahora y queda asociado a '+selected.holder+'.':'Se cobra ahora y queda asociado a esa cancha y horario.'):selected?'Vinculado a la reserva '+selected.holder+'. Se mostrará como pendiente hasta cobrarlo.':'Si no aparece una reserva, registrá cancha y horario para localizar el consumo después.'}</p>
    </div>}
    <label>Observación (opcional)<input value={note} maxLength={400} onChange={e=>setNote(e.target.value)} placeholder="Ej. Llevó a la cancha; pendiente de cobro en Bar" /></label>
    <button type="submit" disabled={!shift||!items.length||cannotSubmit||busy||uncertain||(destination==='IMMEDIATE'&&!cliente)}>{busy?'Guardando…':destination==='IMMEDIATE'?'Cobrar '+MONEY(total):'Guardar pendiente '+MONEY(total)}</button>
    {!shift&&<p className="win-bar-warning">Para registrar entregas o cobros debe haber una Caja Bar abierta desde la pestaña Caja Bar.</p>}
    </fieldset>
   </ValidatedForm>
   <p className="win-bar-muted">Para transferencias, verificá el ingreso y compartí la foto del comprobante en el grupo.</p>
  </section>
  </div>
  <section className="win-bar-card">
   <div className="win-bar-row"><div><h3>Consumos pendientes</h3><p className="win-bar-muted">Mercadería entregada y todavía no cobrada; pagar no vuelve a descontar stock.</p></div><strong>{MONEY(pendingSum)}</strong></div>
   <div className="bar-pos-filters">{[['ALL','Todos'],['COURT','Por cancha'],['ACCOUNT','Por persona']].map(([id,label])=><button type="button" key={id} aria-pressed={pendingFilter===id} onClick={()=>setPendingFilter(id)}>{label}</button>)}</div>
   {!visiblePending.length?<p className="win-bar-empty">Sin consumos pendientes en este filtro.</p>:visiblePending.map(p=><div className="bar-pos-pending" key={p.id}><div>
    <strong>{p.destination==='COURT'?p.court+' · '+p.courtDate+' · '+(p.courtStart||'')+(p.holder?' · '+p.holder:''):p.customerName||'Cuenta corriente'}</strong>
    <small>{formatDate(p.date)} · {(p.items||[]).map(i=>i.quantity+'× '+i.name).join(', ')}</small>
    {p.note&&<small>{p.note}</small>}
   </div><div className="bar-pos-pending-amount"><strong>{MONEY(p.balance)}</strong><button type="button" disabled={!shift||busy||uncertain} onClick={()=>chooseSettle(p)}>Cobrar</button></div></div>)}
   {paymentOrder&&<form className="bar-pos-payment" onSubmit={settle}><fieldset disabled={busy||uncertain} style={{border:0,padding:0,minWidth:0}}>
    <div className="win-bar-row"><h3>Cobrar consumo pendiente</h3><button type="button" className="secundario" onClick={()=>setPaymentOrder(null)}>Cerrar</button></div>
    <p className="win-bar-muted">Saldo: {MONEY(paymentOrder.balance)}. Podés cobrar una parte y dejar el resto pendiente.</p>
    <label>Importe que se recibe ($)<MoneyInput inputMode="decimal" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} required/></label>
    <fieldset className="win-bar-methods"><legend>Medio</legend>{payMethods.map(([id,label])=><button key={id} type="button" className={paymentMethod===id?'selected':''} onClick={()=>setPaymentMethod(id)}>{label}</button>)}</fieldset>
    <button disabled={busy||uncertain}>Confirmar cobro</button>
   </fieldset></form>}
  </section>
  {!soloVenta&&<p className="win-bar-warning">Cada entrega descuenta existencias una sola vez. Los cobros usan exclusivamente Caja Bar. El inventario físico y la conciliación histórica se consultan en Stock y precios.</p>}
 </div>
}

