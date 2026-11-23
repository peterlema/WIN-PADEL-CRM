import { useEffect, useState } from 'react'
import { callApi } from '../api.js'

const money = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(n)||0)
const units = { COURTS:'Canchas', ACADEMY:'Academia', EVENTS:'Eventos', CAFE_BAR:'Café / Bar', SHOP:'Shop', GENERAL:'General' }
const methods = { CASH:'Efectivo', TRANSFER:'Transferencia', CARD:'Tarjeta', OTHER:'Otro' }

export default function Panel({ user, onLogout }) {
  const [shift, setShift] = useState(null)
  const [opening, setOpening] = useState('')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [kind, setKind] = useState('SALE')
  const [unit, setUnit] = useState('CAFE_BAR')
  const [method, setMethod] = useState('CASH')
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)

  async function refresh() {
    const data=await callApi('cash.state')
    setShift(data.shift)
    setUncertain(false)
  }
  useEffect(() => { refresh().catch(e => setError(e.message)) }, [])
  async function action(type, fields) {
    if (busy || uncertain) return
    setBusy(true);setMessage('');setError('')
    try {
      await callApi(type,fields)
      setMessage('Operación confirmada.')
      await refresh()
    } catch(e) {
      setError(e.message || 'No se pudo confirmar.')
      setUncertain(true)
    } finally { setBusy(false) }
  }
  const validAmount=x=>Number(String(x).replace(',','.'))
  const canClose=shift && (user.role==='ADMIN'||user.id===shift.opened_by)
  return <div className="panel">
    <header className="barra"><strong>WIN Gestión</strong><span className="usuario">{user.name} · {user.role}</span><button onClick={onLogout}>Salir</button></header>
    <main className="contenido">
      <h1>Caja general</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {uncertain && <p className="error">Verificá el estado antes de repetir la operación: podría haberse registrado.</p>}
      <button type="button" onClick={()=>refresh().catch(e=>setError(e.message))}>Consultar estado</button>
      {!shift && <section className="tarjeta" style={{marginTop:18}}>
        <h2>Caja cerrada</h2>
        {user.role!=='BAR' && <form onSubmit={e=>{e.preventDefault();action('cash.open',{amount:validAmount(opening)})}}>
          <label>Efectivo inicial<input inputMode="decimal" value={opening} onChange={e=>setOpening(e.target.value)} required /></label>
          <button disabled={busy||uncertain}>Abrir caja</button>
        </form>}
      </section>}
      {shift && <div className="dashboard">
        <section className="tarjeta wide"><h2>Caja abierta</h2><p>Jornada: {shift.business_date}</p><h3>Efectivo esperado: {money(shift.expected_cash)}</h3></section>
        <section className="tarjeta wide"><h2>Registrar movimiento</h2>
          <form onSubmit={e=>{e.preventDefault();action('cash.entry',{requestId:crypto.randomUUID(),shiftId:shift.id,kind,unit,method,amount:validAmount(amount),note})}}>
            <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value)}>{Object.entries({SALE:'Venta',EXPENSE:'Gasto',WITHDRAWAL:'Retiro',DEPOSIT:'Ingreso adicional'}).filter(([k])=>user.role!=='BAR'||k==='SALE').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            <label>Unidad<select value={unit} onChange={e=>setUnit(e.target.value)}>{Object.entries(units).filter(([k])=>user.role!=='BAR'||k==='CAFE_BAR').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            <label>Medio<select value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(methods).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            <label>Importe<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required /></label>
            <label>Observación<input value={note} maxLength={400} onChange={e=>setNote(e.target.value)} /></label>
            <button disabled={busy||uncertain}>Guardar movimiento</button>
          </form>
        </section>
        {canClose && <section className="tarjeta wide"><h2>Cerrar turno</h2>
          <form onSubmit={e=>{e.preventDefault();if(confirm('¿Cerrar la caja?'))action('cash.close',{shiftId:shift.id,counted:validAmount(counted),note})}}>
            <label>Efectivo contado<input inputMode="decimal" value={counted} onChange={e=>setCounted(e.target.value)} required /></label>
            <label>Observación<input value={note} onChange={e=>setNote(e.target.value)} maxLength={400}/></label>
            <button disabled={busy||uncertain}>Confirmar cierre</button>
          </form>
        </section>}
      </div>}
    </main>
  </div>
}
