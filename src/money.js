// Presentation/input only. Server amounts and accounting calculations remain numeric.
const decimals=new Intl.NumberFormat('es-AR',{useGrouping:true,minimumFractionDigits:2,maximumFractionDigits:2})
export function formatMoney(value,missing='Sin definir'){
 if(value==null||value==='')return missing
 const n=Number(value)
 if(!Number.isFinite(n))return missing
 const full=decimals.format(Math.abs(n)),digits=full.endsWith(',00')?full.slice(0,-3):full
 return (n<0&&digits!=='0'?'-':'')+'$'+digits
}
export function parseMoneyInput(value,{empty=NaN}={}){
 if(typeof value==='number')return Number.isFinite(value)?value:NaN
 let s=String(value??'').trim().replace(/\u2212/g,'-')
 if(!s)return empty
 // Currency may be pasted from a report. Never infer an American decimal point.
 s=s.replace(/\s/g,'').replace(/^(-?)\$/,'$1').replace(/^\$(-?)/,'$1')
 if(!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))return NaN
 const n=Number(s.replace(/\./g,'').replace(',','.'))
 return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER/100?n:NaN
}
// Use only for numeric values received from the API, never to interpret user text.
export const moneyInputValue=value=>value==null||value===''?'':String(value).replace('.',',')
export function moneyEditValue(value){
 if(typeof value==='number')return moneyInputValue(value)
 const s=String(value??'')
 if(!Number.isFinite(parseMoneyInput(s)))return s
 return s.trim().replace(/\u2212/g,'-').replace(/\s/g,'').replace(/^(-?)\$/,'$1').replace(/^\$(-?)/,'$1').replace(/\./g,'')
}
export function moneyInputError(value,{min,max}={}){
 if(value==null||value==='')return ''
 const n=parseMoneyInput(value)
 if(!Number.isFinite(n))return 'Usá puntos para miles y coma para hasta dos decimales. Ej.: 1.500,50.'
 if(min!=null&&n<Number(min))return 'El importe mínimo es '+formatMoney(min)+'.'
 if(max!=null&&n>Number(max))return 'El importe máximo es '+formatMoney(max)+'.'
 return ''
}
