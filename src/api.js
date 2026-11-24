const API_URL = import.meta.env.VITE_WIN_API_URL || 'https://cqvoherekzntmhyzdidj.supabase.co/functions/v1/win-api'
const TOKEN_KEY = 'win_session_token'

export const readToken = () => sessionStorage.getItem(TOKEN_KEY)
export const saveToken = (value) => sessionStorage.setItem(TOKEN_KEY, value)
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY)

export async function callApi(action, data = {}, token = readToken()) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  let response
  try {
    response = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...data }), cache: 'no-store' })
  } catch {
    const e = new Error('No se pudo conectar con el servidor. Comprobá la conexión y consultá el estado antes de repetir.')
    e.network = true
    throw e
  }
  let result
  try { result = await response.json() } catch { const e = new Error('No se pudo leer la confirmación. Consultá el estado antes de repetir.'); e.network = true; throw e }
  if (!response.ok) { const e = new Error(result.error || 'No se pudo completar la operación.'); e.status = response.status; e.code = result.code; e.category = result.category; e.outcome = result.outcome; throw e }
  return result
}
