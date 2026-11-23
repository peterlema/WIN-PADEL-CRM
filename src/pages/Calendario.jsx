import { useEffect, useMemo, useState } from 'react'
import { callApi, clearToken } from '../api.js'
import { callCourts } from '../courtsApi.js'

// Horario de la grilla (a confirmar con el club): 08:00 a 01:00 de la jornada comercial.
const COURTS = ['C1', 'C2', 'C3', 'C4']
const FIRST = 8 * 60
const LAST = 25 * 60
const STEP = 30
const SLOTS = Array.from({ length: (LAST - FIRST) / STEP }, (_, i) => FIRST + i * STEP)
const CAPACITY = COURTS.length * (LAST - FIRST)
const DURATIONS_FREE = Array.from({ length: 16 }, (_, i) => (i + 1) * STEP)
const KINDS = { RESERVA: 'Reserva', CLASE: 'Clase', EVENTO: 'Evento', BLOQUEO: 'Bloqueo' }
const duracionesPara = kind => (kind === 'RESERVA' ? [90] : kind === 'CLASE' ? [60, 90, 120] : DURATIONS_FREE)
const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']

const pad = n => String(n).padStart(2, '0')
const minToLabel = m => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`
const labelToMin = s => { const [h, m] = s.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + m }
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const monthOf = iso => iso.slice(0, 7)
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` }
const fechaLarga = iso => new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'))
const mesLargo = ym => new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ym + '-01T12:00:00Z'))

