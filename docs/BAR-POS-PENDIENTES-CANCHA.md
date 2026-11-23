# WIN Gestión — Bar / Buffet: Venta rápida y pendientes por cancha

Fecha de incorporación: 23/11/2026. Fuente: solicitud de WIN de registrar consumos por producto y asociarlos con las reservas del calendario.

## Navegación real
**Bar / Buffet → Ventas rápidas**. Categorías y botones alimentados por `win_products`, sin listas duplicadas. Cada sabor/variante se identifica por su producto único; el precio se obtiene del catálogo, con validación servidor. Producto sin precio: no se puede vender ni dejar pendiente.

- Carrito con unidades, importes y total calculado por precios del backend.
- **Cobrar ahora**: efectivo, transferencia o tarjeta; venta, salida de mercadería y cobro en una transacción.
- **Pendiente de cancha**: seleccionar fecha/reserva del Calendario, o registrar cancha + horario manualmente. Mercadería entregada y deuda; sin ingresar caja.
- **Cuenta corriente**: seleccionar o crear persona por nombre; mercadería entregada y deuda; sin ingresar caja.
- **Consumos pendientes**: lista por cancha o persona y cobro posterior, parcial o total. Cobrar registra únicamente pago, sin nueva venta ni segunda salida de stock.
- **Calendario**: etiqueta «Bar pendiente» sobre el turno, detalle de consumos y botón de cobro separado del alquiler de cancha. Una persona de Recepción autorizada puede cobrar consumos **de cancha** desde Calendario, pero no de cuentas personales.

## Fuente única y conciliación
- Catálogo: `win_products` (ya existente, sin replicar).
- Personas con cuentas de Bar: `win_customers` (una identidad por persona, nombre único como identificación inicial; datos de contacto y unificación posterior aún pendientes). El calendario anterior conserva nombres libres, no hay migración automática de clientes.
- Pedido/consumo: `win_bar_orders`; detalle: `win_bar_order_items`, que congela precio unitario al momento de la entrega.
- Salida de inventario: `win_bar_stock_movements` exactamente **una salida por línea de pedido**, aunque el cobro llegue días después.
- Pagos: `win_bar_order_payments` vincula 1:1 cada cobro con un asiento en `win_cash_movements`; una venta pendiente no crea asiento al entregarse.
- `request_id` en pedidos y pagos para idempotencia. Las funciones PostgreSQL ejecutan la operación completa como transacción y verifican rol, caja abierta, precio, estado, límites y saldo.
- Roles: ADMIN y BAR registran consumo y cobro; RECEPTION puede cobrar **sólo pedidos pendientes de cancha** desde el Calendario. Costos y edición de productos siguen limitados a ADMIN.

## Sin stock inventado
Hasta contar físicamente el stock, los movimientos negativos quedan registrados, pero **no existe todavía saldo de existencias**. Tampoco hay ingreso de compras/recepciones ni bloqueo por falta de existencias; por lo tanto esta fase no constituye control de stock operativo completo. Faltan conteo inicial por ubicación, compras, recepción, devoluciones y mermas.

## Pruebas realizadas
Pruebas SQL transaccionales dentro de `BEGIN … ROLLBACK` (no dejaron registros):
- Cuenta corriente: salida única de inventario, ausencia de caja al abrir deuda, pago parcial, pago final, idempotencia y venta inmediata.
- Cancha C2: asignar consumo al turno, mostrar pendiente a Recepción, cobrar en caja, eliminar de pendientes, sin ingreso duplicado.
- RLS: las funciones sensibles no se pueden ejecutar mediante `anon`; sólo se exponen a través de Edge Function autenticada.

## Restricciones pendientes para operación real
- No se configuraron precios de las diez bebidas; hay que cargarlos en **Bar → Stock y precios** para habilitar botones.
- No existe flujo de ventas + stock integrado en el antiguo Apps Script; no utilizar los dos sistemas simultáneamente como libros de caja sin una migración y conciliación.
- No se verificó compilación/despliegue final en navegador con sesión real. Backend `win-api` actualizado y SQL aplicado.
- Pendientes de integración: stock físico real, pedidos y proveedores, conciliación con cobros de reserva en una transacción combinada, identidad universal cliente/abono y reporte histórico de cuentas corrientes.
- No cargar operaciones reales de Recepción/Bar sin cerrar prueba de extremo a extremo, conciliación de turnos, permisos y recuperación de datos.
