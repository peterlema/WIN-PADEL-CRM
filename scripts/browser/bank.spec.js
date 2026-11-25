import {test,expect} from '@playwright/test'
const prod={id:'00000000-0000-4000-8000-000000000001',name:'Agua Manaos',variant:'',category:'Agua',salePrice:2000,unitCost:415.15,active:true,stockKnown:true,stock:91}
async function setup(page,role='ADMIN'){
 const state={bank:null,requests:[]}
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','bank-test'))
 await page.route('**/functions/v1/win-api',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  const reply=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)})
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers})
  const p=req.postDataJSON();state.requests.push(p)
  if(p.action==='bar.inventory.bank.save'){
   state.bank={bank_name:p.bankName,account_holder:p.accountHolder,bank_alias:p.alias,cbu_cvu:p.cbuCvu,confirmed_at:'2026-11-25T02:03:00Z',updated_at:'2026-11-25T02:03:00Z'}
   return reply({ok:true,bankConfigured:true})
  }
  const totals={transfersReceived:1500.5,transfersPaid:0,cardsReceived:0}
  const shift={id:'shift',status:'OPEN',opening_cash:19200,opened_at:'2026-11-25T02:03:00Z',responsible:'Pedro',totals}
  const response={me:{user:{id:'bank-admin',role,name:'Prueba'}},'bar.inventory.access':{allowed:true},'bar.products':{products:[prod],canEdit:role==='ADMIN'},'bar.customers':{customers:[]},'bar.pending':{orders:[]},'bar.courts':{bookings:[]},
   'bar.inventory.cash.state':{shift,shifts:[shift],cashExpected:25200,bankConfigured:!!state.bank,bankConfig:state.bank,bankHistory:[],totals,
   movements:[{id:'m1',payment_method:'TRANSFER',amount_signed:1500.5,occurred_at:'2026-11-25T02:03:00Z',responsible:'Pedro',kind:'SALE',order_id:'pedido-1',bank_account_snapshot:'Cuenta anterior'}]}}
  return response[p.action]?reply(response[p.action]):reply({error:'Operación fuera de prueba aislada'},409)
 })
 await page.goto('/#/bar');await expect(page.getByText('Caja abierta',{exact:true})).toBeVisible()
 return state
}
test('Admin configura banco, titular y alias; habilita transferencia sin mover dinero',async({page})=>{
 const s=await setup(page)
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 await page.getByRole('button',{name:'Configurar cuenta para transferencias',exact:true}).click()
 await page.getByLabel('Banco o billetera',{exact:true}).fill('Banco de prueba')
 await page.getByLabel('Titular de la cuenta',{exact:true}).fill('Titular de prueba')
 await page.getByLabel('Alias del Bar',{exact:true}).fill('bar.prueba')
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Guardar y habilitar transferencias',exact:true}).click()
 await expect(page.getByText('Configurada y confirmada',{exact:true})).toBeVisible()
 const p=s.requests.find(p=>p.action==='bar.inventory.bank.save')
 expect(p.bankName).toBe('Banco de prueba');expect(p.accountHolder).toBe('Titular de prueba');expect(p.alias).toBe('bar.prueba');expect(p.confirmExclusive).toBe(true)
 expect(s.requests.filter(p=>/order.place|order.pay|cash.entry/.test(p.action))).toHaveLength(0)
 await page.getByRole('button',{name:'Ventas rápidas',exact:true}).click()
 await expect(page.getByRole('button',{name:'Transferencia',exact:true})).toBeEnabled()
})
test('empleado: efectivo disponible sin banco, transferencia pendiente y sin edición',async({page})=>{
 await setup(page,'BAR')
 await expect(page.getByRole('button',{name:'Efectivo',exact:true})).toBeEnabled()
 await expect(page.getByRole('button',{name:'Transferencia',exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'Configurar cuenta para transferencias',exact:true})).toHaveCount(0)
 await expect(page.getByText('Administración debe configurar la cuenta para transferencias.',{exact:true})).toBeVisible()
})
test('Caja Bar presenta fecha argentina, responsable y transferencia separada del efectivo',async({page})=>{
 await setup(page)
 await page.getByRole('button',{name:'Caja Bar',exact:true}).click()
 await expect(page.getByText('25.200',{exact:false}).first()).toBeVisible()
 await expect(page.getByRole('cell',{name:'24/11/2026 23:03',exact:true}).first()).toBeVisible()
 await expect(page.getByRole('cell',{name:'$1.500,50',exact:true}).first()).toBeVisible()
 await expect(page.getByRole('columnheader',{name:/Cuenta bancaria del Bar/i})).toBeVisible()
 await expect(page.getByRole('columnheader',{name:/Transferencias recibidas/i})).toBeVisible()
})
