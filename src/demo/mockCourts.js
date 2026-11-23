// Servidor simulado del calendario de canchas (modo demo). Replica las reglas de las funciones
// win_courts_* de la base: turnos de 90 min, precios 90k efectivo / 100k transferencia, datos del
// cliente, cobro por turno jugado, abonos fijos semanales (con salteo y baja) y quién recibió el efectivo.

const pad = n => String(n).padStart(2, '0')
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const isodow = iso => { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d }
const minutos = s => { const [h, m] = s.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + m }
const hora = m => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`
const fail = (message, status = 409, code) => Object.assign(new Error(message), { status, code })
const PRECIO = { CASH: 90000, TRANSFER: 100000 }

const hoy = hoyAR()
let seq = 0
const PERSONAS = [
  { id: 'p-melu', nombre: 'Melu', rol: 'RECEPTION' }, { id: 'p-bauti', nombre: 'Bauti', rol: 'RECEPTION' },
  { id: 'p-peter', nombre: 'Peter', rol: 'ADMIN' }, { id: 'demo', nombre: 'Usuario demo', rol: 'ADMIN' },
]
let horarios = [
  { id: 'h1', cuentaId: 'p-melu', nombre: 'Melu', diaSemana: 1, desde: '08:00', hasta: '16:00' },
  { id: 'h2', cuentaId: 'p-bauti', nombre: 'Bauti', diaSemana: 1, desde: '16:00', hasta: '00:00' },
]
const nueva = (dias, cancha, inicio, duracion, tipo, titular, extra = {}) => ({
  id: 'demo-' + (++seq), cancha, fecha: sumarDias(hoy, dias), inicio, duracion, tipo, titular, nota: '', estado: 'CONFIRMED',
  creadoPor: 'Melu', creadoPorId: 'p-melu', nombreCompleto: null, whatsapp: null, metodoPrevisto: null, montoPrevisto: null, pago: null, ...extra,
})
const reserva = (dias, cancha, inicio, nombre, _metodo, pago = null) =>
  nueva(dias, cancha, inicio, 90, 'RESERVA', nombre, { nombreCompleto: nombre, whatsapp: '5491155550000', metodoPrevisto: null, montoPrevisto: null, pago })
const pagado = (metodo, extra = {}) => ({ id: 'pg-' + (++seq), metodo, monto: PRECIO[metodo], recibio: metodo === 'CASH' ? 'p-melu' : null, comprobante: metodo === 'TRANSFER', ruta: null, fecha: new Date().toISOString(), ...extra })

const reservas = [
  reserva(0, 'C1', '10:00', 'Lucía Fernández', 'TRANSFER', pagado('TRANSFER')),
  reserva(0, 'C1', '18:00', 'Juan Pérez', 'CASH'),
  nueva(0, 'C2', '19:00', 60, 'CLASE', 'Clase · prof. Chino'),
  nueva(0, 'C3', '20:00', 120, 'EVENTO', 'Torneo del viernes'),
  nueva(0, 'C4', '23:30', 90, 'BLOQUEO', 'Mantenimiento'),
  reserva(1, 'C1', '18:00', 'Martín Gómez', 'CASH'), reserva(1, 'C2', '18:00', 'Sofía Díaz', 'TRANSFER'),
  reserva(-1, 'C1', '19:30', 'Ana López', 'CASH', pagado('CASH')), reserva(-1, 'C3', '21:00', 'Pablo Soto', 'TRANSFER'),
]
const abonos = [
  { id: 'ab-1', cancha: 'C3', diaSemana: isodow(hoy), inicio: '18:00', nombreCompleto: 'Laura Martínez', whatsapp: '5491166660000', metodoPrevisto: null, desde: sumarDias(hoy, -21), hasta: null },
  { id: 'ab-2', cancha: 'C4', diaSemana: isodow(hoy), inicio: '19:30', nombreCompleto: 'Carlos Soto', whatsapp: '5491177770000', metodoPrevisto: null, desde: sumarDias(hoy, -14), hasta: null },
]
const saltos = []
const pagosAbono = [{ abonoId: 'ab-1', fecha: sumarDias(hoy, -7), pago: pagado('CASH') }]

const solapa = (aIni, aDur, bIni, bDur) => minutos(aIni) < minutos(bIni) + bDur && minutos(bIni) < minutos(aIni) + aDur
const abonoActivo = (a, fecha) => a.diaSemana === isodow(fecha) && a.desde <= fecha && (!a.hasta || fecha <= a.hasta) && !saltos.some(s => s.abonoId === a.id && s.fecha === fecha)
const fin = (inicio, dur) => hora(minutos(inicio) + dur)
const ocurrencia = a => fecha => ({
  id: a.id, abonoId: a.id, cancha: a.cancha, fecha, inicio: a.inicio, fin: fin(a.inicio, 90), duracion: 90, tipo: 'ABONO', titular: a.nombreCompleto,
  nombreCompleto: a.nombreCompleto, whatsapp: a.whatsapp, metodoPrevisto: a.metodoPrevisto, montoPrevisto: null, nota: '',
  estado: 'CONFIRMED', creadoPor: 'Melu', creadoPorId: 'p-melu', desde: a.desde,
  pago: pagosAbono.find(p => p.abonoId === a.id && p.fecha === fecha)?.pago || null,
})
const conPersona = p => p && { ...p, recibioNombre: PERSONAS.find(x => x.id === p.recibio)?.nombre || '' }

function deTurno(ahora = new Date()) {
  const dow = isodow(hoy), t = pad(ahora.getHours()) + ':' + pad(ahora.getMinutes())
  return horarios.filter(h => h.diaSemana === dow && (h.desde < h.hasta ? t >= h.desde && t < h.hasta : t >= h.desde)).map(h => h.cuentaId)
}

export function courts(body, usuario) {
  const esAdmin = usuario.role === 'ADMIN'
  switch (body.action) {
    case 'courts.day': {
      const fecha = body.date
      const lista = [
        ...reservas.filter(r => r.fecha === fecha && r.estado === 'CONFIRMED').map(r => ({ ...r, fin: fin(r.inicio, r.duracion), pago: conPersona(r.pago) })),
        ...abonos.filter(a => abonoActivo(a, fecha)).map(a => { const o = ocurrencia(a)(fecha); return { ...o, pago: conPersona(o.pago) } }),
      ].sort((a, b) => minutos(a.inicio) - minutos(b.inicio))
      return { fecha, canchas: ['C1', 'C2', 'C3', 'C4'], precio: { efectivo: PRECIO.CASH, transferencia: PRECIO.TRANSFER }, reservas: lista }
    }
    case 'courts.month': {
      const dias = {}
      const [y, m] = body.month.split('-').map(Number)
      for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
        const fecha = `${body.month}-${pad(d)}`
        const n = reservas.filter(r => r.fecha === fecha && r.estado === 'CONFIRMED')
        const ab = abonos.filter(a => abonoActivo(a, fecha))
        const total = n.length + ab.length
        if (total) dias[fecha] = { reservas: total, minutos: n.reduce((a, r) => a + r.duracion, 0) + ab.length * 90 }
      }
      return { mes: body.month, dias }
    }
    case 'courts.book': {
      const kind = body.kind
      const nombre = String(body.customerName || '').trim().replace(/\s+/g, ' ')
      const wpp = String(body.whatsapp || '').replace(/\D/g, '')
      if (kind === 'RESERVA' && (!/^\S+ \S+/.test(nombre) || !/^\d{8,15}$/.test(wpp))) throw fail('Completá nombre y apellido y WhatsApp.', 400, 'CUSTOMER_REQUIRED')
      if (!/^([01]\d|2[0-3]):(00|30)$/.test(body.start || '')) throw fail('Revisá los datos de la reserva.', 400, 'BOOKING_INVALID')
      const dur = Number(body.duration)
      if ((kind === 'RESERVA' && dur !== 90) || (kind === 'CLASE' && ![60, 90, 120].includes(dur))) throw fail('La duración no está permitida para ese tipo de reserva.', 400, 'DURATION_INVALID')
      const titular = kind === 'RESERVA' ? nombre : String(body.holder || '').trim()
      if (!titular) throw fail('Revisá los datos de la reserva.', 400, 'BOOKING_INVALID')
      const previa = reservas.find(r => r.requestId === body.requestId)
      if (previa) return previa
      const choca = reservas.some(r => r.estado === 'CONFIRMED' && r.cancha === body.court && r.fecha === body.date && solapa(r.inicio, r.duracion, body.start, dur))
        || abonos.some(a => a.cancha === body.court && abonoActivo(a, body.date) && solapa(a.inicio, 90, body.start, dur))
      if (choca) throw fail('Esa cancha ya está ocupada en ese horario. Actualizá el calendario.', 409, 'COURT_TAKEN')
      const r = nueva(0, body.court, body.start, dur, kind, titular, kind === 'RESERVA'
        ? { nombreCompleto: nombre, whatsapp: wpp } : {})
      Object.assign(r, { fecha: body.date, requestId: body.requestId, creadoPor: 'Vos (demo)', creadoPorId: 'demo', nota: body.note || '' })
      reservas.push(r)
      return r
    }
    case 'courts.cancel': {
      const r = reservas.find(x => x.id === body.bookingId && x.estado === 'CONFIRMED')
      if (!r) throw fail('La reserva no existe o ya fue cancelada.', 404, 'BOOKING_NOT_FOUND')
      if (r.pago) throw fail('Ese turno ya tiene el cobro registrado y no se puede cancelar ni saltear.', 409, 'BOOKING_PAID')
      if (!String(body.reason || '').trim()) throw fail('Indicá el motivo de la cancelación.', 400, 'REASON_REQUIRED')
      r.estado = 'CANCELLED'
      return r
    }
    case 'courts.pay': {
      if (!['CASH', 'TRANSFER'].includes(body.method)) throw fail('Revisá los datos del cobro.', 400, 'PAYMENT_INVALID')
      if (body.receiptPath && body.method !== 'TRANSFER') throw fail('Revisá los datos del cobro.', 400, 'PAYMENT_INVALID')
      const recibio = body.method === 'CASH' ? (body.receivedBy || deTurno()[0] || usuario.id) : null
      const nuevoPago = { id: 'pg-' + (++seq), metodo: body.method, monto: PRECIO[body.method], recibio, comprobante: Boolean(body.receiptPath), ruta: body.receiptPath || null, fecha: new Date().toISOString() }
      if (body.bookingId) {
        const r = reservas.find(x => x.id === body.bookingId && x.estado === 'CONFIRMED' && x.tipo === 'RESERVA')
        if (!r) throw fail('La reserva no existe o ya fue cancelada.', 404, 'BOOKING_NOT_FOUND')
        if (r.pago) throw fail('Ese turno ya tiene el cobro registrado.', 409, 'ALREADY_PAID')
        if (!esAdmin && new Date(new Date(`${r.fecha}T${r.inicio}:00-03:00`).getTime() + r.duracion * 60000) > new Date()) throw fail('El cobro se marca cuando termina el turno.', 409, 'PAY_TOO_EARLY')
        r.pago = nuevoPago
      } else {
        const a = abonos.find(x => x.id === body.abonoId)
        if (!a || !abonoActivo(a, body.date)) throw fail('La reserva no existe o ya fue cancelada.', 404, 'BOOKING_NOT_FOUND')
        if (pagosAbono.some(p => p.abonoId === a.id && p.fecha === body.date)) throw fail('Ese turno ya tiene el cobro registrado.', 409, 'ALREADY_PAID')
        if (!esAdmin && new Date(new Date(`${body.date}T${a.inicio}:00-03:00`).getTime() + 90 * 60000) > new Date()) throw fail('El cobro se marca cuando termina el turno.', 409, 'PAY_TOO_EARLY')
        pagosAbono.push({ abonoId: a.id, fecha: body.date, pago: nuevoPago })
      }
      return nuevoPago
    }
    case 'courts.abono.create': {
      const nombre = String(body.customerName || '').trim().replace(/\s+/g, ' ')
      const wpp = String(body.whatsapp || '').replace(/\D/g, '')
      if (!/^\S+ \S+/.test(nombre) || !/^\d{8,15}$/.test(wpp)) throw fail('Completá nombre y apellido y WhatsApp.', 400, 'CUSTOMER_REQUIRED')
      const dow = isodow(body.date)
      const choca = abonos.some(a => a.cancha === body.court && a.diaSemana === dow && !a.hasta && solapa(a.inicio, 90, body.start, 90))
        || reservas.some(r => r.estado === 'CONFIRMED' && r.cancha === body.court && r.fecha >= body.date && isodow(r.fecha) === dow && solapa(r.inicio, r.duracion, body.start, 90))
      if (choca) throw fail('Ese horario ya lo ocupa otra reserva o abono en alguna fecha. Revisá el calendario.', 409, 'ABONO_CONFLICT')
      const a = { id: 'ab-' + (++seq), cancha: body.court, diaSemana: dow, inicio: body.start, nombreCompleto: nombre, whatsapp: wpp, metodoPrevisto: null, desde: body.date, hasta: null }
      abonos.push(a)
      return { id: a.id, cancha: a.cancha, diaSemana: dow, inicio: a.inicio, desde: a.desde }
    }
    case 'courts.abono.end': {
      const a = abonos.find(x => x.id === body.abonoId && !x.hasta)
      if (!a) throw fail('La reserva no existe o ya fue cancelada.', 404, 'BOOKING_NOT_FOUND')
      if (!String(body.reason || '').trim()) throw fail('Indicá el motivo de la cancelación.', 400, 'REASON_REQUIRED')
      a.hasta = sumarDias(body.from, -1)
      return { id: a.id, terminaEl: a.hasta }
    }
    case 'courts.abono.skip': {
      const a = abonos.find(x => x.id === body.abonoId)
      if (!a) throw fail('La reserva no existe o ya fue cancelada.', 404, 'BOOKING_NOT_FOUND')
      if (body.undo) { const i = saltos.findIndex(s => s.abonoId === a.id && s.fecha === body.date); if (i >= 0) saltos.splice(i, 1); return { salteado: false } }
      if (!String(body.reason || '').trim()) throw fail('Indicá el motivo de la cancelación.', 400, 'REASON_REQUIRED')
      if (pagosAbono.some(p => p.abonoId === a.id && p.fecha === body.date)) throw fail('Ese turno ya tiene el cobro registrado y no se puede cancelar ni saltear.', 409, 'BOOKING_PAID')
      saltos.push({ abonoId: a.id, fecha: body.date, motivo: body.reason })
      return { salteado: true }
    }
    case 'courts.receivers': {
      const turno = deTurno()
      return { deTurno: turno, personas: PERSONAS.map(p => ({ id: p.id, nombre: p.nombre, rol: p.rol, deTurno: turno.includes(p.id) })) }
    }
    case 'courts.schedule.list': if (!esAdmin) throw fail('Tu usuario no tiene permisos para esta acción.', 403, 'NOT_AUTHORIZED'); return horarios
    case 'courts.schedule.set': {
      if (!esAdmin) throw fail('Tu usuario no tiene permisos para esta acción.', 403, 'NOT_AUTHORIZED')
      if (body.from === body.to) throw fail('Revisá el día y el horario.', 400, 'SCHEDULE_INVALID')
      const h = { id: 'h' + (++seq), cuentaId: body.accountId, nombre: PERSONAS.find(p => p.id === body.accountId)?.nombre || '', diaSemana: Number(body.weekday), desde: body.from, hasta: body.to }
      horarios.push(h); return { id: h.id }
    }
    case 'courts.schedule.delete': horarios = horarios.filter(h => h.id !== body.id); return { id: body.id }
    case 'courts.receipt.url': return { path: `${hoy.slice(0, 7)}/${crypto.randomUUID()}.jpg`, uploadUrl: 'https://demo.invalid/upload/comprobante', token: 'demo' }
    case 'courts.receipt.view': return { url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="#f3f4f7"/><text x="180" y="110" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#232344">Comprobante (demo)</text><text x="180" y="145" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#667085">Transferencia recibida</text></svg>') }
    default: throw fail('Operación desconocida', 404)
  }
}
