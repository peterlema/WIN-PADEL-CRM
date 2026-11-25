import {useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
import {readBarTransaction,submitBarTransaction,recoverBarTransaction} from '../barTransactions.js'
export default function useBarTransaction(onConfirmed){
 const [owner,setOwner]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const active=useRef(false),callback=useRef(onConfirmed);callback.current=onConfirmed
 useEffect(()=>{let live=true;callApi('me').then(r=>live&&setOwner(r.user.id)).catch(e=>live&&setError(e.message));return()=>{live=false}},[])
 async function finish(r){
  setUncertain(false);setStatus('');setNotice('Operación confirmada. No se duplicó el movimiento.')
  try{await callback.current?.(r)}catch(e){setError('La operación está confirmada. Actualizá la vista: '+e.message)}
 }
 function failure(e){setError(e.message);setUncertain(e.uncertain===true);setStatus(e.recoveryStatus||'')}
 async function recover(retry=false){
  if(active.current||!owner)return;active.current=true;setBusy(true);setError('')
  try{const r=await recoverBarTransaction({call:callApi,storage:sessionStorage,owner,retry});if(r.state==='CONFIRMED')await finish(r);else if(r.state==='EMPTY'){setUncertain(false);setStatus('')}}
  catch(e){setUncertain(true);setStatus(e.recoveryStatus||'UNAVAILABLE');setError(e.message)}
  finally{active.current=false;setBusy(false)}
 }
 useEffect(()=>{if(owner){try{if(readBarTransaction(sessionStorage,owner))recover(false)}catch(e){setUncertain(true);setError(e.message)}}},[owner])
 async function run(action,payload){
  if(active.current||!owner||uncertain)return;active.current=true;setBusy(true);setError('');setNotice('')
  try{const r=await submitBarTransaction({call:callApi,storage:sessionStorage,owner,action,payload:{...payload,requestId:payload.requestId||crypto.randomUUID()}});await finish(r)}
  catch(e){failure(e)}finally{active.current=false;setBusy(false)}
 }
 return {run,recover,busy,uncertain,status,error,notice,ready:!!owner,setError,setNotice}
}
