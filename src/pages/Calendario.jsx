import { useEffect, useMemo, useState } from 'react'
import { callApi, clearToken } from '../api.js'
import { callCourts } from '../courtsApi.js'
import Modal from '../components/Modal.jsx'

// Horario de la grilla (a confirmar con el club): 08:00 a 01:00 de la jornada comercial.
const COURTS = ['C1', 'C2', 'C3', 'C4']
const FIRST = 8 * 60
const LAST = 25 * 60
const STEP = 30
const SLOTS = Array.from({ length: (LAST - FIRST) / STEP }, (_, i) => FIRST + i * STEP)
const CAPACITY = COURTS.length * (LAST - FIRST)
const DURATIONS_FREE = Array.from({ length: 16 }, (_, i) => (i + 1) * STEP)
const KINDS = { RESERVA: 'Reserva', CLASE: 'Clase', EVENTO: 'Evento', BLOQUEO: 'Bloqueo', ABONO: 'Abono' }
const KINDS_NUEVOS = ['RESERVA', 'CLASE', 'EVENTO', 'BLOQUEO']
const duracionesPara = kind => (kind === 'RESERVA' ? [90] : kind === 'CLASE' ? [60, 90, 120] : DURATIONS_FREE)
const METODOS = { CASH: 'Efectivo', TRANSFER: 'Transferencia' }
const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']
const DIAS_LARGOS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

const pad = n => String(n).padStart(2, '0')
const money = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR')
const minToLabel = m => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`
const labelToMin = s => { const [h, m] = s.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + m }
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const monthOf = iso => iso.slice(0, 7)
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` }
const fechaLarga = iso => new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'))
const mesLargo = ym => new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ym + '-01T12:00:00Z'))
const diaSemana = iso => { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d }

