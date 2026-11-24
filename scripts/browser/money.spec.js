import {test,expect} from '@playwright/test'
const product={id:'00000000-0000-4000-8000-000000000001',name:'Agua Manaos',variant:'',category:'Agua',salePrice:2000,unitCost:null,active:true,stock:92,stockKnown:true,stockMin:null}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','isolated-browser-test'))
 await page.route('**/functions/v1/win-api',async route=>{
  const request=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers})
  const body=request.postDataJSON(),{action}=body
  if(action==='bar.inventory.purchase.preview'){
   const lines=body.lines.map(l=>{const total=l.costMode==='UNIT'?l.cost*l.quantity:l.cost??body.totalCost??415.15*l.quantity;return {...l,totalCost:total,unitCost:total/l.quantity,estimated:l.cost==null&&body.totalCost==null,origin:'Costo informado'}})
   return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({total:body.totalCost??lines.reduce((s,l)=>s+l.totalCost,0),lines,estimated:false})})
  }
  const responses={me:{user:{id:'test-admin',name:'Prueba aislada',role:'ADMIN'}},'bar.inventory.access':{allowed:true},'bar.products':{products:[product],canEdit:true,stockConfigured:true},'bar.inventory.cost.snapshot':{groups:[],history:[]},'bar.inventory.snapshot':{canEdit:true,counts:[],reconciliation:[],purchases:[],movements:[],sales:null},'bar.employee.admin.list':{products:[{...product,averageCost:null,publicPrice:2000,mode:'FIXED_PRICE',value:1500.5,revision:0}],employees:[]},'bar.employee.report':{sales:[],accounts:[],enabled:false},'bar.pending':{orders:[]},'bar.customers':{customers:[]},'bar.courts':{bookings:[]},'bar.inventory.cash.state':{shift:null,cashExpected:0,bankConfigured:false,movements:[],shifts:[]}}
  const response=responses[action]
  await route.fulfill({status:response?200:409,headers,contentType:'application/json',body:JSON.stringify(response||{error:'Prueba aislada: no se guarda ninguna transacción.'})})
 })
 await page.goto('/#/bar')
 await expect(page.getByRole('button',{name:'Stock y precios',exact:true})).toBeVisible()
})
test('precio: miles, coma, error sin borrar y payload numérico',async({page})=>{
 await page.getByRole('button',{name:'Stock y precios',exact:true}).click()
 await page.getByRole('button',{name:'Editar precio / producto',exact:true}).click()
 const input=page.getByRole('textbox',{name:/^Precio de venta \(\$\)/})
 expect(await input.getAttribute('type')).toBe('text')
 for(const [raw,formatted] of [['150000','$150.000'],['1250,50','$1.250,50'],['1.500','$1.500'],['-1250,50','-$1.250,50'],['0','$0']]){
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
test('compras: formulario único, total argentino y recepción sin pago automático',async({page})=>{
 await page.getByRole('button',{name:'Compras',exact:true}).click()
 await page.getByRole('button',{name:'+ Nueva compra',exact:true}).click()
 await page.getByLabel('Proveedor',{exact:true}).fill('Proveedor de prueba')
 await page.getByLabel('Cantidad recibida',{exact:true}).fill('24')
 const input=page.getByLabel('Costo total del producto',{exact:true})
 await input.fill('36.000');await input.press('Tab');await expect(input).toHaveValue('$36.000')
 await expect(page.getByText(/Unitario: \\$1\\.500/)).toBeVisible()
 const request=page.waitForRequest(r=>r.method()==='POST'&&r.postDataJSON()?.action==='bar.inventory.purchase.save')
 await page.getByRole('button',{name:'Guardar compra',exact:true}).click()
 const p=(await request).postDataJSON()
 expect(p.lines[0].cost).toBe(36000)
 expect(p.lines[0].quantity).toBe(24)
 expect(p.state).toBe('RECEIVED')
 expect(p.payment).toBe('UNPAID')
 expect(p.confirmPayment).toBe(false)
 await expect(input).toHaveValue('$36.000')
})
test('diferencias históricas: informativas y sin formulario obligatorio',async({page})=>{
 await page.getByRole('button',{name:'Stock y precios',exact:true}).click()
 await expect(page.getByText('Historial de costos y diferencias históricas (informativo)',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Conciliar con costo real'})).toHaveCount(0)
 await page.getByText('Historial de costos y diferencias históricas (informativo)',{exact:true}).click()
 await expect(page.getByText(/No hace falta conciliarlas para operar/)).toBeVisible()
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

test('empleados: borrador desactivado con moneda compartida',async({page})=>{
 await page.getByRole('button',{name:'Precios empleados',exact:true}).click()
 await page.getByRole('button',{name:'Preparar borrador',exact:true}).click()
 const input=page.getByLabel('Precio final ($)',{exact:true})
 await expect(input).toHaveValue('$1.500,50')
 await input.fill('1250,50');await input.press('Tab');await expect(input).toHaveValue('$1.250,50')
 await page.getByLabel('Motivo del borrador',{exact:true}).fill('Prueba de formato aislada')
 const request=page.waitForRequest(r=>r.method()==='POST'&&r.postDataJSON()?.action==='bar.employee.policy.save')
 await page.getByRole('button',{name:'Guardar borrador desactivado',exact:true}).click()
 expect((await request).postDataJSON().value).toBe(1250.5)
 await expect(input).toHaveValue('$1.250,50')
})

test('costos provisionales: decimales y valor numérico conservados',async({page})=>{
 await page.getByRole('button',{name:'Stock y precios',exact:true}).click()
 await page.getByRole('button',{name:'Editar precio / producto',exact:true}).click()
 const input=page.getByRole('textbox',{name:/^Costo provisional manual/})
 await input.fill('1.500,50');await input.press('Tab');await expect(input).toHaveValue('$1.500,50')
 await page.getByLabel('Motivo obligatorio',{exact:true}).fill('Prueba de costo aislada')
 const request=page.waitForRequest(r=>r.method()==='POST'&&r.postDataJSON()?.action==='bar.inventory.cost.set')
 await page.getByRole('button',{name:'Guardar sólo costo provisional',exact:true}).click()
 expect((await request).postDataJSON().cost).toBe(1500.5)
 await expect(input).toHaveValue('$1.500,50')
})
