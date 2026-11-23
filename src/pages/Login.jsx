import { useState } from 'react'
import { supabase } from '../supabaseClient.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function ingresar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password: clave })
    setEnviando(false)
    if (err) setError('Email o clave incorrectos.')
  }

  return (
    <main className="centro">
      <form className="tarjeta" onSubmit={ingresar}>
        <h1>WIN Gestión</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Clave
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </main>
  )
}
