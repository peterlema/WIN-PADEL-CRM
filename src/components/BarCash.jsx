import MoneyInput from './MoneyInput.jsx'
import BarBankConfig from './BarBankConfig.jsx'
import {formatMoney,parseMoneyInput} from '../money.js'
import {barDate} from '../barDate.js'
import {useEffect,useRef,useState} from 'react'
import {callApi} from '../api.js'
const money=value=>formatMoney(value,'Sin definir')
export default function BarCash(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[amount,setAmount]=useState(''),[note,setNote]=useState(''),[admin,setAdmin]=useState(false)
 const request=useRef({key:null,id:null})
 async function load(){const [d,me]=await Promise.all([callApi('bar.inventory.cash.state'),callApi('me')]);setData(d);setAdmin(me.user.role==='ADMIN')}
 useEffect(()=>{load().catch(e=>setError(e.message))},[])
 async function run(action,p){if(busy)return;setBusy(true);setError('');const key=JSON.stringify([action,p]);if(request.current.key!==key)request.current={key,id:crypto.randomUUID()};try{await callApi('bar.inventory.'+action,{...p,requestId:request.current.id});request.current={key:null,id:null};setAmount('');setNote('');await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="win-bar-card"><div className="win-bar-row"><h3>Caja Bar</h3><button className="secundario" disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</button></div>
 <p className="win-bar-muted">Caja y banco exclusivos del Bar. Los movimientos y cuentas de Recepción se mantienen independientes.</p>
 {error&&<p className="win-bar-message" role="alert">{error}</p>}
 {!data?<p>Cargando…</p>:<>
 <p><strong>{data.shift?'Caja Bar abierta':'Caja Bar cerrada'}</strong>{data.shift&&' · Apertura: '+barDate(data.shift.opened_at)}</p>
 {data.shift&&<div className="bar-product-fields"><p>Efectivo físico esperado: <strong>{money(data.cashExpected)}</strong></p><p>Transferencias recibidas: <strong>{money(data.totals?.transfersReceived||0)}</strong></p><p>Pagos por transferencia: <strong>{money(data.totals?.transfersPaid||0)}</strong></p><p>Tarjeta: <strong>{money(data.totals?.cardsReceived||0)}</strong></p></div>}
 <p className="win-bar-muted">Las transferencias y tarjetas no aumentan el efectivo físico esperado.</p>
 <form className="bar-product-editor" onSubmit={e=>{e.preventDefault();run(data.shift?'cash.close':'cash.open',data.shift?{shiftId:data.shift.id,countedCash:parseMoneyInput(amount),note}:{openingCash:parseMoneyInput(amount)})}}>
 <label>{data.shift?'Efectivo contado al cerrar ($)':'Efectivo real para apertura ($)'}<MoneyInput min="0" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
 {data.shift&&<label>Motivo de diferencia / observación<input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>}
 <button disabled={busy}>{data.shift?'Confirmar cierre Caja Bar':'Abrir Caja Bar'}</button>
 </form>
 <BarBankConfig data={data} canEdit={admin} onSaved={load}/>
 <h4>Aperturas y cierres de Caja Bar</h4><div className="bar-table-scroll"><table><thead><tr><th scope="col">Responsable</th><th scope="col">Estado</th><th scope="col">Apertura</th><th scope="col">Cierre</th><th scope="col">Efectivo inicial</th><th scope="col">Efectivo contado</th><th scope="col">Transferencias recibidas</th><th scope="col">Pagos por transferencia</th><th scope="col">Tarjeta</th></tr></thead><tbody>
 {(data.shifts||[]).map(s=><tr key={s.id}><td>{s.responsible}</td><td>{s.status==='OPEN'?'Abierto':'Cerrado'}</td><td>{barDate(s.opened_at)}</td><td>{s.closed_at?barDate(s.closed_at):'Pendiente'}</td><td>{money(s.opening_cash)}</td><td>{s.counted_cash==null?'Pendiente':money(s.counted_cash)}</td><td>{money(s.totals?.transfersReceived||0)}</td><td>{money(s.totals?.transfersPaid||0)}</td><td>{money(s.totals?.cardsReceived||0)}</td></tr>)}
 </tbody></table></div>
 <h4>Movimientos de Caja Bar</h4><div className="bar-table-scroll"><table><thead><tr><th scope="col">Fecha</th><th scope="col">Empleado</th><th scope="col">Tipo</th><th scope="col">Medio</th><th scope="col">Importe</th><th scope="col">Pedido / referencia</th><th scope="col">Cuenta bancaria del Bar</th></tr></thead><tbody>
 {(data.movements||[]).map(m=><tr key={m.id}><td>{barDate(m.occurred_at)}</td><td>{m.responsible}</td><td>{m.kind==='SALE'?'Cobro de venta':'Pago de compra'}</td><td>{{CASH:'Efectivo',TRANSFER:'Transferencia Bar',CARD:'Tarjeta'}[m.payment_method]}</td><td>{money(m.amount_signed)}</td><td>{m.order_id||m.purchase_id||m.note}</td><td>{m.bank_destination_snapshot?<>{m.amount_signed>0?'Destino: ':'Origen: '}{m.bank_destination_snapshot.bankName} · {m.bank_destination_snapshot.accountHolder} · {m.bank_destination_snapshot.alias||m.bank_destination_snapshot.cbuCvu}</>:m.bank_account_snapshot||'No corresponde'}</td></tr>)}
 </tbody></table></div>
 </>}
 </section>
}
