import assert from 'node:assert/strict'
import {createServer} from 'vite'
const server=await createServer({server:{middlewareMode:true},appType:'custom'})
try{
 const {parseCost}=await server.ssrLoadModule('/src/components/BarCosts.jsx')
 for(const [raw,n] of [['415,15',415.15],['$415,15',415.15],['1.435',1435],['$1.435',1435],['36.000',36000],['1.500,50',1500.5],[415.15,415.15]])assert.equal(parseCost(raw),n)
 assert.throws(()=>parseCost(''),/Completá el costo unitario/)
 assert.throws(()=>parseCost('1.50'),/importe argentino/)
 assert.throws(()=>parseCost('1.000.000.001'),/entre/)
 console.log('PASS error de costos: vacío, formato argentino y rango son casos diferentes; imports MoneyInput se interpretan sin escalar.')
}finally{await server.close()}
