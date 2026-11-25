export const BAR_ZONE='America/Argentina/Buenos_Aires'
export const barDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:BAR_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const barDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'—'
export function barDateTime(value){
 if(!value||!Number.isFinite(Date.parse(value)))return '—'
 const p=Object.fromEntries(new Intl.DateTimeFormat('es-AR',{timeZone:BAR_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]))
 return p.day+'/'+p.month+'/'+p.year+' '+p.hour+':'+p.minute
}
export const barMethods=[['CASH','Efectivo'],['TRANSFER','Transferencia'],['CARD','Tarjeta']]
export const barKind={SALE:'Cobro de venta',PURCHASE_PAYMENT:'Pago a proveedor',EXPENSE:'Gasto',WITHDRAWAL:'Retiro'}
