import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {activityEnd,time24,HOURS,QUARTERS} from '../src/activityTime.js'

assert.deepEqual(HOURS,['07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','00'])
assert.deepEqual(QUARTERS,['00','15','30','45'])
assert.deepEqual(activityEnd('2026-11-24','23:45',90),{date:'2026-11-25',time:'01:15',dayOffset:1})
assert.deepEqual(activityEnd('2026-12-31','23:30',180),{date:'2027-01-01',time:'02:30',dayOffset:1})
assert.deepEqual(activityEnd('2028-02-28','23:45',60),{date:'2028-02-29',time:'00:45',dayOffset:1})
assert.deepEqual(activityEnd('2026-11-24','00:00',120),{date:'2026-11-25',time:'02:00',dayOffset:1})
assert.deepEqual(activityEnd('2026-11-24','07:00',60),{date:'2026-11-24',time:'08:00',dayOffset:0})
assert.equal(activityEnd('2026-11-24','',90),null)
assert.equal(activityEnd('2026-11-24','23:45',''),null)
assert.equal(time24('2026-11-25T03:00:00Z'),'00:00')
assert.equal(time24('2026-11-24T20:30:00Z'),'17:30')
const server=await createServer({server:{middlewareMode:true},appType:'custom'})
try {
  const {TimePicker,CourtPicker,DurationPicker,EndTime}=await server.ssrLoadModule('/src/components/ActivityControls.jsx')
  const html=(component,props)=>renderToStaticMarkup(React.createElement(component,props))
  const time=html(TimePicker,{label:'Inicio',value:'23:45',onChange(){},required:true})
  assert.equal((time.match(/<select/g)||[]).length,2)
  assert.ok(!time.includes('type="time"'))
  assert.ok(time.includes('value="23" selected'))
  assert.ok(time.includes('value="45" selected'))
  const preserved=html(TimePicker,{label:'Inicio',value:'01:10',onChange(){},disabled:true})
  assert.ok(preserved.includes('value="01" selected')&&preserved.includes('value="10" selected'))
  const courts=html(CourtPicker,{value:'C3',onChange(){}})
  assert.ok(courts.indexOf('Cancha 4')<courts.indexOf('Cancha 3')&&courts.indexOf('Cancha 3')<courts.indexOf('Cancha 2'))
  assert.equal((courts.match(/aria-pressed="true"/g)||[]).length,1)
  assert.equal((html(CourtPicker,{value:['C4','C1'],multiple:true,onChange(){}}).match(/aria-pressed="true"/g)||[]).length,2)
  assert.ok(!html(DurationPicker,{value:90,onChange(){}}).includes('type="number"'))
  assert.ok(html(DurationPicker,{value:180,onChange(){}}).includes('type="number"'))
  const ending=html(EndTime,{date:'2026-11-24',start:'23:45',duration:90})
  assert.ok(ending.includes('01:15')&&ending.includes('25/11/2026'))
} finally {await server.close()}
console.log('PASS: controles compartidos, formato 24 h, duración excepcional y cambio de fecha sin recortes')
