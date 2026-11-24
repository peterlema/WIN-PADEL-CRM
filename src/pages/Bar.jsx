import {useState} from 'react'
import QuickBar from '../components/QuickBar.jsx'
import BarInventory from '../components/BarInventory.jsx'
import BarCash from '../components/BarCash.jsx'
import StockCatalog from '../components/StockCatalog.jsx'

const sections=[
 {id:'sales',label:'Ventas rápidas'},
 {id:'stock',label:'Stock y precios'},
 {id:'purchases',label:'Compras'},
 {id:'accounts',label:'Cuentas corrientes'},
 {id:'cash',label:'Caja Bar'}
]

export default function Bar({soloVenta=false}){
 const [tab,setTab]=useState('sales')
 // Empleado de Bar (rol BAR): sólo vende y cobra pendientes; no edita precios ni ve secciones vacías.

 return <main className="win-bar">
   <section className="win-bar-header"><div><h2>Bar / Buffet</h2><p>Venta rápida, consumos pendientes e inventario</p></div></section>
   <nav className="win-bar-tabs" aria-label="Áreas del Bar">
     {sections.filter(s=>!soloVenta||s.id!=='purchases').map(s=><button key={s.id} type="button" className={tab===s.id?'current':''} onClick={()=>setTab(s.id)} aria-current={tab===s.id?'page':undefined}>{s.label}</button>)}
   </nav>
   {tab==='sales'&&<QuickBar soloVenta={soloVenta}/>}
   {tab==='cash'&&<BarCash/>}
   {tab==='stock'&&<StockCatalog/>}
   {tab==='purchases'&&<section className="win-bar-card"><BarInventory purchasesOnly/></section>}
   {tab==='accounts'&&<section className="win-bar-card">
     <h3>Cuentas corrientes y pendientes</h3>
     <p>Para abrir una cuenta de una persona y ver sus consumos pendientes, entrá en <button type="button" className="secundario" onClick={()=>setTab('sales')}>Ventas rápidas y pendientes</button>.</p>
     <p className="win-bar-muted">Esta primera versión reúne ventas y deuda en una única vista para que no haya dos circuitos de registro. Más adelante incorporaremos un resumen de saldos y antigüedad por persona.</p>
   </section>}
 </main>
}
