import {useRef,useState} from 'react'
import {callApi} from '../api.js'
import {barDate} from '../barDate.js'
export default function BarBankConfig({data,canEdit,onSaved}){
 const [form,setForm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const request=useRef(null)
 const b=data?.bankConfig
 function open(){setError('');setForm({bankName:b?.bank_name||'',accountHolder:b?.account_holder||'',kind:b?.cbu_cvu&&!b?.bank_alias?'CBU':'ALIAS',destination:b?.bank_alias||b?.cbu_cvu||'',confirmExclusive:false,note:b?.confirmed_at?'Actualización de cuenta exclusiva del Bar':'Configuración inicial de cuenta exclusiva del Bar',expectedUpdatedAt:b?.updated_at||null})}
 async function save(e){
  e.preventDefault();if(busy)return;setError('')
  const p={bankName:form.bankName.trim(),accountHolder:form.accountHolder.trim(),alias:form.kind==='ALIAS'?form.destination.trim():null,cbuCvu:form.kind==='CBU'?form.destination.replace(/\s/g,''):null,confirmExclusive:form.confirmExclusive,note:form.note.trim(),expectedUpdatedAt:form.expectedUpdatedAt}
  if(p.bankName.length<2||p.accountHolder.length<2||p.note.length<5||!p.confirmExclusive){setError('Completá banco, titular, destino y motivo, y confirmá que es la cuenta exclusiva del Bar.');return}
  if(p.alias&&!/^[a-zA-Z0-9._-]{3,40}$/.test(p.alias)||p.cbuCvu&&!/^[0-9]{22}$/.test(p.cbuCvu)){setError('Revisá el alias sin espacios o el CBU/CVU de 22 dígitos.');return}
  const key=JSON.stringify(p);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
  setBusy(true)
  try{await callApi('bar.inventory.bank.save',{...p,requestId:request.current.id});request.current=null;setForm(null);await onSaved()}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 return <section className="bar-inventory-section">
 <p>Cuenta para transferencias del Bar: <strong>{data?.bankConfigured?'Configurada y confirmada':'Pendiente de confirmar'}</strong></p>
 {data?.bankConfigured?<p>{b?.bank_name} · Titular: {b?.account_holder} · {b?.bank_alias?'Alias: '+b.bank_alias:'CBU/CVU: '+b?.cbu_cvu}<br/>Confirmada: {barDate(b?.confirmed_at)}</p>:<p className="win-bar-muted">Podés seguir cobrando en efectivo. Las transferencias se habilitan al confirmar la cuenta exclusiva del Bar.</p>}
 {canEdit?<button type="button" className="secundario" disabled={busy} onClick={open}>{data?.bankConfigured?'Actualizar cuenta para transferencias':'Configurar cuenta para transferencias'}</button>:!data?.bankConfigured&&<p>Administración debe configurar la cuenta para transferencias.</p>}
 {form&&<form className="bar-product-editor" onSubmit={save}>
 <h4>Cuenta exclusiva del Bar</h4><div className="bar-product-fields">
 <label>Banco o billetera<input required minLength={2} maxLength={100} value={form.bankName} onChange={e=>setForm({...form,bankName:e.target.value})}/></label>
 <label>Titular de la cuenta<input required minLength={2} maxLength={120} value={form.accountHolder} onChange={e=>setForm({...form,accountHolder:e.target.value})}/></label>
 <label>Tipo de destino<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value,destination:''})}><option value="ALIAS">Alias</option><option value="CBU">CBU / CVU</option></select></label>
 <label>{form.kind==='ALIAS'?'Alias del Bar':'CBU / CVU del Bar'}<input required maxLength={40} value={form.destination} onChange={e=>setForm({...form,destination:e.target.value})}/></label>
 </div><label>Motivo del registro o actualización<input required minLength={5} maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
 <label><input required type="checkbox" checked={form.confirmExclusive} onChange={e=>setForm({...form,confirmExclusive:e.target.checked})}/>Confirmo que estos son los datos reales de la cuenta exclusiva del Bar.</label>
 {error&&<p role="alert" className="win-bar-message">{error}</p>}
 <button disabled={busy}>{busy?'Guardando…':'Guardar y habilitar transferencias'}</button>
 <button type="button" className="secundario" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button>
 </form>}
 {canEdit&&(data?.bankHistory||[]).length>0&&<details><summary>Historial de la cuenta bancaria</summary>{data.bankHistory.map(a=><p key={a.id}>{barDate(a.created_at)} · {a.actorName} · {a.after_record?.account_label||a.after_record?.accountLabel} · {a.after_record?.reason||'Registro anterior'}</p>)}</details>}
 </section>
}
