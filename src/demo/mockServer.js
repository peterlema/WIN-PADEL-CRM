import { recepcion } from './mockRecepcion.js'

// MODO DEMO: servidor simulado en el navegador, con datos de ejemplo.
// Se activa sólo con la dirección #/demo. No llama a Supabase ni guarda nada: al recargar vuelve a empezar.
// Sirve para ver las pantallas de adentro sin iniciar sesión y sin abrir el backend real.

const pad = n => String(n).padStart(2, '0')
const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const aMin = s => { const [h, m] = s.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + m }
const aHora = m => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code })

const hoy = hoyAR()
let seq = 0
const nueva = (dias, cancha, inicio, duracion, tipo, titular, nota = '') => ({
  id: 'demo-' + (++seq), cancha, fecha: sumarDias(hoy, dias), inicio, duracion, tipo, titular, nota,
  estado: 'CONFIRMED', creadoPor: 'Recepción (demo)', creadoPorId: 'demo',
})
const reservas = [
  nueva(0, 'C1', '18:00', 90, 'RESERVA', 'Juan Pérez'), nueva(0, 'C2', '19:00', 60, 'CLASE', 'Clase · prof. Chino'),
  nueva(0, 'C3', '20:00', 120, 'EVENTO', 'Torneo del viernes'), nueva(0, 'C4', '23:30', 90, 'BLOQUEO', 'Mantenimiento'),
  nueva(0, 'C1', '10:00', 90, 'RESERVA', 'Lucía Fernández'),
  nueva(1, 'C1', '18:00', 90, 'RESERVA', 'Martín Gómez'), nueva(1, 'C2', '18:00', 90, 'RESERVA', 'Sofía Díaz'),
  nueva(2, 'C1', '09:00', 60, 'CLASE', 'Clase · prof. Chino'), nueva(2, 'C2', '10:30', 90, 'RESERVA', 'Carlos Ruiz'),
  nueva(2, 'C3', '18:00', 120, 'EVENTO', 'Cancha abierta'), nueva(2, 'C4', '18:00', 120, 'EVENTO', 'Cancha abierta'),
  nueva(-1, 'C1', '19:00', 90, 'RESERVA', 'Ana López'), nueva(-1, 'C3', '20:30', 90, 'RESERVA', 'Pablo Soto'),
]
for (let h = 8; h < 24; h += 2) { reservas.push(nueva(3, 'C1', `${pad(h)}:00`, 90, 'RESERVA', 'Abono lunes')); reservas.push(nueva(3, 'C2', `${pad(h)}:00`, 90, 'RESERVA', 'Abono martes')) }

const caja = { id: 'demo-turno', business_date: hoy, opened_by: 'demo', opening_cash: 50000, expected_cash: 85000 }
let turno = { ...caja }

function courts(body) {
  const activas = reservas.filter(r => r.estado === 'CONFIRMED')
  if (body.action === 'courts.day') {
    return { fecha: body.date, canchas: ['C1', 'C2', 'C3', 'C4'],
      reservas: activas.filter(r => r.fecha === body.date).map(r => ({ ...r, fin: aHora(aMin(r.inicio) + r.duracion) }))
        .sort((a, b) => aMin(a.inicio) - aMin(b.inicio)) }
  }
  if (body.action === 'courts.month') {
    const dias = {}
    for (const r of activas.filter(r => r.fecha.startsWith(body.month))) {
      dias[r.fecha] ||= { reservas: 0, minutos: 0 }
      dias[r.fecha].reservas++; dias[r.fecha].minutos += r.duracion
    }
    return { mes: body.month, dias }
  }
  if (body.action === 'courts.book') {
    if (!/^([01]\d|2[0-3]):(00|30)$/.test(body.start || '') || !body.holder?.trim()) throw fail('Revisá los datos de la reserva.', 400, 'BOOKING_INVALID')
    if (body.kind === 'RESERVA' && Number(body.duration) !== 90) throw fail('La duración no está permitida para ese tipo de reserva.', 400, 'DURATION_INVALID')
    const ini = aMin(body.start), fin = ini + Number(body.duration)
    const existente = reservas.find(r => r.requestId === body.requestId)
    if (existente) return existente
    if (activas.some(r => r.cancha === body.court && r.fecha === body.date && ini < aMin(r.inicio) + r.duracion && aMin(r.inicio) < fin))
      throw fail('Esa cancha ya está ocupada en ese horario. Actualizá el calendario.', 409, 'COURT_TAKEN')
    const r = { id: 'demo-' + (++seq), requestId: body.requestId, cancha: body.court, fecha: body.date, inicio: body.start,
      duracion: Number(body.duration), tipo: body.kind, titular: body.holder.trim(), nota: body.note || '',
      estado: 'CONFIRMED', creadoPor: 'Vos (demo)', creadoPorId: 'demo' }
    reservas.push(r)
    return r
  }
  if (body.action === 'courts.cancel') {
    const r = reservas.find(x => x.id === body.bookingId && x.estado === 'CONFIRMED')
    if (!r) throw fail('La reserva no existe o ya fue cancelada.', 404, 'BOOKING_NOT_FOUND')
    if (!String(body.reason || '').trim()) throw fail('Indicá el motivo de la cancelación.', 400, 'REASON_REQUIRED')
    r.estado = 'CANCELLED'
    return r
  }
  throw fail('Operación desconocida', 404)
}

let usuario = { id: 'demo', name: 'Usuario demo', role: 'ADMIN' }

function api(body) {
  switch (body.action) {
    case 'login': return { token: 'd'.repeat(64), user: usuario, expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString() }
    case 'me': return { user: usuario, expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString() }
    case 'logout': return { ok: true }
    case 'cash.state': return { shift: turno ? { ...turno } : null }
    case 'cash.open':
      if (turno) throw fail('Ya hay una caja abierta.', 409)
      turno = { ...caja, opening_cash: Number(body.amount), expected_cash: Number(body.amount) }; return { shift: turno }
    case 'cash.entry': {
      if (!turno) throw fail('La caja ya no está abierta.', 409)
      const importe = Number(body.amount)
      if (!(importe > 0)) throw fail('Revisá el importe.', 409)
      if (body.method === 'CASH') turno.expected_cash += ['SALE', 'DEPOSIT'].includes(body.kind) ? importe : -importe
      return { ok: true }
    }
    case 'cash.close': turno = null; return { ok: true }
    default: return String(body.action).startsWith('rec.') ? recepcion(body) : courts(body)
  }
}

export function installDemoServer({ rol = 'ADMIN', nombre = 'Usuario demo' } = {}) {
  usuario = { id: 'demo', name: nombre, role: rol }
  const real = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    if (!/\/functions\/v1\/win-(api|courts|recepcion)$/.test(url)) return real(input, init)
    await new Promise(r => setTimeout(r, 120))
    const headers = { 'Content-Type': 'application/json' }
    try { return new Response(JSON.stringify(api(JSON.parse(init.body || '{}'))), { status: 200, headers }) }
    catch (e) { return new Response(JSON.stringify({ error: e.message, code: e.code }), { status: e.status || 500, headers }) }
  }
  sessionStorage.setItem('win_session_token', 'd'.repeat(64))
}
