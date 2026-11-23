import { useState } from 'react'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!/^\d{6}$/.test(pin)) { setError('Ingresá un PIN de seis dígitos.'); return }
    setBusy(true)
    setError('')
    try { await onLogin(username.trim(), pin) }
    catch (err) { setError(err.message || 'No se pudo ingresar.') }
    finally { setPin(''); setBusy(false) }
  }

  return <main className="centro win-login"><form className="tarjeta win-login-card" onSubmit={submit}>
    <div className="win-login-heading"><h1>Bienvenido a WIN</h1><p>Ingresá a la gestión del club.</p></div>
    <label>Nombre de usuario<input value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="username" /></label>
    <label>PIN personal<input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} required autoComplete="off" /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
  <p className="win-login-note">WIN PADEL CLUB · Gestión</p>
  </form></main>
}
