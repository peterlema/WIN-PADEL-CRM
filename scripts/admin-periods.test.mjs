import assert from 'node:assert/strict'
import {periodBounds,comparisonBounds} from '../src/adminPeriods.js'
assert.deepEqual(periodBounds('week','2026-11-23'),{start:'2026-11-23',end:'2026-11-29'})
assert.deepEqual(periodBounds('week','2026-11-29'),{start:'2026-11-23',end:'2026-11-29'})
assert.deepEqual(comparisonBounds('week',periodBounds('week','2026-11-23')),{start:'2026-11-16',end:'2026-11-22'})
assert.deepEqual(periodBounds('week','2027-01-01'),{start:'2026-12-28',end:'2027-01-03'})
assert.deepEqual(periodBounds('month','2028-02-29'),{start:'2028-02-01',end:'2028-02-29'})
assert.deepEqual(comparisonBounds('month',periodBounds('month','2026-03-31')),{start:'2026-02-01',end:'2026-02-28'})
assert.deepEqual(periodBounds('history','2026-11-23',null,null,{start:'2026-10-19',end:'2026-11-23'}),{start:'2026-10-19',end:'2026-11-23'})
assert.deepEqual(comparisonBounds('custom',{start:'2026-10-19',end:'2026-10-25'}),{start:'2026-10-12',end:'2026-10-18'})
console.log('OK: calendar weeks, month ends, leap year, history and equal comparison ranges')
