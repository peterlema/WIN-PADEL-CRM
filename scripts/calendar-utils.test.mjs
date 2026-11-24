import assert from 'node:assert/strict'
import {COURTS,currentPosition,minutes,label,monday,number} from '../src/calendarUtils.js'
assert.deepEqual(COURTS,['C4','C3','C2','C1'])
assert.equal(currentPosition('2026-11-23',new Date('2026-11-24T00:15:00Z')),1275)
assert.equal(currentPosition('2026-11-23',new Date('2026-11-24T04:15:00Z')),1515)
assert.equal(currentPosition('2026-11-24',new Date('2026-11-24T04:15:00Z')),null)
assert.equal(currentPosition('2026-11-24',new Date('2026-11-24T09:00:00Z')),360)
assert.equal(label(minutes('23:30')+90),'01:00')
assert.equal(monday('2026-11-29'),'2026-11-23')
assert.equal(number('90.000,50'),90000.5)
console.log('OK orden físico, reloj de Buenos Aires, madrugada, fin calculado y moneda argentina')
