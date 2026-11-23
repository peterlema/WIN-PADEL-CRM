# WIN Gestión V5 — arquitectura de caja + Café/Bar

**Estado:** propuesta técnica en desarrollo, NO desplegada. **Base:** copia recibida de Code.gs, Index.html y ReportesActividad.gs, conservada en rama `backup/win-gestion-desarrollo-2026-11-23`.

## Objetivo
Conservar el funcionamiento de recepción de canchas, clases, rendiciones, eventos y tienda; incorporar venta gastronómica, compras, stock, costos y reportes separados por unidad de negocio, pero conciliados en una sola caja.

## Menú proyectado
1. **Inicio:** caja abierta/cerrada, turno, usuario, alertas y acceso a módulos.
2. **Canchas / Academia:** reservas, abonos, clases, profesores, eventos, rendiciones (funcionalidad existente; no reescribir).
3. **Café / Bar:** venta rápida, productos, categorías (bebidas/comida), cantidades, descuentos autorizados, medios de cobro, ticket y anulaciones trazables.
4. **Shop:** venta de artículos deportivos; diferenciarla de gastronomía.
5. **Caja general:** apertura, movimientos provenientes de TODOS los módulos, gastos/retiros, cierre y conciliación.
6. **Stock / Compras:** catálogo, proveedores, entradas, ajustes autorizados, mermas, inventarios.
7. **Administración / Reportes:** ventas por negocio, medios de pago, costos, margen bruto y control de diferencias.

## Principios de integración (invariantes)
- Cada venta gastronómica genera **un único movimiento financiero** en la caja que corresponda; nunca volver a sumar el ingreso por medio de otro formulario.
- No alterar ni reinterpretar cierres históricos; mantener identificadores, registros de auditoría y reversos.
- Las operaciones de venta y stock deben tener identificador único; una solicitud reintentada no duplica venta ni descuento de inventario.
- El dinero recibido se registra por **fecha real de cobro / turno**, y el resultado comercial por fecha de venta según criterio documentado.
- Inventario: stock = existencias iniciales + compras/ingresos - consumos vendidos - mermas ± ajustes justificados. Para comidas preparadas se requiere receta/insumos antes de automatizar consumos.
- **Margen bruto ≠ caja**: margen = venta neta - costo de mercadería vendida. Compras son egresos de caja cuando se pagan, no deben restarse otra vez como costo de la venta en el flujo de caja.
- Cualquier anulación debe quedar asociada a venta original y revertir el efecto de caja y stock según corresponda, sujeto a permisos.
- Autorización en servidor, no solo ocultar controles en la interfaz; credenciales y PIN nunca en el repositorio.

## Modelo de datos propuesto (hojas nuevas, NO creadas todavía)
| Hoja | Campos principales |
| --- | --- |
| WIN Productos | SKU, nombre, unidad_negocio, categoría, unidad, código_barras, precio_vigente, costo_referencia, activo, controla_stock |
| WIN Ventas | venta_id, request_id, fecha_hora, fecha_comercial, turno_id, operador, unidad_negocio, total, estado, venta_original_id |
| WIN Venta Detalle | venta_id, línea_id, SKU, descripción_snapshot, cantidad, precio_unitario, descuento, total_línea, costo_unitario_snapshot |
| WIN Venta Pagos | pago_id, venta_id, medio, importe, fecha_hora |
| WIN Stock Movimientos | movimiento_id, request_id, fecha_hora, SKU, tipo, cantidad_con_signo, costo_unitario, referencia, responsable, motivo |
| WIN Compras | compra_id, proveedor, fecha, estado, total, referencia_pago |
| WIN Compra Detalle | compra_id, SKU, cantidad, costo_unitario |
| WIN Proveedores | proveedor_id, nombre, contacto, activo |
| WIN Recetas | producto_final_SKU, insumo_SKU, cantidad_por_unidad, unidad |
| WIN Inventarios | conteo_id, fecha, SKU, cantidad_contada, diferencia, usuario, motivo |

