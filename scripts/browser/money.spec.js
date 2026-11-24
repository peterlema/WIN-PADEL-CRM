import {test,expect} from '@playwright/test'
const product={id:'00000000-0000-4000-8000-000000000001',name:'Agua Manaos',variant:'',category:'Agua',salePrice:2000,unitCost:null,active:true,stock:92,stockKnown:true,stockMin:null}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','isolated-browser-test'))
 await page.route('**/functions/v1/win-api',async route=>{
  const request=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers})
  const {action}=request.postDataJSON()
  const responses={me:{user:{id:'test-admin',name:'Prueba aislada',role:'ADMIN'}},'bar.inventory.access':{allowed:true},'bar.products':{products:[product],canEdit:true,stockConfigured:true},'bar.inventory.snapshot':{canEdit:true,counts:[],reconciliation:[],purchases:[],movements:[],sales:null},'bar.pending':{orders:[]},'bar.customers':{customers:[]},'bar.courts':{bookings:[]},'bar.inventory.cash.state':{shift:null,cashExpected:0,bankConfigured:false,movements:[],shifts:[]}}
  const response=responses[action]
  await route.fulfill({status:response?200:409,headers,contentType:'application/json',body:JSON.stringify(response||{error:'Prueba aislada: no se guarda ninguna transacción.'})})
 })
 await page.goto('/#/bar')
 await expect(page.getByRole('button',{name:'Stock y precios',exact:true})).toBeVisible()
})
test('precio: miles, coma, error sin borrar y payload numérico',async({page})=>{
 await page.getByRole('button',{name:'Stock y precios',exact:true}).click()
 await page.getByRole('button',{name:'Editar precio / producto',exact:true}).click()
 const input=page.getByLabel('Precio de venta ($)',{exact:true})
 expect(await input.getAttribute('type')).toBe('text')
 for(const [raw,formatted] of [['150000','$150.000'],['1250,50','$1.250,50'],['1.500','$1.500'],['0','$0']]){
  await input.fill(raw);await input.press('Tab');await expect(input).toHaveValue(formatted)
 }
 await input.fill('1.50');await input.press('Tab');await expect(input).toHaveValue('1.50')
 await expect(page.getByText(/El contenido se conserva para corregirlo/)).toBeVisible()
 await input.fill('1250,50');await input.press('Tab')
 const request=page.waitForRequest(r=>r.method()==='POST'&&r.postDataJSON()?.action==='bar.product.save')
 await page.getByRole('button',{name:'Guardar producto',exact:true}).click()
 expect((await request).postDataJSON().salePrice).toBe(1250.5)
 await expect(page.getByText('Prueba aislada: no se guarda ninguna transacción.')).toBeVisible()
 await expect(input).toHaveValue('$1.250,50')
})
test('compras: el costo total conserva centavos y no escala valores',async({page})=>{
 await page.getByRole('button',{name:'Compras',exact:true}).click()
 await page.getByRole('button',{name:'+ Nueva compra',exact:true}).click()
 await page.getByLabel('Proveedor confirmado',{exact:true}).fill('Proveedor de prueba')
 const input=page.getByLabel('Costo total de esta línea ($)',{exact:true})
 await input.fill('1.500,50');await input.press('Tab');await expect(input).toHaveValue('$1.500,50')
 const request=page.waitForRequest(r=>r.method()==='POST'&&r.postDataJSON()?.action==='bar.inventory.purchase.create')
 await page.getByRole('button',{name:'Guardar',exact:true}).click()
 expect((await request).postDataJSON().lines[0].totalCost).toBe(1500.5)
 await expect(input).toHaveValue('$1.500,50')
})
test('Caja Bar: entero grande y decimales se envían como números',async({page})=>{
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 const input=page.getByLabel('Efectivo real para apertura ($)',{exact:true})
 await input.fill('150000');await input.press('Tab');await expect(input).toHaveValue('$150.000')
 const request=page.waitForRequest(r=>r.method()==='POST'&&r.postDataJSON()?.action==='bar.inventory.cash.open')
 await page.getByRole('button',{name:'Abrir Caja Bar',exact:true}).click()
 expect((await request).postDataJSON().openingCash).toBe(150000)
 await expect(input).toHaveValue('$150.000')
})
