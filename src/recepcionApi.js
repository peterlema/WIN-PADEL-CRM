import { readToken } from './api.js'

// Cliente de la futura Edge Function win-recepcion (hoy sólo responde el modo demo, #/demo).
const URL_RECEPCION = import.meta.env.VITE_WIN_RECEPCION_URL || 'https://cqvoherekzntmhyzdidj.supabase.co/functions/v1/win-recepcion'

export async function callRecepcion(action, data = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = readToken()
  if (token) headers.Authorization = 'Bearer ' + token
  let response
  try {
    response = await fetch(URL_RECEPCION, { method: 'POST', headers, body: JSON.stringify({ action, ...data }), cache: 'no-store' })
  } catch {
    const e = new Error('No se pudo conectar con el servidor. Consultá el estado antes de repetir: la operación podría haberse registrado.')
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
