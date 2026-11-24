import {formatMoney} from '../money.js'
// Servidor simulado de Recepción (modo demo). Replica las reglas del Apps Script de recepción
// (WIN Anotaciones): validaciones, superposición de canchas, economía de clases y totales de caja.
// En producción estas reglas viven en la base y en la Edge Function; la pantalla sólo las muestra.

const pad = n => String(n).padStart(2, '0')
const ahora = () => new Date()
const hhmm = (d = ahora()) => new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }).format(d)
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const fail = (message, status = 409, code) => Object.assign(new Error(message), { status, code })
const aMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const aHora = m => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`

const OPCIONES = {
  responsables: ['Bauti', 'Melu'],
  profesores: ['Leo', 'Alejo', 'Pablo', 'Pablo Corsiglia', 'Chino', 'Fede'],
  tarifas: { 1: 60000, 2: 70000, 3: 90000, 4: 100000 },
  porcentajes: { porDefecto: 60, Chino: 55 },
  tiposClase: ['Tradicional', 'Clase-partido'],
  tiposEvento: ['Cancha abierta', 'Torneo'],
  gastos: {
    'Alquiler': ['Septiembre', 'Octubre'], 'Artículos de limpieza': [], 'Sueldos': ['Administración', 'Limpieza', 'Sereno', 'Recepción'],
    'Obra': ['Materiales', 'Electricista', 'Capataz', 'Insumos', 'Gráficas', 'Matafuegos'], 'Mkt': ['Ig'], 'Remax': ['Octubre'],
    'Socios': ['Fede'], 'Servicios': ['Internet'], 'Seguros': ['Emergencia Médica'], 'Gastos de recepción': ['ferretería'],
    'Bar': ['Compras', 'Inversión'], 'Equipamiento pádel': ['Inversión'], 'Equipamiento club': ['Mantenimiento y reparaciones'],
    'Gastos menores': [], 'Otros gastos': [],
  },
  sinCategoria: 'Sin categoría (criterio histórico)',
}

let seq = 0
const e = (o) => ({ id: 'AN-' + (++seq), turno: 'T1', fecha: hoyAR(), registrado: hoyAR() + ' ' + (o.hora || '09:00'), responsable: 'Melu', estado: 'ACTIVA',
  categoria: '', cantidad: 0, alumnos: 0, profesor: '', efectivo: 0, transferencia: 0, importe: 0, medio: '', concepto: '', nota: '', ...o })
const act = (cancha, hora, duracion) => ({ canchas: [cancha], hora, duracion, fin: aHora(aMin(hora) + duracion) })

let turno = { id: 'T1', responsable: 'Melu', apertura: '08:21', saldoInicial: 50000 }
let cierreAnterior = { id: 'T0', contado: 50000 }
let entradas = [
  e({ hora: '09:10', tipo: 'Reserva', categoria: 'Regulares', cantidad: 1, efectivo: 24000, transferencia: 0, actividad: act('C1', '09:00', 90) }),
  e({ hora: '10:05', tipo: 'Reserva', categoria: 'Abonos', cantidad: 1, efectivo: 0, transferencia: 80000, actividad: act('C2', '10:00', 90) }),
  e({ hora: '10:40', tipo: 'Reserva', categoria: 'Regulares', cantidad: 1, efectivo: 0, transferencia: 24000, actividad: act('C3', '10:30', 90) }),
  e({ hora: '11:20', tipo: 'Clase', cantidad: 1, alumnos: 2, profesor: 'Alejo', actividad: act('C4', '11:00', 60),
    economia: { habitual: 70000, cobrado: 70000, remuneracion: 28000, porcentaje: 60, win: 42000 } }),
  e({ hora: '12:15', tipo: 'Tienda', efectivo: 8500, transferencia: 0 }),
  e({ hora: '12:50', tipo: 'Gasto', categoria: 'Artículos de limpieza', importe: 6200, medio: 'Efectivo', concepto: 'Productos de limpieza' }),
]
let avisos = [{ id: 'AV-1', texto: 'Falta cambio en monedas: pedir al banco.', estado: 'PENDIENTE', autor: 'Bauti', fecha: hoyAR() }]

function totales() {
  const t = { efectivo: 0, transferencia: 0, gastosEfectivo: 0, gastosTransferencia: 0, retiros: 0, abonos: 0, regulares: 0, clases: 0 }
  const reg = { n: 0, efectivo: 0, transferencia: 0 }, abo = { n: 0, cobros: 0, efectivo: 0, transferencia: 0 }
  let horas = 0
  for (const x of entradas.filter(r => r.estado === 'ACTIVA')) {
    if (['Reserva', 'Evento', 'Tienda', 'Otro ingreso', 'Rendicion'].includes(x.tipo)) { t.efectivo += x.efectivo; t.transferencia += x.transferencia }
    if (x.tipo === 'Reserva') {
      const dest = x.categoria === 'Abonos' ? abo : reg
      dest.n += x.cantidad; dest.efectivo += x.efectivo; dest.transferencia += x.transferencia
      if (x.categoria === 'Abonos') { t.abonos += x.cantidad; if (x.efectivo + x.transferencia > 0) abo.cobros++ } else t.regulares += x.cantidad
      if (x.cantidad > 0 && x.actividad) horas += x.actividad.duracion / 60
    }
    if (x.tipo === 'Clase') t.clases += x.cantidad
    if (x.tipo === 'Gasto') { if (x.medio === 'Efectivo') t.gastosEfectivo += x.importe; else t.gastosTransferencia += x.importe }
    if (x.tipo === 'Retiro') t.retiros += x.importe
  }
  t.esperado = turno.saldoInicial + t.efectivo - t.gastosEfectivo - t.retiros
  return { totales: t, desglose: { regulares: reg, abonos: abo, horasCancha: horas } }
}

function estado() {
  return {
    turno, cierreAnterior: turno ? null : cierreAnterior, opciones: OPCIONES, avisos,
    ...(turno ? totales() : {}), entradas: turno ? entradas.filter(r => r.estado === 'ACTIVA') : [],
  }
}

const dinero = (v, label, obligatorio = false) => {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw fail('Importe inválido: ' + label, 400)
  if (obligatorio && n <= 0) throw fail('Indicá un importe.', 400)
  return n
}

function actividad(a, { multiple = false, evento = false } = {}) {
  if (!a) throw fail('Completá la cancha y el horario de la actividad.', 400)
  const canchas = [...new Set(a.canchas || [])]
  if (!canchas.length || canchas.some(c => !['C1', 'C2', 'C3', 'C4'].includes(c)) || (!multiple && canchas.length !== 1)) throw fail(evento ? 'Elegí las canchas del evento.' : 'Elegí una cancha.', 400)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.hora || '')) throw fail('Indicá la hora de inicio en formato de 24 horas.', 400)
  let duracion = Number(a.duracion)
  if (evento) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.fin || '')) throw fail('Indicá la hora de finalización.', 400)
    if (a.fin === a.hora) throw fail('Elegí una finalización distinta del inicio.', 400)
    duracion = (aMin(a.fin) - aMin(a.hora) + 1440) % 1440
  }
  if (!Number.isInteger(duracion) || duracion < 1 || duracion > 720) throw fail('Duración inválida.', 400)
  const desde = aMin(a.hora) + (a.diaSiguiente ? 1440 : 0)
  return { canchas, hora: a.hora, duracion, fin: aHora(desde + duracion), diaSiguiente: Boolean(a.diaSiguiente), _desde: desde }
}

function superposicion(fecha, act, excluir) {
  for (const x of entradas.filter(r => r.estado === 'ACTIVA' && r.actividad && r.fecha === fecha && r.id !== excluir)) {
    const d = aMin(x.actividad.hora) + (x.actividad.diaSiguiente ? 1440 : 0)
    if (x.actividad.canchas.some(c => act.canchas.includes(c)) && act._desde < d + x.actividad.duracion && d < act._desde + act.duracion)
      throw fail(`${act.canchas.filter(c => x.actividad.canchas.includes(c)).join(', ')} ya tiene una actividad en ese horario (${x.actividad.hora}–${x.actividad.fin}).`, 409)
  }
}

function economiaClase(a, alumnos, profesor) {
  const pct = OPCIONES.porcentajes[profesor] ?? OPCIONES.porcentajes.porDefecto
  if (a.tipoClase === 'Clase-partido') return { win: dinero(a.importeWIN, 'importe de WIN'), tipo: 'Clase-partido' }
  const habitual = OPCIONES.tarifas[alumnos]
  const profesorHabitual = Math.round(habitual * (100 - pct)) / 100
  const exc = a.excepcion === true
  const cobrado = exc ? dinero(a.cobrado, 'importe real cobrado') : habitual
  const remuneracion = exc && String(a.remuneracion ?? '') !== '' ? dinero(a.remuneracion, 'remuneración del profesor') : profesorHabitual
  if (exc && !String(a.motivoExcepcion || '').trim()) throw fail('Indicá el motivo del acuerdo, descuento o cortesía.', 400)
  return { habitual, cobrado, remuneracion, porcentaje: pct, win: Math.max(0, Math.round((cobrado - remuneracion) * 100) / 100), tipo: 'Tradicional' }
}

function guardar(body) {
  if (!turno || turno.id !== body.turnoId) throw fail('La caja original de la carga ya no está abierta.')
  const a = body.anotacion || {}
  const previo = entradas.find(r => r.requestId === body.requestId)
  if (previo) return estado()
  const fecha = a.fecha || hoyAR()
  if (fecha > hoyAR()) throw fail('No se permite actividad futura.', 400)
  const base = { requestId: body.requestId, fecha, registrado: hoyAR() + ' ' + hhmm(), responsable: turno.responsable, nota: String(a.nota || '').trim().slice(0, 400) }
  let x
  if (a.tipo === 'Reserva') {
    if (!['Abonos', 'Regulares'].includes(a.categoria)) throw fail('Categoría inválida.', 400)
    const efectivo = dinero(a.efectivo, 'efectivo'), transferencia = dinero(a.transferencia, 'transferencia')
    if (a.categoria === 'Abonos' && a.jugado === false) {
      if (efectivo + transferencia <= 0) throw fail('Un abono sin juego requiere un cobro recibido.', 400)
      x = { ...base, tipo: 'Reserva', categoria: 'Abonos', cantidad: 0, efectivo, transferencia, soloCobro: true }
    } else {
      const ac = actividad(a.actividad); superposicion(fecha, ac)
      if (![60, 90, 120].includes(ac.duracion)) throw fail('Los turnos de reserva son de 60, 90 o 120 minutos.', 400)
      if (a.categoria === 'Regulares' && efectivo + transferencia === 0 && !base.nota) throw fail('Indicá el motivo de la cortesía en Observación.', 400)
      x = { ...base, tipo: 'Reserva', categoria: a.categoria, cantidad: 1, efectivo, transferencia, actividad: ac }
    }
  } else if (a.tipo === 'Clase') {
    const alumnos = a.tipoClase === 'Clase-partido' && !a.alumnos ? 0 : Number(a.alumnos)
    if (!Number.isInteger(alumnos) || alumnos < (a.tipoClase === 'Clase-partido' ? 0 : 1) || alumnos > 4) throw fail('Elegí entre 1 y 4 alumnos.', 400)
    const profesor = OPCIONES.profesores.find(p => p === a.profesor)
    if (!profesor) throw fail('Profesor no habilitado.', 400)
    const ac = actividad(a.actividad); superposicion(fecha, ac)
    if (ac.duracion !== (a.tipoClase === 'Clase-partido' ? 90 : 60)) throw fail('La clase particular dura 60 minutos y la clase partido, 90.', 400)
    x = { ...base, tipo: 'Clase', cantidad: 1, alumnos, profesor, actividad: ac, economia: economiaClase(a, alumnos, profesor), incidencia: String(a.incidencia || '').trim().slice(0, 300) }
  } else if (a.tipo === 'Evento') {
    if (!OPCIONES.tiposEvento.includes(a.categoria)) throw fail('Evento inválido.', 400)
    const cantidad = Number(a.cantidad)
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 1000) throw fail('Cantidad de inscriptos inválida.', 400)
    const responsable = String(a.responsableEvento || '').trim().slice(0, 120)
    if (!responsable) throw fail('Indicá el responsable del evento.', 400)
    const ac = actividad(a.actividad, { multiple: true, evento: true }); superposicion(fecha, ac)
    x = { ...base, tipo: 'Evento', categoria: a.categoria, cantidad, concepto: responsable, efectivo: dinero(a.efectivo, 'efectivo cobrado'), transferencia: dinero(a.transferencia, 'transferencia cobrada'), actividad: ac }
  } else if (a.tipo === 'Tienda' || a.tipo === 'Otro ingreso') {
    const concepto = String(a.concepto || '').trim().slice(0, 400)
    if (a.tipo === 'Otro ingreso' && !concepto) throw fail('Indicá concepto.', 400)
    const efectivo = dinero(a.efectivo, 'efectivo'), transferencia = dinero(a.transferencia, 'transferencia')
    if (efectivo + transferencia <= 0) throw fail('Indicá un importe.', 400)
    x = { ...base, tipo: a.tipo, concepto, efectivo, transferencia }
  } else if (a.tipo === 'Gasto' || a.tipo === 'Retiro') {
    const concepto = String(a.concepto || '').trim().slice(0, 400)
    if (!concepto) throw fail(a.tipo === 'Retiro' ? 'Indicá el motivo del retiro.' : 'Indicá concepto.', 400)
    const importe = dinero(a.importe, 'importe', true)
    const disponible = totales().totales.esperado
    if (importe > disponible) throw fail('El importe supera el efectivo disponible en la caja (' + formatMoney(disponible) + ').')
    if (a.tipo === 'Gasto') {
      const categoria = a.categoria || OPCIONES.sinCategoria
      if (categoria !== OPCIONES.sinCategoria && !(categoria in OPCIONES.gastos)) throw fail('Categoría de gasto inválida.', 400)
      x = { ...base, tipo: 'Gasto', categoria, subcategoria: String(a.subcategoria || '').trim().slice(0, 100), importe, medio: 'Efectivo', concepto }
    } else {
      const destinatario = String(a.destinatario || '').trim().slice(0, 120)
      if (!destinatario) throw fail('Indicá quién recibió el efectivo retirado.', 400)
      x = { ...base, tipo: 'Retiro', importe, medio: 'Efectivo', concepto, destinatario }
    }
  } else if (a.tipo === 'Rendicion') {
    throw fail('La rendición de profesores se incorpora en la próxima etapa.', 501)
  } else throw fail('Tipo inválido.', 400)
  entradas.push(e(x))
  return estado()
}

export function recepcion(body) {
  switch (body.action) {
    case 'rec.state': return estado()
    case 'rec.abrir': {
      if (turno) throw fail('Ya hay una caja abierta.')
      const contado = dinero(body.saldoInicial, 'efectivo contado en la apertura')
      if (cierreAnterior && contado !== cierreAnterior.contado && !String(body.motivo || '').trim()) throw fail('Explicá la diferencia de efectivo al recibir el turno.', 409)
      turno = { id: 'T' + (++seq), responsable: 'Admin (demo)', apertura: hhmm(), saldoInicial: contado }
      entradas = []
      return estado()
    }
    case 'rec.guardar': return guardar(body)
    case 'rec.anular': {
      if (!turno || turno.id !== body.turnoId) throw fail('El turno está cerrado.')
      const x = entradas.find(r => r.id === body.id && r.estado === 'ACTIVA')
      if (!x) throw fail('No se encontró una anotación activa.', 404)
      x.estado = 'ANULADA'
      return estado()
    }
    case 'rec.aviso.nuevo': {
      const texto = String(body.texto || '').trim().slice(0, 400)
      if (!texto) throw fail('Escribí el aviso.', 400)
      avisos = [{ id: 'AV-' + (++seq), texto, estado: 'PENDIENTE', autor: turno?.responsable || 'Admin (demo)', fecha: hoyAR() }, ...avisos]
      return estado()
    }
    case 'rec.aviso.resolver': {
      const v = avisos.find(a => a.id === body.id)
      if (v) v.estado = 'RESUELTO'
      return estado()
    }
    case 'rec.cerrar': {
      if (!turno || turno.id !== body.turnoId) throw fail('El turno no está abierto.')
      const t = totales().totales
      const contado = dinero(body.contado, 'efectivo contado'), comprobado = dinero(body.comprobado, 'monto de los comprobantes')
      const cantidad = Number(body.cantidadComprobantes || 0)
      if (!Number.isInteger(cantidad) || cantidad < 0) throw fail('Ingresá una cantidad entera de comprobantes.', 400)
      if ((cantidad === 0) !== (comprobado === 0)) throw fail('Completá el importe y la cantidad real de comprobantes.', 400)
      const difE = Math.round((contado - t.esperado) * 100) / 100, difT = Math.round((comprobado - t.transferencia) * 100) / 100
      if ((difE !== 0 || difT !== 0) && !String(body.observaciones || '').trim()) throw fail('Para cerrar con diferencia, registrá el motivo en las observaciones.', 409)
      cierreAnterior = { id: turno.id, contado }
      turno = null
      return { cierre: { esperado: t.esperado, contado, diferencia: difE, diferenciaTransferencia: difT } }
    }
    default: throw fail('Operación desconocida', 404)
  }
}
