import assert from 'node:assert/strict'
import {formatMoney,parseMoneyInput,moneyInputValue,moneyEditValue,moneyInputError} from '../src/money.js'
for(const [value,label] of [[2000,'$2.000'],[35000,'$35.000'],[1250000,'$1.250.000'],[1500.5,'$1.500,50'],[-1500.5,'-$1.500,50'],[0,'$0'],[-0,'$0'],[415.15151515,'$415,15']])assert.equal(formatMoney(value),label)
assert.equal(formatMoney(null,'Pendiente'),'Pendiente')
assert.equal(formatMoney(NaN),'Sin definir')
for(const [raw,n] of [['150000',150000],['1250,50',1250.5],['1.500',1500],['1.250.000',1250000],['$1.500,50',1500.5],['-$1.500,50',-1500.5],['−$1.500,50',-1500.5],['1.500,00',1500],['0',0],['0,01',.01]])assert.equal(parseMoneyInput(raw),n)
for(const raw of ['1.50','1,500','1.500,501','1,250.50','abc','1e6','1..500','--15','NaN','Infinity'])assert.ok(Number.isNaN(parseMoneyInput(raw)),raw)
assert.equal(parseMoneyInput('',{empty:0}),0)
assert.ok(Number.isNaN(parseMoneyInput('')))
assert.equal(moneyEditValue('$1.250,50'),'1250,50')
assert.equal(moneyInputValue('1250.50'),'1250,50')
assert.equal(moneyInputValue(1250.5),'1250,5')
assert.equal(moneyEditValue('1.50'),'1.50')
assert.equal(moneyEditValue('1250,'),'1250,')
assert.ok(moneyInputError('1.50'))
assert.ok(moneyInputError('-1',{min:0}))
assert.equal(moneyInputError('-1'), '')
// Render -> edit -> numeric payload never scales 1.500 into 1,50, nor drops cents.
for(const n of [0,.01,1.5,1500,1250.5,150000,1250000,-12345.67]){
 const raw=moneyInputValue(n),formatted=formatMoney(parseMoneyInput(raw))
 assert.equal(parseMoneyInput(moneyEditValue(formatted)),n)
 assert.equal(JSON.parse(JSON.stringify({amount:parseMoneyInput(raw)})).amount,n)
}
const {money}=await import('../src/calendarUtils.js');const {money:admin,compactMoney}=await import('../src/adminPresentation.js')
assert.equal(money(1250.5),formatMoney(1250.5));assert.equal(admin(-1250.5),formatMoney(-1250.5));assert.equal(compactMoney(1250000),'$1.250.000')
console.log('PASS moneda AR: formatos, negativos, decimales, puntos de miles, entrada incompleta preservada y payload numérico sin cambios.')
