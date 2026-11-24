export const addDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
export const monday=d=>addDays(d,-(new Date(d+'T12:00:00Z').getUTCDay()+6)%7)
const priorMonth=d=>{const x=new Date(d+'T12:00:00Z'),day=x.getUTCDate();x.setUTCDate(1);x.setUTCMonth(x.getUTCMonth()-1);const last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();x.setUTCDate(Math.min(day,last));return x.toISOString().slice(0,10)}
export function periodBounds(range,today,start,end,history={}){
 if(range==='today')return {start:today,end:today}
 if(range==='week'){const first=monday(today);return {start:first,end:addDays(first,6)}}
 if(range==='month'){const x=new Date(today+'T12:00:00Z');return {start:today.slice(0,8)+'01',end:new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0,12)).toISOString().slice(0,10)}}
 if(range==='four')return {start:addDays(today,-27),end:today}
 if(range==='history')return {start:history.start||today,end:history.end||today}
 return {start,end}
}
export function comparisonBounds(range,b){
 if(range==='today'||range==='week')return {start:addDays(b.start,-7),end:addDays(b.end,-7)}
 if(range==='month')return periodBounds('month',priorMonth(b.start))
 const n=Math.round((new Date(b.end)-new Date(b.start))/86400000)+1
 return {start:addDays(b.start,-n),end:addDays(b.start,-1)}
}
