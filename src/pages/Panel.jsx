import { supabase } from '../supabaseClient.js'

export default function Panel({ session }) {
  return (
    <div className="panel">
      <header className="barra">
        <strong>WIN Gestión</strong>
        <span className="usuario">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <main className="contenido">
        <h2>Panel administrativo</h2>
        <p>Acceso correcto. Los módulos de gestión se agregan acá.</p>
      </main>
    </div>
  )
}
