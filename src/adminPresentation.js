import {formatMoney,parseMoneyInput,moneyInputValue} from './money.js'
// Presentation only: these helpers never write or replace server accounting totals.
export const missing = 'Sin datos'
export const money = value => formatMoney(value,'Sin datos')
export const compactMoney=value=>{
 if(value==null)return missing
 const n=Number(value),absolute=Math.abs(n),scale=absolute>=1e9?1e9:absolute>=1e6?1e6:absolute>=1e3?1e3:1
 return (n<0?'-':'')+'$'+(absolute/scale).toLocaleString('es-AR',{maximumFractionDigits:1})+(scale===1e9?' mil M':scale===1e6?' M':scale===1e3?' mil':'')
}
export const displayDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):value
export const shortDate = d => d ? d.slice(8,10)+'/'+d.slice(5,7) : missing
export const weekday = d => d ? String(new Date(d+'T12:00:00Z').getUTCDay()) : ''
export function groupDays(rows,mode='day') {
 if(mode==='day')return rows
 const groups=new Map()
 for(const r of rows){
  const d=new Date(rows[0].date+'T12:00:00Z');if(mode==='week')d.setUTCDate(d.getUTCDate()+Math.floor((Date.parse(r.date+'T12:00:00Z')-d.getTime())/86400000/7)*7)
  const key=mode==='month'?r.date.slice(0,7):d.toISOString().slice(0,10)
  if(!groups.has(key))groups.set(key,{date:r.date,endDate:r.date,label:mode==='month'?r.date.slice(5,7)+'/'+r.date.slice(0,4):'Sem. '+shortDate(r.date),previousDate:r.previousDate,previousEnd:r.previousDate,previous:{},comparisonAvailable:true,partial:false})
  const g=groups.get(key);g.endDate=r.date;g.previousEnd=r.previousDate
  if(!r.comparisonAvailable){g.comparisonAvailable=false;g.partial=true}
  for(const field of ['collected','expenses','activityNet','activitynet']){
   if(r[field]!=null)g[field]=(g[field]||0)+Number(r[field])
   if(r.comparisonAvailable&&r.previous?.[field]!=null)g.previous[field]=(g.previous[field]||0)+Number(r.previous[field])
  }
 }
 return [...groups.values()]
}
export function createReportCache(request,now=()=>Date.now()){
 let owner=null;const records=new Map()
 return {clear(){records.clear()},get(scope,bounds,refresh=false){
  if(owner!==scope){records.clear();owner=scope}
  const key=JSON.stringify(bounds),cached=records.get(key)
  if(!refresh&&cached&&now()-cached.time<60000)return cached.promise
  const entry={time:now(),promise:null}
  entry.promise=Promise.resolve().then(()=>request(bounds)).catch(e=>{if(records.get(key)===entry)records.delete(key);throw e})
  records.set(key,entry);if(records.size>12)records.delete(records.keys().next().value)
  return entry.promise
 }}
}
