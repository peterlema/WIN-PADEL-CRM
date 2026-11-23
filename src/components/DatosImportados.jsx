import { useEffect, useMemo, useState } from 'react'
import { callApi } from '../api.js'

// Datos transcriptos del panel de Administración de Apps Script (carga staging del 23/11/2026).
// Sólo lectura: no forman parte de la caja real ni se suman a sus totales.
const pesos = n => n === null || n === undefined ? '—' : '$ ' + Math.round(Number(n)).toLocaleString('es-AR')
const num = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('es-AR')
// Las fechas vienen sin zona horaria: se muestran tal cual, sin convertir.
const fecha = v => v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—'
const hora = v => v ? String(v).slice(11, 16) : '—'
const estadoClase = { 'Al día': 'ok', 'Excedente': 'info', 'Parcial': 'alerta', 'Sin rendición vinculada': 'alerta', 'Importe a revisar': 'revisar' }

function Tabla({ columnas, filas, clave }) {
  if (!filas.length) return <p className="win-rec-empty">Sin datos.</p>
  return <div className="win-imp-scroll"><table className="win-imp-tabla">
    <thead><tr>{columnas.map(c => <th key={c.t} className={c.n ? 'n' : ''}>{c.t}</th>)}</tr></thead>
    <tbody>{filas.map((f, i) => <tr key={clave ? clave(f) : i} className={f.nota_revision ? 'win-imp-marcada' : ''}>
      {columnas.map(c => <td key={c.t} className={c.n ? 'n' : ''}>{c.largo ? <div className="win-imp-largo">{c.v(f)}</div> : c.v(f)}</td>)}
    </tr>)}</tbody>
  </table></div>
}

