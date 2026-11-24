export const HOURS = [...Array.from({length:17}, (_,i)=>String(i+7).padStart(2,'0')), '00']
export const QUARTERS = ['00','15','30','45']
export const clockValue = value => /^\d{2}:\d{2}/.test(String(value)) ? String(value).slice(0,5) : ''
export function activityEnd(date, start, duration) {
  const time=clockValue(start), amount=Number(duration)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'') || !time || !Number.isFinite(amount) || amount<=0) return null
  const [hour,minute]=time.split(':').map(Number)
  if(hour>23 || minute>59) return null
  // Existing server convention: the commercial day changes at 06:00.
  const total=(hour<6?hour+24:hour)*60+minute+amount
  const dayOffset=Math.floor(total/1440), d=new Date(date+'T12:00:00Z')
  if(Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate()+dayOffset)
  return {date:d.toISOString().slice(0,10),time:String(Math.floor(total/60)%24).padStart(2,'0')+':'+String(total%60).padStart(2,'0'),dayOffset}
}
export function time24(value, timeZone='America/Argentina/Buenos_Aires') {
  const d=value instanceof Date?value:new Date(value)
  if(Number.isNaN(d.getTime())) return '—'
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]))
  return p.hour+':'+p.minute
}
