import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Calendario from './pages/Calendario.jsx'
import Recepcion from './pages/Recepcion.jsx'
import Bar from './pages/Bar.jsx'
import Administracion from './pages/OperationalAdmin.jsx'
import Configuracion from './pages/Configuracion.jsx'
import { installDemoServer } from './demo/mockServer.js'
import { callApi, clearToken, readToken } from './api.js'
import './styles.css'
import './calendario.css'
import './recepcion.css'
import './recepcion-v5.css'
import './bar.css'
import './admin.css'
import './config.css'
import './tema-win.css'
import './operations.css'
import './bar-daily.css'

// MODO DEMO (#/demo): pantallas de adentro con datos de ejemplo, sin iniciar sesión ni llamar al backend real.
const DEMO = window.location.hash.startsWith('#/demo')
// #/demo/bar muestra la vista del empleado de Bar (sólo esa pestaña).
const DEMO_BAR = window.location.hash.startsWith('#/demo/bar')
if (DEMO) installDemoServer(DEMO_BAR ? { rol: 'BAR', nombre: 'Gerson (demo)' } : {})
const RAIZ = DEMO ? '#/demo/caja' : '#/'
const CALENDARIO = DEMO ? '#/demo/calendario' : '#/calendario'
const BAR = DEMO ? '#/demo/bar' : '#/bar'
const ADMIN = DEMO ? '#/demo/admin' : '#/admin'
const CONFIG = DEMO ? '#/demo/config' : '#/config'
const RECEPCION = '#/demo'
const rutaDe = hash => (DEMO ? hash.replace(/^#\/demo\/?/, '') : hash.replace(/^#\/?/, ''))

// Versión visible al pie: sube en package.json con cada cambio de código.
function Version() {
  return <footer className="version" aria-label="Versión de la aplicación">WIN Gestión v{__APP_VERSION__} · {__APP_COMMIT__}{DEMO ? ' · DEMO' : ''}</footer>
}

function RecepcionConUsuario({ onSalir }) {
  const [user, setUser] = useState(null)
  useEffect(() => { callApi('me').then(r => setUser(r.user)).catch(() => {}) }, [])
  return user ? <Recepcion user={user} onSalir={onSalir} /> : <main className="rec"><p>Cargando…</p></main>
}

function Raiz() {
  const [hash, setHash] = useState(window.location.hash)
  const [token, setToken] = useState(readToken())
  const [rol, setRol] = useState(null)
  const [barAccess,setBarAccess]=useState(false)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    const timer = setInterval(() => setToken(readToken()), 1000)
    return () => { window.removeEventListener('hashchange', onHash); clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!token) { setRol(null); return }
    callApi('me').then(r => setRol(r.user.role)).catch(() => {})
    callApi('bar.inventory.access').then(r=>setBarAccess(r.allowed===true)).catch(()=>setBarAccess(false))
  }, [token])
  const ruta = rutaDe(hash)
  const enCalendario = ruta === 'calendario'
  const enBar = ruta === 'bar'
  const enAdmin = ruta === 'admin'
  const enConfig = ruta === 'config'
  const enRecepcion = DEMO && (ruta === '' || ruta === 'recepcion')
  async function salir() {
    try { await callApi('logout') } catch { /* la sesión local se cierra igual */ }
    clearToken(); setToken(null); window.location.hash = RAIZ
  }
  function salirDelDemo() {
    clearToken(); window.location.hash = '#/'; window.location.reload()
  }
  if (token && rol === null) return <><header className="marca"><div><h1>WIN <span>PADEL CLUB</span></h1><small>GESTIÓN · CAJA Y TURNOS</small></div></header><main className="centro"><p>Verificando sesión…</p></main><Version /></>
  if (token && rol === 'BAR') {
    return (
      <>
        {DEMO && <div className="demo-banner" role="status">MODO DEMO · vista del empleado de Bar<button type="button" className="enlace" onClick={salirDelDemo}>Salir del demo</button></div>}
        <header className="marca"><div><h1>WIN <span>PADEL CLUB</span></h1><small>GESTIÓN · BAR</small></div><span className="pill">Bar</span></header>
        <nav className="subnav" aria-label="Sesión"><span className="subnav-usuario">Bar / Buffet</span><button type="button" className="enlace" onClick={DEMO ? salirDelDemo : salir}>Salir</button></nav>
        <Bar soloVenta />
        <Version />
      </>
    )
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
        <div><h1>WIN <span>PADEL CLUB</span></h1><small>GESTIÓN · CAJA Y TURNOS</small></div>
        <span className="pill">Módulo 01</span>
      </header>
      {token && (
        <nav className="subnav" aria-label="Secciones">
          {DEMO && <a href={RECEPCION} className={enRecepcion ? 'activa' : ''}>Recepción (borrador)</a>}
          <a href={RAIZ} className={enCalendario || enBar || enAdmin || enConfig || enRecepcion ? '' : 'activa'}>Recepción</a>
          <a href={CALENDARIO} className={enCalendario ? 'activa' : ''}>Calendario</a>
          {barAccess && <a href={BAR} className={enBar ? 'activa' : ''}>Bar / Buffet</a>}
          {rol === 'ADMIN' && <a href={ADMIN} className={enAdmin ? 'activa' : ''}>Administración</a>}
          {['ADMIN','MANAGER'].includes(rol) && <a href={CONFIG} className={enConfig ? 'activa' : ''}>Configuración</a>}
          {(enCalendario || enBar || enAdmin || enConfig) && <button type="button" className="enlace" onClick={salir}>Salir</button>}
        </nav>
      )}
      {enConfig
        ? (token && ['ADMIN','MANAGER'].includes(rol) ? <Configuracion /> : <main className="centro"><p>No tenés permiso para ingresar a Configuración.</p></main>)
        : enAdmin
        ? (token && rol === 'ADMIN' ? <Administracion /> : <main className="centro"><p>No tenés permiso para ingresar a Administración.</p></main>)
        : enBar
          ? (token && barAccess ? <Bar soloVenta={rol === 'RECEPTION'} /> : <main className="centro"><p>No tenés permiso para ingresar al Bar.</p></main>)
        : enCalendario
          ? (token ? <Calendario /> : <main className="centro"><p>Ingresá primero desde <a href={RAIZ}>Recepción</a> para ver el calendario.</p></main>)
        : enRecepcion
          ? (token ? <RecepcionConUsuario onSalir={DEMO ? salirDelDemo : salir} /> : null)
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
