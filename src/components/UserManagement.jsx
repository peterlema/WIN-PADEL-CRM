import {useEffect,useState} from 'react'
import {callApi,clearToken} from '../api.js'

const profiles={ADMIN:'Administrador',MANAGER:'Encargado',RECEPTION:'Recepción',ACADEMY_COORDINATOR:'Coordinación de academia',COACH:'Profesor',BAR:'Bar'}
const capabilities={
 ADMIN:'Acceso completo, incluida la administración de usuarios y roles.',
 MANAGER:'Operación de caja y canchas, gestión de Bar, Tienda y profesores, y consulta de reportes.',
 RECEPTION:'Apertura, carga y cierre de caja; calendario, reservas y clases; venta de Bar y consulta de Tienda.',
 ACADEMY_COORDINATOR:'Gestión de academia y clases, y consulta y creación de reservas según los permisos vigentes.',
 COACH:'Consulta y actualización de sus propias clases según los permisos vigentes.',
 BAR:'Consulta de productos y ventas del Bar.'
}

export default function UserManagement(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[ok,setOk]=useState(''),[busy,setBusy]=useState(false)
 const [form,setForm]=useState(null),[role,setRole]=useState(null)
 async function load(){const r=await callApi('users.list');setData(r)}
 useEffect(()=>{let alive=true;callApi('users.list').then(r=>alive&&setData(r)).catch(e=>alive&&setError(e.message));return()=>{alive=false}},[])
 const change=patch=>setForm(f=>({...f,...patch,requestId:crypto.randomUUID()}))
 const changeRole=patch=>setRole(r=>({...r,...patch,requestId:crypto.randomUUID()}))
 async function save(e,action,payload){
  e.preventDefault();if(busy)return;setBusy(true);setError('');setOk('')
  try{
   const r=await callApi(action,payload)
   setForm(null);setRole(null)
   if(r.signInAgain){clearToken();window.location.hash='#/';window.location.reload();return}
   setOk(action==='users.role.save'?'Rol creado. Ya podés asignarlo a un usuario.':'Usuario guardado. Los cambios de acceso se aplican al volver a ingresar.')
   await load()
  }catch(e){setError(e.message+(e.network?' Podés reintentar sin cambiar los datos; se conserva la misma solicitud.':''))}
  finally{setBusy(false)}
 }
 function edit(u){setError('');setOk('');setRole(null);setForm({...u,pin:'',requestId:crypto.randomUUID()})}
 if(!data)return <section className="cfg-card">{error?<p className="cfg-msg error" role="alert">{error}</p>:<p>Cargando usuarios…</p>}</section>
 const selected=data.roles.find(r=>r.id===form?.roleId),self=form?.id===data.currentUserId
 return <section className="cfg-card">
  <div className="cfg-head"><h3>Usuarios y roles</h3><button type="button" disabled={busy} onClick={()=>edit({username:'',name:'',roleId:data.roles.find(r=>r.baseRole==='RECEPTION'&&r.builtin)?.id||'',enabled:true})}>+ Usuario</button></div>
  <p className="cfg-muted">Cada persona ingresa con su usuario y PIN de seis dígitos. Sus cargas quedan registradas a su nombre.</p>
  <div aria-live="polite">{error&&<p className="cfg-msg error" role="alert">{error}</p>}{ok&&<p className="cfg-msg good" role="status">{ok}</p>}</div>
  {form&&<form className="cfg-form" onSubmit={e=>save(e,'users.save',form)}><fieldset disabled={busy} style={{border:0,padding:0,minWidth:0,display:'contents'}}>
   <strong className="cfg-form-title">{form.id?'Editar usuario':'Nuevo usuario'}</strong>
   <label>Nombre para mostrar<input value={form.name} maxLength={120} required autoFocus onChange={e=>change({name:e.target.value})}/></label>
   <label>Usuario de ingreso<input value={form.username} minLength={3} maxLength={100} required autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={e=>change({username:e.target.value})}/></label>
   <label>Rol<select required value={form.roleId||''} disabled={self} onChange={e=>change({roleId:e.target.value})}>{data.roles.map(r=><option key={r.id} value={r.id}>{r.name}{!r.builtin?' · '+profiles[r.baseRole]:''}</option>)}</select></label>
   <label>{form.id?'Nuevo PIN (opcional)':'PIN de seis dígitos'}<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} minLength={6} autoComplete="new-password" value={form.pin} required={!form.id} onChange={e=>change({pin:e.target.value})}/></label>
   <label className="cfg-check"><input type="checkbox" checked={form.enabled} disabled={self} onChange={e=>change({enabled:e.target.checked})}/>Acceso activo</label>
   {selected&&<p className="cfg-muted cfg-form-title">{capabilities[selected.baseRole]}</p>}
   {form.id&&<p className="cfg-muted cfg-form-title">Dejá el PIN vacío para conservarlo. Cambiar el PIN o el rol cierra sus sesiones anteriores. Desactivar el acceso conserva todo el historial.</p>}
   {self&&<p className="cfg-muted cfg-form-title">Tu propio usuario conserva el acceso de administrador. Si cambiás tu PIN, tendrás que volver a ingresar.</p>}
   <div className="cfg-actions"><button disabled={busy}>{busy?'Guardando…':'Guardar usuario'}</button><button type="button" className="secundario" onClick={()=>setForm(null)}>Cancelar</button></div>
  </fieldset></form>}
  <div style={{overflowX:'auto'}}><table className="cfg-table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Acceso</th><th/></tr></thead><tbody>{data.users.map(u=><tr key={u.id} className={u.enabled?'':'baja'}><td>{u.name}</td><td>{u.username}</td><td>{data.roles.find(r=>r.id===u.roleId)?.name||profiles[u.role]}</td><td>{u.enabled?'Activo':'Inactivo'}{u.lockedUntil&&Date.parse(u.lockedUntil)>Date.now()?' · Bloqueo temporal':''}</td><td><button className="enlace" type="button" disabled={busy} onClick={()=>edit(u)}>Editar / cambiar PIN</button></td></tr>)}</tbody></table></div>
  <div className="cfg-head" style={{marginTop:24}}><h3>Roles disponibles</h3><button type="button" className="secundario" disabled={busy} onClick={()=>{setForm(null);setError('');setRole({name:'',baseRole:'RECEPTION',requestId:crypto.randomUUID()})}}>+ Rol</button></div>
  <p className="cfg-muted">Un rol nuevo tiene nombre propio y hereda los permisos del perfil elegido. Crear un rol no cambia los accesos de otros usuarios.</p>
  {role&&<form className="cfg-form" onSubmit={e=>save(e,'users.role.save',role)}><fieldset disabled={busy} style={{border:0,padding:0,minWidth:0,display:'contents'}}>
   <label>Nombre del rol<input required minLength={2} maxLength={60} value={role.name} autoFocus onChange={e=>changeRole({name:e.target.value})}/></label>
   <label>Perfil de permisos<select value={role.baseRole} onChange={e=>changeRole({baseRole:e.target.value})}>{Object.entries(profiles).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <p className="cfg-muted cfg-form-title">{capabilities[role.baseRole]}</p>
   <div className="cfg-actions"><button disabled={busy}>{busy?'Guardando…':'Crear rol'}</button><button type="button" className="secundario" onClick={()=>setRole(null)}>Cancelar</button></div>
  </fieldset></form>}
  <table className="cfg-table"><thead><tr><th>Rol</th><th>Perfil de permisos</th></tr></thead><tbody>{data.roles.map(r=><tr key={r.id}><td>{r.name}</td><td>{profiles[r.baseRole]}</td></tr>)}</tbody></table>
 </section>
}
