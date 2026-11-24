// Isolated demonstration data. No real credentials or backend calls.
const roles=Object.entries({ADMIN:'Administrador',MANAGER:'Encargado',RECEPTION:'Recepción',ACADEMY_COORDINATOR:'Coordinación de academia',COACH:'Profesor',BAR:'Bar'}).map(([baseRole,name])=>({id:'role-'+baseRole,baseRole,name,builtin:true}))
const users=[{id:'demo',name:'Usuario demo',username:'AdminDemo',role:'ADMIN',roleId:'role-ADMIN',enabled:true},{id:'recep-demo',name:'Recepción demo',username:'RecepcionDemo',role:'RECEPTION',roleId:'role-RECEPTION',enabled:true}]
const requests=new Map()
const fail=message=>{throw Object.assign(new Error(message),{status:409})}
export function usersDemo(p,actor){
 if(actor.role!=='ADMIN')fail('Sólo un administrador puede gestionar usuarios y roles.')
 if(p.action==='users.list')return structuredClone({currentUserId:actor.id,users,roles,permissions:[]})
 if(requests.has(p.requestId))return requests.get(p.requestId)
 let id
 if(p.action==='users.role.save'){
  if(roles.some(r=>r.name.trim().toLowerCase()===p.name.trim().toLowerCase()))fail('Ya existe un rol con ese nombre.')
  id=crypto.randomUUID();roles.push({id,name:p.name.trim(),baseRole:p.baseRole,builtin:false})
 }else if(p.action==='users.save'){
  const role=roles.find(r=>r.id===p.roleId);if(!role)fail('Elegí un rol válido.')
  if(p.id===actor.id&&(!p.enabled||role.baseRole!=='ADMIN'))fail('Tu propio usuario debe conservar el acceso de administrador.')
  if(users.some(u=>u.id!==p.id&&u.username.trim().toLowerCase()===p.username.trim().toLowerCase()))fail('Ese usuario de ingreso ya existe.')
  if((!p.id||p.pin)&&!/^\d{6}$/.test(p.pin))fail('Ingresá un PIN de exactamente seis dígitos.')
  id=p.id||crypto.randomUUID();const next={id,username:p.username.trim(),name:p.name.trim(),roleId:p.roleId,role:role.baseRole,enabled:p.enabled}
  const old=users.find(u=>u.id===id);if(old)Object.assign(old,next);else users.push(next)
 }else fail('Operación de usuarios no disponible.')
 const result={id,ok:true,signInAgain:false};requests.set(p.requestId,result);return result
}
