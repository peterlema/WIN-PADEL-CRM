import {usersDemo} from './mockUsers.js'
import { recepcion } from './mockRecepcion.js'
import { courts } from './mockCourts.js'
import { configDemo } from './mockConfig.js'
import { operationsDemo } from './mockOperations.js'
import { calendarDemo } from './mockCalendar.js'

// MODO DEMO: servidor simulado en el navegador, con datos de ejemplo.
// Se activa sólo con la dirección #/demo. No llama a Supabase ni guarda nada: al recargar vuelve a empezar.
// Sirve para ver las pantallas de adentro sin iniciar sesión y sin abrir el backend real.

const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code })
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const caja = { id: 'demo-turno', business_date: hoy, opened_by: 'demo', opening_cash: 50000, expected_cash: 85000 }
let turno = { ...caja }

let usuario = { id: 'demo', name: 'Usuario demo', role: 'ADMIN' }

function api(body) {
  if(String(body.action).startsWith('users.')) return usersDemo(body,usuario)
  if(String(body.action).startsWith('calendar.')) return calendarDemo(body)
  if(String(body.action).startsWith('ops.')) return operationsDemo(body)
  switch (body.action) {
    case 'login': return { token: 'd'.repeat(64), user: usuario, expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString() }
    case 'me': return { user: usuario, expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString() }
    case 'logout': return { ok: true }
    case 'reception.overview': return {
      shift: turno ? {id:turno.id, opened_by:'demo', responsible:'Usuario demo', opened_at:new Date().toISOString(), business_date:turno.business_date, opening_cash:turno.opening_cash} : null,
      totals: turno ? {cash_expected:turno.expected_cash, transfer_received:18000, transfer_out:0,cash_received:35000,cash_out:0,movements_count:2} : null,
      movements: turno ? [
        {id:'sample-1',date:new Date().toISOString(),kind:'SALE',unit:'SHOP',paymentMethod:'CASH',amount:15000,note:'Venta de pelotas',recordedBy:'Recepción demo',shiftOwner:'Recepción demo'},
        {id:'sample-2',date:new Date().toISOString(),kind:'SALE',unit:'GENERAL',paymentMethod:'TRANSFER',amount:18000,note:'Ingreso de prueba',recordedBy:'Recepción demo',shiftOwner:'Recepción demo'}
      ] : [],
      activitiesAvailable:false, noticesAvailable:false, limitedHistory:true
    }
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
    case 'config.list': return configDemo.list()
    case 'settings.get': return configDemo.settings()
    case 'config.setting.set': return configDemo.setting(body)
    case 'config.item.save': return configDemo.item(body)
    case 'config.coach.save': return configDemo.coach(body)
    case 'config.price.set': return configDemo.price(body)
    case 'config.price.cancel': return configDemo.cancel(body)
    default: return String(body.action).startsWith('rec.') ? recepcion(body) : courts(body, usuario)
  }
}

export function installDemoServer({ rol = 'ADMIN', nombre = 'Usuario demo' } = {}) {
  usuario = { id: 'demo', name: nombre, role: rol }
  const real = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    if (/demo\.invalid\/upload/.test(url)) return new Response('{}', { status: 200 })
    if (!/\/functions\/v1\/win-(api|courts|recepcion)$/.test(url)) return real(input, init)
    await new Promise(r => setTimeout(r, 120))
    const headers = { 'Content-Type': 'application/json' }
    try { return new Response(JSON.stringify(api(JSON.parse(init.body || '{}'))), { status: 200, headers }) }
    catch (e) { return new Response(JSON.stringify({ error: e.message, code: e.code }), { status: e.status || 500, headers }) }
  }
  sessionStorage.setItem('win_session_token', 'd'.repeat(64))
}
