import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {readFileSync,readdirSync} from 'node:fs'
const server=await createServer({server:{middlewareMode:true},appType:'custom'})
try{
 const {default:MoneyInput}=await server.ssrLoadModule('/src/components/MoneyInput.jsx')
 const html=value=>renderToStaticMarkup(React.createElement(MoneyInput,{value,onChange(){},min:0,required:true}))
 assert.ok(html('150000').includes('value="$150.000"'))
 assert.ok(html('1250,50').includes('value="$1.250,50"'))
 assert.ok(html('1.500').includes('value="$1.500"'))
 assert.ok(html('1.50').includes('value="1.50"'))
 assert.ok(html('').includes('value=""'))
 assert.ok(html('1250,50').includes('type="text"'))
 assert.ok(html('1250,50').includes('inputMode="decimal"')||html('1250,50').includes('inputmode="decimal"'))
 assert.ok(html('1250,50').includes('lang="es-AR"'))
 for(const dir of ['src/pages','src/components'])for(const file of readdirSync(dir).filter(x=>x.endsWith('.jsx'))){
  const source=readFileSync(dir+'/'+file,'utf8')
  const leftovers=[...source.matchAll(/<input\b(?:(?!\/>)[\s\S])*?\/>/g)].map(m=>m[0]).filter(tag=>tag.includes('inputMode="decimal"'))
  assert.ok(file==='Configuracion.jsx'||file==='MoneyInput.jsx'||leftovers.length===0,'Campo monetario sin control compartido: '+file)
 }
 console.log('PASS render monetario compartido, texto/coma sin dependencia regional y conservación de entradas inválidas.')
}finally{await server.close()}
