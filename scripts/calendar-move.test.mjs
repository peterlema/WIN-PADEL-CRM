import assert from 'node:assert/strict'
import {canMoveBooking,destinationAt,validateMove,sameSlot,movePayload,slotTime} from '../src/calendarMove.js'
const now=new Date('2026-11-24T12:00:00Z'),settings={GRID_OPEN_MIN:480,GRID_CLOSE_MIN:1560}
const b={id:'one',revision:3,date:'2026-11-25',court:'C4',start:'18:30',duration:90,kind:'RESERVA',status:'SCHEDULED',price:90000,paid:30000}
assert.equal(canMoveBooking(b,now),true)
for(const patch of [{status:'CANCELLED'},{status:'PERFORMED'},{readOnly:true},{kind:'BLOQUEO'},{kind:'EVENTO'},{date:'2026-11-23'}])assert.equal(canMoveBooking({...b,...patch},now),false)
assert.deepEqual(destinationAt(b.date,'C3',677,100,30,480),{date:b.date,court:'C3',start:'14:00',minute:840})
assert.equal(destinationAt(b.date,'C3',695,100,30,480).start,'14:15')
const target={date:b.date,court:'C3',start:'19:15'}
assert.equal(validateMove(b,target,[b],settings,now),'')
assert.match(validateMove(b,target,[b,{...b,id:'two',court:'C3',start:'20:00'}],settings,now),/ocupada/)
assert.equal(validateMove(b,{...target,start:'20:00'},[b,{...b,id:'two',court:'C3',start:'18:30'}],settings,now),'')
assert.match(validateMove({...b,kind:'CLASE',teacherId:'teacher'},target,[{...b,id:'two',court:'C1',teacherId:'teacher',start:'19:30'}],settings,now),/profesor/)
assert.match(validateMove({...b,kind:'ABONO'},{...target,date:'2026-11-26'},[b],settings,now),/misma jornada/)
assert.equal(validateMove(b,{...target,start:'00:15'},[b],settings,now),'')
assert.equal(slotTime('2026-11-25','00:15'),Date.parse('2026-11-26T03:15:00Z'))
assert.match(validateMove(b,{...target,start:'00:45'},[b],settings,now),/Fuera/)
assert.match(validateMove(b,{...target,start:'19:10'},[b],settings,now),/válidos/)
assert.equal(sameSlot(b,b),true)
const p=movePayload(b,target,'request');assert.deepEqual(Object.keys(p).sort(),['court','date','from','id','requestId','revision','scope','start'])
assert.equal(movePayload({...b,kind:'ABONO'},target,'req').scope,'occurrence')
assert.equal(p.id,b.id);assert.ok(!('price' in p)&&!('duration' in p)&&!('participants' in p))
console.log('PASS destino por píxeles, ajuste a 15 min, madrugada, duración, solapamientos, profesor y payload sin datos financieros')
