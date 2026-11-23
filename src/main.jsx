import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Calendario from './pages/Calendario.jsx'
import { installDemoServer } from './demo/mockServer.js'
import { callApi, clearToken, readToken } from './api.js'
import './styles.css'
import './calendario.css'
import './tema-win.css'

// MODO DEMO (#/demo): pantallas de adentro con datos de ejemplo, sin iniciar sesión ni llamar al backend real.
const DEMO = window.location.hash.startsWith('#/demo')
if (DEMO) installDemoServer()
const RAIZ = DEMO ? '#/demo' : '#/'
const CALENDARIO = DEMO ? '#/demo/calendario' : '#/calendario'

// Versión visible al pie: sube en package.json con cada cambio de código.
function Version() {
  return <footer className="version" aria-label="Versión de la aplicación">WIN Gestión v{__APP_VERSION__} · {__APP_COMMIT__}{DEMO ? ' · DEMO' : ''}</footer>
}

function Raiz() {
  const [hash, setHash] = useState(window.location.hash)
  const [token, setToken] = useState(readToken())
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    const timer = setInterval(() => setToken(readToken()), 1000)
    return () => { window.removeEventListener('hashchange', onHash); clearInterval(timer) }
  }, [])
  const enCalendario = hash === CALENDARIO
  async function salir() {
    try { await callApi('logout') } catch { /* la sesión local se cierra igual */ }
    clearToken(); setToken(null); window.location.hash = RAIZ
  }
  function salirDelDemo() {
    clearToken(); window.location.hash = '#/'; window.location.reload()
  }
  return (
    <>
      {DEMO && (
        <div className="demo-banner" role="status">
          MODO DEMO · datos de ejemplo, no se guarda nada
          <button type="button" className="enlace" onClick={salirDelDemo}>Salir del demo</button>
        </div>
      )}
      <header className="marca">
        <h1>WIN <span>PADEL CLUB</span></h1>
        <small>GESTIÓN · CAJA Y TURNOS</small>
      </header>
      {token && (
        <nav className="subnav" aria-label="Secciones">
          <a href={RAIZ} className={enCalendario ? '' : 'activa'}>Caja</a>
          <a href={CALENDARIO} className={enCalendario ? 'activa' : ''}>Calendario</a>
          {enCalendario && <button type="button" className="enlace" onClick={salir}>Salir</button>}
        </nav>
      )}
      {enCalendario
        ? (token ? <Calendario /> : <main className="centro"><p>Ingresá primero desde <a href={RAIZ}>Caja</a> para ver el calendario.</p></main>)
        : <App />}
      <Version />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Raiz />
  </StrictMode>,
)
