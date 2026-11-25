import assert from 'node:assert/strict'
import {submitBarTransaction,recoverBarTransaction,readBarTransaction,journalKey} from '../src/barTransactions.js'
import {createServer} from 'vite'
class Storage{m=new Map();getItem(k){return this.m.get(k)??null}setItem(k,v){this.m.set(k,v)}removeItem(k){this.m.delete(k)}}
const owner='admin-test',action='bar.order.place'
const payload={requestId:'00000000-0000-4000-8000-000000000001',items:[{id:'water',quantity:1}],destination:'IMMEDIATE',method:'CASH',clientUnknown:true}
const result={id:'order-1',total:2000,status:'PAID'}
const options=(call,storage=new Storage())=>({call,storage,owner,action,payload})
let calls=[],storage=new Storage()
let r=await submitBarTransaction(options(async(a,p)=>{calls.push([a,p]);return result},storage))
assert.equal(r.state,'CONFIRMED');assert.equal(storage.getItem(journalKey(owner)),null);assert.equal(calls.length,1)
for(const e of [Object.assign(new Error('Dato inválido'),{status:409,outcome:'REJECTED'}),Object.assign(new Error('Error interno; rollback'),{status:500,outcome:'REJECTED'})]){
 storage=new Storage();calls=[]
 await assert.rejects(()=>submitBarTransaction(options(async(a)=>{calls.push(a);throw e},storage)),x=>x===e)
 assert.equal(storage.getItem(journalKey(owner)),null);assert.equal(calls.length,1)
}
storage=new Storage();calls=[]
r=await submitBarTransaction(options(async(a,p)=>{
 calls.push([a,p]);if(a===action)throw Object.assign(new Error('Respuesta perdida'),{network:true})
 assert.equal(a,'bar.request.status');assert.equal(p.requestId,payload.requestId);assert.deepEqual(p.payload,payload)
 return {state:'FOUND',result}
},storage))
assert.equal(r.state,'CONFIRMED');assert.equal(calls.filter(x=>x[0]===action).length,1);assert.equal(readBarTransaction(storage,owner),null)
storage=new Storage();calls=[]
const noCommit=async(a,p)=>{calls.push([a,p]);if(a===action)throw Object.assign(new Error('Sin conexión'),{network:true});return {state:'NOT_FOUND'}}
await assert.rejects(()=>submitBarTransaction(options(noCommit,storage)),e=>e.uncertain&&e.recoveryStatus==='NOT_FOUND')
assert.deepEqual(readBarTransaction(storage,owner).payload,payload)
await assert.rejects(()=>submitBarTransaction(options(noCommit,storage)),e=>e.uncertain)
r=await recoverBarTransaction({storage,owner,retry:true,call:async(a,p)=>{calls.push([a,p]);if(a==='bar.request.status')return {state:'NOT_FOUND'};assert.deepEqual(p,payload);return result}})
assert.equal(r.state,'CONFIRMED');assert.equal(readBarTransaction(storage,owner),null)
assert.deepEqual(calls.slice(-2).map(x=>x[0]),['bar.request.status',action])
for(const state of ['IN_PROGRESS','INCONSISTENT']){
 storage=new Storage();storage.setItem(journalKey(owner),JSON.stringify({owner,action,payload}));calls=[]
 await assert.rejects(()=>recoverBarTransaction({storage,owner,retry:true,call:async(a)=>{calls.push(a);return {state}}}),e=>e.uncertain&&e.recoveryStatus===state)
 assert.deepEqual(calls,['bar.request.status']);assert.ok(readBarTransaction(storage,owner))
}
storage=new Storage();storage.setItem(journalKey(owner),JSON.stringify({owner,action:'bar.order.pay',payload:{requestId:payload.requestId,orderId:'old-order',amount:500,method:'CASH'}}))
assert.equal(readBarTransaction(storage,'other-user'),null)
r=await recoverBarTransaction({storage,owner,call:async(a,p)=>{assert.equal(p.kind,'PAY');return {state:'FOUND',result:{orderId:'old-order',remaining:1500}}}})
assert.equal(r.result.remaining,1500);assert.equal(readBarTransaction(storage,owner),null)
storage=new Storage()
await assert.rejects(()=>submitBarTransaction(options(async()=>{throw Object.assign(new Error('Solicitud con otros datos'),{status:409,outcome:'REJECTED',code:'REQUEST_ID_REUSED'})},storage)),e=>e.uncertain)
assert.ok(readBarTransaction(storage,owner))
const vite=await createServer({server:{middlewareMode:true},appType:'custom'})
try{
 const {barFailure}=await vite.ssrLoadModule('/supabase/functions/win-api/barErrors.ts')
 assert.equal(barFailure({code:'P0001',message:'BAR_PRICE_IMMUTABLE'}).body.outcome,'REJECTED')
 assert.equal(barFailure({code:'P0001',message:'BAR_PRICE_IMMUTABLE'}).body.category,'SERVER')
 assert.equal(barFailure({code:'P0001',message:'BAR_BANK_REQUIRED'},{BAR_BANK_REQUIRED:'Configurá el banco'}).body.category,'VALIDATION')
 assert.equal(barFailure({code:'42501',message:'permission denied'}).body.outcome,'REJECTED')
 assert.equal(barFailure({code:'',message:'fetch failed'}).body.outcome,'UNKNOWN')
}finally{await vite.close()}
console.log('PASS recuperación: journal antes de enviar, error validación/servidor rechazado, respuesta perdida ya confirmada, ausencia y reintento mismo requestId, bloqueo IN_PROGRESS/INCONSISTENT, persistencia por usuario y recuperación de pago parcial.')

for(const action of ['bar.inventory.stock.out','bar.inventory.cash.open','bar.inventory.cash.close','bar.inventory.cash.out','bar.inventory.purchase.save','bar.inventory.purchase.receive','bar.inventory.purchase.pay']){
 const saved=new Storage(),p={requestId:crypto.randomUUID(),amount:123.45},responses=[],queries=[]
 let sends=0
 const call=async(a,v)=>{
  if(a==='bar.request.status'){queries.push(v);return {state:responses.length?'FOUND':'NOT_FOUND',result:responses[0]}}
  sends++;responses.push({ok:true,id:'isolated'});throw Object.assign(new Error('Respuesta perdida'),{network:true})
 }
 const r=await submitBarTransaction({call,storage:saved,owner,action,payload:p})
 assert.equal(r.state,'CONFIRMED');assert.equal(sends,1);assert.equal(queries[0].kind,'INVENTORY');assert.equal(queries[0].payload.action,action);assert.equal(queries[0].requestId,p.requestId);assert.equal(saved.getItem(journalKey(owner)),null)
}
console.log('PASS solicitudes de inventario: respuesta perdida se recupera sin duplicar compras, recepciones, pagos ni movimientos de caja.')
