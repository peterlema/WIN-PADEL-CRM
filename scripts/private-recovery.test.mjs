import assert from 'node:assert/strict'
import {submitBarTransaction,recoverBarTransaction,journalKey} from '../src/barTransactions.js'
const records=new Map(),storage={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)},owner='isolated-owner'
const payload={requestId:crypto.randomUUID(),customerId:'authorized',quoteFingerprint:'old-quote',destination:'ACCOUNT',items:[{id:'water',quantity:1}]}
const sent=[];let rejectQuote=false
const call=async(action,p)=>{if(action==='bar.request.status')return {state:'NOT_FOUND'};sent.push(p.requestId);if(rejectQuote)throw Object.assign(new Error('Revisá el nuevo precio'),{status:409,code:'PRIVATE_QUOTE_STALE',outcome:'REJECTED'});throw Object.assign(new Error('Respuesta perdida'),{network:true})}
await assert.rejects(()=>submitBarTransaction({call,storage,owner,action:'bar.order.place',payload}),e=>e.uncertain===true)
assert.ok(storage.getItem(journalKey(owner)));rejectQuote=true
await assert.rejects(()=>recoverBarTransaction({call,storage,owner,retry:true}),e=>e.code==='PRIVATE_QUOTE_STALE'&&e.uncertain===false)
assert.equal(storage.getItem(journalKey(owner)),null);assert.deepEqual(sent,[payload.requestId,payload.requestId])
console.log('PASS recuperación: reintento conserva requestId, rechazo definitivo libera la operación y exige revisar la nueva cotización.')
