import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const expected=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version
const origin='https://win-padel-crm.peterlema35.workers.dev'
let last
for(let attempt=0;attempt<36;attempt++){
 try{
  const html=await fetch(origin+'/?verify='+Date.now(),{signal:AbortSignal.timeout(15000),cache:'no-store'});assert.equal(html.status,200)
  const source=await html.text(),scripts=[...source.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m=>m[1])
  assert.ok(scripts.length,'No se encontró el script publicado')
  const code=(await Promise.all(scripts.map(async path=>{const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000),cache:'no-store'});assert.equal(r.status,200);return r.text()}))).join('\n')
  assert.ok(code.includes(expected),'La versión publicada todavía no es '+expected)
  for(const text of ['bar.inventory.accounts','bar.inventory.dashboard','bar.inventory.cash.out'])assert.ok(code.includes(text),'Falta ruta '+text)
  console.log('PASS producción HTTP 200; versión v'+expected+' y rutas Bar diario publicadas. Verificación pública de lectura, sin ventas ni escrituras.')
  process.exit(0)
 }catch(e){last=e;console.log('Esperando publicación '+expected+': '+e.message);await new Promise(r=>setTimeout(r,10000))}
}
throw last
