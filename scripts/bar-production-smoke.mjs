import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const expected=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version
const backendSource=readFileSync(new URL('../supabase/functions/win-api/index.ts',import.meta.url),'utf8')
const expectedBackend=backendSource.match(/["']X-WIN-Backend-Version["']\s*:\s*["']([^"']+)["']/i)?.[1]
assert.ok(expectedBackend,'Falta una versión explícita del backend para verificar su publicación')
const origin='https://win-padel-crm.peterlema35.workers.dev'
let last
for(let attempt=0;attempt<36;attempt++){
 try{
  const html=await fetch(origin+'/?verify='+Date.now(),{signal:AbortSignal.timeout(15000),cache:'no-store'});assert.equal(html.status,200)
  const source=await html.text(),scripts=[...source.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m=>m[1])
  assert.ok(scripts.length,'No se encontró el script publicado')
  const code=(await Promise.all(scripts.map(async path=>{const r=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(15000),cache:'no-store'});assert.equal(r.status,200);return r.text()}))).join('\n')
  const version=code.match(/WIN Gestión v[`"'\s,]*(\d+\.\d+\.\d+)/)?.[1];console.log('Versión web publicada:',version||'Sin identificar')
  if(process.argv.includes('--inspect')){assert.ok(version,'No se pudo identificar la versión publicada');console.log('PASS publicación existente HTTP 200, sin escrituras.');process.exit(0)}
  assert.equal(version,expected,'La versión publicada todavía no es '+expected)
  for(const text of ['bar.inventory.accounts','bar.inventory.dashboard','bar.inventory.cash.out','bar.inventory.bank.save'])assert.ok(code.includes(text),'Falta ruta '+text)
  const api=await fetch('https://cqvoherekzntmhyzdidj.supabase.co/functions/v1/win-api',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({action:'me'}),signal:AbortSignal.timeout(15000)})
  assert.equal(api.status,401,'La API debe exigir sesión')
  assert.equal(api.headers.get('access-control-allow-origin'),origin,'CORS de la aplicación')
  assert.equal(api.headers.get('x-win-backend-version'),expectedBackend,'Versión de la API publicada')
  console.log('PASS producción HTTP 200; web v'+expected+', API v'+expectedBackend+' y rutas Bar diario publicadas. Verificación pública de lectura, sin ventas ni escrituras.')
  process.exit(0)
 }catch(e){last=e;console.log('Esperando publicación '+expected+': '+e.message);await new Promise(r=>setTimeout(r,10000))}
}
throw last
