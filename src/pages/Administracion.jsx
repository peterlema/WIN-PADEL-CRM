import { useEffect, useMemo, useState } from 'react'
import { callApi } from '../api.js'
import DatosImportados from '../components/DatosImportados.jsx'

const money = n => '$ ' + Math.round(Number(n)||0).toLocaleString('es-AR')
const fmtDate = iso => new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'2-digit',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'))
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const addDays = (iso,n) => {const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
const startOfWeek = iso => {const d=new Date(iso+'T12:00:00Z');const delta=(d.getUTCDay()+6)%7;return addDays(iso,-delta)}
const endOfMonth = iso => {const [y,m]=iso.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)}
const tabs = [['summary','Resumen General'],['finance','Finanzas'],['activity','Actividad'],['academy','Academia'],['control','Control y herramientas'],['imported','Datos importados']]
const units = {COURTS:'Canchas',ACADEMY:'Academia',EVENTS:'Eventos',CAFE_BAR:'Bar',SHOP:'Tienda',GENERAL:'General'}
const kinds = {SALE:'Venta',DEPOSIT:'Otro ingreso',EXPENSE:'Gasto',WITHDRAWAL:'Retiro',REFUND:'Devolución',ADJUSTMENT:'Ajuste'}
const methods = {CASH:'Efectivo',TRANSFER:'Transferencia',CARD:'Tarjeta',OTHER:'Otro'}
const shortTime = v => new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const planned = {
  activity:{title:'Actividad, Ocupación y Eventos',lead:'Se calcula por fecha de actividad realizada, no por fecha de cobro.',items:[
    ['Reservas regulares y abonos','Cantidad, neto WIN generado y evolución por día'],
    ['Clases','Actividad efectiva y participación del club, sin duplicar las rendiciones'],
    ['Ocupación C1–C4','Horas-cancha ocupadas, capacidad real y mapa de calor por horarios'],
    ['Eventos','Participantes, horas-cancha, neto WIN y comparativas por edición']
  ]},
  academy:{title:'Academia — análisis por profesor',lead:'Bruto, remuneración devengada, neto WIN y dinero rendido son medidas diferentes.',items:[
    ['Profesores','Tabla de clases con 1, 2, 3 y 4 alumnos y promedio por clase'],
    ['Evolución','Clases y neto WIN generado por profesor, comparados por semana'],
    ['Rendiciones','Importes cobrados realmente, pendientes y saldos a favor'],
    ['Comisiones','Porcentaje histórico aplicado en la fecha de cada clase']
  ]}
}
function VerticalBars({rows,keyName='collected',label='Ingresos'}) {
  const max = Math.max(1,...rows.map(r=>Number(r[keyName])||0))
  return <div className="admin-chart" aria-label={label}>
    {rows.map(r=><div className="admin-bar-column" key={r.date}>
      <div className="admin-bar-space" title={fmtDate(r.date)+' · '+money(r[keyName])}><div className={keyName==='expenses'?'admin-bar expense':'admin-bar'} style={{height:(Math.max(0,Number(r[keyName])||0)/max*100)+'%'}}/></div>
      <span>{fmtDate(r.date)}</span><small>{money(r[keyName])}</small>
    </div>)}
  </div>
}
function Stat({label,value,onClick,detail,unavailable=false}) {
  const child=<><small>{label}</small><strong className={unavailable?'admin-stat-pending':''}>{value}</strong>{detail&&<span>{detail}</span>}</>
  return onClick?<button type="button" className="admin-stat" onClick={onClick}>{child}</button>:<div className="admin-stat">{child}</div>
}
export default function Administracion() {
  const [section,setSection]=useState('summary')
  const [range,setRange]=useState('week')
  const [customStart,setCustomStart]=useState(today())
  const [customEnd,setCustomEnd]=useState(today())
  const [report,setReport]=useState(null)
  const [previous,setPrevious]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [detail,setDetail]=useState(null)
  const [expanded,setExpanded]=useState(false)

  const bounds=useMemo(()=>{
    const d=today()
    if(range==='today') return {start:d,end:d}
    if(range==='week') return {start:startOfWeek(d),end:d}
    if(range==='month') return {start:d.slice(0,8)+'01',end:d}
    return {start:customStart,end:customEnd}
  },[range,customStart,customEnd])
  const days=Math.round((new Date(bounds.end+'T12:00:00Z')-new Date(bounds.start+'T12:00:00Z'))/86400000)+1
  const previousBounds={start:addDays(bounds.start,-days),end:addDays(bounds.start,-1)}

  useEffect(()=>{
    if(days<1||days>366) {setError('Elegí un período válido de hasta 366 días.');setReport(null);return}
    if(!['summary','finance','control'].includes(section)) return
    let active=true
    setLoading(true);setError('')
    Promise.all([
      callApi('admin.finance',bounds),
      callApi('admin.finance',previousBounds)
    ]).then(([current,prior])=>{if(active){setReport(current);setPrevious(prior)}})
      .catch(e=>{if(active){setError(e.message||'No se pudieron consultar los reportes.');setReport(null);setPrevious(null)}})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[bounds.start,bounds.end,section])

  const t=report?.totals||{}
  const p=previous?.totals||{}
  const movementRows=(report?.recent||[]).filter(x=>!detail||(
    detail==='collected'?['SALE','DEPOSIT'].includes(x.kind):
    detail==='expenses'?x.kind==='EXPENSE':
    detail==='withdrawals'?x.kind==='WITHDRAWAL':
    detail==='cash'?x.method==='CASH':true
  ))
  function view(target,filter=null){setSection(target);setDetail(filter);setExpanded(false)}
  const variation=(now,was)=>{
    if(!was) return now>0?'Sin base previa':'Sin variación'
    return ((now-was)/Math.abs(was)*100).toLocaleString('es-AR',{maximumFractionDigits:1})+'% vs. período previo'
  }
  return <main className="admin-page">
    <section className="admin-heading"><div><h2>Administración</h2><p>Indicadores y reportes · Acceso exclusivo de administradores</p></div></section>
    <nav className="admin-tabs" aria-label="Secciones de Administración">{tabs.map(([id,title])=><button type="button" key={id} className={section===id?'active':''} onClick={()=>{setSection(id);setDetail(null)}} aria-current={section===id?'page':undefined}>{title}</button>)}</nav>
    {section!=='imported'&&<section className="admin-filters">
      <div className="admin-periods" role="group" aria-label="Período del reporte">
        {[['today','Hoy'],['week','Semana'],['month','Mes'],['custom','Personalizado']].map(([id,label])=><button type="button" key={id} aria-pressed={range===id} onClick={()=>setRange(id)}>{label}</button>)}
      </div>
      {range==='custom'&&<div className="admin-dates"><label>Desde<input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}/></label><label>Hasta<input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/></label></div>}
      <p>{fmtDate(bounds.start)} – {fmtDate(bounds.end)} · Comparación equivalente: {fmtDate(previousBounds.start)} – {fmtDate(previousBounds.end)}</p>
    </section>}
    {error&&<div className="admin-error" role="alert">{error}</div>}
    {loading&&<p className="admin-status" role="status">Actualizando reportes de Supabase…</p>}

    {section==='imported'&&<div className="admin-content"><DatosImportados/></div>}

    {section==='summary'&&<div className="admin-content">
      <section className="admin-card">
        <div className="admin-section-head"><h3>Resumen General</h3><span>Movimientos financieros registrados</span></div>
        <div className="admin-stats">
          <Stat label="Ingresos cobrados" value={report?money(t.collected):'—'} detail={report?variation(Number(t.collected),Number(p.collected)):null} onClick={()=>view('finance','collected')}/>
          <Stat label="Gastos pagados" value={report?money(t.expenses):'—'} detail={report?variation(Number(t.expenses),Number(p.expenses)):null} onClick={()=>view('finance','expenses')}/>
          <Stat label="Resultado financiero operativo" value={report?money(t.result):'—'} detail="Ingresos − gastos registrados; retiros separados" onClick={()=>view('finance')}/>
          <Stat label="Neto generado para WIN" value="Sin integrar" unavailable detail="Requiere actividad realmente realizada y remuneración de profesores" onClick={()=>view('activity')}/>
        </div>
        <p className="admin-disclaimer">Resultado financiero parcial: todavía no incluye necesariamente alquiler, sueldos, obra y todos los gastos administrativos. No representa la utilidad final del club.</p>
      </section>
      <section className="admin-card">
        <div className="admin-section-head"><h3>Ingresos por día</h3><button className="admin-outline" type="button" onClick={()=>view('finance')}>Ver Finanzas</button></div>
        {report?.daily?.length?<VerticalBars rows={report.daily}/>:<p className="admin-empty">Sin datos disponibles para el período.</p>}
      </section>
      <section className="admin-card">
        <h3>Actividad generada para WIN</h3>
        <div className="admin-mini-links">{['Reservas y abonos','Clases','Eventos','Ocupación'].map(x=><button type="button" key={x} onClick={()=>view('activity')}><strong>{x}</strong><span>Ver subreporte · Pendiente de integración</span></button>)}</div>
      </section>
    </div>}

    {section==='finance'&&<div className="admin-content">
      <section className="admin-card">
        <div className="admin-section-head"><h3>Finanzas</h3><span>Fecha real de cobro o egreso</span></div>
        <div className="admin-stats">
          <Stat label="Ingresos cobrados" value={report?money(t.collected):'—'} onClick={()=>setDetail('collected')}/>
          <Stat label="Gastos pagados" value={report?money(t.expenses):'—'} onClick={()=>setDetail('expenses')}/>
          <Stat label="Resultado operativo registrado" value={report?money(t.result):'—'} detail="No es utilidad final" onClick={()=>setDetail(null)}/>
          <Stat label="Efectivo esperado" value="Ver caja activa" detail="Se calcula por turno, no como ganancia" onClick={()=>{window.location.hash='#/'}}/>
        </div>
        <p className="admin-disclaimer">Retiros separados: {report?money(t.withdrawals):'—'}. No se consideran gastos. Reembolsos y ajustes requieren un tratamiento analítico específico antes de incluirse en el resultado.</p>
      </section>
      <section className="admin-card"><h3>Ingresos diarios</h3>{report?.daily?.length?<VerticalBars rows={report.daily}/>:<p className="admin-empty">Sin datos</p>}</section>
      <section className="admin-card"><h3>Gastos diarios</h3>{report?.daily?.length?<VerticalBars rows={report.daily} keyName="expenses" label="Gastos"/>:<p className="admin-empty">Sin datos</p>}</section>
      <section className="admin-card">
        <h3>Por unidad de negocio y categoría</h3>
        <div className="admin-table-wrap"><table><thead><tr><th>Unidad</th><th>Tipo</th><th>Movimientos</th><th>Ingresos</th><th>Gastos</th></tr></thead><tbody>
          {(report?.categories||[]).map((row,i)=><tr key={i}><td>{units[row.unit]||row.unit}</td><td>{kinds[row.kind]||row.kind}</td><td>{row.count}</td><td>{money(row.collected)}</td><td>{money(row.expenses)}</td></tr>)}
          {report&&!report.categories.length&&<tr><td colSpan={5}>Sin movimientos en este período</td></tr>}
        </tbody></table></div>
      </section>
      <section className="admin-card"><h3>Por medio de pago</h3>
        <div className="admin-table-wrap"><table><thead><tr><th>Medio</th><th>Ingresos</th><th>Gastos</th></tr></thead><tbody>
          {(report?.methods||[]).map(row=><tr key={row.method}><td>{methods[row.method]||row.method}</td><td>{money(row.collected)}</td><td>{money(row.expenses)}</td></tr>)}
          {report&&!report.methods.length&&<tr><td colSpan={3}>Sin movimientos</td></tr>}
        </tbody></table></div>
      </section>
      <section className="admin-card">
        <div className="admin-section-head"><h3>Detalle de movimientos</h3><span>Últimos 100 del período</span></div>
        <div className="admin-periods admin-detail-filters">
          {[['all','Todos'],['collected','Ingresos'],['expenses','Gastos'],['withdrawals','Retiros']].map(([key,label])=><button type="button" aria-pressed={(detail||'all')===key} onClick={()=>setDetail(key==='all'?null:key)} key={key}>{label}</button>)}
        </div>
        <div className="admin-table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th>Usuario</th><th>Importe</th></tr></thead><tbody>
          {movementRows.map(r=><tr key={r.id}><td>{shortTime(r.occurredAt)}</td><td>{kinds[r.kind]||r.kind} · {units[r.unit]||r.unit}<small>{r.note}</small></td><td>{methods[r.method]||r.method}</td><td>{r.user}</td><td>{money(r.amount)}</td></tr>)}
          {report&&!movementRows.length&&<tr><td colSpan={5}>Sin movimientos para el filtro.</td></tr>}
        </tbody></table></div>
        {report&&Number(t.entries)>100&&<p className="admin-disclaimer">El detalle muestra como máximo 100 movimientos. Los totales se calculan sobre todos los registros del período.</p>}
      </section>
    </div>}

    {['activity','academy'].includes(section)&&<section className="admin-card">
      <div className="admin-section-head"><h3>{planned[section].title}</h3><span>Integración de datos pendiente</span></div>
      <p>{planned[section].lead}</p>
      <div className="admin-mini-links">{planned[section].items.map(([label,desc])=><div className="admin-plan" key={label}><strong>{label}</strong><span>{desc}</span></div>)}</div>
      <p className="admin-disclaimer">Esta vista está preparada visualmente, pero no presenta números hasta contar con registros verificables de actividad real. Las reservas programadas no se toman como jugadas.</p>
    </section>}

    {section==='control'&&<div className="admin-content">
      <section className="admin-card">
        <h3>Control Diario y herramientas</h3>
        <p>Una única vista administrativa sobre los movimientos de caja. Auditoría, conciliación de comprobantes, aprobaciones y exportación del sistema anterior están pendientes de migrar.</p>
        <div className="admin-mini-links">
          <button onClick={()=>window.location.hash='#/'}><strong>Ir a Recepción</strong><span>Consultar estado y responsable de caja activa</span></button>
          <button onClick={()=>view('finance')}><strong>Movimientos registrados</strong><span>Consultar finanzas, autores, medios y categorías</span></button>
          <div className="admin-plan"><strong>Arqueos y conciliaciones</strong><span>Pendiente de integrar comprobantes y cierres por jornada</span></div>
          <div className="admin-plan"><strong>Correcciones y auditoría</strong><span>Pendiente de interfaz y aprobaciones administrativas</span></div>
          <div className="admin-plan"><strong>Exportaciones</strong><span>Pendiente de migrar sin perder funciones del sistema anterior</span></div>
        </div>
      </section>
      <section className="admin-card"><h3>Control por período</h3>
        <div className="admin-stats">
          <Stat label="Movimientos" value={report?String(t.entries):'—'}/>
          <Stat label="Ingresos registrados" value={report?money(t.collected):'—'}/>
          <Stat label="Retiros de efectivo" value={report?money(t.withdrawals):'—'}/>
          <Stat label="Resultado registrado" value={report?money(t.result):'—'}/>
        </div>
      </section>
    </div>}
  </main>
}
