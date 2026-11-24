import MoneyInput from '../components/MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import { useEffect, useMemo, useState } from 'react'
import { callRecepcion } from '../recepcionApi.js'

const pad = n => String(n).padStart(2, '0')
const money = value => formatMoney(value,'Sin definir')
const num=value=>parseMoneyInput(value,{empty:0})
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const HORAS = Array.from({ length: 24 }, (_, i) => pad(i))
const MINUTOS = Array.from({ length: 60 }, (_, i) => pad(i))
const CANCHAS = ['C1', 'C2', 'C3', 'C4']
const TIPOS = [
  { k: 'abono', label: '+ Abono', tipo: 'Reserva', cat: 'Abonos' },
  { k: 'regular', label: '+ Reserva regular', tipo: 'Reserva', cat: 'Regulares' },
  { k: 'clase', label: '+ Clase', tipo: 'Clase' },
  { k: 'rendicion', label: '+ Rendición', tipo: 'Rendicion' },
  { k: 'evento', label: '+ Evento', tipo: 'Evento' },
  { k: 'gasto', label: '+ Gasto', tipo: 'Gasto' },
  { k: 'retiro', label: '+ Retiro', tipo: 'Retiro' },
  { k: 'tienda', label: '+ Tienda', tipo: 'Tienda' },
  { k: 'otro', label: '+ Otros ingresos', tipo: 'Otro ingreso' },
]
const FILTROS_TIPO = [['', 'Todos'], ['Regulares', 'Reserva regular'], ['Abonos', 'Abono'], ['Clase', 'Clase'], ['Rendicion', 'Rendición'], ['Evento', 'Evento'], ['Tienda', 'Tienda'], ['Gasto', 'Gasto'], ['Retiro', 'Retiro'], ['Otro ingreso', 'Otro ingreso']]

const formVacio = (user) => ({
  fecha: hoyAR(), nota: '', canchas: [], hora: '', minuto: '00', duracion: 60, diaSiguiente: false, jugado: true,
  efectivo: '', transferencia: '', alumnos: 2, profesor: '', tipoClase: 'Tradicional', excepcion: false, cobrado: '', remuneracion: '',
  motivoExcepcion: '', incidencia: '', importeWIN: '', cantidad: 1, tipoEvento: 'Cancha abierta', responsableEvento: user?.name || '',
  finHora: '', finMinuto: '00', categoria: '', subcategoria: '', importe: '', concepto: '', destinatario: '',
})

function titulo(x) {
  const a = x.actividad
  const lugar = a ? `${a.canchas.join('+')} ${a.hora}–${a.fin}` : ''
  if (x.tipo === 'Reserva') return x.soloCobro ? 'Abono · Pago anticipado' : `${x.categoria === 'Abonos' ? 'Abono' : 'Reserva regular'} · ${lugar}`
  if (x.tipo === 'Clase') return `Clase · ${x.profesor} · ${x.alumnos || '—'} alumnos · ${lugar}`
  if (x.tipo === 'Evento') return `${x.categoria} · ${x.cantidad} inscriptos · ${x.concepto} · ${lugar}`
  if (x.tipo === 'Gasto') return `Gasto · ${x.categoria}${x.subcategoria ? ' › ' + x.subcategoria : ''} · ${x.concepto}`
  if (x.tipo === 'Retiro') return `Retiro · ${x.concepto} → ${x.destinatario}`
  if (x.tipo === 'Otro ingreso') return `Otro ingreso · ${x.concepto}`
  return x.tipo === 'Rendicion' ? `Rendición · ${x.profesor}` : x.tipo
}

