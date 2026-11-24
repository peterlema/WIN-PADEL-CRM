import {test,expect} from '@playwright/test'
const product={id:'00000000-0000-4000-8000-000000000001',name:'Agua Manaos',variant:'',category:'Agua',salePrice:2000,unitCost:415.15,provisionalInitialCost:415.15,costEstimated:true,active:true,stock:91,stockKnown:true}
async function install(page,mode){
 const state={attempts:[],queries:[],orders:new Map(),payments:new Map(),delivered:0,collected:0,pending:[]}
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','isolated-checkout-test'))
 page.on('dialog',d=>d.accept())
 await page.route('**/functions/v1/win-api',async route=>{
  const request=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  const reply=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)})
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers})
  const p=request.postDataJSON(),a=p.action
  if(a==='bar.order.place'){
   state.attempts.push(p)
   if(mode==='reject')return reply({error:'Error interno del Bar. La operación fue rechazada y no se registró ningún cobro ni salida de stock.',outcome:'REJECTED',category:'SERVER',code:'BAR_PRICE_IMMUTABLE'},500)
   if(mode==='before'&&state.attempts.length===1)return route.abort('failed')
   if(!state.orders.has(p.requestId)){state.orders.set(p.requestId,{id:'order-'+state.orders.size,total:2000,status:p.destination==='IMMEDIATE'?'PAID':'OPEN'});state.delivered++;if(p.destination==='IMMEDIATE')state.collected+=2000}
   const r=state.orders.get(p.requestId)
   if(mode==='after'&&state.attempts.length===1)return route.abort('failed')
   return reply(r)
  }
  if(a==='bar.request.status'){
   state.queries.push(p)
   const r=p.kind==='PLACE'?state.orders.get(p.requestId):state.payments.get(p.requestId)
   return reply(r?{state:'FOUND',result:r}:{state:'NOT_FOUND'})
  }
  const responses={me:{user:{id:'checkout-admin',name:'Prueba aislada',role:'ADMIN'}},'bar.inventory.access':{allowed:true},'bar.products':{products:[{...product,stock:product.stock-state.delivered}],canEdit:true},'bar.customers':{customers:[]},'bar.pending':{orders:[]},'bar.courts':{bookings:[]},'bar.inventory.cash.state':{shift:{id:'bar-shift',status:'OPEN'},cashExpected:19200+state.collected,bankConfigured:true,movements:[],shifts:[]}}
  if(responses[a])return reply(responses[a])
  return reply({error:'Acción no permitida en prueba aislada'},409)
 })
 await page.goto('/#/bar')
 await expect(page.getByText('Caja abierta',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:/^Agua Manaos/}).click()
 await page.getByRole('button',{name:'No conozco cliente',exact:true}).click()
 return state
}
test('rechazo del servidor no se presenta como resultado incierto',async({page})=>{
 const s=await install(page,'reject')
 await page.getByRole('button',{name:'Cobrar $2.000',exact:true}).click()
 await expect(page.getByText(/Error interno del Bar/).first()).toBeVisible()
 await expect(page.getByRole('button',{name:'Consultar resultado',exact:true})).toHaveCount(0)
 expect(s.delivered).toBe(0);expect(s.collected).toBe(0);expect(s.queries).toHaveLength(0)
 await expect(page.getByRole('button',{name:'Cobrar $2.000',exact:true})).toBeEnabled()
})
test('respuesta perdida después de commit se recupera sin reenviar venta',async({page})=>{
 const s=await install(page,'after')
 await page.getByRole('button',{name:'Cobrar $2.000',exact:true}).click()
 await expect(page.getByText('Venta confirmada: $2.000',{exact:true})).toBeVisible()
 expect(s.attempts).toHaveLength(1);expect(s.queries).toHaveLength(1)
 expect(s.queries[0].requestId).toBe(s.attempts[0].requestId)
 expect(s.delivered).toBe(1);expect(s.collected).toBe(2000)
 expect(await page.evaluate(()=>sessionStorage.getItem('win_bar_transaction:checkout-admin'))).toBeNull()
})
test('recargar conserva requestId y reintenta sólo después de consultar ausencia',async({page})=>{
 const s=await install(page,'before')
 await page.getByRole('button',{name:'Cobrar $2.000',exact:true}).click()
 await expect(page.getByRole('button',{name:'Reintentar misma operación',exact:true})).toBeVisible()
 const original=s.attempts[0]
 await page.reload()
 await expect(page.getByRole('button',{name:'Reintentar misma operación',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Reintentar misma operación',exact:true}).click()
 await expect(page.getByText('Venta confirmada: $2.000',{exact:true})).toBeVisible()
 expect(s.attempts).toHaveLength(2);expect(s.attempts[1]).toEqual(original)
 expect(s.queries.every(q=>q.requestId===original.requestId)).toBe(true)
 expect(s.delivered).toBe(1);expect(s.collected).toBe(2000)
})
