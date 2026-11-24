import assert from 'node:assert/strict'
import {alignDays,compareGroups} from '../src/adminComparisons.js'
const days=alignDays([{date:'2026-11-23',collected:20},{date:'2026-11-24',collected:30}],[{date:'2026-11-16',collected:10},{date:'2026-11-17',collected:40}],'2026-11-23','2026-11-16','2026-10-19')
assert.equal(days[0].previousDate,'2026-11-16');assert.equal(days[1].previous.collected,40)
assert.equal(alignDays([{date:'2026-10-19'}],[],'2026-10-19','2026-10-12','2026-10-19')[0].comparisonAvailable,false)
const groups=compareGroups([{type:'RESERVA',net:5}],[{type:'CLASE',net:8}])
assert.equal(groups.length,2);assert.equal(groups[1].current,null);assert.equal(groups[1].previous.net,8)
assert.equal(compareGroups([{unit:'COURTS',category:'RESERVA',kind:'SALE'}],[{unit:'COURTS',category:'RESERVA',kind:'SALE'},{unit:'SHOP',category:'RESERVA',kind:'SALE'}],['unit','category','kind']).length,2)
console.log('OK: same weekday alignment, missing coverage and category union')
