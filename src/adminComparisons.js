// Display-only comparisons of server totals; no pricing or cash writes.
const dayNumber=d=>Date.parse(d+'T12:00:00Z')/86400000
export function alignDays(current=[],previous=[],start,previousStart,coverageStart){
 const byDay=new Map(previous.map(d=>[d.date,d]))
 return current.map(d=>{
  const offset=dayNumber(d.date)-dayNumber(start)
  const priorDate=new Date((dayNumber(previousStart)+offset)*86400000).toISOString().slice(0,10)
  return {...d,previousDate:priorDate,previous:byDay.get(priorDate)||null,comparisonAvailable:!coverageStart||priorDate>=coverageStart}
 })
}
export function compareGroups(current=[],previous=[],keys=['type']){
 const key=r=>JSON.stringify(keys.map(k=>r[k]??null)),map=new Map()
 for(const r of current)map.set(key(r),{...r,current:r,previous:null})
 for(const r of previous){const k=key(r);map.set(k,{...(map.get(k)||r),current:map.get(k)?.current||null,previous:r})}
 return [...map.values()]
}
