import { useEffect, useState } from 'react'
import { callApi } from '../api.js'

// Configuración: datos que cambian seguido (productos, precios y profesores), editables sin tocar la base.
// La pantalla sólo muestra y envía; permisos, validaciones y auditoría viven en win_config_* (PostgreSQL).

const money = n => '$ ' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })
const fecha = d => d ? new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d + 'T00:00:00Z')) : '—'
const num = v => { const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.'); return s === '' ? NaN : Number(s) }
const pct = v => { const s = String(v ?? '').trim().replace(',', '.'); return s === '' ? NaN : Number(s) }
// [código, duración en minutos, rótulo]. La cancha tiene precio por duración; las clases, por cantidad de alumnos.
const PRECIOS = [
  ['COURT_TURN', 60, 'Cancha · 60 min'], ['COURT_TURN', 90, 'Cancha · 90 min'], ['COURT_TURN', 120, 'Cancha · 120 min'],
  ['CLASS_1', 60, 'Clase · 1 alumno'], ['CLASS_2', 60, 'Clase · 2 alumnos'], ['CLASS_3', 60, 'Clase · 3 alumnos'], ['CLASS_4', 60, 'Clase · 4 alumnos'],
]
const UNIDADES = { CAFE_BAR: 'Bar / Buffet', SHOP: 'Tienda' }

export default function Configuracion() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('productos')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [ajustes, setAjustes] = useState(null)

  async function cargar() {
    try {
      const [r, a] = await Promise.all([callApi('config.list'), callApi('settings.get').catch(() => null)])
      setData(r); setAjustes(a); setError('')
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { cargar() }, [])
  async function guardar(action, params, mensaje) {
    if (busy) return false
    setBusy(true); setError(''); setOk('')
    try { await callApi(action, params); setOk(mensaje); await cargar(); return true }
    catch (e) { setError(e.message); return false }
    finally { setBusy(false) }
  }

  const p = data?.permisos || {}
  const tabs = [
    (p.bar || p.tienda) && ['productos', 'Productos'],
    p.precios && ['precios', 'Precios'],
    p.profesores && ['profesores', 'Profesores'],
    p.precios && ajustes && ['ajustes', 'Ajustes'],
  ].filter(Boolean)
  const actual = tabs.some(t => t[0] === tab) ? tab : tabs[0]?.[0]

  return <main className="cfg-page">
    <section className="cfg-heading"><h2>Configuración</h2><p>Productos, precios y profesores. Cada cambio queda registrado con usuario y hora.</p></section>
    {data && <nav className="admin-tabs" aria-label="Secciones de configuración">
      {tabs.map(([id, label]) => <button key={id} type="button" className={actual === id ? 'active' : ''} aria-current={actual === id ? 'page' : undefined} onClick={() => { setTab(id); setOk(''); setError('') }}>{label}</button>)}
    </nav>}
    <div aria-live="polite">
      {error && <p className="cfg-msg error" role="alert">{error}</p>}
      {ok && <p className="cfg-msg good">{ok}</p>}
    </div>
    {!data && !error && <p className="cfg-muted">Cargando…</p>}
    {data && actual === 'productos' && <Productos data={data} guardar={guardar} busy={busy} />}
    {data && actual === 'precios' && <Precios data={data} guardar={guardar} busy={busy} />}
    {data && actual === 'profesores' && <Profesores data={data} guardar={guardar} busy={busy} pctBase={ajustes?.COACH_DEFAULT_WIN_PCT ?? 60} />}
    {data && actual === 'ajustes' && <Ajustes ajustes={ajustes} guardar={guardar} busy={busy} />}
  </main>
}

function Productos({ data, guardar, busy }) {
  const unidades = Object.keys(UNIDADES).filter(u => (u === 'CAFE_BAR' ? data.permisos.bar : data.permisos.tienda))
  const [unidad, setUnidad] = useState(unidades[0])
  const [edit, setEdit] = useState(null)
  const [buscar, setBuscar] = useState('')
  const [inactivos, setInactivos] = useState(false)
  const q = buscar.trim().toLowerCase()
  const filas = data.productos.filter(x => x.unidad === unidad && (inactivos || x.activo) && (!q || (x.nombre + ' ' + (x.variante || '') + ' ' + x.categoria).toLowerCase().includes(q)))
  const esBar = unidad === 'CAFE_BAR'
  const sinPrecio = filas.filter(x => x.activo && (x.precio == null || Number(x.precio) <= 0)).length
  const categorias = [...new Set(data.productos.filter(x => x.unidad === unidad && x.categoria).map(x => x.categoria))]
  async function enviar(e) {
    e.preventDefault()
    const price = num(edit.precio)
    if (!edit.nombre.trim() || !Number.isFinite(price) || price < 0) return
    const listo = await guardar('config.item.save', { id: edit.id, unit: unidad, name: edit.nombre, variant: esBar ? edit.variante : '', category: edit.categoria, price, active: edit.activo },
      edit.id ? 'Producto actualizado.' : 'Producto agregado.')
    if (listo) setEdit(null)
  }
  return <section className="cfg-card">
    <div className="cfg-head">
      {unidades.length > 1 ? <div className="cfg-seg" role="group" aria-label="Unidad">
        {unidades.map(u => <button key={u} type="button" aria-pressed={unidad === u} onClick={() => { setUnidad(u); setEdit(null) }}>{UNIDADES[u]}</button>)}
      </div> : <h3>{UNIDADES[unidad]}</h3>}
      <button type="button" onClick={() => setEdit({ id: null, nombre: '', variante: '', categoria: '', precio: '', activo: true })} disabled={busy}>+ Producto</button>
    </div>
    <div className="cfg-tools">
      <input type="search" placeholder="Buscar producto o categoría" value={buscar} onChange={e => setBuscar(e.target.value)} />
      <label className="cfg-check"><input type="checkbox" checked={inactivos} onChange={e => setInactivos(e.target.checked)} />Mostrar dados de baja</label>
    </div>
    {edit && <form className="cfg-form" onSubmit={enviar}>
      <label>Nombre<input value={edit.nombre} maxLength={80} required autoFocus onChange={e => setEdit({ ...edit, nombre: e.target.value })} /></label>
      {esBar && <label>Sabor / variante<input value={edit.variante} maxLength={90} placeholder="Ej. Azul, Amber (opcional)" onChange={e => setEdit({ ...edit, variante: e.target.value })} /></label>}
      <label>Categoría<input value={edit.categoria} maxLength={60} list="cfg-categorias" placeholder="Ej. Bebidas" onChange={e => setEdit({ ...edit, categoria: e.target.value })} /></label>
      <datalist id="cfg-categorias">{categorias.map(c => <option key={c} value={c} />)}</datalist>
      <label>Precio ($)<input inputMode="decimal" className="cfg-num" value={edit.precio} required onChange={e => setEdit({ ...edit, precio: e.target.value })} /></label>
      <label className="cfg-check"><input type="checkbox" checked={edit.activo} onChange={e => setEdit({ ...edit, activo: e.target.checked })} />Activo</label>
      <div className="cfg-actions"><button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button><button type="button" className="secundario" onClick={() => setEdit(null)}>Cancelar</button></div>
    </form>}
    {esBar && <p className="cfg-muted">Son los mismos productos que se venden en Bar / Buffet: el precio que guardes acá se usa en la próxima venta.{sinPrecio > 0 && ` ${sinPrecio} activo(s) sin precio no se pueden vender.`}</p>}
    {!filas.length ? <p className="cfg-muted">{data.productos.some(x => x.unidad === unidad) ? 'Ningún producto coincide.' : 'Todavía no hay productos cargados.'}</p> :
      <table className="cfg-table">
        <thead><tr><th>Producto</th>{esBar && <th>Sabor</th>}<th>Categoría</th><th className="n">Precio</th><th>Estado</th><th /></tr></thead>
        <tbody>{filas.map(x => <tr key={x.id} className={!x.activo ? 'baja' : (x.precio == null || Number(x.precio) <= 0) ? 'sin-precio' : ''}>
          <td>{x.nombre}</td>{esBar && <td>{x.variante || '—'}</td>}<td>{x.categoria || '—'}</td><td className="n">{x.precio == null ? 'Sin precio' : money(x.precio)}</td><td>{x.activo ? 'Activo' : 'De baja'}</td>
          <td><button type="button" className="enlace" onClick={() => { setEdit({ id: x.id, nombre: x.nombre, variante: x.variante || '', categoria: x.categoria, precio: x.precio == null ? '' : String(x.precio).replace('.', ','), activo: x.activo }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Editar</button></td>
        </tr>)}</tbody>
      </table>}
  </section>
}

function Precios({ data, guardar, busy }) {
  const [edit, setEdit] = useState(null)
  async function enviar(e) {
    e.preventDefault()
    const cash = num(edit.efectivo), transfer = num(edit.mismo ? edit.efectivo : edit.transferencia)
    if (!(cash > 0) || !(transfer > 0)) return
    if (edit.desde < data.hoy) return
    const listo = await guardar('config.price.set', { code: edit.codigo, duration: edit.duracion, cash, transfer, validFrom: edit.desde },
      edit.desde === data.hoy ? 'Precio actualizado desde hoy.' : `Cambio programado desde el ${fecha(edit.desde)}.`)
    if (listo) setEdit(null)
  }
  async function anular(x) {
    if (!window.confirm(`¿Anular el cambio programado desde el ${fecha(x.desde)}?`)) return
    await guardar('config.price.cancel', { code: x.codigo, duration: x.duracion, validFrom: x.desde }, 'Cambio programado anulado.')
  }
  return <section className="cfg-card">
    <div className="cfg-head"><h3>Precios vigentes</h3></div>
    <p className="cfg-muted">Un precio nuevo rige desde la fecha que elijas (hoy o más adelante). Lo ya cobrado conserva su importe.</p>
    {edit && <form className="cfg-form" onSubmit={enviar}>
      <strong className="cfg-form-title">{edit.rotulo}</strong>
      <label>Efectivo ($)<input inputMode="decimal" className="cfg-num" value={edit.efectivo} required autoFocus onChange={e => setEdit({ ...edit, efectivo: e.target.value })} /></label>
      {!edit.mismo && <label>Transferencia ($)<input inputMode="decimal" className="cfg-num" value={edit.transferencia} required onChange={e => setEdit({ ...edit, transferencia: e.target.value })} /></label>}
      <label className="cfg-check"><input type="checkbox" checked={edit.mismo} onChange={e => setEdit({ ...edit, mismo: e.target.checked })} />Mismo importe en transferencia</label>
      <label>Vigente desde<input type="date" min={data.hoy} value={edit.desde} required onChange={e => setEdit({ ...edit, desde: e.target.value })} /></label>
      <div className="cfg-actions"><button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button><button type="button" className="secundario" onClick={() => setEdit(null)}>Cancelar</button></div>
    </form>}
    <table className="cfg-table">
      <thead><tr><th>Concepto</th><th className="n">Efectivo</th><th className="n">Transferencia</th><th>Desde</th><th /></tr></thead>
      <tbody>{PRECIOS.flatMap(([codigo, duracion, label]) => {
        const filas = data.precios.filter(x => x.codigo === codigo && Number(x.duracion) === duracion)
        const vigente = filas.find(x => !x.futuro)
        const clave = codigo + duracion
        return [
          <tr key={clave} className={vigente ? '' : 'sin-precio'}>
            <td>{label}</td>
            <td className="n">{vigente ? money(vigente.efectivo) : '—'}</td>
            <td className="n">{vigente ? money(vigente.transferencia) : '—'}</td>
            <td>{vigente ? fecha(vigente.desde) : 'Sin precio: no se puede cobrar'}</td>
            <td><button type="button" className="enlace" disabled={busy} onClick={() => setEdit({ codigo, duracion, rotulo: label, efectivo: vigente ? String(vigente.efectivo) : '', transferencia: vigente ? String(vigente.transferencia) : '', mismo: vigente ? Number(vigente.efectivo) === Number(vigente.transferencia) : false, desde: data.hoy })}>Cambiar</button></td>
          </tr>,
          ...filas.filter(x => x.futuro).map(x => <tr key={clave + x.desde} className="futuro">
            <td>↳ programado</td><td className="n">{money(x.efectivo)}</td><td className="n">{money(x.transferencia)}</td><td>{fecha(x.desde)}</td>
            <td><button type="button" className="enlace" disabled={busy} onClick={() => anular(x)}>Anular</button></td>
          </tr>),
        ]
      })}</tbody>
    </table>
  </section>
}

function Profesores({ data, guardar, busy, pctBase }) {
  const [edit, setEdit] = useState(null)
  async function enviar(e) {
    e.preventDefault()
    const winPct = pct(edit.porcentaje)
    if (!edit.nombre.trim() || !(winPct >= 0 && winPct <= 100)) return
    const listo = await guardar('config.coach.save', { id: edit.id, name: edit.nombre, winPct, active: edit.activo }, edit.id ? 'Profesor actualizado.' : 'Profesor agregado.')
    if (listo) setEdit(null)
  }
  const ejemplo = edit && pct(edit.porcentaje) >= 0 && pct(edit.porcentaje) <= 100
  return <section className="cfg-card">
    <div className="cfg-head"><h3>Profesores</h3><button type="button" disabled={busy} onClick={() => setEdit({ id: null, nombre: '', porcentaje: String(pctBase).replace('.', ','), activo: true })}>+ Profesor</button></div>
    <p className="cfg-muted">El porcentaje es la parte de cada clase que queda para WIN; el profesor cobra el resto.</p>
    {edit && <form className="cfg-form" onSubmit={enviar}>
      <label>Nombre<input value={edit.nombre} maxLength={60} required autoFocus onChange={e => setEdit({ ...edit, nombre: e.target.value })} /></label>
      <label>% WIN<input inputMode="decimal" className="cfg-num" value={edit.porcentaje} required onChange={e => setEdit({ ...edit, porcentaje: e.target.value })} /></label>
      <label className="cfg-check"><input type="checkbox" checked={edit.activo} onChange={e => setEdit({ ...edit, activo: e.target.checked })} />Activo</label>
      {ejemplo && <small className="cfg-muted">Ej.: clase de $ 100.000 → WIN {money(pct(edit.porcentaje) * 1000)} · profesor {money((100 - pct(edit.porcentaje)) * 1000)}</small>}
      <div className="cfg-actions"><button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button><button type="button" className="secundario" onClick={() => setEdit(null)}>Cancelar</button></div>
    </form>}
    <table className="cfg-table">
      <thead><tr><th>Profesor</th><th className="n">% WIN</th><th className="n">% profesor</th><th>Estado</th><th /></tr></thead>
      <tbody>{data.profesores.map(x => <tr key={x.id} className={x.activo ? '' : 'baja'}>
        <td>{x.nombre}</td><td className="n">{Number(x.porcentajeWin).toLocaleString('es-AR')} %</td><td className="n">{(100 - Number(x.porcentajeWin)).toLocaleString('es-AR')} %</td>
        <td>{x.activo ? 'Activo' : 'De baja'}</td>
        <td><button type="button" className="enlace" onClick={() => setEdit({ id: x.id, nombre: x.nombre, porcentaje: String(x.porcentajeWin).replace('.', ','), activo: x.activo })}>Editar</button></td>
      </tr>)}</tbody>
    </table>
  </section>
}

// Valores numéricos de funcionamiento. Horarios en minutos de la jornada comercial (corta a las 06:00).
const hhmm = m => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const HORAS = Array.from({ length: 49 }, (_, i) => 360 + i * 30)  // 06:00 a 06:00 del día siguiente, cada 30 min
const AJUSTES = [
  { key: 'GRID_OPEN_MIN', label: 'Calendario · apertura', tipo: 'hora', ayuda: 'Primer horario de la grilla de canchas.' },
  { key: 'GRID_CLOSE_MIN', label: 'Calendario · cierre', tipo: 'hora', ayuda: 'Último horario; después de medianoche cuenta para la misma jornada.' },
  { key: 'BOOKING_DEFAULT_DURATION', label: 'Reserva · duración propuesta', tipo: 'duracion', ayuda: 'Duración que aparece al cargar una reserva nueva.' },
  { key: 'COACH_DEFAULT_WIN_PCT', label: 'Profesor nuevo · % WIN propuesto', tipo: 'pct', ayuda: 'Se puede cambiar en cada profesor.' },
]
const mostrar = (a, v) => a.tipo === 'hora' ? hhmm(Number(v)) + (Number(v) >= 1440 ? ' (día siguiente)' : '') : a.tipo === 'duracion' ? v + ' min' : Number(v).toLocaleString('es-AR') + ' %'

function Ajustes({ ajustes, guardar, busy }) {
  const [edit, setEdit] = useState(null)
  async function enviar(e) {
    e.preventDefault()
    const value = edit.tipo === 'pct' ? pct(edit.valor) : Number(edit.valor)
    if (!Number.isFinite(value)) return
    if (await guardar('config.setting.set', { key: edit.key, value }, 'Ajuste guardado.')) setEdit(null)
  }
  return <section className="cfg-card">
    <div className="cfg-head"><h3>Ajustes</h3></div>
    <p className="cfg-muted">Valores de funcionamiento que antes estaban fijos. Sólo los cambia un administrador.</p>
    {edit && <form className="cfg-form" onSubmit={enviar}>
      <strong className="cfg-form-title">{edit.label}</strong>
      {edit.tipo === 'hora' && <label>Horario<select value={edit.valor} autoFocus onChange={e => setEdit({ ...edit, valor: e.target.value })}>
        {HORAS.map(m => <option key={m} value={m}>{hhmm(m)}{m >= 1440 ? ' (día siguiente)' : ''}</option>)}</select></label>}
      {edit.tipo === 'duracion' && <label>Duración<select value={edit.valor} autoFocus onChange={e => setEdit({ ...edit, valor: e.target.value })}>
        {[60, 90, 120].map(d => <option key={d} value={d}>{d} min</option>)}</select></label>}
      {edit.tipo === 'pct' && <label>% WIN<input inputMode="decimal" className="cfg-num" value={edit.valor} required autoFocus onChange={e => setEdit({ ...edit, valor: e.target.value })} /></label>}
      <div className="cfg-actions"><button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button><button type="button" className="secundario" onClick={() => setEdit(null)}>Cancelar</button></div>
    </form>}
    <table className="cfg-table">
      <thead><tr><th>Ajuste</th><th className="n">Valor</th><th>Para qué sirve</th><th /></tr></thead>
      <tbody>{AJUSTES.map(a => <tr key={a.key}>
        <td>{a.label}</td><td className="n">{mostrar(a, ajustes[a.key])}</td><td className="cfg-ayuda">{a.ayuda}</td>
        <td><button type="button" className="enlace" disabled={busy} onClick={() => setEdit({ ...a, valor: a.tipo === 'pct' ? String(ajustes[a.key]).replace('.', ',') : String(Number(ajustes[a.key])) })}>Cambiar</button></td>
      </tr>)}</tbody>
    </table>
  </section>
}
