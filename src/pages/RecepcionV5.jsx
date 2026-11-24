import MoneyInput from '../components/MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { callApi } from '../api.js'

const currency = value => formatMoney(value,'Sin definir')
const dateTime = v => v ? new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit'}).format(new Date(v)) : '—'
const actions = [
  {id:'abono',title:'+ Abono',enabled:false,description:'Juego realizado y cobros anticipados, separados para no duplicar ingresos.'},
  {id:'reserva',title:'+ Reserva regular',enabled:false,description:'Reservas efectivamente jugadas, con cobros reales y cortesías.'},
  {id:'clase',title:'+ Clase',enabled:false,description:'Asistencia real, profesor y remuneración; no se carga como dinero recibido.'},
  {id:'rendicion',title:'+ Rendición',enabled:false,description:'Entrega real del profesor, con asignación a clases pendientes.'},
  {id:'evento',title:'+ Evento',enabled:false,description:'Una actividad para todas las canchas usadas, con ingreso real de WIN.'},
  {id:'gasto',title:'+ Gasto',enabled:true,kind:'EXPENSE',unit:'GENERAL',description:'Pago en efectivo desde esta caja.'},
  {id:'retiro',title:'+ Retiro',enabled:true,kind:'WITHDRAWAL',unit:'GENERAL',description:'Entrega de efectivo; no se registra como gasto.'},
  {id:'tienda',title:'+ Tienda',enabled:true,kind:'SALE',unit:'SHOP',description:'Venta simple sin detalle de productos; el stock sigue pendiente.'},
  {id:'otro',title:'+ Otros ingresos',enabled:true,kind:'DEPOSIT',unit:'GENERAL',description:'Cobro real no comprendido en otras categorías.'}
]
const labels = {SALE:'Venta',EXPENSE:'Gasto',WITHDRAWAL:'Retiro',DEPOSIT:'Otros ingresos',REFUND:'Devolución',ADJUSTMENT:'Ajuste',COURTS:'Canchas',ACADEMY:'Academia',EVENTS:'Eventos',CAFE_BAR:'Bar',SHOP:'Tienda',GENERAL:'General',CASH:'Efectivo',TRANSFER:'Transferencia',CARD:'Tarjeta',OTHER:'Otro'}

