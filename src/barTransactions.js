// Financial retry recovery. No totals or authorization rules live in the browser.
export const journalKey=owner=>'win_bar_transaction:'+owner
export function readBarTransaction(storage,owner){
 const raw=storage.getItem(journalKey(owner))
 if(!raw)return null
 try{const j=JSON.parse(raw);if(j.owner!==owner||!['bar.order.place','bar.order.pay'].includes(j.action)||!j.payload?.requestId)throw Error();return j}
 catch{throw new Error('El registro local de recuperación no se pudo leer. No vuelvas a cobrar hasta revisar esta pestaña.')}
}
const uncertain=(state,cause)=>Object.assign(new Error(state==='NOT_FOUND'?'El servidor todavía no registra esta operación. Podés reintentar la misma solicitud sin duplicarla.':state==='IN_PROGRESS'?'La operación sigue procesándose. Consultá nuevamente su resultado.':state==='INCONSISTENT'?'La operación requiere revisión del administrador; no la repitas.':'No se pudo consultar el resultado. Conservamos la solicitud para verificarla.'),{uncertain:true,recoveryStatus:state,cause})
const rejected=e=>e.outcome==='REJECTED'||(e.status>=400&&e.status<500&&![408,429].includes(e.status))
function confirmed(action,r){return action==='bar.order.place'?typeof r?.id==='string'&&Number.isFinite(Number(r.total)):typeof r?.orderId==='string'&&Number.isFinite(Number(r.remaining))}
async function query(call,j){
 return call('bar.request.status',{requestId:j.payload.requestId,kind:j.action==='bar.order.place'?'PLACE':'PAY',payload:j.payload})
}
function clear(storage,owner){storage.removeItem(journalKey(owner))}
export async function recoverBarTransaction({call,storage,owner,retry=false}){
 const j=readBarTransaction(storage,owner)
 if(!j)return {state:'EMPTY'}
 let status
 try{status=await query(call,j)}catch(e){throw uncertain('UNAVAILABLE',e)}
 if(status.state==='FOUND'&&confirmed(j.action,status.result)){clear(storage,owner);return {state:'CONFIRMED',action:j.action,result:status.result}}
 if(status.state==='NOT_FOUND'&&retry)return send(call,storage,owner,j)
 throw uncertain(status.state||'UNAVAILABLE')
}
async function send(call,storage,owner,j){
 try{
  const r=await call(j.action,j.payload)
  if(!confirmed(j.action,r))throw Object.assign(new Error('Confirmación incompleta.'),{network:true})
  clear(storage,owner);return {state:'CONFIRMED',action:j.action,result:r}
 }catch(e){
  if(rejected(e)){clear(storage,owner);throw e}
  return recoverBarTransaction({call,storage,owner})
 }
}
export async function submitBarTransaction({call,storage,owner,action,payload}){
 if(!owner)throw new Error('Actualizá la sesión antes de cobrar.')
 if(readBarTransaction(storage,owner))throw uncertain('UNAVAILABLE')
 const j={owner,action,payload,createdAt:new Date().toISOString()}
 // Write BEFORE dispatch. Refreshing the page cannot lose the request identifier.
 storage.setItem(journalKey(owner),JSON.stringify(j))
 return send(call,storage,owner,j)
}
