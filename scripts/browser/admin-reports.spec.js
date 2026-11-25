import {test,expect} from '@playwright/test'
const begin='2025-01-01',finish='2026-11-25'
const date=d=>new Date(d+'T12:00:00Z')
function report(start,end){
 const days=Math.round((date(end)-date(start))/86400000)+1,n=days>90?5000:24
 const daily=Array.from({length:Math.max(1,days)},(_,i)=>({date:new Date(+date(start)+i*86400000).toISOString().slice(0,10),collected:0,expenses:0,activityNet:0}))
 const recent=Array.from({length:n},(_,i)=>{
  const day=daily[i%daily.length],amount=i%4===3?-1250.5:2000+i
  if(amount<0)day.expenses-=amount;else day.collected+=amount
  return {id:'r-'+i,date:day.date,activity_date:day.date,category:i%2?'TIENDA':'RESERVA',kind:amount<0?'EXPENSE':'SALE',unit:i%2?'SHOP':'COURTS',method:i%3?'CASH':'TRANSFER',amount,note:'Registro de prueba '+String(i).padStart(4,'0'),user:'Prueba aislada',source:'TEST',origin_id:'source-'+i}
 })
 const operations=Array.from({length:n},(_,i)=>{
  const day=daily[i%daily.length];day.activityNet+=1500
  return {id:'o-'+i,type:i%2?'CLASE':'RESERVA',activity_date:day.date,quantity:1,start_time:'18:00',courts:[i%2?'C2':'C1'],teacher_id:i%2?'t1':null,participants:2,win_net:1500,gross:2500,teacher_pay:1000,win_pct:60,class_kind:'CLASS_2',source:'TEST',origin_id:'operation-'+i}
 })
 const collected=daily.reduce((n,d)=>n+d.collected,0),expenses=daily.reduce((n,d)=>n+d.expenses,0)
 return {start,end,totals:{collected,expenses,result:collected-expenses,activityNet:n*1500,withdrawals:0,entries:n},daily,recent,operations,
  history:{start:begin,end:finish,rows:5000,baseline:{},current:{}},
  categories:[{unit:'COURTS',category:'RESERVA',kind:'SALE',count:n/2,collected,expenses:0}],methods:[{method:'CASH',collected,expenses}],
  activity:[{type:'CLASE',count:n/2,net:n*750,hours:n/2},{type:'RESERVA',count:n/2,net:n*750,hours:n/2}],
  academy:[{id:'t1',name:'Profesor de prueba',classes:n/2,individual:0,double:n/2,triple:0,four:0,average:2,gross:n*1250,remuneration:n*500,net:n*750,received:0,balance:{balance:0,credit:0,days:[]}}],
  academyDaily:daily.map(d=>({...d,teacher_id:'t1',activitynet:d.activityNet/2})),resources:[],events:[],occupancy:{occupiedHours:n,capacityHours:null,missingCourtDays:4},corrections:[],controls:[],shifts:[],historicalShifts:[],audit:[]}
}
async function setup(page){
 const requests=[]
 await page.addInitScript(()=>sessionStorage.setItem('win_session_token','isolated-admin-report-test'))
 await page.route('**/functions/v1/win-api',async route=>{
  const req=route.request(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
  const reply=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)})
  if(req.method()==='OPTIONS')return reply({})
  const p=req.postDataJSON();requests.push(p)
  if(p.action==='ops.admin')return reply(report(p.start,p.end))
  if(p.action==='ops.export')return reply({rows:[{business_date:p.start,activity_date:p.start,occurred_at:p.start+'T12:00:00Z',operation_type:'RESERVA',business_unit:'COURTS',kind:'SALE',payment_method:'CASH',amount_signed:1500.5,note:'=FORMULA',author:'Prueba',source:'TEST',origin_id:'source-0'}]})
  if(p.action==='me')return reply({user:{id:'admin',name:'Prueba aislada',role:'ADMIN'}})
  if(p.action==='bar.inventory.access')return reply({allowed:true})
  return reply({error:'Acción no autorizada en prueba de presentación'},403)
 })
 await page.goto('/#/admin')
 await expect(page.getByRole('heading',{name:'Administración',exact:true})).toBeVisible()
 await expect(page.getByText('Consultando registros…')).toHaveCount(0)
 return requests
}
test('MacBook: orden, búsqueda, páginas, columnas, detalle y filtros conservados sin consultas nuevas',async({page})=>{
 const requests=await setup(page)
 await page.getByRole('button',{name:'Finanzas',exact:true}).click()
 // Find the table by its visible tools caption, independently of the fold heading.
 const grid=page.locator('.admin-data-table').filter({hasText:'Movimientos financieros'}).last()
 await expect(grid.locator('tbody tr')).toHaveCount(10)
 await grid.getByRole('button',{name:'Siguiente',exact:true}).click()
 await expect(grid.getByText('Pág. 2 / 3')).toBeVisible()
 await grid.getByRole('button',{name:/^Importe/}).click()
 await expect(grid.locator('th[aria-sort=ascending]')).toContainText('Importe')
 await grid.getByRole('searchbox').fill('Registro de prueba 0023')
 await expect(grid.locator('tbody tr')).toHaveCount(1)
 await grid.getByRole('button',{name:/^Ver detalle/}).click()
 await expect(page.getByRole('dialog')).toContainText('Registro de prueba 0023')
 await page.getByRole('button',{name:'Cerrar detalle'}).click()
 await grid.getByText(/Columnas \(/).click()
 await grid.getByRole('checkbox',{name:'Autor',exact:true}).uncheck()
 await grid.getByText(/Columnas \(/).click()
 const calls=requests.filter(r=>r.action==='ops.admin').length
 await page.getByRole('button',{name:'Actividad',exact:true}).click()
 await page.getByRole('button',{name:'Finanzas',exact:true}).click()
 await expect(grid.getByRole('searchbox')).toHaveValue('Registro de prueba 0023')
 expect(requests.filter(r=>r.action==='ops.admin').length).toBe(calls)
 await grid.getByRole('searchbox').fill('')
 await page.getByLabel('Categoría',{exact:true}).selectOption('RESERVA')
 await page.getByLabel('Unidad de negocio').selectOption('COURTS')
 await page.getByLabel('Medio de pago').selectOption('TRANSFER')
 await expect(grid.getByText('4 / 4 filas')).toBeVisible()
 const overflow=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}))
 expect(overflow.document).toBeLessThanOrEqual(overflow.width+2)
 await page.screenshot({path:test.info().outputPath('admin-macbook.png'),fullPage:true})
 expect(requests.every(r=>['me','bar.inventory.access','ops.admin'].includes(r.action))).toBe(true)
})
test('histórico completo: totales estables al buscar/paginar, vistas y selección de una barra',async({page})=>{
 await setup(page)
 await page.getByRole('button',{name:'Histórico importado',exact:true}).click()
 const grid=page.locator('.admin-data-table').filter({hasText:'Ingresos por jornada'}).last()
 await expect(grid.getByText(/Total período/)).toBeVisible()
 const totals=await grid.locator('tfoot').innerText()
 await grid.getByRole('button',{name:'Siguiente',exact:true}).click()
 expect(await grid.locator('tfoot').innerText()).toBe(totals)
 await grid.getByRole('searchbox').fill('01/01/2025')
 expect(await grid.locator('tfoot').innerText()).toBe(totals)
 const views=page.locator('.admin-report-views').first()
 await views.getByRole('button',{name:'Tabla',exact:true}).click()
 await expect(views.locator('svg')).toHaveCount(0)
 await views.getByRole('button',{name:'Gráfico',exact:true}).click()
 await expect(views.locator('table')).toHaveCount(0)
 await views.getByRole('button',{name:'Ambos',exact:true}).click()
 const chart=views.locator('[role=group][aria-label="Ingresos diarios"]')
 const bar=chart.getByRole('button').first()
 await bar.hover()
 await expect(views.getByRole('tooltip')).toContainText('$')
 await bar.click()
 await expect(page.getByRole('button',{name:'Personalizado',exact:true})).toHaveAttribute('aria-pressed','true')
 await expect(page.getByRole('button',{name:'Finanzas',exact:true})).toHaveClass(/active/)
 await expect(page.getByLabel('Desde',{exact:true})).toHaveValue('2025-01-01')
 await expect(page.getByLabel('Hasta',{exact:true})).toHaveValue('2025-01-31')
})
test('actividad: filtros combinados y CSV Excel completo preservado',async({page})=>{
 await setup(page)
 await page.getByRole('button',{name:'Actividad',exact:true}).click()
 await page.getByLabel('Categoría',{exact:true}).selectOption('CLASE')
 await page.getByLabel('Cancha',{exact:true}).selectOption('C2')
 await page.getByLabel('Profesor',{exact:true}).selectOption('t1')
 const detail=page.locator('.admin-data-table').filter({hasText:'Detalle de actividad'}).last()
 await expect(detail.getByText('12 / 12 filas')).toBeVisible()
 await page.getByRole('button',{name:'Finanzas',exact:true}).click()
 const downloadPromise=page.waitForEvent('download')
 await page.getByRole('button',{name:'Exportar período completo (CSV Excel)',exact:true}).click()
 const download=await downloadPromise
 expect(download.suggestedFilename()).toMatch(/^WIN_.*\.csv$/)
 const {readFile}=await import('node:fs/promises')
 const csv=await readFile(await download.path(),'utf8')
 expect(csv.charCodeAt(0)).toBe(0xfeff)
 expect(csv).toContain(';1500,5;')
 expect(csv).toContain("'=FORMULA")
 expect(csv).toContain('\r\n')
})
