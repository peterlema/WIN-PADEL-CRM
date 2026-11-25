import assert from 'node:assert/strict'
import {createReportCache,groupDays,money,compactMoney} from '../src/adminPresentation.js'
let calls=0,clock=0
const cache=createReportCache(async bounds=>{calls++;return {bounds,totals:{collected:42}}},()=>clock)
const bounds={start:'2026-11-16',end:'2026-11-22'}
const [a,b]=await Promise.all([cache.get('session-a',bounds),cache.get('session-a',bounds)])
assert.equal(calls,1);assert.equal(a,b)
await cache.get('session-a',bounds);assert.equal(calls,1)
clock=61000;await cache.get('session-a',bounds);assert.equal(calls,2)
await cache.get('session-b',bounds);assert.equal(calls,3)
cache.clear();await cache.get('session-b',bounds);assert.equal(calls,4)
let failures=0;const failed=createReportCache(async()=>{failures++;throw new Error('offline')})
await assert.rejects(failed.get('a',bounds));await assert.rejects(failed.get('a',bounds));assert.equal(failures,2)
const daily=[{date:'2026-11-16',collected:100,expenses:20,previousDate:'2026-11-09',previous:{collected:90},comparisonAvailable:true},{date:'2026-11-17',collected:200,expenses:10,previousDate:'2026-11-10',previous:{collected:110},comparisonAvailable:true},{date:'2026-11-23',collected:-25,previousDate:'2026-11-16',previous:null,comparisonAvailable:false}]
const weeks=groupDays(daily,'week');assert.equal(weeks.length,2);assert.equal(weeks[0].collected,300);assert.equal(weeks[0].previous.collected,200);assert.equal(weeks[0].previousEnd,'2026-11-10');assert.equal(weeks[1].collected,-25);assert.equal(weeks[1].comparisonAvailable,false)
assert.equal(groupDays(daily,'month')[0].collected,275)
assert.equal(groupDays(daily,'day'),daily)
assert.equal(money(null),'Sin datos');assert.equal(compactMoney(2000000),'$2 M');assert.equal(compactMoney(-1000),'-$1 mil')
console.log('Presentación: caché por sesión, deduplicación, caducidad, errores y agrupaciones verificadas')

const rolling=Array.from({length:28},(_,i)=>({date:new Date(Date.parse('2026-10-28T12:00:00Z')+i*86400000).toISOString().slice(0,10),collected:1,comparisonAvailable:true}));assert.equal(groupDays(rolling,'week').length,4);assert.equal(groupDays(rolling,'week')[3].collected,7)
