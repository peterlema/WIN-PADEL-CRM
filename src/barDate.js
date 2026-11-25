export function barDate(value){
 if(!value)return 'Sin fecha'
 const parts=Object.fromEntries(new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]))
 return parts.day+'/'+parts.month+'/'+parts.year+' '+parts.hour+':'+parts.minute
}
