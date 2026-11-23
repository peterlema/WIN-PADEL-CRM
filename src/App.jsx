import { useEffect, useState } from 'react'
import { supabase, supabaseConfigurado } from './supabaseClient.js'
import Login from './pages/Login.jsx'
import Panel from './pages/Panel.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!supabaseConfigurado) {
      setCargando(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSession(nuevaSesion)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigurado) {
    return (
      <main className="centro">
        <div className="tarjeta">
          <h1>WIN Gestión</h1>
          <p className="error">
            Falta configurar Supabase: copiá <code>.env.example</code> a <code>.env.local</code> y completá
            la URL y la clave pública.
          </p>
        </div>
      </main>
    )
  }

  if (cargando) return <main className="centro">Cargando…</main>

  return session ? <Panel session={session} /> : <Login />
}
