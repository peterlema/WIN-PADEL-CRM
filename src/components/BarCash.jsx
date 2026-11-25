import {useCallback,useEffect,useState} from 'react'
import {callApi} from '../api.js'
import {formatMoney,parseMoneyInput} from '../money.js'
import {barDateTime,barMethods,barKind} from '../barDisplay.js'
import MoneyInput from './MoneyInput.jsx'
import Modal from './Modal.jsx'
import ValidatedForm from './ValidatedForm.jsx'
import useBarTransaction from './useBarTransaction.js'
import BarTransactionNotice from './BarTransactionNotice.jsx'
const money=n=>formatMoney(n,'Pendiente')
function Totals({t={}}){return <dl className="bar-totals">{[['Fondo inicial',t.openingCash],['Cobros en efectivo',t.cashSales],['Cobros por transferencia',t.transferSales],['Cobros con tarjeta',t.cardSales],['Pagos a proveedores',t.supplierPayments],['Gastos',t.expenses],['Retiros',t.withdrawals],['Egresos pagados en efectivo',t.cashOut],['Efectivo esperado',t.cashExpected]].map(([label,n])=><div key={label}><dt>{label}</dt><dd>{money(n)}</dd></div>)}</dl>}
export default function BarCash(){
 const [data,setData]=useState(null),[form,setForm]=useState(null),[error,setError]=useState('')
 const load=useCallback(async()=>{const d=await callApi('bar.inventory.cash.state');setData(d)},[])
 const tx=useBarTransaction(async()=>{setForm(null);await load()})
 useEffect(()=>{load().catch(e=>setError(e.message))},[load])
 const locked=tx.busy||tx.uncertain,sh=data?.shift,t=data?.totals||{}
 const canClose=sh&&(data.canManage||sh.opened_by===data.currentUserId)
 const count=form?.amount===''?null:parseMoneyInput(form?.amount)
 const difference=Number.isFinite(count)?count-Number(t.cashExpected||0):null
 function submit(e){e.preventDefault()
  if(form.type==='open')tx.run('bar.inventory.cash.open',{openingCash:parseMoneyInput(form.amount)})
  else if(form.type==='close')tx.run('bar.inventory.cash.close',{shiftId:sh.id,countedCash:parseMoneyInput(form.amount),note:form.note})
  else tx.run('bar.inventory.cash.out',{shiftId:sh.id,amount:parseMoneyInput(form.amount),kind:form.kind,method:form.method,note:form.note})
 }
 return <section className="win-bar-card">
  <div className="win-bar-row"><div><h3>Caja Bar</h3><p className="win-bar-muted">{sh?'Abierta por '+sh.responsible+' · '+barDateTime(sh.opened_at):'Sin turno abierto'}</p></div><div className="bar-catalog-toolbar"><button className="secundario" disabled={locked} onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</button>{!sh?<button disabled={locked||!tx.ready} onClick={()=>setForm({type:'open',amount:''})}>Abrir Caja Bar</button>:canClose&&<><button className="secundario" disabled={locked} onClick={()=>setForm({type:'out',amount:'',note:'',kind:'EXPENSE',method:'CASH'})}>Registrar gasto / retiro</button><button disabled={locked} onClick={()=>setForm({type:'close',amount:'',note:''})}>Cerrar y arquear</button></>}</div></div>
  <BarTransactionNotice transaction={tx}/>{error&&<p role="alert">{error}</p>}
  <p className="win-bar-muted">Transferencias habilitadas sin configurar una cuenta bancaria. Verificá el ingreso y compartí el comprobante en el grupo.</p>
  {sh&&<><Totals t={t}/><p className="win-bar-muted">El efectivo esperado incluye fondo y movimientos en efectivo. Transferencias y tarjetas se controlan por separado.</p></>}
  <h4>Movimientos {sh?'del turno abierto':''}</h4>
  <div className="bar-table-scroll"><table><thead><tr><th>Fecha</th><th>Movimiento / empleado</th><th>Medio</th><th className="num">Importe</th><th>Referencia</th><th>Cuenta bancaria del Bar</th></tr></thead><tbody>{(data?.movements||[]).map(m=><tr key={m.id}><td className="bar-nowrap">{barDateTime(m.occurred_at)}</td><td>{barKind[m.kind]}<small>{m.author}</small></td><td>{barMethods.find(x=>x[0]===m.payment_method)?.[1]}</td><td className="num">{money(m.amount_signed)}</td><td>{m.note||m.order_id||m.purchase_id}</td><td>{m.bank_destination_snapshot?<>{m.amount_signed>0?'Destino: ':'Origen: '}{m.bank_destination_snapshot.bankName} · {m.bank_destination_snapshot.accountHolder} · {m.bank_destination_snapshot.alias||m.bank_destination_snapshot.cbuCvu}</>:m.bank_account_snapshot||(m.payment_method==='TRANSFER'?'Cuenta no informada':'No corresponde')}</td></tr>)}</tbody></table>{data&&!(data.movements||[]).length&&<p>Sin movimientos en el turno abierto.</p>}</div>
  <details><summary>Turnos e historial de arqueos</summary>{(data?.shifts||[]).map(s=><details className="bar-shift-history" key={s.id}><summary>{barDateTime(s.opened_at)} · {s.responsible} · {s.status==='OPEN'?'Abierto':'Cerrado'} · Diferencia: {money(s.totals?.difference)}</summary><Totals t={s.closing_snapshot||s.totals}/><p>Contado: {money(s.counted_cash)} · Cierre: {barDateTime(s.closed_at)}{s.note?' · '+s.note:''}</p></details>)}</details>
  {data?.canManage&&<details><summary>Auditoría de cuenta bancaria</summary>{(data.bankHistory||[]).map((h,i)=><p key={i}>{barDateTime(h.created_at)} · {h.author} · {h.after_record.bank||h.after_record.accountLabel} · {h.after_record.holder} · {h.after_record.identifier}</p>)}</details>}
  {form&&<Modal titulo={{bank:'Cuenta bancaria exclusiva del Bar',open:'Abrir Caja Bar',close:'Cierre y arqueo de Caja Bar',out:'Registrar egreso real del Bar'}[form.type]} onCerrar={()=>{if(!locked)setForm(null)}} footer={<><button form="bar-cash-action" type="submit" disabled={locked||!tx.ready}>{tx.busy?'Confirmando…':form.type==='bank'?'Confirmar cuenta':form.type==='close'?'Confirmar cierre':form.type==='open'?'Confirmar apertura':'Registrar egreso real'}</button><button className="secundario" type="button" disabled={locked} onClick={()=>setForm(null)}>Cancelar</button></>}>
   <BarTransactionNotice transaction={tx}/><ValidatedForm id="bar-cash-action" error={tx.error} onSubmit={submit}><fieldset disabled={locked} className="bar-plain-fields">
    <>
     {form.type==='close'&&<><Totals t={t}/><p>Contá únicamente el efectivo físico.</p></>}
     <label>{form.type==='open'?'Fondo inicial real ($)':form.type==='close'?'Efectivo contado ($)':'Importe realmente pagado / retirado ($)'}<MoneyInput min={form.type==='out'?0.01:0} required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
     {form.type==='close'&&<p className={difference?'win-bar-warning':'win-bar-message good'}>Diferencia de caja: <strong>{money(difference)}</strong></p>}
     {form.type==='out'&&<div className="bar-product-fields"><label>Tipo<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="EXPENSE">Gasto</option><option value="WITHDRAWAL">Retiro</option></select></label><label>Medio<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}>{barMethods.map(([k,l])=><option  key={k} value={k}>{l}</option>)}</select></label></div>}
     {form.type!=='open'&&<label>{form.type==='close'?'Motivo de la diferencia / observación':'Concepto / comprobante'}<input maxLength={1000} required={form.type==='out'||(difference!==null&&difference!==0)} minLength={5} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>}
    </>}
   </fieldset></ValidatedForm>
  </Modal>}
 </section>
}
