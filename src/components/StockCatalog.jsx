import MoneyInput from './MoneyInput.jsx'
import {formatMoney,parseMoneyInput,moneyInputValue} from '../money.js'
import { useCallback, useEffect, useState } from 'react'
import BarCosts,{BarProductCost} from './BarCosts.jsx'
import BarInventory from './BarInventory.jsx'
import { callApi } from '../api.js'

const money = value => formatMoney(value,'Sin definir')
const empty = () => ({id:null,name:'',variant:'',category:'Bebidas',salePrice:'',unitCost:'',barcode:'',active:true})
const toInput = moneyInputValue
function decimalOrNull(raw) {
  const v=String(raw).trim()
  if(!v) return null
  const n=parseMoneyInput(v)
  if(!Number.isFinite(n)||n<0||Math.abs(Math.round(n*100)-n*100)>1e-7) throw new Error('El precio y el costo deben ser importes positivos, con hasta dos decimales.')
  return n
}
export default function StockCatalog() {
  const [products,setProducts]=useState([])
  const [canEdit,setCanEdit]=useState(false)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [editing,setEditing]=useState(null)
  const [form,setForm]=useState(empty())
  const [search,setSearch]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const refresh=useCallback(async()=>{
    setLoading(true);setError('')
    try {
      const data=await callApi('bar.products')
      setProducts(data.products||[])
      setCanEdit(data.canEdit===true)
    } catch(e){setError(e.message||'No se pudo consultar el catálogo.')}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{refresh()},[refresh])
  function add(){setEditing('new');setForm(empty());setNotice('');setError('')}
  function edit(product) {
    setEditing(product.id)
    setForm({id:product.id,name:product.name,variant:product.variant,category:product.category,
      salePrice:toInput(product.salePrice),unitCost:toInput(product.unitCost),barcode:product.barcode||'',active:product.active})
    setNotice('');setError('')
  }
  async function save(e) {
    e.preventDefault()
    if(saving)return
    setError('');setNotice('')
    if(!form.name.trim()||!form.category.trim()){setError('Indicá nombre y categoría.');return}
    let salePrice,unitCost
    try {salePrice=decimalOrNull(form.salePrice);unitCost=products.find(p=>p.id===form.id)?.unitCost??null}
    catch(e){setError(e.message);return}
    setSaving(true)
    try {
      await callApi('bar.product.save',{...form,name:form.name.trim(),variant:form.variant.trim(),category:form.category.trim(),
        barcode:form.barcode.trim()||null,salePrice,unitCost})
      setEditing(null);setForm(empty());setNotice('Producto guardado.');await refresh()
    }catch(e){setError(e.message||'No se pudo guardar el producto.')}
    finally{setSaving(false)}
  }
  const filtered=products.filter(p=>[p.name,p.variant,p.category,p.barcode||''].join(' ').toLowerCase().includes(search.toLowerCase().trim()))
  const categories=[...new Set(filtered.map(p=>p.category))].sort((a,b)=>a.localeCompare(b,'es'))
  return <section className="win-bar-card bar-catalog">
    <div className="win-bar-row">
      <div><h3>Productos de Bar / Buffet</h3><p className="win-bar-muted">Inventario único del Bar: depósito y heladeras. Las ventas y recepciones actualizan estas existencias.</p></div>
      <div className="bar-catalog-toolbar">
        <button type="button" className="secundario" onClick={refresh} disabled={loading||saving}>Actualizar</button>
        {canEdit&&<button type="button" onClick={add}>+ Agregar producto</button>}
      </div>
    </div>
    <p className="win-bar-warning">Los costos provisionales están disponibles para operar. Las diferencias históricas son informativas. Las compras nuevas permiten costo unitario, total o reparto estimado por referencias.</p>
    {error&&<p className="win-bar-message" role="alert">{error}</p>}
    {notice&&<p className="win-bar-message good" role="status">{notice}</p>}
    {canEdit&&editing!==null&&<form className="bar-product-editor" onSubmit={save}>
      <div className="win-bar-row"><h3>{editing==='new'?'Nuevo producto':'Editar producto'}</h3><button type="button" className="secundario" onClick={()=>setEditing(null)}>Cancelar</button></div>
      <div className="bar-product-fields">
        <label>Producto<input required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ej. Gatorade" /></label>
        <label>Variante / sabor<input maxLength={90} value={form.variant} onChange={e=>setForm({...form,variant:e.target.value})} placeholder="Ej. Azul (opcional)" /></label>
        <label>Categoría<input required maxLength={80} value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="Bebidas" /></label>
        <label>Precio de venta ($)<MoneyInput inputMode="decimal" value={form.salePrice} onChange={e=>setForm({...form,salePrice:e.target.value})} placeholder="A definir" /></label>
        <label>Costo promedio ponderado<span>{money(products.find(p=>p.id===form.id)?.unitCost)}</span><small>Se actualiza desde compras recibidas. El costo provisional se carga por separado abajo.</small></label>
        <label>Código de barras<input maxLength={60} value={form.barcode} onChange={e=>setForm({...form,barcode:e.target.value})} placeholder="Opcional" /></label>
      </div>
      <label className="bar-catalog-active"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Producto activo para la venta</label>
      <button type="submit" disabled={saving}>{saving?'Guardando…':'Guardar producto'}</button>
    </form>}
    {canEdit&&editing&&editing!=='new'&&products.find(p=>p.id===editing)&&<BarProductCost key={editing+':'+products.find(p=>p.id===editing).costVersion} product={products.find(p=>p.id===editing)} onSaved={refresh}/>}
    <div className="bar-catalog-search"><label>Buscar producto<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nombre, variante o categoría"/></label><span>{filtered.length} productos</span></div>
    {loading?<p className="win-bar-muted">Cargando productos desde Supabase…</p>:products.length===0?<p className="win-bar-empty">No hay productos cargados.</p>:filtered.length===0?<p className="win-bar-empty">No se encontraron productos con ese filtro.</p>:
      categories.map(category=><div className="bar-product-group" key={category}><h4>{category}</h4>
        {filtered.filter(p=>p.category===category).map(p=><div className={"bar-product-item"+(p.lowStock?" bar-stock-low":"")} key={p.id}>
          <div><strong>{p.name}{p.variant?' · '+p.variant:''}</strong><small>{p.active?'Activo':'Inactivo'} · {p.stockKnown?p.stock+' unidades':'Stock sin conteo'}{p.lowStock?' · Reponer':''}</small></div>
          <div className="bar-product-price"><span>Venta: <b>{money(p.salePrice)}</b></span>{canEdit&&<span>Costo vigente: {money(p.unitCost)} · {p.costOrigin}{p.costEstimated?' · Estimado':''}<br/>Margen bruto {p.costEstimated?'estimado ':''}: {money(p.grossMarginUnit)} ({p.grossMarginPercent==null?'Pendiente':Number(p.grossMarginPercent).toLocaleString('es-AR',{maximumFractionDigits:2})+'%'})<br/>Inventario {p.costEstimated?'estimado ':''}: {money(p.inventoryValue)}</span>}</div>
          {canEdit&&<div className="bar-catalog-toolbar"><label>Mínimo<input aria-label={'Stock mínimo '+p.name+' '+p.variant} type="number" min="0" step="1" placeholder="Sin definir" defaultValue={p.stockMin??''} key={p.id+':'+p.stockMin} onBlur={async e=>{const v=e.target.value===''?null:Number(e.target.value);if(v===p.stockMin)return;if(v!==null&&(!Number.isInteger(v)||v<0)){setError('El mínimo debe ser un número entero positivo.');return}try{await callApi('bar.inventory.minimum.set',{requestId:crypto.randomUUID(),productId:p.id,quantity:v});await refresh()}catch(err){setError(err.message)}}}/></label><button type="button" className="secundario" onClick={()=>edit(p)}>Editar precio / producto</button></div>}
        </div>)}
      </div>)}
    <BarInventory onStockChanged={refresh}/>
    {canEdit&&<BarCosts products={products} onSaved={refresh}/>}
  </section>
}
