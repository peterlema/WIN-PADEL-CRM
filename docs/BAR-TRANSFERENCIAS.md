# Transferencias exclusivas del Bar
Administración configura banco/billetera, titular y alias o CBU/CVU en Caja Bar o en la acción visible de Venta rápida. Confirmar guarda una configuración completa auditada y habilita transferencias automáticamente; una etiqueta antigua incompleta no las habilita.

No se copian ni consultan cuentas de Recepción. La configuración no genera dinero. Sólo ADMIN puede escribir por API; se validan los campos, la confirmación explícita y la versión anterior para impedir sobrescribir actualizaciones simultáneas. Los reintentos mantienen requestId y no repiten la auditoría.

Cada transferencia guarda un snapshot del banco, titular, alias/CBU, fecha y usuario de confirmación. Actualizar la cuenta no cambia destinos históricos. Importe, fecha, empleado, pedido y turno siguen vinculados por el movimiento inmutable de Caja Bar. Efectivo y tarjetas siguen operativos según sus reglas; la falta de banco sólo deshabilita transferencia.

Aperturas, cierres y movimientos muestran DD/MM/AAAA HH:mm de Buenos Aires e importes es-AR. Cada turno muestra transferencias recibidas, pagos por transferencia y tarjetas por separado del efectivo esperado, que sólo incluye movimientos CASH. Los totales cerrados se calculan desde el ledger inmutable del turno cerrado.

Se verifica el circuito con migraciones y procedimientos reales en PGlite y PostgreSQL 17, incluyendo recepción de dinero inmediata/parcial, reintentos, actualización de cuenta, conservación del snapshot, cierre y aislamiento de Recepción. Interfaz en Chrome y WebKit. No se inserta ninguna cuenta ni operación financiera ficticia en producción; la cuenta real debe proporcionarla Administración.
