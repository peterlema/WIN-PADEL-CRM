import {test,expect} from '@playwright/test'
const prod={id:'00000000-0000-4000-8000-000000000001',name:'Agua Manaos',variant:'',category:'Agua',salePrice:2000,unitCost:415.15,active:true,stockKnown:true,stock:91}
async function setup(page,role='ADMIN',{lostBank=false}={}){
 const state={bank:null,requests:[],records:new Map()}
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','bank-test'))
 await page.route('**/functions/v1/win-api',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  const reply=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)})
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers})
  const p=req.postDataJSON();state.requests.push(p)
  if(p.action==='bar.inventory.bank.save'){
   state.bank={bank_name:p.bankName,account_holder:p.accountHolder,bank_alias:p.alias,cbu_cvu:p.cbuCvu,confirmed_at:'2026-11-25T02:03:00Z',updated_at:'2026-11-25T02:03:00Z'}
   const result={ok:true,bankConfigured:true};state.records.set(p.requestId,result)
   if(lostBank)return route.abort('failed')
   return reply(result)
  }
  if(p.action==='bar.request.status')return reply(state.records.has(p.requestId)?{state:'FOUND',result:state.records.get(p.requestId)}:{state:'NOT_FOUND'})
  const totals={openingCash:19200,cashSales:6000,transferSales:1500.5,cardSales:0,supplierPayments:0,expenses:0,withdrawals:0,cashOut:0,cashExpected:25200}
  const shift={id:'shift',status:'OPEN',opening_cash:19200,opened_at:'2026-11-25T02:03:00Z',responsible:'Pedro',totals}
  const response={me:{user:{id:'bank-admin',role,name:'Prueba'}},'bar.inventory.access':{allowed:true},'bar.products':{products:[prod],canEdit:role==='ADMIN'},'bar.customers':{customers:[]},'bar.pending':{orders:[]},'bar.courts':{bookings:[]},
   'bar.inventory.cash.state':{shift,shifts:[shift],cashExpected:25200,transfersEnabled:true,canManage:role==='ADMIN',currentUserId:'bank-admin',bankConfigured:!!state.bank,bankConfig:state.bank,bankHistory:[],totals,
   movements:[{id:'m1',payment_method:'TRANSFER',amount_signed:1500.5,occurred_at:'2026-11-25T02:03:00Z',responsible:'Pedro',kind:'SALE',order_id:'pedido-1',bank_account_snapshot:'Cuenta anterior'}]}}
  return response[p.action]?reply(response[p.action]):reply({error:'Operación fuera de prueba aislada'},409)
 })
 await page.goto('/#/bar');await expect(page.getByText('Caja abierta',{exact:true})).toBeVisible()
 return state
}
export function transferCases(){
test('transferencia habilitada sin datos bancarios y efectivo disponible',async({page})=>{
 await setup(page,'BAR')
 await expect(page.getByRole('button',{name:'Efectivo',exact:true})).toBeEnabled()
 await expect(page.getByRole('button',{name:'Transferencia',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'Transferencia',exact:true}).click()
 await expect(page.getByText(/compartí la foto del comprobante en el grupo/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Configurar cuenta para transferencias',exact:true})).toHaveCount(0)
 await expect(page.getByText('Pendiente de confirmar',{exact:true})).toHaveCount(0)
})
test('Caja Bar no exige cuenta bancaria y conserva fechas, importes y totales',async({page})=>{
 await setup(page)
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 await expect(page.getByText(/Transferencias habilitadas sin configurar/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Configurar cuenta para transferencias',exact:true})).toBeVisible()
 await expect(page.getByRole('cell',{name:'24/11/2026 23:03',exact:true}).first()).toBeVisible()
 await expect(page.getByRole('cell',{name:'$1.500,50',exact:true}).first()).toBeVisible()
})


test('Administración confirma banco y actualiza alias a CVU; fecha argentina y una solicitud por cambio',async({page})=>{
 const s=await setup(page)
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 await page.getByRole('button',{name:'Configurar cuenta para transferencias',exact:true}).click()
 await page.getByLabel('Banco o billetera',{exact:true}).fill('Banco de prueba')
 await page.getByLabel('Titular de la cuenta',{exact:true}).fill('Titular de prueba')
 await page.getByLabel('Alias del Bar',{exact:true}).fill('bar.prueba')
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Guardar y confirmar cuenta',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Cuenta exclusiva del Bar',exact:true})).toHaveCount(0)
 await expect(page.getByText('Configurada y confirmada',{exact:true})).toBeVisible()
 expect(s.requests.filter(p=>p.action==='bar.inventory.bank.save')).toHaveLength(1)
 const first=s.requests.find(p=>p.action==='bar.inventory.bank.save')
 expect(first.expectedUpdatedAt).toBeNull();expect(first.confirmExclusive).toBe(true)
 await page.getByRole('button',{name:'Actualizar cuenta para transferencias',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Cuenta exclusiva del Bar',exact:true})).toBeVisible()
 await page.getByLabel('Tipo de destino',{exact:true}).selectOption('CBU')
 await page.getByLabel('CBU / CVU del Bar',{exact:true}).fill('1234567890123456789012')
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Guardar y confirmar cuenta',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Cuenta exclusiva del Bar',exact:true})).toHaveCount(0)
 expect(s.requests.filter(p=>p.action==='bar.inventory.bank.save')).toHaveLength(2)
 const updated=s.requests.filter(p=>p.action==='bar.inventory.bank.save')[1]
 expect(updated.alias).toBeNull();expect(updated.cbuCvu).toBe('1234567890123456789012')
 expect(updated.expectedUpdatedAt).toBe('2026-11-25T02:03:00Z')
})
test('confirmación bancaria con respuesta perdida consulta el mismo requestId sin reenviar',async({page})=>{
 const s=await setup(page,'ADMIN',{lostBank:true})
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 await page.getByRole('button',{name:'Configurar cuenta para transferencias',exact:true}).click()
 await page.getByLabel('Banco o billetera',{exact:true}).fill('Banco de prueba')
 await page.getByLabel('Titular de la cuenta',{exact:true}).fill('Titular de prueba')
 await page.getByLabel('Alias del Bar',{exact:true}).fill('bar.prueba')
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Guardar y confirmar cuenta',exact:true}).click()
 await expect(page.getByText('Configurada y confirmada',{exact:true})).toBeVisible()
 expect(s.requests.filter(p=>p.action==='bar.inventory.bank.save')).toHaveLength(1)
 expect(s.requests.find(p=>p.action==='bar.request.status').requestId).toBe(s.requests.find(p=>p.action==='bar.inventory.bank.save').requestId)
})

}
