import {useId,useState} from 'react'
import {HOURS,QUARTERS,clockValue,activityEnd} from '../activityTime.js'
import './activity-controls.css'

export function TimePicker({label='Inicio',value,onChange,disabled=false,required=false,allowAfterMidnight=false,minuteOptions=QUARTERS,field='start'}) {
  const id=useId(), time=clockValue(value), [hour='',minute='']=time.split(':')
  const hours=allowAfterMidnight?[...HOURS,'01','02','03','04','05','06']:HOURS
  const hh=hour&&!hours.includes(hour)?[...hours,hour]:hours
  const mm=minute&&!minuteOptions.includes(minute)?[...minuteOptions,minute]:minuteOptions
  return <div className="win-field win-time-field" data-field={field}>
    <span id={id}>{label}</span>
    <div className="win-time-pair" role="group" aria-labelledby={id}>
      <label className="win-time-part"><span className="win-sr-only">{label}: horas</span><select aria-label={label+': horas'} value={hour} required={required} disabled={disabled} onChange={e=>onChange(e.target.value+':'+(minute||'00'))}>{!time&&<option value="">HH</option>}{hh.map(h=><option key={h} value={h}>{h}</option>)}</select></label>
      <span aria-hidden="true">:</span>
      <label className="win-time-part"><span className="win-sr-only">{label}: minutos</span><select aria-label={label+': minutos'} value={minute} required={required} disabled={disabled} onChange={e=>onChange((hour||'07')+':'+e.target.value)}>{!time&&<option value="">mm</option>}{mm.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
    </div>
    {time&&Number(hour)<6&&<small className="win-field-help">{time} del día siguiente a la jornada</small>}
  </div>
}

export function CourtPicker({value,onChange,multiple=false,optional=false,disabled=false,label='Cancha'}) {
  const id=useId(), selected=c=>multiple?value.includes(c):value===c
  const toggle=c=>onChange(multiple?(selected(c)?value.filter(x=>x!==c):[...value,c]):c)
  return <div className="win-field win-court-field" data-field="court"><span id={id}>{label}</span><div className="win-choices win-courts" role="group" aria-labelledby={id}>{optional&&<button type="button" disabled={disabled} aria-pressed={!value} onClick={()=>onChange('')}>Cualquiera</button>}{['C4','C3','C2','C1'].map(c=><button type="button" disabled={disabled} key={c} aria-label={'Cancha '+c.slice(1)} aria-pressed={selected(c)} onClick={()=>toggle(c)}>{c}</button>)}</div>{multiple&&<small className="win-field-help">Podés seleccionar varias canchas.</small>}</div>
}

export function DurationPicker({value,onChange,disabled=false,exceptional=true,label='Duración'}) {
  const [other,setOther]=useState(false), custom=other||![60,90,120].includes(Number(value))
  const id=useId()
  return <div className="win-field" data-field="duration"><span id={id}>{label}</span><div className="win-choices" role="group" aria-labelledby={id}>{[60,90,120].map(n=><button type="button" key={n} disabled={disabled} aria-pressed={!custom&&Number(value)===n} onClick={()=>{setOther(false);onChange(n)}}>{n} min</button>)}{exceptional&&<button type="button" disabled={disabled} aria-pressed={custom} onClick={()=>setOther(true)}>Otra</button>}</div>{custom&&<label className="win-exception-duration">Duración excepcional (min)<input type="number" min={15} max={720} step={15} value={value} disabled={disabled} required onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/></label>}</div>
}

export function EndTime({date,start,duration}) {
  const end=activityEnd(date,start,duration)
  return <output className="win-end-time" aria-live="polite">Finaliza <strong>{end?.time||'—'}</strong>{end&&<span> · {end.date.split('-').reverse().join('/')}{end.dayOffset>0?' · día siguiente':''}</span>}</output>
}