export default function RecepcionV5({user,onLogout}) {
  const [snapshot,setSnapshot]=useState(null)
  const [status,setStatus]=useState('loading')
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [selected,setSelected]=useState(null)
  const [amount,setAmount]=useState('')
  const [method,setMethod]=useState('CASH')
  const [concept,setConcept]=useState('')
  const [opening,setOpening]=useState('')
  const [counted,setCounted]=useState('')
  const [closeNote,setCloseNote]=useState('')
  const [closing,setClosing]=useState(false)
  const [busy,setBusy]=useState(false)
  const [uncertain,setUncertain]=useState(false)
  const [filter,setFilter]=useState('ALL')
  const [kindFilter,setKindFilter]=useState('ALL')
  const [search,setSearch]=useState('')
  const [details,setDetails]=useState(null)
  const requestId=useRef(crypto.randomUUID())
  const formRef=useRef(null)

  async function refresh() {
    setStatus('loading')
    try {
      const data=await callApi('reception.overview')
      setSnapshot(data)
      setStatus('ready')
      setError('')
      setUncertain(false)
    } catch(e) {
      setError(e.message||'No se pudo consultar el estado de la caja.')
      setStatus('error')
    }
  }
  useEffect(()=>{ refresh() },[])
  const shift=snapshot?.shift
  const totals=snapshot?.totals
  const isOwner=shift?.opened_by===user.id
  const canClose=user.role==='ADMIN'||isOwner
  const available=actions.find(x=>x.id===selected)
  const rows=useMemo(()=>(snapshot?.movements||[]).filter(row=>{
    if(filter!=='ALL'&&row.paymentMethod!==filter)return false
    if(kindFilter!=='ALL'&&row.kind!==kindFilter)return false
    const q=search.trim().toLowerCase()
    return !q||[row.note,row.recordedBy,row.unit,row.kind,row.paymentMethod,labels[row.unit],labels[row.kind]].join(' ').toLowerCase().includes(q)
  }),[snapshot,filter,kindFilter,search])

  function selectAction(item) {
    if(selected===item.id){setSelected(null);return}
    setSelected(item.id)
    setError('');setSuccess('')
    setAmount('');setConcept('')
    setMethod(item.kind==='EXPENSE'||item.kind==='WITHDRAWAL'?'CASH':'CASH')
    requestId.current=crypto.randomUUID()
    setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'}),40)
  }
  const amountValue=parseMoneyInput
  async function perform(action,params,message) {
    if(busy||uncertain)return false
    setBusy(true);setError('');setSuccess('')
    try {
      await callApi(action,params)
      setSuccess(message)
      await refresh()
      return true
    } catch(e) {
      setError(e.message||'No se confirmó la operación. Consultá el estado antes de reintentar.')
      setUncertain(true)
      return false
    } finally {setBusy(false)}
  }
  async function submitMovement(e) {
    e.preventDefault()
    if(!available?.enabled||!shift)return
    const n=amountValue(amount)
    if(!Number.isFinite(n)||n<=0){setError('Indicá un importe positivo.');return}
    if(!concept.trim()){setError('Indicá el concepto o destinatario.');return}
    const ok=await perform('cash.entry',{requestId:requestId.current,shiftId:shift.id,kind:available.kind,unit:available.unit,method,amount:n,note:concept.trim()},'Movimiento registrado correctamente.')
    if(ok){setSelected(null);setAmount('');setConcept('');requestId.current=crypto.randomUUID()}
  }
  async function openShift(e) {
    e.preventDefault()
    const n=amountValue(opening)
    if(!Number.isFinite(n)||n<0){setError('Ingresá el efectivo físico contado al abrir.');return}
    const ok=await perform('cash.open',{amount:n},'Caja abierta.')
    if(ok)setOpening('')
  }
  async function closeShift(e) {
    e.preventDefault()
    const n=amountValue(counted)
    if(!Number.isFinite(n)||n<0){setError('Ingresá el efectivo contado al cerrar.');return}
    if(!window.confirm('¿Confirmás el cierre básico de caja? La conciliación completa de comprobantes todavía está pendiente de implementar.'))return
    const ok=await perform('cash.close',{shiftId:shift.id,counted:n,note:closeNote},'Caja cerrada.')
    if(ok){setClosing(false);setCounted('');setCloseNote('')}
  }
  return <main className="win-reception">
    <div className="win-rec-alerts" aria-live="polite">
      {error&&<div className="win-rec-notice error" role="alert">{error}</div>}
      {success&&<div className="win-rec-notice success" role="status">{success}</div>}
      {uncertain&&<div className="win-rec-notice warning">Hay una operación sin resultado confirmado. Usá Actualizar y comprobá el estado antes de reintentar. La solicitud conserva el mismo identificador para evitar duplicados.</div>}
    </div>

    <section className="win-rec-panel win-rec-shift">
      <div>
        <h2>{shift?'Turno de '+shift.responsible:'Caja sin turno abierto'}</h2>
        <p>{shift?`Caja abierta · ${shift.responsible} · Apertura ${dateTime(shift.opened_at)}`:'No hay caja abierta en este momento.'}</p>
        {shift&&!isOwner&&<p className="win-rec-assist">Estás colaborando en la caja de {shift.responsible}. Tus movimientos se registran con tu usuario.</p>}
      </div>
      <div className="win-rec-toolbar">
        <span className="win-rec-person">{user.name}</span>
        <button className="win-rec-light" type="button" onClick={refresh} disabled={busy||status==='loading'}>{status==='loading'?'Cargando…':'Actualizar'}</button>
        <button className="win-rec-light" type="button" onClick={onLogout}>Salir</button>
      </div>
    </section>


    {status==='loading'&&!snapshot&&<section className="win-rec-panel"><p>Consultando la caja…</p></section>}
    {status==='error'&&!snapshot&&<section className="win-rec-panel"><p>No se pudieron recuperar los datos. Revisá la conexión y volvé a actualizar.</p></section>}

    {status!=='error'&&!shift&&status==='ready'&&<section className="win-rec-panel">
      <h2>Abrir caja</h2>
      <p className="win-rec-muted">Contá el efectivo real antes de abrir. La comparación con el cierre anterior todavía no está implementada en V5.</p>
      <form className="win-rec-form" onSubmit={openShift}>
        <label>Efectivo contado al abrir ($)<MoneyInput inputMode="decimal" value={opening} onChange={e=>setOpening(e.target.value)} required/></label>
        <button disabled={busy||uncertain}>Abrir caja</button>
      </form>
    </section>}

    {shift&&<>
      <section className="win-rec-panel">
        <h2>Caja del turno</h2>
        <div className="win-rec-metrics">
          <button type="button" className="win-rec-metric" onClick={()=>{setFilter('CASH');document.getElementById('win-history')?.scrollIntoView({behavior:'smooth'})}}>
            <span>Efectivo esperado</span><strong>{currency(totals?.cash_expected)}</strong><small>Ver movimientos en efectivo</small>
          </button>
          <button type="button" className="win-rec-metric" onClick={()=>{setFilter('TRANSFER');document.getElementById('win-history')?.scrollIntoView({behavior:'smooth'})}}>
            <span>Transferencias recibidas</span><strong>{currency(totals?.transfer_received)}</strong><small>Ver transferencias</small>
          </button>
          <div className="win-rec-metric"><span>Reservas jugadas</span><strong className="win-rec-novalue">Sin integrar</strong><small>No se confunden con reservas programadas</small></div>
          <div className="win-rec-metric"><span>Clases dictadas</span><strong className="win-rec-novalue">Sin integrar</strong><small>Se completará con Academia</small></div>
        </div>
      </section>

      <section className="win-rec-panel">
        <div className="win-rec-line"><h2>Avisos y pendientes <span className="win-rec-counter">—</span></h2><span className="win-rec-muted">Próxima etapa</span></div>
        <div className="win-rec-switch"><span className="win-rec-active">Pendientes</span><span>Resueltos</span></div>
        <p className="win-rec-muted">La gestión de avisos entre turnos todavía no está conectada. No se muestra un cero que pueda interpretarse como ausencia de pendientes.</p>
      </section>

      <section className="win-rec-panel">
        <h2>Agregar anotación</h2>
        <p className="win-rec-muted">Elegí qué sucedió. Las categorías aún no implementadas no registran movimientos.</p>
        <div className="win-rec-actions">
          {actions.map(item=><button className="win-rec-action" type="button" key={item.id} aria-pressed={selected===item.id} onClick={()=>selectAction(item)}>{item.title}{!item.enabled&&<span className="win-rec-queued">Próximamente</span>}</button>)}
        </div>
        {available&&<div className="win-rec-form-area" ref={formRef}>
          <div className="win-rec-line"><h3>{available.title.replace('+ ','')}</h3><button type="button" className="win-rec-light" onClick={()=>setSelected(null)}>Cerrar</button></div>
          <p className="win-rec-muted">{available.description}</p>
          {!available.enabled?<p className="win-rec-pending">Este formulario no está habilitado porque falta integrar el registro de actividad y su validación en Supabase. No se guardarán datos ficticios.</p>:
          <form className="win-rec-form" onSubmit={submitMovement}>
            <label>Importe ($)<MoneyInput inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0" required/></label>
            {(available.kind==='SALE'||available.kind==='DEPOSIT')&&<label>Medio de pago<select value={method} onChange={e=>setMethod(e.target.value)}><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia</option><option value="CARD">Tarjeta</option></select></label>}
            <label>{available.kind==='WITHDRAWAL'?'Destinatario y motivo':'Concepto'}<input value={concept} onChange={e=>setConcept(e.target.value)} maxLength={400} required placeholder={available.kind==='WITHDRAWAL'?'A quién se entrega el efectivo y por qué':'Describí la operación'}/></label>
            <button type="submit" disabled={busy||uncertain}>{busy?'Guardando…':'Guardar anotación'}</button>
          </form>}
        </div>}
      </section>

      <section className="win-rec-panel" id="win-history">
        <div className="win-rec-line"><h2>Movimientos e historial</h2><small className="win-rec-muted">{snapshot?.movements?.length||0} movimientos visibles</small></div>
        <p className="win-rec-muted">Caja actual · últimos 100 movimientos. El historial de turnos cerrados y las correcciones auditadas se incorporarán por separado.</p>
        <div className="win-rec-filters">
          <label>Tipo<select value={kindFilter} onChange={e=>setKindFilter(e.target.value)}><option value="ALL">Todos</option><option value="SALE">Ventas</option><option value="EXPENSE">Gastos</option><option value="WITHDRAWAL">Retiros</option><option value="DEPOSIT">Otros ingresos</option></select></label>
          <label>Buscar<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Concepto, usuario o categoría"/></label>
        </div>
        <div className="win-rec-switch win-rec-filter-switch">
          {[['ALL','Todos'],['CASH','Efectivo'],['TRANSFER','Transferencia'],['CARD','Tarjeta']].map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}
        </div>
        {!rows.length?<p className="win-rec-empty">No hay movimientos que coincidan con los filtros.</p>:
        <div className="win-rec-movements">{rows.map(r=><button type="button" className="win-rec-movement" key={r.id} onClick={()=>setDetails(details===r.id?null:r.id)}>
          <div><strong>{labels[r.kind]||r.kind} · {labels[r.unit]||r.unit}</strong><small>{dateTime(r.date)} · {labels[r.paymentMethod]||r.paymentMethod} · Cargó {r.recordedBy}</small>{details===r.id&&<p>{r.note||'Sin observación'} · Titular de caja: {r.shiftOwner}</p>}</div>
          <b className={r.amount<0?'negative':''}>{currency(r.amount)}</b>
        </button>)}</div>}
      </section>

      {canClose&&<section className="win-rec-panel">
        <button type="button" className="win-rec-collapse" aria-expanded={closing} onClick={()=>setClosing(v=>!v)}>Cerrar turno <span>{closing?'−':'+'}</span></button>
        {closing&&<>
          <p className="win-rec-pending">Esta es una versión básica del cierre. Falta la conciliación de comprobantes por turno y por jornada definida en el Manual 01.</p>
          <form className="win-rec-form" onSubmit={closeShift}>
            <label>Efectivo contado ($)<MoneyInput inputMode="decimal" required value={counted} onChange={e=>setCounted(e.target.value)}/></label>
            <label>Observación por diferencia<input value={closeNote} onChange={e=>setCloseNote(e.target.value)} maxLength={400}/></label>
            <button disabled={busy||uncertain}>Confirmar cierre básico</button>
          </form>
        </>}
      </section>}
    </>}
  </main>
}