export default function DatosImportados() {
  const [abierto, setAbierto] = useState(true)
  const [datos, setDatos] = useState(null)
  const [estado, setEstado] = useState('idle')
  const [error, setError] = useState('')
  const [profesor, setProfesor] = useState('ALL')
  const [estadoFiltro, setEstadoFiltro] = useState('ALL')

  async function cargar() {
    setEstado('loading'); setError('')
    try { setDatos(await callApi('imported.snapshot')); setEstado('ready') }
    catch (e) { setError(e.message || 'No se pudieron leer los datos importados.'); setEstado('error') }
  }
  useEffect(() => { cargar() }, [])
  function alternar() {
    const nuevo = !abierto
    setAbierto(nuevo)
    if (nuevo && !datos && estado !== 'loading') cargar()
  }

  const clases = datos?.clases || []
  const profesores = useMemo(() => [...new Set(clases.map(c => c.profesor))].sort(), [clases])
  const estados = useMemo(() => [...new Set(clases.map(c => c.estado))].sort(), [clases])
  const filtradas = clases.filter(c => (profesor === 'ALL' || c.profesor === profesor) && (estadoFiltro === 'ALL' || c.estado === estadoFiltro))
  const tot = filtradas.reduce((a, c) => ({ clases: a.clases + c.clases, asistencias: a.asistencias + c.asistencias, esperado: a.esperado + Number(c.esperado), rendido: a.rendido + Number(c.rendido) }), { clases: 0, asistencias: 0, esperado: 0, rendido: 0 })
  const r = datos?.resumen

  return <section className="win-rec-panel">
    <button type="button" className="win-rec-collapse" aria-expanded={abierto} onClick={alternar}>Datos importados de Apps Script <span>{abierto ? '−' : '+'}</span></button>
    {abierto && <div className="win-imp">
      <p className="win-rec-pending">Copia de sólo lectura del panel de Administración original, al 23/11/2026. No forma parte de esta caja ni se suma a sus totales.</p>
      {estado === 'loading' && <p className="win-rec-muted">Cargando…</p>}
      {estado === 'error' && <p className="win-rec-notice error" role="alert">{error} <button type="button" className="win-rec-light" onClick={cargar}>Reintentar</button></p>}
      {estado === 'ready' && <>
        {r && <>
          <h3>Resumen {fecha(r.periodo_desde)} al {fecha(r.periodo_hasta)} ({r.dias} días)</h3>
          <div className="win-rec-metrics">
            <div className="win-rec-metric"><span>Generado por actividad</span><strong>{pesos(r.generado_actividad)}</strong><small>Parcial: faltan precios de {r.clases_sin_precio_confirmado} clases</small></div>
            <div className="win-rec-metric"><span>Cobrado registrado</span><strong>{pesos(r.cobrado_registrado)}</strong><small>Efectivo y transferencias, incluye rendiciones</small></div>
            <div className="win-rec-metric"><span>Rendido por clases</span><strong>{pesos(r.rendido_clases_periodo)}</strong></div>
            <div className="win-rec-metric"><span>Egresos registrados</span><strong>{pesos(r.egresos_registrados)}</strong><small>Gastos de recepción</small></div>
            <div className="win-rec-metric"><span>Flujo neto registrado</span><strong>{pesos(r.flujo_neto_registrado)}</strong><small>No es utilidad total</small></div>
            <div className="win-rec-metric"><span>Reservas</span><strong>{num(r.reservas_registradas)}</strong><small>{num(r.reservas_abonos)} abonos · {num(r.reservas_regulares)} regulares</small></div>
            <div className="win-rec-metric"><span>Clases</span><strong>{num(r.clases_registradas)}</strong><small>{num(r.asistencias)} asistencias · 1 alumno {r.clases_1_alumno} · 2: {r.clases_2_alumnos} · 3: {r.clases_3_alumnos} · 4: {r.clases_4_alumnos}</small></div>
          </div>
        </>}

        <h3>Clases por profesor y día</h3>
        <div className="win-rec-filters">
          <label>Profesor<select value={profesor} onChange={e => setProfesor(e.target.value)}><option value="ALL">Todos</option>{profesores.map(p => <option key={p}>{p}</option>)}</select></label>
          <label>Estado<select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}><option value="ALL">Todos</option>{estados.map(s => <option key={s}>{s}</option>)}</select></label>
        </div>
        <p className="win-rec-muted">{filtradas.length} filas · {num(tot.clases)} clases · {num(tot.asistencias)} asistencias · esperado {pesos(tot.esperado)} · rendido {pesos(tot.rendido)}</p>
        <Tabla filas={filtradas} clave={c => c.profesor + c.fecha_clase} columnas={[
          { t: 'Fecha', v: c => fecha(c.fecha_clase) },
          { t: 'Profesor', v: c => c.profesor },
          { t: 'Clases', n: 1, v: c => c.clases },
          { t: 'Asist.', n: 1, v: c => c.asistencias },
          { t: 'Esperado', n: 1, v: c => pesos(c.esperado) },
          { t: 'Rendido', n: 1, v: c => pesos(c.rendido) },
          { t: 'Estado', v: c => <span className={'win-imp-estado ' + (estadoClase[c.estado] || '')}>{c.estado}</span> },
          { t: 'Nota', largo: 1, v: c => c.nota_revision || '' }
        ]} />

        <h3>Turnos del 23/11</h3>
        <Tabla filas={datos.turnos} clave={t => t.turno_id} columnas={[
          { t: 'Responsable', v: t => t.responsable },
          { t: 'Estado', v: t => t.estado },
          { t: 'Apertura', v: t => hora(t.apertura) },
          { t: 'Cierre', v: t => hora(t.cierre) },
          { t: 'Efvo. esperado', n: 1, v: t => pesos(t.efectivo_esperado) },
          { t: 'Efvo. contado', n: 1, v: t => pesos(t.efectivo_contado) },
          { t: 'Diferencia', n: 1, v: t => pesos(t.diferencia) },
          { t: 'Observación', largo: 1, v: t => t.observacion || '' }
        ]} />

        <h3>Movimientos del 23/11</h3>
        <Tabla filas={datos.movimientos} columnas={[
          { t: 'Hora', v: m => hora(m.fecha_hora) },
          { t: 'Responsable', v: m => m.responsable },
          { t: 'Tipo', v: m => m.tipo },
          { t: 'Profesor', v: m => m.profesor || '' },
          { t: 'Alumnos', n: 1, v: m => m.alumnos ?? '' },
          { t: 'Efectivo', n: 1, v: m => m.efectivo ? pesos(m.efectivo) : '' },
          { t: 'Transf.', n: 1, v: m => m.transferencia ? pesos(m.transferencia) : '' },
          { t: 'Detalle', largo: 1, v: m => m.detalle || '' }
        ]} />
        <p className="win-rec-muted">Total: efectivo {pesos(datos.movimientos.reduce((a, m) => a + Number(m.efectivo || 0), 0))} · transferencias {pesos(datos.movimientos.reduce((a, m) => a + Number(m.transferencia || 0), 0))}</p>

        <h3>Cobros distribuidos</h3>
        <Tabla filas={datos.cobros} clave={c => c.cobro_id} columnas={[
          { t: 'Fecha', v: c => fecha(c.fecha_cobro) },
          { t: 'Profesor', v: c => c.profesor },
          { t: 'Importe', n: 1, v: c => pesos(c.importe) },
          { t: 'Medio', v: c => c.medio },
          { t: 'Actividad', v: c => fecha(c.fecha_actividad) },
          { t: 'Cargó', v: c => c.responsable },
          { t: 'Detalle', largo: 1, v: c => c.detalle || '' }
        ]} />

        <h3>Incidencias de caja abiertas</h3>
        <Tabla filas={datos.incidencias} columnas={[
          { t: 'Tipo', v: i => i.tipo },
          { t: 'Jornada', v: i => fecha(i.jornada) },
          { t: 'Responsable', v: i => i.responsable },
          { t: 'Rubro', v: i => i.rubro },
          { t: 'Esperado', n: 1, v: i => pesos(i.esperado) },
          { t: 'Verificado', n: 1, v: i => pesos(i.verificado) },
          { t: 'Diferencia', n: 1, v: i => pesos(i.diferencia) },
          { t: 'Estado', v: i => i.estado },
          { t: 'Detalle', largo: 1, v: i => i.detalle || '' }
        ]} />
      </>}
    </div>}
  </section>
}