**Nota:** son nombres propuestos sujetos a cotejo con la base real. No crear nuevas hojas ni migraciones sobre producción sin respaldo y aprobación.

## Flujo de venta gastronómica
1. Operador autenticado abre el menú Café / Bar durante una caja abierta.
2. Busca SKU o categoría, registra cantidad. Se congela precio y costo de referencia en el detalle.
3. Selecciona medio(s) de pago y confirma.
4. Servidor valida permisos, caja abierta, precios, totales, existencia cuando aplique y `requestId`.
5. Bajo exclusión mutua y mecanismo de escritura recuperable, se registran venta, detalle, pagos, movimiento financiero de caja, consumo de stock y auditoría como una sola operación lógica.
6. Se devuelve comprobante interno y saldos actualizados.
7. Ante error de red se consulta estado usando el mismo `requestId` antes de reintentar.

## Interacción con la implementación actual
- `Code.gs` usa `WIN_SHEET_ID` en Script Properties y mantiene `WIN Anotaciones`, `Cierres`, `WIN Auditoria`; debe preservarse su circuito de apertura/cierre.
- `Index.html` envía llamadas a `google.script.run` y mantiene en memoria usuario/PIN; revisar y endurecer autenticación antes del despliegue.
- `ReportesActividad.gs` construye indicadores a partir de actividades existentes; extenderlos sin computar dos veces ventas.
- La categoría actual `Tienda` solo registra montos; **no es un POS de productos ni descuenta inventario**. Su migración futura requiere definición expresa para impedir registros duplicados.

## Etapas de implementación
1. Auditar correspondencia entre archivos compartidos y versión actual de Apps Script; obtener `appsscript.json`. Copia inmutable y base de pruebas separada.
2. Catálogo y esquema de datos + pruebas de compatibilidad (sin cambios en UI actual).
3. Funciones servidor: venta, consulta, anulación, compras, stock y auditoría con idempotencia.
4. Interfaz de Café / Bar y navegación modular; sin cambiar la experiencia actual de Recepción hasta probar.
5. Reportes, márgenes y conciliación, incluyendo pruebas de efectivo/transferencias.
6. Pruebas completas y despliegue manual y controlado en desarrollo; producción solo con autorización posterior.

## Pruebas mínimas antes de cualquier publicación
- Doble clic / reintento de venta produce una sola venta, un cobro y una salida de stock.
- Venta mixta efectivo + transferencia cuadra con cierre.
- Cambio de turno bloquea venta con identificador del turno anterior.
- Anular venta registrada revierte correctamente saldo y stock y deja historial.
- Compra al contado disminuye caja solo una vez; compra a crédito no registra pago inexistente.
- Precio de catálogo modificado no altera tickets históricos.
- Reporte de ingresos por negocio suma exactamente el total de caja sin duplicaciones.
- Usuarios de Recepción no acceden a operaciones exclusivas de Administración.
- Exportaciones y reportes de la versión existente no cambian con datos de ejemplo históricos.

## Pendientes de decisión
- ¿Café y Shop operan con mismo efectivo físico y mismo turno? Se propone **sí**, sujeto a confirmación operativa.
- Medios de cobro adicionales: tarjeta, QR, Mercado Pago y tratamiento de comisiones.
- Política de descuentos, consumos internos, invitaciones, fiado y pagos parciales.
- Si el bar controla stock por producto terminado o también por ingredientes/recetas.
- Costeo: promedio ponderado o costo de última compra; fecha de corte de implementación.
- ¿Se requiere impresión de ticket o solo comprobante interno?
- Roles de responsables de caja, bar, compras y autorizaciones.

## Seguridad y publicación
- No cargar IDs de bases productivas, PIN ni tokens privados en archivos versionados.
- Este documento no implica que existan integraciones, pruebas o funciones V5 ejecutadas.
- No se ha publicado ninguna implementación V5 en Google Apps Script.
