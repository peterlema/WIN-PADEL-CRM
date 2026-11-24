import {chromium} from '/tmp/win-browser/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
const browser=await chromium.launch()
const page=await browser.newPage({viewport:{width:1440,height:1000}})
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.goto('https://peterlema.github.io/WIN-PADEL-CRM/?check=0.12.0',{waitUntil:'networkidle'})
await page.getByText('WIN Gestión v0.12.0',{exact:false}).waitFor()
console.log('OK versión publicada 0.12.0 y pantalla de ingreso')
await page.goto('https://peterlema.github.io/WIN-PADEL-CRM/?check=0.12.0#/demo/caja',{waitUntil:'networkidle'})
await page.getByRole('heading',{name:'Caja del turno',exact:true}).waitFor()
for(const name of ['Abono','Reserva regular','Clase','Rendición','Evento / Cancha abierta','Gasto','Retiro','Tienda','Otros ingresos']){
 const button=page.getByRole('button',{name:'+ '+name,exact:true})
 assert.equal(await button.isEnabled(),true)
 await button.click()
 await page.getByRole('heading',{name,exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Guardar '+name.toLowerCase(),exact:true}).isEnabled(),true)
 await page.getByRole('button',{name:'Cerrar',exact:true}).click()
}
assert.equal(await page.getByText(/Próximamente|Sin integrar|aún no implementadas/).count(),0)
console.log('OK nueve formularios habilitados y métricas renderizadas')
await page.screenshot({path:'reception-desktop.png',fullPage:true})
await page.setViewportSize({width:390,height:844})
await page.getByRole('button',{name:'+ Clase',exact:true}).click()
await page.getByRole('heading',{name:'Clase',exact:true}).waitFor()
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow móvil')
await page.screenshot({path:'reception-mobile.png',fullPage:true})
console.log('OK recepción móvil sin desborde horizontal')
await page.getByRole('link',{name:'Administración',exact:true}).click()
await page.getByRole('button',{name:'Resumen General',exact:true}).waitFor()
for(const name of ['Finanzas','Actividad','Academia','Control y herramientas','Resumen General']){
 await page.getByRole('button',{name,exact:true}).click()
 await page.waitForTimeout(200)
}
await page.screenshot({path:'admin-mobile.png',fullPage:true})
console.log('OK secciones de Administración renderizadas')
assert.deepEqual(errors,[],'errores JavaScript')
await browser.close()
