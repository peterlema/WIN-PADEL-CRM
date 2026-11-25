# Operación diaria del Bar — v0.18.0

- Venta rápida: elegí productos, medio y Cobrar. Cliente desconocido es el valor inicial. Asociar cancha es opcional; los pendientes de cancha conservan fecha y horario.
- Cuenta bancaria: Administración puede confirmar banco, titular y alias o CBU/CVU desde Caja Bar, con auditoría y recuperación del mismo requestId. Los cambios conservan la cuenta histórica de cada movimiento.
- Transferencias: se conserva la decisión publicada en v0.17.6. No requieren configurar banco; verificá el ingreso y compartí la foto del comprobante en el grupo. No se inventan cuentas ni se usan cuentas de Recepción.
- Cuentas corrientes: filtros por estado, persona, tipo, cancha y fecha; detalle de productos y cobros; importe editable para cobro parcial o total. Cobrar no vuelve a descontar stock.
- Caja Bar: apertura, egresos reales, arqueo y cierre en ventanas con acciones visibles. Efectivo, transferencias y tarjetas separados. La diferencia se calcula contra efectivo físico y exige motivo si no es cero. Consulta de movimientos de turnos anteriores, sin modificar turnos cerrados.
- Compras: se reutiliza el formulario único existente. Registrar pedido, recibir mercadería y pagar son hechos distintos. El total sin desglose conserva distribución estimada editable. Recepción actualiza existencias y costo promedio; el pago confirmado afecta sólo Caja Bar.
- Control (Administración): períodos comparables, ventas/entregas, cobros, saldos, compras, pagos, gastos, costo y margen bruto estimado, productos y reposición. No presenta margen como utilidad neta.

Las operaciones de caja, cobros, compras, recepción y salidas de stock conservan la solicitud en la pestaña antes de enviarla. Ante respuesta incierta se consulta el mismo requestId y sólo se reintenta después de confirmar que no está registrado.

## Integración y datos

Se integra sobre main v0.17.6, conservando sus dos migraciones bancarias ya aplicadas. La migración de estabilización requiere ambas; no las reemplaza ni las vuelve a ejecutar. La cuenta bancaria, movimientos históricos, compra histórica de $822.800 y conteo inicial de 393 unidades no se vuelven a cargar.

Las pruebas usan bases desechables o interceptan por completo la API del navegador. No generan ventas ni movimientos financieros de prueba en producción.

La corrección de compatibilidad de totales ya aplicada en Supabase se conserva en 20261125011135_win_bar_cash_totals_compatibility.sql. No volver a aplicar en producción. Las pruebas reconstruyen el esquema y verifican claves antiguas y nuevas, además de concurrencia real en PostgreSQL 17.