function Horario({ f, set, evento }) {
  const alternar = c => set({ canchas: evento ? (f.canchas.includes(c) ? f.canchas.filter(x => x !== c) : [...f.canchas, c]) : [c] })
  return (
    <div className="rec-bloque">
      <label>{evento ? 'Canchas (podés elegir varias)' : 'Cancha'}</label>
      <div className="rec-sel">
        {CANCHAS.map(c => <button type="button" key={c} className="secundario" aria-pressed={f.canchas.includes(c)} onClick={() => alternar(c)}>{c}</button>)}
      </div>
      <div className="rec-grid">
        <div>
          <label>Hora de inicio · 24 horas</label>
          <div className="rec-grid">
            <select aria-label="Hora de inicio" value={f.hora} onChange={e => set({ hora: e.target.value })}><option value="">Hora</option>{HORAS.map(h => <option key={h}>{h}</option>)}</select>
            <select aria-label="Minutos de inicio" value={f.minuto} onChange={e => set({ minuto: e.target.value })}>{MINUTOS.map(m => <option key={m}>{m}</option>)}</select>
          </div>
        </div>
        {evento && (
          <div>
            <label>Hora de finalización · 24 horas</label>
            <div className="rec-grid">
              <select aria-label="Hora de finalización" value={f.finHora} onChange={e => set({ finHora: e.target.value })}><option value="">Hora</option>{HORAS.map(h => <option key={h}>{h}</option>)}</select>
              <select aria-label="Minutos de finalización" value={f.finMinuto} onChange={e => set({ finMinuto: e.target.value })}>{MINUTOS.map(m => <option key={m}>{m}</option>)}</select>
            </div>
          </div>
        )}
      </div>
      {!evento && f.tipoDuracion !== 'minutos' && (
        <>
          <label>Duración</label>
          <div className="rec-sel">
            {[60, 90, 120].map(d => <button type="button" key={d} className="secundario" aria-pressed={f.duracion === d} onClick={() => set({ duracion: d })}>{d} min</button>)}
          </div>
        </>
      )}
      {!evento && f.tipoDuracion === 'minutos' && (
        <label>Minutos (clase particular 60 · clase partido 90)<input type="number" readOnly value={f.duracion} /></label>
      )}
      <label className="rec-check"><input type="checkbox" checked={f.diaSiguiente} onChange={e => set({ diaSiguiente: e.target.checked })} /> La actividad empieza después de medianoche, en la misma jornada</label>
    </div>
  )
}

const Dinero = ({ f, set, campos = ['efectivo', 'transferencia'] }) => (
  <div className="rec-grid">
    {campos.includes('efectivo') && <label>Efectivo ($)<MoneyInput inputMode="decimal" placeholder="0" value={f.efectivo} onChange={e => set({ efectivo: e.target.value })} /></label>}
    {campos.includes('transferencia') && <label>Transferencia ($)<MoneyInput inputMode="decimal" placeholder="0" value={f.transferencia} onChange={e => set({ transferencia: e.target.value })} /></label>}
  </div>
)

