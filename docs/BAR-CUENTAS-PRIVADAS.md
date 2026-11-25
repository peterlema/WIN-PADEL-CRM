# Cuentas privadas del Bar

Sólo Administración crea, configura y activa titulares. La migración no autoriza clientes existentes ni cambia consumos anteriores. Un cliente o reserva no abre una cuenta.

Cada titular tiene descuento, recargo mínimo sobre costo, redondeo, excepciones y observaciones propios. La sugerencia de socios (50%, 10%, múltiplos de $500 hacia arriba) es editable y no activa cuentas por sí sola. El precio usa el mayor entre descuento y costo más recargo; si falta costo o se supera el precio público, se exige revisión. Los márgenes con costos provisionales se identifican como estimados.

Venta rápida consulta precios en el servidor y confirma el mismo cálculo antes de entregar. Los precios/costos/descuentos quedan congelados en el consumo. La recuperación conserva requestId. Los pagos de titular se aplican a los consumos más antiguos en una transacción, sin una nueva salida de stock y sólo en Caja Bar.

Movimientos conserva saldo anterior al período y saldo acumulado sobre toda la historia. La exportación produce XLSX real con números y textos seguros. Para más de 10.000 movimientos en un período se solicita acotar las fechas para evitar exportaciones parciales.

Los saldos anteriores sin autorización siguen en su sección y se pueden cobrar. Administración puede vincular una persona existente al crear una cuenta privada; eso conserva su deuda histórica y sólo aplica condiciones a consumos nuevos.
