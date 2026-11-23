import { useEffect, useRef, useState } from 'react'
import { callApi } from '../api.js'
import StockCatalog from '../components/StockCatalog.jsx'

const money = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR')
const parseAmount = v => {
  const n = Number(String(v ?? '').trim().replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const paymentMethods = { CASH:'Efectivo', TRANSFER:'Transferencia', CARD:'Tarjeta' }
const sections = [
  {id:'sales',label:'Ventas'},
  {id:'stock',label:'Stock'},
  {id:'purchases',label:'Compras'},
  {id:'accounts',label:'Cuentas corrientes'}
]
const planned = {
  stock: {
    title:'Inventario de bebidas',
    description:'Acá vas a consultar existencias, stock mínimo, costos, precios de venta y movimientos por producto.',
    features:['Productos y códigos de barras','Entradas, ventas, consumos y mermas','Alertas de reposición y control por ubicación']
  },
  purchases: {
    title:'Pedidos y proveedores',
    description:'Circuito de compras desde el pedido hasta la recepción de mercadería, sin aumentar stock antes de recibirla.',
    features:['Órdenes de compra y estado','Fecha estimada y recepción real','Costo por unidad e historial del proveedor']
  },
  accounts: {
    title:'Cuenta corriente de socios y clientes',
    description:'Los consumos pendientes deben descontar stock y generar deuda, pero no ingresos de caja hasta su cobro.',
    features:['Cuenta por persona y saldo pendiente','Consumos, pagos parciales y fechas','Autorización de consumos internos y cortesías']
  }
}

export default function Bar() {
  const [tab,setTab] = useState('sales')
  const [shift,setShift] = useState(undefined)
  const [amount,setAmount] = useState('')
  const [method,setMethod] = useState('CASH')
  const [note,setNote] = useState('')
  const [sales,setSales] = useState([])
  const [message,setMessage] = useState({text:'',ok:false})
  const [busy,setBusy] = useState(false)
  const [uncertain,setUncertain] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  async function refresh(){
    try {
      const r=await callApi('cash.state')
      setShift(r.shift||null)
      setUncertain(false)
      setMessage({text:'',ok:false})
    }catch(e){setMessage({text:e.message,ok:false})}
  }
  useEffect(()=>{refresh()},[])
  async function sell(e){
    e.preventDefault()
    if(busy||!shift||uncertain)return
    const value=parseAmount(amount)
    if(!(value>0)){setMessage({text:'Ingresá un importe válido.',ok:false});return}
    setBusy(true);setMessage({text:'',ok:false})
    try{
      await callApi('cash.entry',{requestId:requestId.current,shiftId:shift.id,kind:'SALE',unit:'CAFE_BAR',method,amount:value,note:note.trim()})
      const id=requestId.current
      setSales(previous=>[{id,method,value,note,hour:new Intl.DateTimeFormat('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Buenos_Aires'}).format(new Date())},...previous])
      setMessage({text:'Venta guardada en la caja actual.',ok:true})
      setAmount('');setNote('');requestId.current=crypto.randomUUID()
      try {const current=await callApi('cash.state');setShift(current.shift||null)}
      catch {setUncertain(true);setMessage({text:'La venta se guardó, pero no se pudo actualizar el estado de caja. Verificá antes de continuar.',ok:false})}
    }catch(e){
      setUncertain(true)
      setMessage({text:(e.message||'No se pudo confirmar la venta.')+' Consultá el estado antes de intentar nuevamente.',ok:false})
    }finally{setBusy(false)}
  }
  const total=sales.reduce((sum,x)=>sum+x.value,0)
  const pending=planned[tab]
  return <main className="win-bar">
    <section className="win-bar-header">
      <div><h2>Bar / Buffet</h2><p>Ventas y control de mercadería</p></div>
      <button className="secundario" type="button" onClick={refresh} disabled={busy}>Actualizar caja</button>
    </section>
    <nav className="win-bar-tabs" aria-label="Áreas del Bar">
      {sections.map(s=><button key={s.id} type="button" className={tab===s.id?'current':''} onClick={()=>setTab(s.id)} aria-current={tab===s.id?'page':undefined}>{s.label}</button>)}
    </nav>
    {message.text&&<p role="alert" className={message.ok?'win-bar-message good':'win-bar-message'}>{message.text}</p>}
    {tab==='sales' ? <>
      <section className="win-bar-card">
        <div className="win-bar-row"><div><h3>Venta rápida</h3><p className="win-bar-muted">Registrá importes cobrados en el momento.</p></div>
          <span className="win-bar-status">{shift===undefined?'Consultando caja…':shift?'Caja abierta · '+shift.business_date:'Caja cerrada'}</span>
        </div>
        <p className="win-bar-warning">La carga por producto y el descuento automático de stock aún no están disponibles. Esta venta registra sólo el importe y el concepto.</p>
        {shift===null&&<p>Recepción debe abrir la caja para registrar cobros.</p>}
        {shift&&<form className="win-bar-form" onSubmit={sell}>
          <label>Importe cobrado ($)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0" required /></label>
          <fieldset className="win-bar-methods"><legend>Medio de pago</legend>
            {Object.entries(paymentMethods).map(([key,label])=><button key={key} type="button" aria-pressed={method===key} className={method===key?'selected':''} onClick={()=>setMethod(key)}>{label}</button>)}
          </fieldset>
          <label>Detalle de venta<input maxLength={400} value={note} onChange={e=>setNote(e.target.value)} placeholder="Ej. 2 aguas y una gaseosa" /></label>
          {uncertain&&<p className="win-bar-warning">Resultado de conexión incierto. Tocá «Actualizar caja» antes de volver a registrar.</p>}
          <button type="submit" disabled={busy||uncertain}>{busy?'Guardando…':'Registrar venta'}</button>
        </form>}
      </section>
      <section className="win-bar-card">
        <div className="win-bar-row"><h3>Ventas registradas en esta sesión</h3><strong>{money(total)}</strong></div>
        <p className="win-bar-muted">Este listado es temporal y no reemplaza el historial de Supabase.</p>
        {!sales.length?<p className="win-bar-empty">Todavía no registraste ventas desde esta pantalla.</p>:sales.map(s=><div className="win-bar-sale" key={s.id}><div><strong>{paymentMethods[s.method]}</strong><small>{s.hour}{s.note?' · '+s.note:''}</small></div><b>{money(s.value)}</b></div>)}
      </section>
    </> : tab==='stock' ? <StockCatalog /> : <section className="win-bar-card">
      <div className="win-bar-row"><h3>{pending.title}</h3><span className="win-bar-status">En desarrollo</span></div>
      <p>{pending.description}</p>
      <div className="win-bar-feature-grid">{pending.features.map(x=><div className="win-bar-feature" key={x}><span aria-hidden="true">○</span>{x}</div>)}</div>
      <p className="win-bar-warning">Todavía no se puede cargar información aquí. Primero hay que conectar productos, proveedores y clientes reales en Supabase, con permisos y auditoría.</p>
    </section>}
  </main>
}