export default function Recepcion({ user, onSalir }) {
  const [st, setSt] = useState(null)
  const [msg, setMsg] = useState({ texto: '', bueno: false })
  const [elegido, setElegido] = useState(null)
  const [f, setF] = useState(() => formVacio(user))
  const [tocado, setTocado] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [ocupado, setOcupado] = useState(false)
  const [verReservas, setVerReservas] = useState(false)
  const [verClases, setVerClases] = useState(false)
  const [avisoAbierto, setAvisoAbierto] = useState(false)
  const [avisoTexto, setAvisoTexto] = useState('')
  const [avisosVer, setAvisosVer] = useState('PENDIENTE')
  const [fMedio, setFMedio] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [buscar, setBuscar] = useState('')
  const [cierre, setCierre] = useState({ contado: '', comprobado: '', cantidad: '', observaciones: '' })
  const [apertura, setApertura] = useState({ saldo: '', motivo: '' })

  const set = parche => { setF(v => ({ ...v, ...parche })); setTocado(true) }
  const avisar = (texto, bueno = false) => setMsg({ texto, bueno })

  async function llamar(accion, datos, exito) {
    if (ocupado) return false
    setOcupado(true); avisar('')
    try {
      const r = await callRecepcion(accion, datos)
      if (r.turno !== undefined) setSt(r)
      if (exito) avisar(exito, true)
      return r
    } catch (e) { avisar(e.message); return false } finally { setOcupado(false) }
  }

  useEffect(() => {
    callRecepcion('rec.state').then(r => { setSt(r); avisar('Acceso correcto.', true) }).catch(e => avisar(e.message))
  }, [])

  const o = st?.opciones
  const t = st?.totales
  const clases = useMemo(() => (st?.entradas || []).filter(x => x.tipo === 'Clase'), [st])
  const lista = useMemo(() => (st?.entradas || []).filter(x => {
    if (fMedio === 'Efectivo' && !(x.efectivo > 0 || x.medio === 'Efectivo')) return false
    if (fMedio === 'Transferencia' && !(x.transferencia > 0 || x.medio === 'Transferencia')) return false
    if (fTipo && !(fTipo === x.categoria || fTipo === x.tipo)) return false
    const q = buscar.trim().toLowerCase()
    return !q || [titulo(x), x.concepto, x.profesor, x.nota, x.responsable].join(' ').toLowerCase().includes(q)
  }).slice().reverse(), [st, fMedio, fTipo, buscar])

  function elegir(item) {
    if (elegido?.k === item.k) return
    if (elegido && tocado && !window.confirm('¿Descartar la anotación que estás cargando?')) return
    setElegido(item); setF({ ...formVacio(user), duracion: item.tipo === 'Clase' ? 60 : 90, tipoDuracion: item.tipo === 'Clase' ? 'minutos' : 'turno' }); setTocado(false)
    setRequestId(crypto.randomUUID()); avisar('')
  }
  function cancelar() { setElegido(null); setTocado(false); avisar('') }

  const tarifa = o?.tarifas?.[f.alumnos] || 0
  const pct = o ? (o.porcentajes[f.profesor] ?? o.porcentajes.porDefecto) : 0
  const winHabitual = Math.round(tarifa * pct) / 100
  const cobrado = f.excepcion ? num(f.cobrado) : tarifa
  const remuneracion = f.excepcion && f.remuneracion !== '' ? num(f.remuneracion) : tarifa - winHabitual
  const winClase = f.tipoClase === 'Clase-partido' ? num(f.importeWIN) : Math.max(0, cobrado - remuneracion)

  function armar() {
    const base = { tipo: elegido.tipo, categoria: elegido.cat || '', fecha: f.fecha, nota: f.nota }
    const hora = f.hora !== '' ? `${f.hora}:${f.minuto}` : ''
    const horario = { canchas: f.canchas, hora, duracion: f.duracion, diaSiguiente: f.diaSiguiente }
    switch (elegido.k) {
      case 'abono': return { ...base, jugado: f.jugado, actividad: horario, efectivo: num(f.efectivo), transferencia: num(f.transferencia) }
      case 'regular': return { ...base, actividad: horario, efectivo: num(f.efectivo), transferencia: num(f.transferencia) }
      case 'clase': return { ...base, actividad: horario, alumnos: f.alumnos, profesor: f.profesor, tipoClase: f.tipoClase, excepcion: f.excepcion, cobrado: num(f.cobrado), remuneracion: f.remuneracion, motivoExcepcion: f.motivoExcepcion, incidencia: f.incidencia, importeWIN: num(f.importeWIN) }
      case 'evento': return { ...base, categoria: f.tipoEvento, cantidad: f.cantidad, responsableEvento: f.responsableEvento, actividad: { ...horario, fin: f.finHora !== '' ? `${f.finHora}:${f.finMinuto}` : '' }, efectivo: num(f.efectivo), transferencia: num(f.transferencia) }
      case 'gasto': return { ...base, categoria: f.categoria, subcategoria: f.subcategoria, importe: num(f.importe), concepto: f.concepto }
      case 'retiro': return { ...base, importe: num(f.importe), concepto: f.concepto, destinatario: f.destinatario }
      case 'tienda': return { ...base, efectivo: num(f.efectivo), transferencia: num(f.transferencia) }
      default: return { ...base, efectivo: num(f.efectivo), transferencia: num(f.transferencia), concepto: f.concepto }
    }
  }

  async function guardar(e) {
    e.preventDefault()
    if (elegido.k === 'rendicion') return
    // El mismo requestId se reutiliza en los reintentos: el servidor no duplica la anotación.
    const r = await llamar('rec.guardar', { requestId, turnoId: st.turno.id, anotacion: armar() }, 'Anotación guardada.')
    if (r) { setElegido(null); setTocado(false) }
  }

  async function abrir(e) {
    e.preventDefault()
    await llamar('rec.abrir', { saldoInicial: num(apertura.saldo), motivo: apertura.motivo }, 'Caja abierta.')
  }
  async function cerrar(e) {
    e.preventDefault()
    if (!window.confirm('¿Confirmás el cierre del turno?')) return
    const r = await llamar('rec.cerrar', { turnoId: st.turno.id, contado: num(cierre.contado), comprobado: num(cierre.comprobado), cantidadComprobantes: num(cierre.cantidad), observaciones: cierre.observaciones })
    if (r?.cierre) {
      avisar(`Turno cerrado. Esperado ${money(r.cierre.esperado)} · contado ${money(r.cierre.contado)} · diferencia ${money(r.cierre.diferencia)}.`, r.cierre.diferencia === 0)
      setCierre({ contado: '', comprobado: '', cantidad: '', observaciones: '' })
      const s = await callRecepcion('rec.state'); setSt(s)
    }
  }
  async function anular(x) {
    const motivo = window.prompt('Motivo de la anulación:', 'Corrección durante turno')
    if (motivo === null) return
    await llamar('rec.anular', { id: x.id, turnoId: st.turno.id, motivo }, 'Anotación anulada.')
  }
  async function guardarAviso(e) {
    e.preventDefault()
    const r = await llamar('rec.aviso.nuevo', { texto: avisoTexto }, 'Aviso guardado.')
    if (r) { setAvisoTexto(''); setAvisoAbierto(false) }
  }

  if (!st) return <main className="rec"><div className={`rec-msg${msg.bueno ? ' bueno' : ''}`} hidden={!msg.texto} role="status">{msg.texto}</div><p>Cargando…</p></main>

  const avisosFiltrados = st.avisos.filter(a => a.estado === avisosVer)
  const pendientes = st.avisos.filter(a => a.estado === 'PENDIENTE').length
  const d = st.desglose

  return (
    <main className="rec">
      <div className={`rec-msg${msg.bueno ? ' bueno' : ''}`} hidden={!msg.texto} role="status">{msg.texto}</div>

      {/* 1. Turno */}
      <section className="tarjeta wide">
        <div className="rec-fila">
          <div>
            <h2>{st.turno ? `Turno de ${st.turno.responsable}` : 'Caja cerrada'}</h2>
            <small>{st.turno ? `Caja abierta · ${st.turno.responsable} · Apertura ${st.turno.apertura}` : 'Abrí la caja para empezar a cargar movimientos.'}</small>
          </div>
          <div className="rec-acciones">
            <button type="button" className="secundario" disabled={ocupado} onClick={() => llamar('rec.state', {}, 'Datos actualizados.')}>Actualizar</button>
            <button type="button" className="secundario" onClick={onSalir}>Salir</button>
          </div>
        </div>
      </section>

      {!st.turno && (
        <section className="tarjeta wide">
          <h2>Abrir caja</h2>
          {st.cierreAnterior && <p className="rec-suave">Efectivo contado en el último cierre: <b>{money(st.cierreAnterior.contado)}</b>. Contá el efectivo que recibís y, si no coincide, explicá la diferencia.</p>}
          <form onSubmit={abrir} className="rec-form">
            <label>Efectivo contado al abrir ($)<MoneyInput inputMode="decimal" value={apertura.saldo} onChange={e => setApertura({ ...apertura, saldo: e.target.value })} required /></label>
            <label>Motivo de la diferencia (si corresponde)<input value={apertura.motivo} maxLength={400} onChange={e => setApertura({ ...apertura, motivo: e.target.value })} /></label>
            <button disabled={ocupado}>Abrir caja</button>
          </form>
        </section>
      )}

      {st.turno && <>
        {/* 2. Caja del turno */}
        <section className="tarjeta wide">
          <h2>Caja del turno</h2>
          <div className="rec-grid">
            <div className="rec-stat"><small>Efectivo esperado</small><b>{money(t.esperado)}</b></div>
            <div className={`rec-stat${t.transferencia === 0 ? ' alerta' : ''}`}><small>Transferencias recibidas</small><b>{money(t.transferencia)}</b></div>
            <button type="button" className="rec-stat" aria-expanded={verReservas} onClick={() => setVerReservas(!verReservas)}>
              <small>Reservas jugadas</small><b>{t.abonos + t.regulares} <span className="rec-chico">({t.abonos} abonos · {t.regulares} regulares)</span></b><small>{verReservas ? 'Ocultar detalle' : 'Ver detalle'}</small>
            </button>
            <button type="button" className="rec-stat" aria-expanded={verClases} onClick={() => setVerClases(!verClases)}>
              <small>Clases dictadas</small><b>{t.clases}</b><small>{verClases ? 'Ocultar detalle' : 'Ver detalle'}</small>
            </button>
          </div>
          {verReservas && (
            <div className="rec-detalle">
              <h3>Reservas regulares · {d.regulares.n}</h3>
              <div className="rec-par"><span>Efectivo</span><b>{money(d.regulares.efectivo)}</b></div>
              <div className="rec-par"><span>Transferencia</span><b>{money(d.regulares.transferencia)}</b></div>
              <div className="rec-par"><span>Total cobrado</span><b>{money(d.regulares.efectivo + d.regulares.transferencia)}</b></div>
              <h3>Abonos jugados · {d.abonos.n}</h3>
              <div className="rec-par"><span>Cobros de abonos registrados en este turno</span><b>{d.abonos.cobros}</b></div>
              <div className="rec-par"><span>Efectivo</span><b>{money(d.abonos.efectivo)}</b></div>
              <div className="rec-par"><span>Transferencia</span><b>{money(d.abonos.transferencia)}</b></div>
              <div className="rec-par total"><span>Total cobrado por reservas jugadas</span><b>{money(d.regulares.efectivo + d.regulares.transferencia + d.abonos.efectivo + d.abonos.transferencia)}</b></div>
              <div className="rec-par"><span>Horas-cancha registradas</span><b>{d.horasCancha.toLocaleString('es-AR')}</b></div>
              <p className="rec-suave">Corresponde a las anotaciones del turno abierto. Los abonos jugados sin cobro nuevo no suman ingresos. No incluye clases, rendiciones ni otros ingresos.</p>
            </div>
          )}
          {verClases && (
            <div className="rec-detalle">
              {clases.length === 0 && <p className="rec-suave">Todavía no hay clases en este turno.</p>}
              {clases.map(c => <div className="rec-par" key={c.id}><span>{c.profesor} · {c.alumnos} alumnos · {c.actividad.canchas.join('+')} {c.actividad.hora}</span><b>WIN {money(c.economia.win)}</b></div>)}
            </div>
          )}
        </section>

        {/* 3. Avisos */}
        <section className="tarjeta wide">
          <div className="rec-fila">
            <h2>Avisos y pendientes <span className="pill">{pendientes}</span></h2>
            <button type="button" className="secundario" onClick={() => setAvisoAbierto(!avisoAbierto)}>+ Nuevo aviso</button>
          </div>
          <div className="rec-sel">
            <button type="button" className="secundario" aria-pressed={avisosVer === 'PENDIENTE'} onClick={() => setAvisosVer('PENDIENTE')}>Pendientes</button>
            <button type="button" className="secundario" aria-pressed={avisosVer === 'RESUELTO'} onClick={() => setAvisosVer('RESUELTO')}>Resueltos</button>
          </div>
          {avisoAbierto && (
            <form onSubmit={guardarAviso} className="rec-form">
              <label>Aviso para el siguiente turno<textarea rows={2} maxLength={400} value={avisoTexto} onChange={e => setAvisoTexto(e.target.value)} /></label>
              <div className="rec-acciones"><button type="button" className="secundario" onClick={() => { setAvisoAbierto(false); setAvisoTexto('') }}>Cancelar</button><button disabled={ocupado}>Guardar aviso</button></div>
            </form>
          )}
          {avisosFiltrados.length === 0 && <p className="rec-suave">{avisosVer === 'PENDIENTE' ? 'Sin avisos pendientes.' : 'Sin avisos resueltos.'}</p>}
          {avisosFiltrados.map(a => (
            <div className="rec-item" key={a.id}>
              <div><b>{a.texto}</b><br /><small>{a.autor} · {a.fecha}</small></div>
              {a.estado === 'PENDIENTE' && <button type="button" className="secundario" onClick={() => llamar('rec.aviso.resolver', { id: a.id }, 'Aviso resuelto.')}>Resolver</button>}
            </div>
          ))}
        </section>

        {/* 4. Agregar anotación */}
        <section className="tarjeta wide">
          <h2>Agregar anotación</h2>
          <div className="rec-chips">
            {TIPOS.map(item => <button type="button" key={item.k} aria-pressed={elegido?.k === item.k} onClick={() => elegir(item)}>{item.label}</button>)}
          </div>

          {elegido?.k === 'rendicion' && (
            <div className="rec-detalle"><h3>Registrar rendición</h3><p className="rec-suave">La rendición de profesores (saldos pendientes por fecha de clase, excedente y diferencias) se incorpora en la próxima etapa.</p>
              <button type="button" className="secundario" onClick={cancelar}>Cerrar</button></div>
          )}

          {elegido && elegido.k !== 'rendicion' && (
            <form onSubmit={guardar} className="rec-form">
              {['abono', 'regular', 'clase', 'evento'].includes(elegido.k) && (
                <>
                  {elegido.k === 'abono' && <label className="rec-check"><input type="checkbox" checked={f.jugado} onChange={e => set({ jugado: e.target.checked })} /> ¿Se jugó?</label>}
                  {(elegido.k !== 'abono' || f.jugado) && <Horario f={f} set={set} evento={elegido.k === 'evento'} />}
                </>
              )}

              {elegido.k === 'clase' && (
                <>
                  <div className="rec-grid">
                    <label>Alumnos por clase<select value={f.alumnos} onChange={e => set({ alumnos: Number(e.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} {n === 1 ? 'alumno' : 'alumnos'}</option>)}</select></label>
                    <label>Profesor<select value={f.profesor} onChange={e => set({ profesor: e.target.value })} required><option value="">Elegí un profesor</option>{o.profesores.map(p => <option key={p}>{p}</option>)}</select></label>
                  </div>
                  <label>Tipo de clase<select value={f.tipoClase} onChange={e => set({ tipoClase: e.target.value, duracion: e.target.value === 'Clase-partido' ? 90 : 60 })}>{o.tiposClase.map(p => <option key={p}>{p}</option>)}</select></label>
                  {f.tipoClase === 'Tradicional' ? (
                    <>
                      <div className="rec-grid">
                        <label>Tarifa habitual ($)<input readOnly value={money(tarifa)} /></label>
                        <label>Porcentaje de WIN (%)<input readOnly value={pct} /></label>
                      </div>
                      <p className="rec-calculo">Profesor {money(remuneracion)} · WIN {money(winClase)}</p>
                      <details className="rec-desplegable" open={f.excepcion} onToggle={e => { if (e.currentTarget.open !== f.excepcion) set({ excepcion: e.currentTarget.open }) }}>
                        <summary>Excepción / Descuento</summary>
                        <div className="rec-grid">
                          <label>Importe real cobrado ($)<MoneyInput inputMode="decimal" value={f.cobrado} onChange={e => set({ cobrado: e.target.value })} /></label>
                          <label>Remuneración acordada (opcional)<MoneyInput inputMode="decimal" value={f.remuneracion} onChange={e => set({ remuneracion: e.target.value })} /></label>
                        </div>
                        <label>Motivo<input maxLength={300} value={f.motivoExcepcion} onChange={e => set({ motivoExcepcion: e.target.value })} /></label>
                      </details>
                    </>
                  ) : (
                    <label>Importe para WIN ($)<MoneyInput inputMode="decimal" value={f.importeWIN} onChange={e => set({ importeWIN: e.target.value })} /></label>
                  )}
                  <label>Pendiente de revisión (opcional)<input maxLength={300} placeholder="Qué falta verificar" value={f.incidencia} onChange={e => set({ incidencia: e.target.value })} /></label>
                  <p className="rec-suave">La clase no pide medio de pago: el cobro entra por Rendición.</p>
                </>
              )}

              {elegido.k === 'evento' && (
                <>
                  <label>Cantidad de inscriptos
                    <span className="rec-contador"><button type="button" className="secundario" onClick={() => set({ cantidad: Math.max(1, f.cantidad - 1) })}>−</button><strong>{f.cantidad}</strong><button type="button" className="secundario" onClick={() => set({ cantidad: f.cantidad + 1 })}>+</button></span>
                  </label>
                  <div className="rec-grid">
                    <label>Tipo de evento<select value={f.tipoEvento} onChange={e => set({ tipoEvento: e.target.value })}>{o.tiposEvento.map(p => <option key={p}>{p}</option>)}</select></label>
                    <label>Responsable del evento<input maxLength={120} value={f.responsableEvento} onChange={e => set({ responsableEvento: e.target.value })} required /></label>
                  </div>
                  <p className="rec-suave">Indicá lo efectivamente cobrado en los campos Efectivo y Transferencia. Pueden quedar en cero si todavía no hubo cobro.</p>
                  <p className="rec-suave">Registrá solo dinero recibido, una vez. No multiplica el importe por inscriptos ni genera otra rendición.</p>
                </>
              )}

              {['abono', 'regular', 'evento', 'tienda', 'otro'].includes(elegido.k) && <Dinero f={f} set={set} />}
              {elegido.k === 'otro' && <label>Concepto<input maxLength={400} value={f.concepto} onChange={e => set({ concepto: e.target.value })} required /></label>}

              {elegido.k === 'gasto' && (
                <>
                  <div className="rec-grid">
                    <label>Categoría de gasto del Excel
                      <select value={f.categoria} onChange={e => set({ categoria: e.target.value, subcategoria: '' })}>
                        <option value="">{o.sinCategoria}</option>{Object.keys(o.gastos).map(c => <option key={c}>{c}</option>)}
                      </select>
                    </label>
                    <label>Subcategoría (opcional)
                      <input list="subcategorias" maxLength={100} placeholder="Ej. Internet" value={f.subcategoria} onChange={e => set({ subcategoria: e.target.value })} />
                      <datalist id="subcategorias">{(o.gastos[f.categoria] || []).map(s => <option key={s} value={s} />)}</datalist>
                    </label>
                  </div>
                  <p className="rec-suave">Elegí categoría y, si corresponde, subcategoría. El concepto sigue siendo libre. El gasto sale de efectivo.</p>
                  <div className="rec-grid">
                    <label>Importe ($)<MoneyInput inputMode="decimal" value={f.importe} onChange={e => set({ importe: e.target.value })} required /></label>
                    <label>Concepto<input maxLength={400} placeholder="Ej. Productos de limpieza" value={f.concepto} onChange={e => set({ concepto: e.target.value })} required /></label>
                  </div>
                </>
              )}

              {elegido.k === 'retiro' && (
                <>
                  <div className="rec-grid">
                    <label>Importe ($)<MoneyInput inputMode="decimal" value={f.importe} onChange={e => set({ importe: e.target.value })} required /></label>
                    <label>Motivo del retiro<input maxLength={400} placeholder="Ej. Traslado a Administración" value={f.concepto} onChange={e => set({ concepto: e.target.value })} required /></label>
                  </div>
                  <label>Destinatario del efectivo<input maxLength={120} value={f.destinatario} onChange={e => set({ destinatario: e.target.value })} required /></label>
                  <p className="rec-suave">Si el efectivo se usó para pagar directamente un bien o servicio, registrá un gasto.</p>
                </>
              )}

              <div className="rec-grid">
                <label>Fecha de actividad<input type="date" max={hoyAR()} value={f.fecha} onChange={e => set({ fecha: e.target.value })} required /></label>
                <label>Observación (opcional)<input maxLength={400} placeholder="Detalle adicional" value={f.nota} onChange={e => set({ nota: e.target.value })} /></label>
              </div>
              <div className="rec-acciones"><button type="button" className="secundario" onClick={cancelar}>Cancelar</button><button disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar anotación'}</button></div>
            </form>
          )}
        </section>

        {/* 5. Movimientos e historial */}
        <section className="tarjeta wide">
          <div className="rec-fila"><h2>Movimientos e historial</h2><span className="rec-suave">{lista.length} registros</span></div>
          <div className="rec-grid">
            <label>Período<select value="caja" onChange={() => {}}><option value="caja">Caja actual</option></select></label>
            <label>Tipo<select value={fTipo} onChange={e => setFTipo(e.target.value)}>{FILTROS_TIPO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <label>Buscar<input type="search" placeholder="Ej. profesor, cancha o concepto" value={buscar} onChange={e => setBuscar(e.target.value)} /></label>
          <div className="rec-sel">
            {[['', 'Todos'], ['Efectivo', 'Efectivo'], ['Transferencia', 'Transferencia']].map(([v, l]) => <button type="button" key={l} className="secundario" aria-pressed={fMedio === v} onClick={() => setFMedio(v)}>{l}</button>)}
          </div>
          {lista.length === 0 && <p className="rec-suave">No hay movimientos para este filtro.</p>}
          {lista.map(x => (
            <div className="rec-item" key={x.id}>
              <div>
                <b>{titulo(x)}</b><br />
                <small>{x.registrado.slice(11)} · {x.responsable}{x.nota ? ' · ' + x.nota : ''}</small>
                {x.economia && <><br /><small>Profesor {money(x.economia.remuneracion ?? 0)} · WIN {money(x.economia.win)}</small></>}
              </div>
              <div className="rec-importes">
                {x.importe > 0 && <b className="egreso">− {money(x.importe)}</b>}
                {x.efectivo > 0 && <span>Efectivo {money(x.efectivo)}</span>}
                {x.transferencia > 0 && <span>Transf. {money(x.transferencia)}</span>}
                <button type="button" className="secundario rec-anular" onClick={() => anular(x)}>Anular</button>
              </div>
            </div>
          ))}
        </section>

        {/* 6. Cerrar turno */}
        <details className="tarjeta wide rec-cierre">
          <summary>Cerrar turno</summary>
          <form onSubmit={cerrar} className="rec-form">
            <div className="rec-grid">
              <div className="rec-stat"><small>Efectivo esperado</small><b>{money(t.esperado)}</b></div>
              <div className="rec-stat"><small>Transferencias esperadas</small><b>{money(t.transferencia)}</b></div>
            </div>
            <label>Efectivo contado ($)<MoneyInput inputMode="decimal" placeholder="Contar billetes y monedas" value={cierre.contado} onChange={e => setCierre({ ...cierre, contado: e.target.value })} required /></label>
            <div className="rec-grid">
              <label>Monto de comprobantes ($)<MoneyInput inputMode="decimal" value={cierre.comprobado} onChange={e => setCierre({ ...cierre, comprobado: e.target.value })} /></label>
              <label>Cantidad de comprobantes<input type="number" min="0" step="1" inputMode="numeric" value={cierre.cantidad} onChange={e => setCierre({ ...cierre, cantidad: e.target.value })} /></label>
            </div>
            <p className="rec-suave">Un mismo comprobante puede cubrir varios movimientos. Contalo una sola vez. Efectivo: ingresá el importe. · Transferencias: ingresá el importe.</p>
            <label>Observaciones de cierre<input maxLength={400} placeholder="Motivo de la diferencia o aclaración" value={cierre.observaciones} onChange={e => setCierre({ ...cierre, observaciones: e.target.value })} /></label>
            <button disabled={ocupado}>Confirmar cierre de turno</button>
          </form>
        </details>
      </>}
    </main>
  )
}