// Achica la foto del comprobante (máx. 1600 px, JPEG) para subir rápido desde el celular.
async function comprimir(file) {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82))
    return blob || file
  } catch { return file }
}

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
  const [accion, setAccion] = useState('')          // '', 'cancelar', 'saltear', 'baja'
  const [pago, setPago] = useState(null)            // formulario de cobro del detalle
  const [receptores, setReceptores] = useState(null)
  const [horarios, setHorarios] = useState(null)    // ventana de horarios de recepción
  const [nuevoHorario, setNuevoHorario] = useState({ accountId: '', weekday: 1, from: '09:00', to: '17:00' })
  const [ocupado, setOcupado] = useState(false)
  const hoy = hoyAR()

  function falla(e) {
    if (e.status === 401) clearToken()
    setError(e.message || 'No se pudo completar la operación.')
  }

  useEffect(() => { callApi('me').then(r => setUser(r.user)).catch(falla) }, [])

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
  const esAdmin = user?.role === 'ADMIN'
  const puedeCancelar = b => Boolean(user) && (['ADMIN', 'MANAGER'].includes(user.role) || b.creadoPorId === user.id)
  const precio = dia?.precio || { efectivo: 90000, transferencia: 100000 }
  const modalAbierto = Boolean(form || detalle || horarios)

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

  function irAFecha(iso) { setFecha(iso); setMes(monthOf(iso)); cerrarTodo(); setAviso(''); setError('') }
  function cerrarTodo() { setForm(null); setDetalle(null); setAccion(''); setMotivo(''); setPago(null); setHorarios(null) }

  function abrirForm(court, minutos) {
    cerrarTodo(); setAviso(''); setError('')
    setForm({ court, start: minToLabel(minutos), duration: 90, kind: 'RESERVA', holder: '', note: '', nombre: '', whatsapp: '', method: 'CASH', abono: false, requestId: crypto.randomUUID() })
  }
  function cambiarTipo(kind) {
    setForm(f => {
      const permitidas = duracionesPara(kind)
      return { ...f, kind, abono: kind === 'RESERVA' ? f.abono : false, duration: permitidas.includes(Number(f.duration)) ? f.duration : permitidas[0] }
    })
  }

  async function reservar(e) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true); setError(''); setAviso('')
    try {
      // El mismo requestId se reutiliza si hay que reintentar: el servidor no duplica la reserva.
      if (form.kind === 'RESERVA' && form.abono) {
        await callCourts('courts.abono.create', { requestId: form.requestId, court: form.court, date: fecha, start: form.start,
          customerName: form.nombre, whatsapp: form.whatsapp, method: form.method, note: form.note })
        setAviso(`Abono fijo creado: ${form.court} los ${DIAS_LARGOS[diaSemana(fecha)].toLowerCase()} a las ${form.start}, desde hoy hasta que se dé de baja.`)
      } else {
        await callCourts('courts.book', { requestId: form.requestId, court: form.court, date: fecha, start: form.start,
          duration: Number(form.duration), kind: form.kind, holder: form.holder, note: form.note,
          customerName: form.nombre, whatsapp: form.whatsapp, method: form.method })
        setAviso(`Reserva confirmada: ${form.court} a las ${form.start}.`)
      }
      setForm(null)
      setRefresco(v => v + 1)
    } catch (err) {
      falla(err)
      if (['COURT_TAKEN', 'ABONO_CONFLICT'].includes(err.code)) setRefresco(v => v + 1)
      if (err.code === 'REQUEST_ID_REUSED') setForm(f => ({ ...f, requestId: crypto.randomUUID() }))
    } finally { setOcupado(false) }
  }

  async function abrirDetalle(b) {
    cerrarTodo(); setAviso(''); setError('')
    setDetalle(b)
    if (['RESERVA', 'ABONO'].includes(b.tipo) && !b.pago && puedeReservar) {
      setPago({ method: b.metodoPrevisto || 'CASH', receivedBy: '', file: null, preview: '', requestId: crypto.randomUUID() })
      try { const r = await callCourts('courts.receivers'); setReceptores(r); setPago(p => p && ({ ...p, receivedBy: (r.deTurno || [])[0] || user?.id || '' })) } catch { /* se puede cobrar igual */ }
    }
  }

  function elegirFoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!/^image\//.test(file.type)) { setError('Subí una foto (JPG, PNG o WEBP).'); return }
    setError('')
    setPago(p => ({ ...p, file, preview: URL.createObjectURL(file) }))
  }

  async function cobrar(e) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true); setError(''); setAviso('')
    try {
      let receiptPath = null
      if (pago.method === 'TRANSFER' && pago.file) {
        const blob = await comprimir(pago.file)
        const up = await callCourts('courts.receipt.url', { contentType: blob.type || 'image/jpeg' })
        const put = await fetch(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'false' }, body: blob })
        if (!put.ok) throw new Error('No se pudo subir la foto del comprobante. Probá de nuevo.')
        receiptPath = up.path
      }
      await callCourts('courts.pay', {
        requestId: pago.requestId, bookingId: detalle.tipo === 'ABONO' ? null : detalle.id, abonoId: detalle.tipo === 'ABONO' ? detalle.abonoId : null,
        date: detalle.tipo === 'ABONO' ? fecha : null, method: pago.method,
        receivedBy: pago.method === 'CASH' ? pago.receivedBy || null : null, receiptPath })
      setAviso(`Cobro registrado: ${detalle.titular} · ${METODOS[pago.method]} ${money(pago.method === 'CASH' ? precio.efectivo : precio.transferencia)}.`)
      cerrarTodo(); setRefresco(v => v + 1)
    } catch (err) {
      falla(err)
      if (['ALREADY_PAID', 'BOOKING_NOT_FOUND'].includes(err.code)) setRefresco(v => v + 1)
    } finally { setOcupado(false) }
  }

  async function verComprobante(ruta) {
    try { const r = await callCourts('courts.receipt.view', { path: ruta }); window.open(r.url, '_blank', 'noopener') } catch (err) { falla(err) }
  }

  async function confirmarAccion() {
    if (ocupado) return
    if (!motivo.trim()) { setError('Indicá el motivo.'); return }
    setOcupado(true); setError(''); setAviso('')
    try {
      if (accion === 'cancelar') await callCourts('courts.cancel', { bookingId: detalle.id, reason: motivo })
      if (accion === 'saltear') await callCourts('courts.abono.skip', { abonoId: detalle.abonoId, date: fecha, reason: motivo })
      if (accion === 'baja') await callCourts('courts.abono.end', { abonoId: detalle.abonoId, from: fecha, reason: motivo })
      setAviso(accion === 'cancelar' ? `Reserva cancelada: ${detalle.cancha} a las ${detalle.inicio}.`
        : accion === 'saltear' ? `Se salteó el abono de ${detalle.titular} el ${fechaLarga(fecha)}.` : `Abono de ${detalle.titular} dado de baja desde el ${fechaLarga(fecha)}.`)
      cerrarTodo(); setRefresco(v => v + 1)
    } catch (err) {
      falla(err)
      if (['BOOKING_NOT_FOUND', 'BOOKING_PAID'].includes(err.code)) setRefresco(v => v + 1)
    } finally { setOcupado(false) }
  }

  async function abrirHorarios() {
    cerrarTodo(); setError('')
    try {
      const [h, r] = await Promise.all([callCourts('courts.schedule.list'), callCourts('courts.receivers')])
      setReceptores(r); setHorarios(h); setNuevoHorario(n => ({ ...n, accountId: r.personas[0]?.id || '' }))
    } catch (err) { falla(err) }
  }
  async function guardarHorario(e) {
    e.preventDefault()
    try {
      await callCourts('courts.schedule.set', nuevoHorario)
      setHorarios(await callCourts('courts.schedule.list'))
    } catch (err) { falla(err) }
  }
  async function borrarHorario(id) {
    try { await callCourts('courts.schedule.delete', { id }); setHorarios(await callCourts('courts.schedule.list')) } catch (err) { falla(err) }
  }

  // Calendario del mes
  const [y, m] = mes.split('-').map(Number)
  const diasDelMes = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const desfase = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const celdasMes = [...Array(desfase).fill(null), ...Array.from({ length: diasDelMes }, (_, i) => i + 1)]
  const errorEnVentana = error && modalAbierto ? <p className="error" role="alert">{error}</p> : null

  return (
    <main className="cal">
      <div className="cal-fila">
        <h1>Calendario de canchas</h1>
        {esAdmin && <button type="button" className="secundario" onClick={abrirHorarios}>Horarios de recepción</button>}
      </div>
      {error && !modalAbierto && <p className="error" role="alert">{error}</p>}
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
            {` · Turno de 90 min: ${money(precio.efectivo)} efectivo · ${money(precio.transferencia)} transferencia`}
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
                          <td key={c} rowSpan={cel.n} className={`ocupada ${b.tipo}${b.pago ? ' cobrada' : ''}`}>
                            <button type="button" className="reserva" onClick={() => abrirDetalle(b)}>
                              <strong>{b.pago ? '✓ ' : ''}{b.titular}</strong>
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
        </section>
      </div>

      {form && (
        <Modal titulo={`Nueva reserva · ${fechaLarga(fecha)}`} onCerrar={() => setForm(null)}>
          {errorEnVentana}
          <form className="cal-form" onSubmit={reservar}>
            <label>Cancha
              <select value={form.court} onChange={e => setForm({ ...form, court: e.target.value })}>{COURTS.map(c => <option key={c}>{c}</option>)}</select>
            </label>
            <label>Inicio
              <select value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}>{SLOTS.map(s => <option key={s}>{minToLabel(s)}</option>)}</select>
            </label>
            <label>Tipo
              <select value={form.kind} onChange={e => cambiarTipo(e.target.value)}>{KINDS_NUEVOS.map(k => <option key={k} value={k}>{KINDS[k]}</option>)}</select>
            </label>
            <label>Duración
              <select value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })}>
                {duracionesPara(form.kind).map(d => <option key={d} value={d}>{d} min</option>)}
              </select>
            </label>
            {form.kind === 'RESERVA' ? (
              <>
                <label className="cal-ancho">Nombre completo
                  <input value={form.nombre} maxLength={120} required autoFocus autoComplete="off" placeholder="Nombre y apellido" onChange={e => setForm({ ...form, nombre: e.target.value })} />
                </label>
                <label>WhatsApp
                  <input type="tel" inputMode="tel" value={form.whatsapp} maxLength={20} required placeholder="Ej. 11 5555 1234" onChange={e => setForm({ ...form, whatsapp: e.target.value })} />
                </label>
                <div className="cal-ancho">
                  <span className="cal-etiqueta">Método de pago</span>
                  <div className="rec-sel" role="group" aria-label="Método de pago">
                    {Object.entries(METODOS).map(([k, v]) => (
                      <button type="button" key={k} className="secundario" aria-pressed={form.method === k} onClick={() => setForm({ ...form, method: k })}>
                        {v} · {money(k === 'CASH' ? precio.efectivo : precio.transferencia)}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="cal-check cal-ancho">
                  <input type="checkbox" checked={form.abono} onChange={e => setForm({ ...form, abono: e.target.checked })} />
                  Abono fijo: se repite todos los {DIAS_LARGOS[diaSemana(fecha)].toLowerCase()} a esta hora, hasta que se dé de baja
                </label>
              </>
            ) : (
              <label className="cal-ancho">Titular / detalle
                <input value={form.holder} maxLength={120} required autoFocus onChange={e => setForm({ ...form, holder: e.target.value })} />
              </label>
            )}
            <label className="cal-ancho">Observación
              <input value={form.note} maxLength={400} onChange={e => setForm({ ...form, note: e.target.value })} />
            </label>
            <div className="cal-acciones">
              <button disabled={ocupado}>{ocupado ? 'Guardando…' : form.abono ? 'Crear abono fijo' : 'Confirmar reserva'}</button>
              <button type="button" className="secundario" onClick={() => setForm(null)}>Cerrar</button>
            </div>
          </form>
        </Modal>
      )}

      {detalle && (
        <Modal titulo={`${KINDS[detalle.tipo]} · ${detalle.cancha}`} onCerrar={cerrarTodo}>
          {errorEnVentana}
          <div className="cal-form">
            <p><b>{detalle.titular}</b> · {fechaLarga(fecha)} · {detalle.inicio}–{detalle.fin} ({detalle.duracion} min)</p>
            {detalle.whatsapp && <p>WhatsApp: <a href={`https://wa.me/${detalle.whatsapp}`} target="_blank" rel="noopener noreferrer">{detalle.whatsapp}</a></p>}
            {detalle.tipo === 'ABONO' && <p className="cal-resumen">Abono fijo semanal desde el {detalle.desde}. Se repite hasta que se dé de baja.</p>}
            {detalle.nota && <p>Observación: {detalle.nota}</p>}
            {detalle.creadoPor && <p className="cal-resumen">Cargó: {detalle.creadoPor}</p>}

            {['RESERVA', 'ABONO'].includes(detalle.tipo) && (
              <p className="cal-ancho"><b>Cobro:</b>{' '}
                {detalle.pago
                  ? <>Cobrado en {METODOS[detalle.pago.metodo].toLowerCase()} · {money(detalle.pago.monto)}{detalle.pago.recibioNombre ? ` · recibió ${detalle.pago.recibioNombre}` : ''}
                    {detalle.pago.ruta && <> · <button type="button" className="enlace" onClick={() => verComprobante(detalle.pago.ruta)}>Ver comprobante</button></>}</>
                  : <>Pendiente · previsto {METODOS[detalle.metodoPrevisto]} {money(detalle.montoPrevisto)}</>}
              </p>
            )}

            {pago && !detalle.pago && accion === '' && (
              <form className="cal-ancho cal-pago" onSubmit={cobrar}>
                <h3>Registrar cobro del turno</h3>
                <div className="rec-sel" role="group" aria-label="Método de pago real">
                  {Object.entries(METODOS).map(([k, v]) => (
                    <button type="button" key={k} className="secundario" aria-pressed={pago.method === k} onClick={() => setPago({ ...pago, method: k })}>
                      {v} · {money(k === 'CASH' ? precio.efectivo : precio.transferencia)}
                    </button>
                  ))}
                </div>
                {pago.method === 'CASH' && (
                  <label>¿Quién recibió el efectivo?
                    <select value={pago.receivedBy} onChange={e => setPago({ ...pago, receivedBy: e.target.value })} required>
                      {(receptores?.personas || []).map(p => <option key={p.id} value={p.id}>{p.nombre}{p.deTurno ? ' · de turno' : ''}</option>)}
                      {!receptores && <option value={user?.id}>{user?.name}</option>}
                    </select>
                  </label>
                )}
                {pago.method === 'TRANSFER' && (
                  <div>
                    <span className="cal-etiqueta">¿Te mandaron comprobante? Subí la foto (opcional)</span>
                    <input type="file" accept="image/*" onChange={elegirFoto} />
                    {pago.preview && <img className="cal-foto" src={pago.preview} alt="Vista previa del comprobante" />}
                  </div>
                )}
                <button disabled={ocupado}>{ocupado ? 'Guardando…' : `Marcar cobrado ${money(pago.method === 'CASH' ? precio.efectivo : precio.transferencia)}`}</button>
              </form>
            )}

            {accion !== '' && (
              <div className="cal-ancho cal-pago">
                <label>{accion === 'baja' ? 'Motivo de la baja (el abono deja de aparecer desde esta fecha)' : accion === 'saltear' ? 'Motivo (sólo se saltea esta fecha)' : 'Motivo de la cancelación'}
                  <input value={motivo} maxLength={400} autoFocus onChange={e => setMotivo(e.target.value)} />
                </label>
                <div className="cal-acciones">
                  <button type="button" className="peligro" disabled={ocupado} onClick={confirmarAccion}>{ocupado ? 'Guardando…' : 'Confirmar'}</button>
                  <button type="button" className="secundario" onClick={() => { setAccion(''); setMotivo(''); setError('') }}>Volver</button>
                </div>
              </div>
            )}

            {accion === '' && (
              <div className="cal-acciones">
                {detalle.tipo === 'ABONO' && puedeCancelar(detalle) && !detalle.pago && <button type="button" className="secundario" onClick={() => setAccion('saltear')}>Saltear este día</button>}
                {detalle.tipo === 'ABONO' && puedeCancelar(detalle) && <button type="button" className="peligro" onClick={() => setAccion('baja')}>Dar de baja el abono</button>}
                {detalle.tipo !== 'ABONO' && puedeCancelar(detalle) && !detalle.pago && <button type="button" className="peligro" onClick={() => setAccion('cancelar')}>Cancelar reserva</button>}
                <button type="button" className="secundario" onClick={cerrarTodo}>Cerrar</button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {horarios && (
        <Modal titulo="Horarios de quien recibe el efectivo" onCerrar={() => setHorarios(null)}>
          {errorEnVentana}
          <p className="cal-resumen">Al cobrar en efectivo se sugiere a la persona que está de turno en ese día y horario. Si el horario termina antes de empezar (ej. 22:00 a 02:00) cruza la medianoche.</p>
          <div className="cal-horarios">
            {horarios.length === 0 && <p className="cal-resumen">Todavía no hay horarios cargados: se sugiere a quien registra el cobro.</p>}
            {horarios.map(h => (
              <div className="cal-horario" key={h.id}>
                <span>{DIAS_LARGOS[h.diaSemana]}</span><span>{h.desde}–{h.hasta}</span><b>{h.nombre}</b>
                <button type="button" className="secundario" onClick={() => borrarHorario(h.id)} aria-label={`Quitar horario de ${h.nombre} el ${DIAS_LARGOS[h.diaSemana]}`}>Quitar</button>
              </div>
            ))}
          </div>
          <form className="cal-form" onSubmit={guardarHorario}>
            <label>Persona
              <select value={nuevoHorario.accountId} onChange={e => setNuevoHorario({ ...nuevoHorario, accountId: e.target.value })} required>
                {(receptores?.personas || []).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label>Día
              <select value={nuevoHorario.weekday} onChange={e => setNuevoHorario({ ...nuevoHorario, weekday: Number(e.target.value) })}>
                {DIAS_LARGOS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </label>
            <label>Desde<input type="time" value={nuevoHorario.from} onChange={e => setNuevoHorario({ ...nuevoHorario, from: e.target.value })} required /></label>
            <label>Hasta<input type="time" value={nuevoHorario.to} onChange={e => setNuevoHorario({ ...nuevoHorario, to: e.target.value })} required /></label>
            <div className="cal-acciones"><button>Agregar horario</button><button type="button" className="secundario" onClick={() => setHorarios(null)}>Cerrar</button></div>
          </form>
        </Modal>
      )}
    </main>
  )
}
