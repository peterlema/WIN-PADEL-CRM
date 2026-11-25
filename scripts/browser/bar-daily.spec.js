import {test,expect} from '@playwright/test'
const product={id:'00000000-0000-4000-8000-000000000001',name:'Agua Manaos',variant:'',category:'Agua',salePrice:2000,unitCost:415.15,active:true,stock:91,stockKnown:true,stockMin:10}
const summary={sales:2000,collected:2000,pending:0,purchases:0,supplierPayments:0,expenses:0,cogs:415.15,grossMargin:1584.85,estimatedCostUnits:1,unknownCostUnits:0,cash:2000,transfer:0,card:0,withdrawals:0,topProducts:[{product_id:product.id,name:product.name,units:1,sales:2000}]}
async function install(page,{lostOut=false}={}){
 const s={requests:[],bank:null,records:new Map(),paid:0}
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','isolated-bar-daily'))
 page.on('dialog',d=>d.accept())
 await page.route('**/functions/v1/win-api',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  const reply=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)})
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers})
  const p=req.postDataJSON(),a=p.action;s.requests.push(p)
  if(a==='bar.inventory.cash.out'){
   if(!s.records.has(p.requestId))s.records.set(p.requestId,{ok:true,id:'out'})
   if(lostOut)return route.abort('failed')
   return reply(s.records.get(p.requestId))
  }
  if(a==='bar.request.status')return reply(s.records.has(p.requestId)?{state:'FOUND',result:s.records.get(p.requestId)}:{state:'NOT_FOUND'})
  if(a==='bar.order.place')return reply({id:'isolated-order',total:2000,status:'PAID'})
  if(a==='bar.order.pay'){s.paid+=p.amount;return reply({orderId:p.orderId,remaining:2000-s.paid})}
  const order={id:'debt',customerName:'Cliente de prueba',audience:'CLIENT',court:'C4',courtStart:'20:00',courtDate:'2026-11-24',date:'2026-11-24T18:13:05.216889+00:00',ageDays:2,total:2000,paid:s.paid,balance:2000-s.paid,items:[{name:'Agua Manaos',quantity:1,price:2000,amount:2000}],payments:[]}
  const responses={me:{user:{id:'daily-admin',name:'Prueba aislada',role:'ADMIN'}},'bar.inventory.access':{allowed:true},'bar.products':{products:[product],canEdit:true},'bar.pending':{orders:[]},'bar.customers':{customers:[]},'bar.courts':{bookings:[]},
   'bar.inventory.cash.state':{shift:{id:'shift',status:'OPEN',opened_at:'2026-11-24T18:13:05.216889+00:00',responsible:'Empleado de prueba',opened_by:'daily-admin'},canManage:true,currentUserId:'daily-admin',bank:s.bank,bankConfigured:!!s.bank,bankAccount:s.bank?'Banco de prueba · Titular de prueba · bar.prueba':null,bankHistory:[],totals:{openingCash:1000,cashSales:2000,transferSales:3500,cardSales:4000,supplierPayments:500,expenses:100,withdrawals:200,cashOut:800,cashExpected:2200},movements:[],shifts:[]},
   'bar.inventory.accounts':{orders:s.paid<2000||p.status==='PAID'?[order]:[],total:s.paid<2000||p.status==='PAID'?1:0,pending:2000-s.paid,limit:50,offset:0},
   'bar.inventory.dashboard':{start:'2026-11-24',end:'2026-11-24',previousStart:'2026-11-23',previousEnd:'2026-11-23',current:summary,previous:{...summary,sales:0,collected:0},products:[product]}}
  return reply(responses[a]||{error:'Acción fuera de la prueba aislada'},responses[a]?200:409)
 })
 await page.goto('/#/bar')
 await expect(page.getByText('Caja abierta',{exact:true})).toBeVisible()
 return s
}
test('venta inmediata sin cancha ni horario; total y cobro accesibles en 13 pulgadas',async({page})=>{
 const s=await install(page)
 await page.getByRole('button',{name:/^Agua Manaos/}).click()
 const charge=page.getByRole('button',{name:'Cobrar $2.000',exact:true})
 await expect(charge).toBeEnabled()
 await expect(page.getByRole('button',{name:'Transferencia',exact:true})).toBeEnabled()
 await expect(page.getByLabel('Inicio del turno')).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 await charge.scrollIntoViewIfNeeded();await expect(charge).toBeInViewport()
 await charge.click()
 await expect(page.getByText('Venta confirmada: $2.000',{exact:true})).toBeVisible()
 const p=s.requests.find(p=>p.action==='bar.order.place')
 expect(p.clientUnknown).toBe(true);expect(p.court).toBeNull();expect(p.courtStart).toBeNull()
 expect(s.requests.filter(p=>p.action==='bar.order.place')).toHaveLength(1)
})
test('transferencia sin banco conserva comprobante externo; egreso recupera respuesta perdida',async({page})=>{
 const s=await install(page,{lostOut:true})
 await page.getByRole('button',{name:'Transferencia',exact:true}).click()
 await expect(page.getByText(/compartí la foto del comprobante en el grupo/)).toBeVisible()
 await page.getByRole('button',{name:/^Agua Manaos/}).click()
 await page.getByRole('button',{name:'Cobrar $2.000',exact:true}).click()
 await expect(page.getByText('Venta confirmada: $2.000',{exact:true})).toBeVisible()
 expect(s.requests.find(p=>p.action==='bar.order.place').method).toBe('TRANSFER')
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 await expect(page.getByText('Abierta por Empleado de prueba · 24/11/2026 15:13',{exact:true})).toBeVisible()
 await expect(page.getByText(/Transferencias habilitadas sin configurar/)).toBeVisible()
 await page.getByRole('button',{name:'Registrar gasto / retiro',exact:true}).click()
 await page.getByLabel('Importe realmente pagado / retirado ($)',{exact:true}).fill('100')
 await page.getByLabel('Concepto / comprobante',{exact:true}).fill('Prueba aislada')
 await page.getByRole('button',{name:'Registrar egreso real',exact:true}).click()
 await expect(page.getByText('Operación confirmada. No se duplicó el movimiento.',{exact:true})).toBeVisible()
 expect(s.requests.filter(p=>p.action==='bar.inventory.cash.out')).toHaveLength(1)
 const q=s.requests.find(p=>p.action==='bar.request.status')
 expect(q.kind).toBe('INVENTORY');expect(q.payload.action).toBe('bar.inventory.cash.out')
 expect(q.requestId).toBe(s.requests.find(p=>p.action==='bar.inventory.cash.out').requestId)
})
test('cuentas: consulta, cobro parcial y final sin nueva venta',async({page})=>{
 const s=await install(page)
 await page.getByRole('button',{name:'Cuentas corrientes',exact:true}).click()
 await expect(page.getByText('Cliente de prueba',{exact:true})).toBeVisible()
 await expect(page.getByText('2 días pendiente',{exact:true})).toBeVisible()
 for(const amount of ['500','1.500']){
  await page.getByRole('button',{name:'Cobrar',exact:true}).click()
  await page.getByLabel('Importe a cobrar ($)',{exact:true}).fill(amount)
  await page.getByRole('button',{name:/^Confirmar cobro \$/}).click()
  await expect(page.getByRole('heading',{name:'Cobrar cuenta pendiente',exact:true})).toHaveCount(0)
 }
 await expect(page.getByText('Sin consumos para estos filtros.',{exact:true})).toBeVisible()
 expect(s.paid).toBe(2000);expect(s.requests.filter(p=>p.action==='bar.order.pay')).toHaveLength(2)
 expect(s.requests.filter(p=>p.action==='bar.order.place')).toHaveLength(0)
 await page.getByLabel('Estado',{exact:true}).selectOption('PAID')
 await expect(page.getByText('Cliente de prueba',{exact:true})).toBeVisible()
})
test('arqueo separa medios y muestra diferencia; control identifica margen estimado',async({page})=>{
 await install(page)
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 await expect(page.locator('dl').filter({hasText:'Efectivo esperado'})).toContainText('$2.200')
 await expect(page.locator('dl')).toContainText('$3.500');await expect(page.locator('dl')).toContainText('$4.000')
 await page.getByRole('button',{name:'Cerrar y arquear',exact:true}).click()
 await page.getByLabel('Efectivo contado ($)',{exact:true}).fill('2.200')
 await page.getByLabel('Efectivo contado ($)',{exact:true}).press('Tab')
 await expect(page.getByText('Diferencia de caja:',{exact:false})).toContainText('$0')
 await page.getByRole('button',{name:'Cancelar',exact:true}).click()
 await page.getByRole('button',{name:'Control',exact:true}).click()
 await expect(page.getByText('Margen bruto estimado',{exact:true})).toBeVisible()
 await expect(page.getByText('Productos más vendidos',{exact:true})).toBeVisible()
 await expect(page.getByText(/El margen bruto no es utilidad neta/)).toBeVisible()
})
