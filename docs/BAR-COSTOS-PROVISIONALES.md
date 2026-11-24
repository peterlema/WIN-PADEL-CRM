# Bar: costo inicial provisional y conciliación

Administración → Bar → Stock y precios → Editar precio / producto → Guardar sólo costo provisional.
Cada variante se carga por separado, con importe argentino y motivo obligatorio. La ficha muestra costo vigente, costo automático conservado, origen, margen bruto unitario y porcentual, stock y valoración estimada. El historial completo está en Costos iniciales y conciliación de importes.

unit_cost es el promedio ponderado vigente. automatic_unit_cost conserva el cálculo automático sin sustituirlo con el manual; provisional_initial_cost conserva la referencia manual. initial_cost_fraction registra la proporción de la valorización procedente de la base inicial. Una recepción usa una sola vez el valor de las unidades actuales más el costo real de las nuevas. Las revisiones del costo inicial sólo ajustan la proporción que sigue en inventario. Al agotarse la base inicial y recibir nuevas unidades, esa proporción pasa a cero. No se reescriben ventas ni movimientos anteriores.

La conciliación exige comprobante/motivo, cantidades originales y totales por variante que sumen exactamente cada línea/grupo de la compra original. Sólo modifica la valorización inicial que aún participa en el promedio y registra evidencia inmutable; no cambia los documentos originales, movimientos financieros, stock ni costos de ventas registradas.

La API verifica sesión ADMIN para cost.set, cost.reconcile y cost.snapshot. Las funciones son SECURITY INVOKER, ejecutables sólo por service_role; anon/authenticated no tienen acceso. Los reintentos usan requestId y las escrituras verifican costVersion para impedir sobrescribir una edición concurrente.

Carga autorizada del 24/11/2026: 11 referencias provisionales. Agua 415,15; Coca común/Zero 1.435; Gatorade Azul/Rojo/Violeta y Powerade 1.585; Patagonia Amber Lager/Lager del Sur/IPA 24/7 2.410; Stella 2.000.
Compra original: 540 unidades, 822.800. Base física: 393; verificar movimientos posteriores antes de ejecutar el script inicial, que no carga unidades y es idempotente.
Diferencias de referencia frente al total histórico: Agua -0,20; Coca +1.760; isotónicas +160; cervezas +1.200. Total +3.119,80. Todas pendientes de conciliación con comprobante; la distribución original de sabores y variedades sigue pendiente. Si luego varían las referencias entre sabores cuya distribución original no se conoce, la referencia grupal queda Pendiente y no se inventa una distribución.

Pruebas: npm run test:bar y npm run test:bar-costs; GitHub Actions bar-costs.yml ejecuta ambas y compila la web. El script de costos iniciales compara registros completos antes/después y aborta si cambian precios, stock, compras, ventas o cajas.
