import {useState} from 'react'
import {barDateTime} from '../barDisplay.js'
import Modal from './Modal.jsx'
import ValidatedForm from './ValidatedForm.jsx'
import useBarTransaction from './useBarTransaction.js'
import BarTransactionNotice from './BarTransactionNotice.jsx'
export default function BarBankConfig({data,canEdit,onSaved,disabled=false}){
 const [form,setForm]=useState(null),[error,setError]=useState('')
 const tx=useBarTransaction(async()=>{setForm(null);await onSaved()})
 const b=data?.bankConfig,locked=disabled||tx.busy||tx.uncertain
 function open(){setError('');setForm({bankName:b?.bank_name||'',accountHolder:b?.account_holder||'',kind:b?.cbu_cvu&&!b?.bank_alias?'CBU':'ALIAS',destination:b?.bank_alias||b?.cbu_cvu||'',confirmExclusive:false,note:b?.confirmed_at?'Actualización de cuenta exclusiva del Bar':'Configuración inicial de cuenta exclusiva del Bar',expectedUpdatedAt:b?.updated_at||null})}
 function save(e){
  e.preventDefault();if(locked)return;setError('')
  const p={bankName:form.bankName.trim(),accountHolder:form.accountHolder.trim(),alias:form.kind==='ALIAS'?form.destination.trim():null,cbuCvu:form.kind==='CBU'?form.destination.replace(/\s/g,''):null,confirmExclusive:form.confirmExclusive,note:form.note.trim(),expectedUpdatedAt:form.expectedUpdatedAt}
  if(p.bankName.length<2||p.accountHolder.length<2||p.note.length<5||!p.confirmExclusive){setError('Completá banco, titular y motivo, y confirmá que es la cuenta exclusiva del Bar.');return}
  if((p.alias&&!/^[a-zA-Z0-9._-]{3,40}$/.test(p.alias))||(p.cbuCvu&&!/^[0-9]{22}$/.test(p.cbuCvu))||(!p.alias&&!p.cbuCvu)){setError('Ingresá un alias sin espacios o un CBU/CVU de 22 dígitos.');return}
  tx.run('bar.inventory.bank.save',p)
 }
 return <section className="bar-inventory-section">
 <div className="win-bar-row"><p>Cuenta para transferencias del Bar: <strong>{data?.bankConfigured?'Configurada y confirmada':'Pendiente de confirmar'}</strong></p>
 {canEdit&&<button type="button" className="secundario" disabled={locked||!data||!tx.ready} onClick={open}>{data?.bankConfigured?'Actualizar cuenta para transferencias':'Configurar cuenta para transferencias'}</button>}</div>
 {data?.bankConfigured?<p>{b?.bank_name} · Titular: {b?.account_holder} · {b?.bank_alias?'Alias: '+b.bank_alias:'CBU/CVU: '+b?.cbu_cvu}<br/>Confirmada: {barDateTime(b?.confirmed_at)}</p>:<p className="win-bar-muted">{canEdit?'Completá los datos reales de la cuenta exclusiva del Bar.':'Administración puede completar la cuenta exclusiva del Bar.'}</p>}
 <BarTransactionNotice transaction={tx}/>
 {canEdit&&(data?.bankHistory||[]).length>0&&<details><summary>Historial de la cuenta bancaria</summary>{data.bankHistory.map((a,i)=><p key={a.id||i}>{barDateTime(a.created_at)} · {a.author||a.actorName} · {a.after_record?.bank_name} · {a.after_record?.account_holder} · {a.after_record?.bank_alias||a.after_record?.cbu_cvu} · {a.after_record?.reason}</p>)}</details>}
 {form&&<Modal titulo="Cuenta exclusiva del Bar" onCerrar={()=>{if(!locked)setForm(null)}} footer={<><button form="bar-bank-form" disabled={locked||!tx.ready}>{tx.busy?'Guardando…':'Guardar y confirmar cuenta'}</button><button type="button" className="secundario" disabled={locked} onClick={()=>setForm(null)}>Cancelar</button></>}>
 <BarTransactionNotice transaction={tx}/><ValidatedForm id="bar-bank-form" error={error||tx.error} onSubmit={save}><fieldset disabled={locked} className="bar-plain-fields"><div className="bar-product-fields">
 <label>Banco o billetera<input required minLength={2} maxLength={100} value={form.bankName} onChange={e=>setForm({...form,bankName:e.target.value})}/></label>
 <label>Titular de la cuenta<input required minLength={2} maxLength={120} value={form.accountHolder} onChange={e=>setForm({...form,accountHolder:e.target.value})}/></label>
 <label>Tipo de destino<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value,destination:''})}><option value="ALIAS">Alias</option><option value="CBU">CBU / CVU</option></select></label>
 <label>{form.kind==='ALIAS'?'Alias del Bar':'CBU / CVU del Bar'}<input required maxLength={form.kind==='ALIAS'?40:22} value={form.destination} onChange={e=>setForm({...form,destination:e.target.value})}/></label></div>
 <label>Motivo del registro o actualización<input required minLength={5} maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
 <label><input required type="checkbox" checked={form.confirmExclusive} onChange={e=>setForm({...form,confirmExclusive:e.target.checked})}/>Confirmo que estos son los datos reales de la cuenta exclusiva del Bar.</label>
 <p className="win-bar-muted">La cuenta de Recepción se administra por separado. Cada transferencia nueva conservará la cuenta confirmada al registrarse.</p>
 </fieldset></ValidatedForm></Modal>}
 </section>
}
