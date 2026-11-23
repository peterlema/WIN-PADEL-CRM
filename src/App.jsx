import { useEffect, useState } from 'react'
import Login from './pages/Login.jsx'
import Panel from './pages/Panel.jsx'
import { callApi, readToken, saveToken, clearToken } from './api.js'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const token = readToken()
    if (!token) { setLoading(false); return }
    callApi('me', {}, token).then(r => setUser(r.user)).catch(() => clearToken()).finally(() => setLoading(false))
  }, [])
  async function onLogin(username, pin) {
    const result = await callApi('login', { username, pin }, null)
    saveToken(result.token)
    setUser(result.user)
  }
  async function onLogout() {
    try { await callApi('logout') } catch { /* expire local session regardless */ }
    clearToken()
    setUser(null)
  }
  if (loading) return <main className="centro"><p>Verificando sesión…</p></main>
  return user ? <Panel user={user} onLogout={onLogout} /> : <Login onLogin={onLogin} />
}
