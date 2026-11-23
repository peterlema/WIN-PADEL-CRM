// MODO DEMO: configuración simulada (productos, precios y profesores). Reglas espejo de win_config_* en SQL.
const fail = (message, status = 409) => Object.assign(new Error(message), { status })
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
let n = 0
const id = () => 'demo-cfg-' + (++n)
const productos = [
  { unidad: 'CAFE_BAR', nombre: 'Agua 500 ml', categoria: 'Bebidas', precio: 1500 },
  { unidad: 'CAFE_BAR', nombre: 'Gatorade', categoria: 'Bebidas', precio: 2500 },
  { unidad: 'CAFE_BAR', nombre: 'Café', categoria: 'Cafetería', precio: 2000 },
  { unidad: 'SHOP', nombre: 'Tubo de pelotas', categoria: 'Pelotas', precio: 12000 },
  { unidad: 'SHOP', nombre: 'Overgrip', categoria: 'Accesorios', precio: 4000 },
].map(x => ({ id: id(), activo: true, ...x }))
const profesores = [['Leo', 60], ['Alejo', 60], ['Pablo', 60], ['Pablo Corsiglia', 60], ['Chino', 55], ['Fede', 60]]
  .map(([nombre, porcentajeWin]) => ({ id: id(), nombre, porcentajeWin, activo: true }))
let precios = [['COURT_TURN', 60, 60000, 70000], ['COURT_TURN', 90, 90000, 100000], ['COURT_TURN', 120, 120000, 120000], ['CLASS_1', 60, 60000, 60000], ['CLASS_2', 60, 70000, 70000], ['CLASS_3', 60, 90000, 90000], ['CLASS_4', 60, 100000, 100000]]
  .map(([codigo, duracion, efectivo, transferencia]) => ({ codigo, duracion, efectivo, transferencia, desde: '2020-01-01' }))
const mismo = (p, b) => p.codigo === b.code && p.duracion === Number(b.duration) && p.desde === b.validFrom
const igual = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

export const configDemo = {
  list() {
    const vig = precios.filter(p => p.desde <= hoy && p.desde === precios.filter(x => x.codigo === p.codigo && x.duracion === p.duracion && x.desde <= hoy).map(x => x.desde).sort().at(-1))
    return {
      hoy, permisos: { bar: true, tienda: true, profesores: true, precios: true },
      productos: structuredClone(productos), profesores: structuredClone(profesores),
      precios: [...vig, ...precios.filter(p => p.desde > hoy)].map(p => ({ ...p, futuro: p.desde > hoy })).sort((a, b) => a.codigo.localeCompare(b.codigo) || a.duracion - b.duracion || a.desde.localeCompare(b.desde)),
    }
  },
  item(b) {
    const nombre = String(b.name || '').trim()
    if (nombre.length < 2 || !(Number(b.price) >= 0)) throw fail('Revisá los datos: nombre, importe o porcentaje.', 409)
    if (productos.some(x => x.unidad === b.unit && igual(x.nombre, nombre) && x.id !== b.id)) throw fail('Ya existe uno con ese nombre.')
    const datos = { unidad: b.unit, nombre, categoria: String(b.category || '').trim(), precio: Number(b.price), activo: b.active !== false }
    if (b.id) Object.assign(productos.find(x => x.id === b.id), datos); else productos.push({ id: id(), ...datos })
    return { ok: true }
  },
  coach(b) {
    const nombre = String(b.name || '').trim(); const p = Number(b.winPct)
    if (nombre.length < 2 || !(p >= 0 && p <= 100)) throw fail('Revisá los datos: nombre, importe o porcentaje.', 409)
    if (profesores.some(x => igual(x.nombre, nombre) && x.id !== b.id)) throw fail('Ya existe uno con ese nombre.')
    const datos = { nombre, porcentajeWin: p, activo: b.active !== false }
    if (b.id) Object.assign(profesores.find(x => x.id === b.id), datos); else profesores.push({ id: id(), ...datos })
    return { ok: true }
  },
  price(b) {
    if (!b.validFrom || b.validFrom < hoy) throw fail('Los precios sólo se cambian desde hoy o una fecha futura.')
    precios = precios.filter(p => !mismo(p, b))
    precios.push({ codigo: b.code, duracion: Number(b.duration), efectivo: Number(b.cash), transferencia: Number(b.transfer), desde: b.validFrom })
    return { ok: true }
  },
  cancel(b) {
    if (b.validFrom <= hoy) throw fail('Los precios sólo se cambian desde hoy o una fecha futura.')
    precios = precios.filter(p => !mismo(p, b))
    return { ok: true }
  },
}
