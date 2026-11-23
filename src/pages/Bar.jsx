import { useEffect, useRef, useState } from 'react'
import { callApi } from '../api.js'

const money = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR')
const num = v => { const n = Number(String(v ?? '').trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const METODOS = { CASH: 'Efectivo', TRANSFER: 'Transferencia', CARD: 'Tarjeta' }

// Pestaña única del rol BAR: sólo ventas de Café / Bar. El servidor además rechaza cualquier otra operación.
export default function Bar() {
  const [turno, setTurno] = useState(undefined)
  const [importe, setImporte] = useState('')
  const [metodo, setMetodo] = useState('CASH')
  const [nota, setNota] = useState('')
  const [ventas, setVentas] = useState([])
  const [msg, setMsg] = useState({ texto: '', bueno: false })
  const [ocupado, setOcupado] = useState(false)
  const requestId = useRef(crypto.randomUUID())

  const cargar = () => callApi('cash.state').then(r => setTurno(r.shift || null)).catch(e => setMsg({ texto: e.message, bueno: false }))
  useEffect(() => { cargar() }, [])

  async function vender(e) {
    e.preventDefault()
    if (ocupado || !turno) return
    const monto = num(importe)
    if (!(monto > 0)) { setMsg({ texto: 'Revisá el importe.', bueno: false }); return }
    setOcupado(true); setMsg({ texto: '', bueno: false })
    try {
      // El mismo requestId se reutiliza en los reintentos: el servidor no duplica la venta.
      await callApi('cash.entry', { requestId: requestId.current, shiftId: turno.id, kind: 'SALE', unit: 'CAFE_BAR', method: metodo, amount: monto, note: nota })
      setVentas(v => [{ id: requestId.current, hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }), monto, metodo, nota }, ...v])
      setMsg({ texto: 'Venta registrada.', bueno: true })
      setImporte(''); setNota(''); requestId.current = crypto.randomUUID()
    } catch (err) { setMsg({ texto: err.message, bueno: false }) } finally { setOcupado(false) }
  }

  const total = ventas.reduce((a, v) => a + v.monto, 0)
  return (
    <main className="rec">
      <div className={`rec-msg${msg.bueno ? ' bueno' : ''}`} hidden={!msg.texto} role="status">{msg.texto}</div>
      <section className="tarjeta wide">
        <div className="rec-fila">
          <h2>Bar</h2>
          <button type="button" className="secundario" onClick={cargar}>Actualizar</button>
        </div>
        {turno === undefined && <p className="rec-suave">Cargando…</p>}
        {turno === null && <p className="rec-suave">La caja está cerrada. Pedile a recepción que la abra para registrar ventas.</p>}
        {turno && <p className="rec-suave">Caja abierta · jornada {turno.business_date}</p>}
      </section>
      {turno && (
        <>
          <section className="tarjeta wide">
            <h2>Registrar venta</h2>
            <form onSubmit={vender} className="rec-form">
              <label>Importe ($)<input inputMode="decimal" value={importe} onChange={e => setImporte(e.target.value)} required autoFocus /></label>
              <div className="rec-sel" role="group" aria-label="Medio de cobro">
                {Object.entries(METODOS).map(([k, v]) => <button type="button" key={k} className="secundario" aria-pressed={metodo === k} onClick={() => setMetodo(k)}>{v}</button>)}
              </div>
              <label>Observación (opcional)<input maxLength={400} placeholder="Ej. 2 cafés + medialuna" value={nota} onChange={e => setNota(e.target.value)} /></label>
              <button disabled={ocupado}>{ocupado ? 'Guardando…' : 'Registrar venta'}</button>
            </form>
          </section>
          <section className="tarjeta wide">
            <div className="rec-fila"><h2>Ventas de esta sesión</h2><b>{money(total)}</b></div>
            {ventas.length === 0 && <p className="rec-suave">Todavía no registraste ventas.</p>}
            {ventas.map(v => (
              <div className="rec-item" key={v.id}>
                <div><b>{METODOS[v.metodo]}</b><br /><small>{v.hora}{v.nota ? ' · ' + v.nota : ''}</small></div>
                <b>{money(v.monto)}</b>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  )
}
