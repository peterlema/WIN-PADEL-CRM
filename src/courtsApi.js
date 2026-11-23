import { readToken } from './api.js'

const COURTS_URL = import.meta.env.VITE_WIN_COURTS_URL || 'https://cqvoherekzntmhyzdidj.supabase.co/functions/v1/win-courts'

// Cliente de la Edge Function win-courts. Mismo token de sesión que win-api.
export async function callCourts(action, data = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = readToken()
  if (token) headers.Authorization = 'Bearer ' + token
  let response
  try {
    response = await fetch(COURTS_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...data }), cache: 'no-store' })
  } catch {
    const e = new Error('No se pudo conectar con el servidor. Podés reintentar: no se duplica la reserva.')
    e.network = true
    throw e
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const e = new Error(result.error || 'No se pudo completar la operación.')
    e.code = result.code
    e.status = response.status
    throw e
  }
  return result
}
