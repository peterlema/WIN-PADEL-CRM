import {useCallback,useEffect,useState} from 'react'
import {callApi} from '../api.js'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import {barDateTime,barMethods,barDay} from '../barDisplay.js'
import {Table} from './AdminReportUI.jsx'
import Modal from './Modal.jsx'
import MoneyInput from './MoneyInput.jsx'
import ValidatedForm from './ValidatedForm.jsx'
import useBarTransaction from './useBarTransaction.js'
import BarTransactionNotice from './BarTransactionNotice.jsx'
import BarPendingAccounts from './BarPendingAccounts.jsx'
import {downloadWorkbook} from '../xlsxExport.js'
const types={PARTNER:'Socio',EMPLOYEE:'Empleado',OTHER:'Otro autorizado'}
const money=n=>formatMoney(n,'Pendiente')
const defaults=type=>type==='PARTNER'?{discountPercent:50,minMarkupPercent:10,rounding:'UP',roundingStep:'500'}:{discountPercent:0,minMarkupPercent:0,rounding:'NONE',roundingStep:'1'}
function Configuration({account,onSaved,onCancel,onLock}){
 const a=account||{},c=a.configuration||{},d=defaults(a.account_type||'PARTNER')
 const [form,setForm]=useState({id:a.id||null,customerId:a.customer_id||'',holder:a.holder||'',type:a.account_type||'PARTNER',active:a.active||false,expectedRevision:a.revision||null,
 discountPercent:c.discountPercent??d.discountPercent,minMarkupPercent:c.minMarkupPercent??d.minMarkupPercent,rounding:c.rounding||d.rounding,roundingStep:c.roundingStep==null?d.roundingStep:moneyInputValue(c.roundingStep),notes:c.notes||'',
 exceptions:Object.entries(c.exceptions||{}).map(([productId,price])=>({productId,price:moneyInputValue(price)}))})
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[products,setProducts]=useState([]),[people,setPeople]=useState([])
 const tx=useBarTransaction(onSaved),locked=tx.busy||tx.uncertain
 useEffect(()=>{onLock?.(locked);return()=>onLock?.(false)},[locked,onLock])
 useEffect(()=>{callApi('bar.products').then(d=>setProducts(d.products||[])).catch(e=>setError(e.message));if(!a.id)callApi('bar.inventory.private.candidates').then(d=>setPeople(d.customers||[])).catch(e=>setError(e.message))},[])
 const cfg={discountPercent:Number(form.discountPercent),minMarkupPercent:Number(form.minMarkupPercent),rounding:form.rounding,roundingStep:parseMoneyInput(form.roundingStep),
  notes:form.notes,exceptions:Object.fromEntries(form.exceptions.filter(e=>e.productId&&Number.isFinite(parseMoneyInput(e.price))).map(e=>[e.productId,parseMoneyInput(e.price)]))}
 const signature=JSON.stringify(cfg)
 useEffect(()=>{let live=true;setPreview(null);const timer=setTimeout(()=>callApi('bar.inventory.private.preview',{configuration:JSON.parse(signature)}).then(d=>live&&setPreview(d)).catch(e=>live&&setPreview({error:e.message})),250);return()=>{live=false;clearTimeout(timer)}},[signature])
 function submit(e){e.preventDefault();setError('')
  if(form.exceptions.some(e=>!e.productId||!Number.isFinite(parseMoneyInput(e.price)))||new Set(form.exceptions.map(e=>e.productId)).size!==form.exceptions.length){setError('Completá cada excepción y elegí cada producto una sola vez.');return}
  tx.run('bar.inventory.private.save',{id:form.id,customerId:form.customerId||null,holder:form.holder.trim(),type:form.type,active:form.active,expectedRevision:form.expectedRevision,configuration:cfg})
 }
 return <section><BarTransactionNotice transaction={tx}/><ValidatedForm id="private-account-config" error={error||tx.error} onSubmit={submit}>
 <fieldset disabled={locked} className="bar-plain-fields">
 <div className="bar-product-fields"><label>Titular<input required minLength={2} maxLength={120} value={form.holder} onChange={e=>setForm({...form,holder:e.target.value})}/></label>
 <label>Tipo de cuenta<select aria-label="Tipo de cuenta" value={form.type} onChange={e=>setForm({...form,type:e.target.value,...(!form.id?defaults(e.target.value):{})})}>{Object.entries(types).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
 <label>Estado de la cuenta<select aria-label="Estado de la cuenta" value={form.active?'ACTIVE':'INACTIVE'} onChange={e=>setForm({...form,active:e.target.value==='ACTIVE'})}><option value="INACTIVE">Inactiva: no admite nuevos consumos</option><option value="ACTIVE">Activa: titular autorizado</option></select></label></div>
 {!form.id&&<label>Persona existente (opcional)<select aria-label="Persona existente" value={form.customerId} onChange={e=>{const person=people.find(p=>p.id===e.target.value);setForm({...form,customerId:e.target.value,holder:person?.name||form.holder})}}><option value="">Crear titular nuevo</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><small>Vincular una persona conserva sus saldos anteriores. Registrar clientes o reservas nunca autoriza una cuenta.</small></label>}
 {form.type==='PARTNER'&&<button type="button" className="secundario" onClick={()=>setForm({...form,...defaults('PARTNER')})}>Usar sugerencia para socios: 50% / 10% / $500</button>}
 <div className="bar-product-fields"><label>Descuento sobre precio público (%)<input type="number" min="0" max="100" step="0.01" required value={form.discountPercent} onChange={e=>setForm({...form,discountPercent:e.target.value})}/></label>
 <label>Recargo mínimo sobre costo (%)<input type="number" min="0" max="1000" step="0.01" required value={form.minMarkupPercent} onChange={e=>setForm({...form,minMarkupPercent:e.target.value})}/></label>
 <label>Regla de redondeo<select aria-label="Regla de redondeo" value={form.rounding} onChange={e=>setForm({...form,rounding:e.target.value})}><option value="UP">Hacia arriba</option><option value="NEAREST">Al múltiplo más cercano, respetando el mínimo</option><option value="NONE">Sin múltiplo (hasta centavos)</option></select></label>
 <label>Múltiplo de redondeo ($)<MoneyInput required min={0.01} value={form.roundingStep} onChange={e=>setForm({...form,roundingStep:e.target.value})}/></label></div>
 <details><summary>Excepciones por producto ({form.exceptions.length})</summary>{form.exceptions.map((x,i)=><div className="bar-product-fields" key={i}><label>Producto de la excepción<select aria-label={'Producto de excepción '+(i+1)} value={x.productId} onChange={e=>setForm({...form,exceptions:form.exceptions.map((r,j)=>j===i?{...r,productId:e.target.value}:r)})}><option value="">Elegir producto</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} {p.variant}</option>)}</select></label><label>Precio especial fijo ($)<MoneyInput min={0.01} value={x.price} onChange={e=>setForm({...form,exceptions:form.exceptions.map((r,j)=>j===i?{...r,price:e.target.value}:r)})}/></label><button type="button" className="secundario" onClick={()=>setForm({...form,exceptions:form.exceptions.filter((_,j)=>j!==i)})}>Quitar excepción</button></div>)}<button type="button" className="secundario" onClick={()=>setForm({...form,exceptions:[...form.exceptions,{productId:'',price:''}]})}>Agregar excepción</button><p>La excepción debe respetar el recargo mínimo y la regla de redondeo de esta cuenta.</p></details>
 <label>Observaciones<textarea maxLength={1000} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
 <p className="win-bar-muted">El precio usa el mayor entre precio con descuento y costo más recargo, y aplica el redondeo. Un costo pendiente o un resultado superior al precio público requiere revisión. Los costos provisionales generan márgenes estimados.</p>
 </fieldset>
 <div className="private-form-actions"><button disabled={locked||!tx.ready}>{tx.busy?'Guardando…':'Guardar condiciones de esta cuenta'}</button>{onCancel&&<button type="button" className="secundario" disabled={locked} onClick={onCancel}>Cancelar</button>}</div>
 </ValidatedForm>
 <h4>Previsualización de precios especiales · sólo Administración</h4>{!preview?<p>Calculando previsualización…</p>:preview.error?<p role="alert">{preview.error}</p>:<Table caption="Previsualización de esta cuenta" head={['Producto','Costo vigente','Precio público','Precio especial calculado','Descuento efectivo','Ganancia bruta','Margen']} defaultColumns={[0,1,2,3,4,5,6]} rows={preview.lines.map(p=>[p.name,money(p.unitCost)+(p.estimated?' · Estimado':''),money(p.publicPrice),p.valid?money(p.price):p.error,p.valid?p.effectiveDiscount+'%':'Pendiente',money(p.grossMargin),p.valid?p.marginPercent+'%':'Pendiente'])}/>}
 </section>
}
export default function BarAccounts(){
 const [accounts,setAccounts]=useState([]),[canManage,setCanManage]=useState(false),[selected,setSelected]=useState(''),[tab,setTab]=useState('movements'),[statement,setStatement]=useState(null),[configuration,setConfiguration]=useState(null),[create,setCreate]=useState(false),[pay,setPay]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[bounds,setBounds]=useState({start:'',end:''}),[stateFilter,setStateFilter]=useState('ALL'),[configLocked,setConfigLocked]=useState(false)
 const load=useCallback(async()=>{const d=await callApi('bar.inventory.private.list');setAccounts(d.accounts||[]);setCanManage(d.canManage===true)},[])
 useEffect(()=>{load().catch(e=>setError(e.message))},[load,refresh])
 useEffect(()=>{if(!selected)return;let live=true;setStatement(null);setError('');callApi('bar.inventory.private.statement',{customerId:selected,...bounds}).then(d=>live&&setStatement(d)).catch(e=>live&&setError(e.message));return()=>{live=false}},[selected,bounds.start,bounds.end,refresh])
 useEffect(()=>{if(!selected||tab!=='configuration'||!canManage)return;let live=true;setConfiguration(null);callApi('bar.inventory.private.configuration',{customerId:selected}).then(d=>live&&setConfiguration(d.account)).catch(e=>live&&setError(e.message));return()=>{live=false}},[selected,tab,canManage,refresh])
 const tx=useBarTransaction(async()=>{setPay(null);setRefresh(n=>n+1)}),locked=tx.busy||tx.uncertain
 const holder=accounts.find(a=>a.customerId===selected)
 function saved(r){setCreate(false);setRefresh(n=>n+1);if(r.result?.customerId)setSelected(r.result.customerId)}
 function exportExcel(){try{
  if(statement.truncated)throw new Error('Acotá el período para exportar el estado completo; hay más de 10.000 movimientos.')
  downloadWorkbook('WIN_Estado_Cuenta_'+barDay()+'.xlsx','Movimientos',
   ['Fecha','Producto','Cantidad','Precio unitario aplicado','Consumo','Pago','Saldo acumulado','Medio','Pedido'],
   [['Saldo anterior','','','',0,0,statement.openingBalance,'',''],...statement.rows.map(r=>[barDateTime(r.date),r.product,r.quantity,r.unitPrice,r.debit,r.credit,r.balance,barMethods.find(m=>m[0]===r.method)?.[1]||'',r.orderId])])
 }catch(e){setError(e.message)}}
 return <section className="win-bar-card">
 <div className="win-bar-row"><div><h3>Cuentas corrientes privadas</h3><p className="win-bar-muted">Sólo socios, empleados y otras personas autorizadas por Administración.</p></div><div className="bar-catalog-toolbar"><button className="secundario" onClick={()=>setRefresh(n=>n+1)} disabled={locked}>Actualizar cuentas</button>{canManage&&<button onClick={()=>setCreate(true)}>Crear cuenta privada</button>}</div></div>
 {error&&<p role="alert">{error}</p>}<BarTransactionNotice transaction={tx}/>
 <label>Estado de titulares<select aria-label="Estado de titulares" value={stateFilter} onChange={e=>setStateFilter(e.target.value)}><option value="ALL">Todos</option><option value="ACTIVE">Activos</option><option value="INACTIVE">Inactivos</option></select></label>
 <Table caption="Titulares de cuentas privadas" head={['Titular','Tipo de cuenta','Estado','Saldo pendiente','Acciones']} rows={accounts.filter(a=>stateFilter==='ALL'||a.active===(stateFilter==='ACTIVE')).map(a=>[a.holder,types[a.type],a.active?'Activa':'Inactiva',money(a.balance),<button className="secundario" onClick={()=>{setSelected(a.customerId);setTab('movements')}}>Ver cuenta {a.holder}</button>])}/>
 {holder&&<section className="private-account-detail"><h3>{holder.holder} · {types[holder.type]}</h3><div className="bar-pos-filters"><button aria-pressed={tab==='movements'} onClick={()=>setTab('movements')}>Movimientos</button>{canManage&&<button aria-pressed={tab==='configuration'} onClick={()=>setTab('configuration')}>Configuración</button>}</div>
 {tab==='configuration'&&canManage&&(configuration?<Configuration key={configuration.id+':'+configuration.revision} account={configuration} onSaved={saved}/>:<p>Cargando condiciones…</p>)}
 {tab==='movements'&&<><div className="bar-account-filters"><label>Desde<input type="date" value={bounds.start} onChange={e=>setBounds({...bounds,start:e.target.value})}/></label><label>Hasta<input type="date" value={bounds.end} onChange={e=>setBounds({...bounds,end:e.target.value})}/></label><button className="secundario" disabled={!statement||statement.truncated} onClick={exportExcel}>Exportar a Excel</button><button disabled={locked||!statement||Number(statement.balance)<=0||!tx.ready} onClick={()=>setPay({amount:moneyInputValue(statement.balance),method:'CASH'})}>Cobrar cuenta</button></div>
 {!statement?<p>Cargando movimientos…</p>:<><p>Saldo anterior al período: <strong>{money(statement.openingBalance)}</strong> · Saldo al final del período: <strong>{money(statement.closingBalance)}</strong> · Deuda actual: <strong>{money(statement.balance)}</strong></p>
 {statement.truncated&&<p role="alert">Hay más de 10.000 movimientos. Acotá el período para consultar y exportar el estado completo.</p>}
 <Table caption="Movimientos del titular" head={['Fecha','Producto','Cantidad','Precio unitario aplicado','Consumo','Pago','Saldo acumulado']} defaultColumns={[0,1,2,3,4,5,6]} rows={statement.rows.map(r=>[barDateTime(r.date),r.product,r.quantity??'',r.unitPrice==null?'':money(r.unitPrice),r.debit?money(r.debit):'',r.credit?money(r.credit):'',money(r.balance)])}/></>}
 </>}
 </section>}
 <details open={!selected}><summary>Pendientes de cancha y saldos anteriores sin cuenta autorizada</summary><p className="win-bar-muted">Estos consumos conservan su cobro e historia. No autorizan nuevos consumos a cuenta.</p><BarPendingAccounts/></details>
 {create&&canManage&&<Modal titulo="Nueva cuenta corriente privada" onCerrar={()=>{if(!configLocked)setCreate(false)}}><Configuration onLock={setConfigLocked} onSaved={saved} onCancel={()=>setCreate(false)}/></Modal>}
 {pay&&<Modal titulo="Cobrar cuenta privada" onCerrar={()=>{if(!locked)setPay(null)}} footer={<><button type="submit" form="private-account-pay" disabled={locked}>Confirmar cobro de cuenta</button><button type="button" className="secundario" disabled={locked} onClick={()=>setPay(null)}>Cancelar</button></>}>
 <BarTransactionNotice transaction={tx}/><ValidatedForm id="private-account-pay" error={tx.error} onSubmit={e=>{e.preventDefault();tx.run('bar.inventory.private.pay',{customerId:selected,amount:parseMoneyInput(pay.amount),method:pay.method})}}><fieldset disabled={locked} className="bar-plain-fields"><p>{holder?.holder} · Deuda actual {money(statement?.balance)}</p><label>Importe recibido ($)<MoneyInput required min={0.01} max={statement?.balance} value={pay.amount} onChange={e=>setPay({...pay,amount:e.target.value})}/></label><label>Medio del cobro<select aria-label="Medio del cobro" value={pay.method} onChange={e=>setPay({...pay,method:e.target.value})}>{barMethods.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label><p>Se aplica primero a los consumos más antiguos. No vuelve a descontar stock.{pay.method==='TRANSFER'?' Verificá el ingreso y compartí el comprobante en el grupo.':''}</p></fieldset></ValidatedForm></Modal>}
 </section>
}
