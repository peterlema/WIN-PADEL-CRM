import BarAccounts from '../components/BarAccounts.jsx'
import BarDashboard from '../components/BarDashboard.jsx'
import {callApi} from '../api.js'
import BarEmployeePricing from '../components/BarEmployeePricing.jsx'
import {useEffect,useState} from 'react'
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
 const [isAdmin,setIsAdmin]=useState(false)
 useEffect(()=>{callApi('me').then(d=>setIsAdmin(d.user.role==='ADMIN')).catch(()=>{})},[])
 // Empleado de Bar (rol BAR): sólo vende y cobra pendientes; no edita precios ni ve secciones vacías.

 return <main className="win-bar">
   <section className="win-bar-header"><div><h2>Bar / Buffet</h2><p>Venta rápida, consumos pendientes e inventario</p></div></section>
   <nav className="win-bar-tabs" aria-label="Áreas del Bar">
     {[...sections,...(isAdmin?[{id:'dashboard',label:'Control'},{id:'employees',label:'Precios empleados'}]:[])].filter(s=>!soloVenta||s.id!=='purchases').map(s=><button key={s.id} type="button" className={tab===s.id?'current':''} onClick={()=>setTab(s.id)} aria-current={tab===s.id?'page':undefined}>{s.label}</button>)}
   </nav>
   {tab==='employees'&&isAdmin&&<BarEmployeePricing/>}
   {tab==='sales'&&<QuickBar soloVenta={soloVenta} onOpenCash={()=>setTab('cash')} onOpenAccounts={()=>setTab('accounts')}/>}
   {tab==='cash'&&<BarCash/>}
   {tab==='stock'&&<StockCatalog/>}
   {tab==='purchases'&&<section className="win-bar-card"><BarInventory purchasesOnly/></section>}
   {tab==='accounts'&&<BarAccounts/>}
   {tab==='dashboard'&&isAdmin&&<BarDashboard onNavigate={setTab}/>}

 </main>
}
