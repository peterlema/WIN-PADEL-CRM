import {test,expect} from '@playwright/test'
const product={id:'00000000-0000-4000-8000-000000000001',name:'Agua Manaos',variant:'',category:'Agua',salePrice:2000,unitCost:415.15,active:true,stockKnown:true,stock:91,stockMin:10,grossMarginUnit:1584.85,grossMarginPercent:79.24,inventoryValue:37778.65}
const account={id:'account',customerId:'person',holder:'Socio de prueba',type:'PARTNER',active:true,balance:1000}
const config={discountPercent:50,minMarkupPercent:10,rounding:'UP',roundingStep:500,exceptions:{},notes:''}
async function setup(page,role='ADMIN',{lostPay=false,quoteBlocked=false}={}){
 const s={requests:[],records:new Map(),paid:0,revision:1}
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','private-isolated'))
 await page.route('**/functions/v1/win-api',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  const reply=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)})
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers})
  const p=req.postDataJSON(),a=p.action;s.requests.push(p)
  const line={productId:product.id,name:product.name,valid:!quoteBlocked,unitCost:415.15,publicPrice:2000,price:quoteBlocked?null:1000,effectiveDiscount:50,grossMargin:584.85,marginPercent:58.49,quantity:1,error:quoteBlocked?'Falta el costo':null}
  if(a==='bar.inventory.private.save'){s.revision++;return reply({ok:true,id:'account',customerId:'person'})}
  if(a==='bar.inventory.private.pay'){
   if(!s.records.has(p.requestId)){s.paid+=p.amount;s.records.set(p.requestId,{ok:true,id:p.requestId,remaining:1000-s.paid})}
   if(lostPay)return route.abort('failed')
   return reply(s.records.get(p.requestId))
  }
  if(a==='bar.request.status')return reply(s.records.has(p.requestId)?{state:'FOUND',result:s.records.get(p.requestId)}:{state:'NOT_FOUND'})
  if(a==='bar.order.place')return reply({id:'order',total:p.destination==='ACCOUNT'?1000:2000})
  const responses={me:{user:{id:'admin',role,name:'Prueba'}},'bar.inventory.access':{allowed:true},'bar.products':{products:[product],canEdit:role==='ADMIN'},'bar.customers':{customers:[{id:'person',name:account.holder}]},'bar.pending':{orders:[]},'bar.courts':{bookings:[]},
   'bar.inventory.cash.state':{shift:{id:'shift',status:'OPEN',opening_cash:0,opened_by:'admin'},canManage:role==='ADMIN',transfersEnabled:true,totals:{cashExpected:0},movements:[],shifts:[]},
   'bar.inventory.private.list':{accounts:[{...account,balance:1000-s.paid}],canManage:role==='ADMIN'},
   'bar.inventory.private.configuration':{account:{id:'account',customer_id:'person',holder:account.holder,account_type:'PARTNER',active:true,revision:s.revision,configuration:config}},
   'bar.inventory.private.candidates':{customers:[]},'bar.inventory.private.preview':{lines:[line]},
   'bar.inventory.private.quote':{valid:!quoteBlocked,holder:account.holder,total:quoteBlocked?null:1000,fingerprint:'quote-1',lines:[line]},
   'bar.inventory.private.statement':{holder:account.holder,balance:1000-s.paid,openingBalance:0,closingBalance:1000-s.paid,truncated:false,rows:[{id:'line',date:'2026-11-25T18:30:00Z',product:'Agua Manaos',kind:'CONSUMPTION',quantity:1,unitPrice:1000,debit:1000,credit:0,balance:1000,orderId:'order'}]},
   'bar.inventory.accounts':{orders:[],total:0,pending:0,limit:50,offset:0},'bar.inventory.snapshot':{canEdit:false,counts:[],purchases:[],movements:[]}}
  return responses[a]?reply(responses[a]):reply({error:'Fuera de prueba aislada'},409)
 })
 await page.goto('/#/bar');await expect(page.getByText('Caja abierta',{exact:true})).toBeVisible()
 return s
}
test('productos: tabla compacta sin precio socio y diez columnas administrativas',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Stock y precios',exact:true}).click()
 const table=page.locator('.bar-stock-sheet table');await expect(table).toBeVisible()
 if(await table.getByRole('columnheader').count()!==10)console.log('STOCK_TABLE_DIAGNOSTIC',await table.ariaSnapshot(),await table.innerHTML())
 await expect(table.getByRole('columnheader')).toHaveCount(10)
 await expect(table.getByRole('columnheader',{name:'Precio socio',exact:true})).toHaveCount(0)
 await expect(table.getByRole('columnheader',{name:'Ganancia bruta unitaria',exact:true})).toBeVisible()
})
test('operador: sólo titular autorizado, precio automático y ninguna alta desde venta',async({page})=>{
 const s=await setup(page,'BAR')
 await page.getByRole('button',{name:'Cuenta corriente',exact:true}).click()
 await expect(page.getByRole('button',{name:'+ Nueva persona',exact:true})).toHaveCount(0)
 await page.getByRole('combobox',{name:'Cuenta corriente autorizada',exact:true}).selectOption('person')
 await page.getByRole('button',{name:/^Agua Manaos/}).click()
 const charge=page.getByRole('button',{name:'Guardar pendiente $1.000',exact:true})
 await expect(charge).toBeEnabled();await charge.click()
 await expect(page.getByText('Venta confirmada: $1.000',{exact:true})).toBeVisible()
 const p=s.requests.find(p=>p.action==='bar.order.place');expect(p.quoteFingerprint).toBe('quote-1');expect(p.customerId).toBe('person')
 await page.getByRole('button',{name:'Cuentas corrientes',exact:true}).click()
 await page.getByRole('button',{name:'Ver cuenta Socio de prueba',exact:true}).click()
 await expect(page.getByRole('button',{name:'Configuración',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Crear cuenta privada',exact:true})).toHaveCount(0)
})
test('costo pendiente bloquea consumo a cuenta y solicita revisión',async({page})=>{
 const s=await setup(page,'BAR',{quoteBlocked:true})
 await page.getByRole('button',{name:'Cuenta corriente',exact:true}).click()
 await page.getByRole('combobox',{name:'Cuenta corriente autorizada',exact:true}).selectOption('person')
 await page.getByRole('button',{name:/^Agua Manaos/}).click()
 await expect(page.getByText(/Falta el costo/)).toBeVisible()
 await expect(page.getByRole('button',{name:/^Guardar pendiente/})).toBeDisabled()
 expect(s.requests.filter(p=>p.action==='bar.order.place')).toHaveLength(0)
})
test('Administración: condiciones individuales y previsualización sólo dentro del titular',async({page})=>{
 const s=await setup(page)
 await page.getByRole('button',{name:'Cuentas corrientes',exact:true}).click()
 await page.getByRole('button',{name:'Ver cuenta Socio de prueba',exact:true}).click()
 await page.getByRole('button',{name:'Configuración',exact:true}).click()
 await expect(page.getByLabel('Descuento sobre precio público (%)',{exact:true})).toHaveValue('50')
 await page.getByLabel('Descuento sobre precio público (%)',{exact:true}).fill('30')
 await expect(page.getByText('Previsualización de precios especiales · sólo Administración',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Guardar condiciones de esta cuenta',exact:true}).click()
 await expect.poll(()=>s.requests.filter(p=>p.action==='bar.inventory.private.save').length).toBe(1)
 const p=s.requests.find(p=>p.action==='bar.inventory.private.save')
 expect(p.configuration.discountPercent).toBe(30);expect(p.configuration.minMarkupPercent).toBe(10);expect(p.configuration.roundingStep).toBe(500)
 expect(p.expectedRevision).toBe(1)
})
test('movimientos: Excel real y cobro recuperado sin nueva venta ni doble pago',async({page})=>{
 const s=await setup(page,'BAR',{lostPay:true})
 await page.getByRole('button',{name:'Cuentas corrientes',exact:true}).click()
 await page.getByRole('button',{name:'Ver cuenta Socio de prueba',exact:true}).click()
 const download=page.waitForEvent('download')
 await page.getByRole('button',{name:'Exportar a Excel',exact:true}).click()
 const file=await download;expect(file.suggestedFilename()).toMatch(/\.xlsx$/)
 await page.getByRole('button',{name:'Cobrar cuenta',exact:true}).click()
 await page.getByLabel('Importe recibido ($)',{exact:true}).fill('500')
 await page.getByRole('button',{name:'Confirmar cobro de cuenta',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Cobrar cuenta privada',exact:true})).toHaveCount(0)
 expect(s.paid).toBe(500)
 const sends=s.requests.filter(p=>p.action==='bar.inventory.private.pay');expect(sends).toHaveLength(1)
 expect(s.requests.find(p=>p.action==='bar.request.status').requestId).toBe(sends[0].requestId)
 expect(s.requests.filter(p=>p.action==='bar.order.place')).toHaveLength(0)
})
