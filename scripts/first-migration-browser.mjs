// Local/CI UI tests use intercepted requests only. Never create production data.
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const {chromium,webkit}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright')
const browserType=process.env.WIN_TEST_BROWSER==='webkit'?webkit:chromium
const browser=await browserType.launch(browserType===chromium?{channel:'chrome'}:{})
const page=await browser.newPage({viewport:{width:1280,height:800}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const requests=[]
await page.addInitScript(()=>sessionStorage.setItem('win_session_token','isolated-migration-test'))
const intake=(kind,id,data,status='REVIEW')=>({id,kind,data,status,revision:1,reasons:['Requiere confirmación'],sheet:'Origen',cell:'A'+id,source_file:'fixture.xlsx'})
const clients=[intake('CLIENT','review-client',{name:'Identificación incompleta',phone:null,raw:{A1:'Identificación incompleta'}})]
const pending=intake('ABONO','review-abono',{name:'Horario especial pendiente',phone:'5491155550102',weekday:1,start:'08:30',duration:null,court:'C1',raw:{A5:'08:30hs',B5:'Horario especial pendiente'}})
const wait=intake('WAITLIST','review-wait',{name:'',phone:null,days:'Martes o jueves',times:['19:00'],raw:{E41:'Martes o jueves',F41:'19:00hs'}})
wait.waitlist_id='w1'
const series=[{id:'s1',customer_name:'Cliente verificado',customer_whatsapp:'5491155550101',court:'C2',weekday:1,start_time:'18:30:00',duration_min:90,nextDate:'2026-12-07',starts_on:'2026-12-07',agreed_amount:null,paid:0}]
await page.route('**/functions/v1/win-api',async route=>{
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
 const reply=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)})
 if(route.request().method()==='OPTIONS')return reply({})
 const p=route.request().postDataJSON();requests.push(p)
 if(p.action==='me')return reply({user:{id:'admin',name:'Administración aislada',role:'ADMIN'}})
 if(p.action==='bar.inventory.access')return reply({allowed:true})
 if(p.action==='cash.state')return reply({shift:null})
 if(p.action==='calendar.range')return reply({rows:[],settings:{GRID_OPEN_MIN:480,GRID_CLOSE_MIN:1500},context:{coaches:[]}})
 if(p.action==='calendar.pending')return reply({rows:[]})
 if(p.action==='calendar.registry.list')return reply({rows:p.kind==='CLIENT'?clients:p.kind==='WAITLIST'?[wait]:[pending],series,waitlist:[{id:'w1',name:'',phone:null,requested_days:'Martes o jueves',requested_times:'["19:00"]',weekdays:[],windows:[],channel:'',referral:''}],counts:[{kind:'CLIENT',status:'CONFIRMED',count:515},{kind:'ABONO',status:'CONFIRMED',count:44}]})
 if(p.action==='calendar.registry.save')return reply({error:'Conflicto con otra actividad. La serie no se activó.'},409)
 return reply({error:'Escritura no permitida en prueba aislada'},403)
})
try{
 await page.goto((process.env.WIN_TEST_URL||'http://127.0.0.1:5182')+'/#/calendario')
 await page.getByRole('button',{name:'Abonos semanales',exact:true}).click()
 await page.getByRole('row',{name:/Cliente verificado/}).waitFor()
 assert.equal(await page.locator('.migration-scroll').first().locator('tbody tr').count(),2)
 await page.getByLabel('Buscar nombre, teléfono u observación').fill('verificado')
 assert.equal(await page.locator('.migration-scroll').first().locator('tbody tr').count(),1)
 await page.getByLabel('Buscar nombre, teléfono u observación').fill('')
 await page.getByRole('button',{name:'Cliente',exact:true}).click()
 await page.getByRole('row',{name:/Horario especial pendiente/}).click()
 await page.getByRole('button',{name:'Revisar y editar',exact:true}).click()
 await page.getByLabel('Motivo de la revisión').fill('Comprobación de conflicto aislada')
 await page.getByRole('button',{name:'Guardar revisión',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'Conflicto con otra actividad'}).last().waitFor()
 assert.ok(await page.getByRole('dialog').getByRole('alert').isVisible())
 await page.getByRole('button',{name:'Cancelar',exact:true}).click()
 await page.getByRole('button',{name:'Cerrar',exact:true}).click()
 await page.getByRole('button',{name:'Lista de espera',exact:true}).click()
 await page.getByRole('row',{name:/Sin nombre/}).waitFor()
 await page.getByRole('button',{name:'Revisar importación',exact:true}).click()
 await page.getByRole('row',{name:/Identificación incompleta/}).waitFor()
 const overflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}))
 assert.ok(overflow.document<=overflow.width+2,'Desborde del documento en MacBook')
 await page.getByRole('button',{name:'Abonos semanales',exact:true}).click()
 await page.getByRole('button',{name:'Domingo',exact:true}).click()
 assert.equal(await page.locator('.migration-scroll').first().locator('tbody tr').count(),0)
 assert.deepEqual(errors,[])
 assert.ok(requests.filter(p=>p.action==='calendar.registry.save').length===1)
 assert.ok(requests.every(p=>['me','bar.inventory.access','cash.state','calendar.range','calendar.pending','calendar.registry.list','calendar.registry.save'].includes(p.action)))
 if(process.env.WIN_TEST_SCREENSHOT)await page.screenshot({path:process.env.WIN_TEST_SCREENSHOT,fullPage:true})
 console.log('OK MacBook: siete días, filtros, orden, origen, espera sin nombre, revisión de clientes, error visible en modal y 0 escrituras reales · '+browserType.name())
}finally{await browser.close()}
