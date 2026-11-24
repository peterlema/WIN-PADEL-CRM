import MoneyInput from './MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import {useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
const money = value => formatMoney(value,'Sin definir')
export default function BarCash(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[amount,setAmount]=useState(''),[note,setNote]=useState(''),[bank,setBank]=useState(''),[admin,setAdmin]=useState(false)
 const request=useRef({key:null,id:null})
 async function load(){const [d,me]=await Promise.all([callApi('bar.inventory.cash.state'),callApi('me')]);setData(d);setAdmin(me.user.role==='ADMIN');setBank(d.bankAccount||'')}
 useEffect(()=>{load().catch(e=>setError(e.message))},[])
 async function run(action,p){if(busy)return;setBusy(true);setError('');const key=JSON.stringify([action,p]);if(request.current.key!==key)request.current={key,id:crypto.randomUUID()};try{await callApi('bar.inventory.'+action,{...p,requestId:request.current.id});request.current={key:null,id:null};setAmount('');setNote('');await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="win-bar-card"><div className="win-bar-row"><h3>Caja Bar</h3><button className="secundario" disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</button></div>
  <p className="win-bar-muted">Caja y cuenta bancaria exclusivas del Bar. Abrir, cobrar o pagar aquí no modifica Caja Recepción. El conteo inicial y la compra histórica no generaron movimientos de dinero.</p>
  {error&&<p className="win-bar-message" role="alert">{error}</p>}
  {!data?<p>Cargando…</p>:<><p><strong>{data.shift?'Caja Bar abierta':'Caja Bar cerrada'}</strong>{data.shift&&' · Efectivo esperado: '+money(data.cashExpected)}</p>
   <form className="bar-product-editor" onSubmit={e=>{e.preventDefault();run(data.shift?'cash.close':'cash.open',data.shift?{shiftId:data.shift.id,countedCash:parseMoneyInput(amount),note}:{openingCash:parseMoneyInput(amount)})}}>
    <label>{data.shift?'Efectivo contado al cerrar ($)':'Efectivo real para apertura ($)'}<MoneyInput type="number" min="0" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    {data.shift&&<label>Motivo de diferencia / observación<input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>}
    <button disabled={busy}>{data.shift?'Confirmar cierre Caja Bar':'Abrir Caja Bar'}</button>
   </form>
   <p>Cuenta para transferencias del Bar: <strong>{data.bankAccount||'Pendiente de confirmar'}</strong>.</p>
   {!data.bankConfigured&&<p className="win-bar-warning">Las transferencias están bloqueadas hasta confirmar la cuenta del Bar.</p>}
   {admin&&<form className="bar-product-editor" onSubmit={e=>{e.preventDefault();run('bank.save',{accountLabel:bank})}}><label>Cuenta bancaria exclusiva del Bar (banco, titular y alias / CBU)<input required minLength={5} maxLength={200} value={bank} onChange={e=>setBank(e.target.value)}/></label><button disabled={busy}>Guardar cuenta confirmada</button></form>}
   <h4>Turnos de Caja Bar</h4><div className="bar-table-scroll"><table><thead><tr><th>Responsable</th><th>Estado</th><th>Apertura</th><th>Efectivo contado al cierre</th></tr></thead><tbody>{(data.shifts||[]).map(s=><tr key={s.id}><td>{s.responsible}</td><td>{s.status==='OPEN'?'Abierto':'Cerrado'}</td><td>{s.opened_at}</td><td>{s.counted_cash==null?'Pendiente':money(s.counted_cash)}</td></tr>)}</tbody></table></div><h4>Últimos movimientos de Caja Bar</h4><div className="bar-table-scroll"><table><thead><tr><th>Tipo</th><th>Medio</th><th>Importe</th><th>Referencia</th></tr></thead><tbody>{data.movements.map(m=><tr key={m.id}><td>{m.kind==='SALE'?'Cobro de venta':'Pago de compra'}</td><td>{{CASH:'Efectivo',TRANSFER:'Transferencia Bar',CARD:'Tarjeta'}[m.payment_method]}</td><td>{money(m.amount_signed)}</td><td>{m.note||m.order_id||m.purchase_id}</td></tr>)}</tbody></table></div>
  </>}
 </section>
}