export default function Calendario() {
  const [user, setUser] = useState(null)
  const [fecha, setFecha] = useState(hoyAR())
  const [mes, setMes] = useState(monthOf(hoyAR()))
  const [dia, setDia] = useState(null)
  const [resumen, setResumen] = useState({})
  const [refresco, setRefresco] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [form, setForm] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const hoy = hoyAR()

  function falla(e) {
    if (e.status === 401) clearToken()
    setError(e.message || 'No se pudo completar la operación.')
  }

  useEffect(() => {
    callApi('me').then(r => setUser(r.user)).catch(falla)
  }, [])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    callCourts('courts.day', { date: fecha })
      .then(r => { if (vivo) setDia(r) })
      .catch(e => vivo && falla(e))
      .finally(() => vivo && setCargando(false))
    return () => { vivo = false }
  }, [fecha, refresco])

  useEffect(() => {
    let vivo = true
    callCourts('courts.month', { month: mes })
      .then(r => vivo && setResumen(r.dias || {}))
      .catch(e => vivo && falla(e))
    return () => { vivo = false }
  }, [mes, refresco])

  const puedeReservar = Boolean(user) && user.role !== 'BAR'
  const puedeCancelar = b => Boolean(user) && (['ADMIN', 'MANAGER'].includes(user.role) || b.creadoPorId === user.id)

  const { celdas, fuera, minutosDia } = useMemo(() => {
    const celdas = COURTS.map(() => Array(SLOTS.length).fill(null))
    const fuera = []
    let minutosDia = 0
    for (const b of dia?.reservas || []) {
      minutosDia += b.duracion
      const c = COURTS.indexOf(b.cancha)
      let s = (labelToMin(b.inicio) - FIRST) / STEP
      let n = b.duracion / STEP
      if (s < 0) { n += s; s = 0 }
      if (c < 0 || n <= 0 || s >= SLOTS.length) { fuera.push(b); continue }
      n = Math.min(n, SLOTS.length - s)
      celdas[c][s] = { b, n }
      for (let i = 1; i < n; i++) celdas[c][s + i] = 'x'
    }
    return { celdas, fuera, minutosDia }
  }, [dia])

  function irAFecha(iso) { setFecha(iso); setMes(monthOf(iso)); setForm(null); setDetalle(null); setAviso(''); setError('') }

  function abrirForm(court, minutos) {
    setDetalle(null); setAviso(''); setError('')
    setForm({ court, start: minToLabel(minutos), duration: 90, kind: 'RESERVA', holder: '', note: '', requestId: crypto.randomUUID() })
  }
  function cambiarTipo(kind) {
    setForm(f => {
      const permitidas = duracionesPara(kind)
      return { ...f, kind, duration: permitidas.includes(Number(f.duration)) ? f.duration : permitidas[0] }
    })
  }

  async function reservar(e) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true); setError(''); setAviso('')
    try {
      // El mismo requestId se reutiliza si hay que reintentar: el servidor no duplica la reserva.
      await callCourts('courts.book', {
        requestId: form.requestId, court: form.court, date: fecha, start: form.start,
        duration: Number(form.duration), kind: form.kind, holder: form.holder, note: form.note,
      })
      setAviso(`Reserva confirmada: ${form.court} a las ${form.start}.`)
      setForm(null)
      setRefresco(v => v + 1)
    } catch (err) {
      falla(err)
      if (err.code === 'COURT_TAKEN') setRefresco(v => v + 1)
      if (err.code === 'REQUEST_ID_REUSED') setForm(f => ({ ...f, requestId: crypto.randomUUID() }))
    } finally { setOcupado(false) }
  }

  async function cancelar() {
    if (ocupado) return
    if (!motivo.trim()) { setError('Indicá el motivo de la cancelación.'); return }
    setOcupado(true); setError(''); setAviso('')
    try {
      await callCourts('courts.cancel', { bookingId: detalle.id, reason: motivo })
      setAviso(`Reserva cancelada: ${detalle.cancha} a las ${detalle.inicio}.`)
      setDetalle(null); setMotivo('')
      setRefresco(v => v + 1)
    } catch (err) {
      falla(err)
      if (err.code === 'BOOKING_NOT_FOUND') setRefresco(v => v + 1)
    } finally { setOcupado(false) }
  }

  // Calendario del mes
  const [y, m] = mes.split('-').map(Number)
  const diasDelMes = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const desfase = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const celdasMes = [...Array(desfase).fill(null), ...Array.from({ length: diasDelMes }, (_, i) => i + 1)]

  return (
    <main className="cal">
      <h1>Calendario de canchas</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {aviso && <p className="aviso" role="status">{aviso}</p>}

      <div className="cal-layout">
        <section className="tarjeta wide cal-mes" aria-label="Calendario del mes">
          <div className="cal-nav">
            <button type="button" onClick={() => setMes(addMonths(mes, -1))} aria-label="Mes anterior">‹</button>
            <strong className="cal-titulo">{mesLargo(mes)}</strong>
            <button type="button" onClick={() => setMes(addMonths(mes, 1))} aria-label="Mes siguiente">›</button>
          </div>
          <div className="cal-grilla-mes">
            {DIAS.map(d => <span key={d} className="cal-dow">{d}</span>)}
            {celdasMes.map((d, i) => {
              if (!d) return <span key={'v' + i} />
              const iso = `${mes}-${pad(d)}`
              const info = resumen[iso]
              const pct = info ? info.minutos / CAPACITY : 0
              const nivel = !info ? 0 : pct < 0.35 ? 1 : pct < 0.7 ? 2 : 3
              return (
                <button key={iso} type="button"
                  className={`cal-dia-mes nivel${nivel}${iso === fecha ? ' sel' : ''}${iso === hoy ? ' hoy' : ''}`}
                  onClick={() => irAFecha(iso)}
                  aria-label={`${fechaLarga(iso)}: ${info ? `${info.reservas} reservas, ${Math.round(pct * 100)}% ocupado` : 'libre'}`}
                  aria-pressed={iso === fecha}>
                  <b>{d}</b>
                  <small>{info ? `${info.reservas} res.` : 'Libre'}</small>
                </button>
              )
            })}
          </div>
          <div className="cal-leyenda" aria-hidden="true">
            <span><i className="nivel0" />Libre</span><span><i className="nivel1" />Poco</span>
            <span><i className="nivel2" />Medio</span><span><i className="nivel3" />Muy ocupado</span>
          </div>
        </section>

        <section className="tarjeta wide cal-dia-panel" aria-label="Disponibilidad del día">
          <div className="cal-nav">
            <button type="button" onClick={() => irAFecha(addDays(fecha, -1))} aria-label="Día anterior">‹</button>
            <strong className="cal-titulo">{fechaLarga(fecha)}</strong>
            <button type="button" onClick={() => irAFecha(addDays(fecha, 1))} aria-label="Día siguiente">›</button>
            {fecha !== hoy && <button type="button" className="secundario" onClick={() => irAFecha(hoy)}>Hoy</button>}
          </div>
          <p className="cal-resumen">
            {cargando ? 'Cargando…' : `${dia?.reservas?.length || 0} reservas · ${Math.round((minutosDia / CAPACITY) * 100)}% ocupado`}
            {!puedeReservar && user && ' · Sólo lectura'}
          </p>

          <div className="cal-scroll">
            <table className="cal-dia">
              <colgroup><col className="col-hora" />{COURTS.map(c => <col key={c} className="col-cancha" />)}</colgroup>
              <thead><tr><th scope="col">Hora</th>{COURTS.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {SLOTS.map((min, i) => (
                  <tr key={min} className={min % 60 === 0 ? 'hora-entera' : ''}>
                    <th scope="row" className="hora">{minToLabel(min)}</th>
                    {COURTS.map((c, ci) => {
                      const cel = celdas[ci][i]
                      if (cel === 'x') return null
                      if (cel) {
                        const b = cel.b
                        return (
                          <td key={c} rowSpan={cel.n} className={`ocupada ${b.tipo}`}>
                            <button type="button" className="reserva" onClick={() => { setForm(null); setAviso(''); setError(''); setMotivo(''); setDetalle(b) }}>
                              <strong>{b.titular}</strong>
                              <span>{KINDS[b.tipo]} · {b.inicio}–{b.fin}</span>
                            </button>
                          </td>
                        )
                      }
                      return (
                        <td key={c} className="libre">
                          {puedeReservar && <button type="button" className="slot" aria-label={`Reservar ${c} ${minToLabel(min)}`} onClick={() => abrirForm(c, min)}>+</button>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fuera.length > 0 && (
            <p className="cal-fuera">Fuera de la grilla ({minToLabel(FIRST)}–{minToLabel(LAST)}): {fuera.map(b => `${b.cancha} ${b.inicio} ${b.titular}`).join(' · ')}</p>
          )}

          {form && (
            <form className="cal-form" onSubmit={reservar}>
              <h2>Nueva reserva · {fechaLarga(fecha)}</h2>
              <label>Cancha
                <select value={form.court} onChange={e => setForm({ ...form, court: e.target.value })}>{COURTS.map(c => <option key={c}>{c}</option>)}</select>
              </label>
              <label>Inicio
                <select value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}>{SLOTS.map(s => <option key={s}>{minToLabel(s)}</option>)}</select>
              </label>
              <label>Tipo
                <select value={form.kind} onChange={e => cambiarTipo(e.target.value)}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label>Duración
                <select value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })}>
                  {duracionesPara(form.kind).map(d => <option key={d} value={d}>{d} min</option>)}
                </select>
              </label>
              <label>Titular
                <input value={form.holder} maxLength={120} required autoFocus onChange={e => setForm({ ...form, holder: e.target.value })} />
              </label>
              <label>Observación
                <input value={form.note} maxLength={400} onChange={e => setForm({ ...form, note: e.target.value })} />
              </label>
              <div className="cal-acciones">
                <button disabled={ocupado}>{ocupado ? 'Guardando…' : 'Confirmar reserva'}</button>
                <button type="button" className="secundario" onClick={() => setForm(null)}>Cerrar</button>
              </div>
            </form>
          )}

          {detalle && (
            <div className="cal-form">
              <h2>{KINDS[detalle.tipo]} · {detalle.cancha}</h2>
              <p>{detalle.titular} · {detalle.inicio}–{detalle.fin} ({detalle.duracion} min)</p>
              {detalle.nota && <p>Observación: {detalle.nota}</p>}
              {detalle.creadoPor && <p className="cal-resumen">Cargó: {detalle.creadoPor}</p>}
              {puedeCancelar(detalle) && (
                <>
                  <label>Motivo de la cancelación
                    <input value={motivo} maxLength={400} onChange={e => setMotivo(e.target.value)} />
                  </label>
                  <div className="cal-acciones">
                    <button type="button" className="peligro" disabled={ocupado} onClick={cancelar}>{ocupado ? 'Cancelando…' : 'Cancelar reserva'}</button>
                    <button type="button" className="secundario" onClick={() => setDetalle(null)}>Cerrar</button>
                  </div>
                </>
              )}
              {!puedeCancelar(detalle) && <div className="cal-acciones"><button type="button" className="secundario" onClick={() => setDetalle(null)}>Cerrar</button></div>}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
