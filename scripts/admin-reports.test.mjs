import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {financeDetails,activityDetails,availableValues} from '../src/adminReportFilters.js'
import {displayDate,groupDays,money} from '../src/adminPresentation.js'

const finance=[{category:'RESERVA',unit:'COURTS',method:'CASH',amount:1500},{category:'RESERVA',unit:'COURTS',method:'TRANSFER',amount:3000},{category:'TIENDA',unit:'SHOP',method:'CASH',amount:-500}]
const snapshot=JSON.stringify(finance)
assert.equal(financeDetails(finance,{financeCategory:'RESERVA',unit:'COURTS',method:'TRANSFER'})[0].amount,3000)
assert.equal(financeDetails(finance,{unit:'SHOP',method:'TRANSFER'}).length,0)
assert.equal(financeDetails(finance).length,3)
assert.equal(JSON.stringify(finance),snapshot)
const activities=[{type:'CLASE',courts:['C1','C2'],teacher_id:'a'},{type:'CLASE',courts:['C2'],teacher_id:'b'},{type:'RESERVA',courts:[],teacher_id:null}]
assert.equal(activityDetails(activities,{activityType:'CLASE',court:'C2'},'a').length,1)
assert.equal(activityDetails(activities,{court:'C4'}).length,0)
assert.deepEqual(availableValues(activities,'courts'),['C1','C2'])
assert.equal(displayDate('2026-11-25'),'25/11/2026')

const memory=new Map()
globalThis.sessionStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}
const server=await createServer({server:{middlewareMode:true},appType:'custom'})
try{
 const {Table,Bars}=await server.ssrLoadModule('/src/components/AdminReportUI.jsx')
 const rows=Array.from({length:5000},(_,i)=>['2026-11-25','Registro '+i,money(i+1)])
 const render=props=>renderToStaticMarkup(React.createElement(Table,props))
 const props={head:['Fecha','Concepto','Importe'],rows,caption:'Prueba completa',total:['Total período','',money(12502500)]}
 let html=render(props)
 assert.equal((html.match(/Ver detalle de /g)||[]).length,10)
 assert.ok(html.includes('$12.502.500'));assert.ok(html.includes('Pág. 1 / 500'))
 const key='win_admin_table_Prueba completa_Fecha|Concepto|Importe'
 memory.set(key,JSON.stringify({query:'Registro 4999',sort:{index:2,direction:-1}}))
 html=render(props);assert.ok(html.includes('Registro 4999'));assert.ok(html.includes('$12.502.500'))
 memory.set(key,JSON.stringify({query:'25/11/2026',page:499}))
 html=render(props);assert.ok(html.includes('Pág. 500 / 500'));assert.ok(html.includes('$12.502.500'))
 memory.set(key,JSON.stringify({sort:{index:2,direction:-1}}))
 html=render(props);assert.ok(html.indexOf('Registro 4999')<html.indexOf('Registro 4998'))
 memory.set(key,JSON.stringify({columns:[0,2]}));html=render(props)
 assert.ok(!html.includes('<th class="" aria-sort="none"><button type="button" class="admin-sort">Concepto'))
 memory.set('win_admin_table_Fechas_Fecha',JSON.stringify({sort:{index:0,direction:1}}))
 const dates=render({caption:'Fechas',head:['Fecha'],rows:[[React.createElement('button',null,'02/12/2026')],[React.createElement('button',null,'31/01/2026')]]})
 assert.ok(dates.indexOf('31/01/2026')<dates.indexOf('02/12/2026'))
 const chart=renderToStaticMarkup(React.createElement(Bars,{rows:[{date:'2026-11-25',collected:-1234.5}],field:'collected',label:'Importe exacto'}))
 assert.ok(chart.includes('-$1.234,50'));assert.ok(!chart.includes('NaN'))
 if(process.env.WIN_ADMIN_SNAPSHOT){
  // Read-only aggregated production snapshot supplied locally; never committed to the repository.
  for(const report of Object.values(JSON.parse(readFileSync(process.env.WIN_ADMIN_SNAPSHOT,'utf8')))){
   for(const metric of ['collected','expenses','activityNet']){
    const sum=report.daily.reduce((n,r)=>n+Number(r[metric]||0),0)
    assert.equal(Math.round(sum*100),Math.round(Number(report.totals[metric])*100))
    for(const mode of ['day','week','month'])assert.equal(Math.round(groupDays(report.daily,mode).reduce((n,r)=>n+Number(r[metric]||0),0)*100),Math.round(sum*100))
   }
   const shown=render({caption:'Fuente de servidor',head:['Jornada','Cobros','Gastos','Neto por actividad'],rows:report.daily.map(d=>[d.date,money(d.collected),money(d.expenses),money(d.activityNet)]),total:['Total período',money(report.totals.collected),money(report.totals.expenses),money(report.totals.activityNet)]})
   assert.ok(shown.includes(money(report.totals.collected)));assert.ok(shown.includes(money(report.totals.activityNet)))
  }
  console.log('PASS instantánea real de sólo lectura: día y fuente histórica completa conservan los totales del servidor en tablas y agrupaciones.')
 }
 console.log('PASS Administración: filtros combinados sin mutaciones, 5.000 filas, búsqueda/orden/paginación/columnas y totales completos independientes de la vista.')
}finally{await server.close();delete globalThis.sessionStorage}
