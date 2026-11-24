export function barFailure(error:{message?:string;code?:string},messages:Record<string,string>={}){
 const raw=String(error?.message||''),dbCode=String(error?.code||'')
 const known=Object.keys(messages).find(k=>raw.includes(k))
 const databaseResponse=/^[0-9A-Z]{5}$/.test(dbCode)||/^PGRST[0-9]{3}$/.test(dbCode)
 if(!databaseResponse)return {status:503,body:{error:'No se pudo confirmar la respuesta del servidor. Se consultará la misma solicitud antes de reintentar.',code:'BAR_RESULT_UNKNOWN',category:'SERVER',outcome:'UNKNOWN'}}
 if(known)return {status:known==='SESSION_INVALID'?401:known==='NOT_AUTHORIZED'?403:409,body:{error:messages[known],code:known,category:'VALIDATION',outcome:'REJECTED'}}
 return {status:500,body:{error:'Error interno del Bar. La operación fue rechazada y no se registró ningún cobro ni salida de stock.',code:raw.includes('BAR_PRICE_IMMUTABLE')?'BAR_PRICE_IMMUTABLE':'BAR_SERVER_ERROR',category:'SERVER',outcome:'REJECTED'}}
}
