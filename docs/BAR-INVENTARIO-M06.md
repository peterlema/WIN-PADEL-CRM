# Bar: inventario operativo y apertura del 24/11/2026

La pantalla existente Bar → Stock y precios usa `win_products` y el único libro `win_bar_stock_movements`. No hay inventarios separados para depósito y heladeras.

## Publicación

1. Ejecutar las comprobaciones de GitHub Actions de la rama `implementation/bar-inventory` y `npm run test:bar`.
2. Aplicar una sola vez `20261124124633_win_bar_inventory_cash_isolation.sql`. No modifica turnos cerrados ni genera movimientos de dinero. Mantiene los enlaces financieros anteriores como antecedentes.
3. Ejecutar en una transacción `supabase/operations/bar-opening-20261124.sql`. Exige la cuenta ADMIN de Pedro y aborta si encuentra movimientos/compras ajenos al documento. Su clave de origen evita repetir la compra o el conteo. No se debe volver a recibir la compra histórica.
4. Publicar `win-api`, conservando su autenticación por sesión PIN y sus tres archivos relativos actuales. Verificar que `main` no cambió antes de integrar la rama. Cloudflare despliega `main` por el procedimiento existente.
5. Verificar 11 productos, 393 unidades físicas, una compra histórica de 540 unidades por $822.800, diferencia 147 y potencial $568.000. Caja Bar debe seguir sin turno ni movimientos; Caja Recepción debe permanecer idéntica.

## Evidencia y pendientes

- Se conserva la identidad de Villa Manaos al renombrarla Agua Manaos. Gatorade Violeta se agrega sólo si falta.
- Se cargan precios aprobados por Pedro. No se inventan proveedor, fecha original, pagos, cantidades iniciales de sabores/variedades, mínimos ni cuenta bancaria.
- La compra histórica es un antecedente sin recepción operativa. El conteo registra por separado fecha del conteo, fecha de registro, autor y unidades. Las 147 diferencias son una conciliación PENDING, sin venta, costo de venta ni movimiento financiero.
- Se conservan cuatro grupos de costo: agua $54.800; Coca común/Zero $136.000; Gatorade/Powerade $152.000; Stella/Patagonia $480.000. Los tres últimos NO se prorratean. Sólo agua permite derivar costo unitario confirmado ($54.800 / 132).
- Un promedio de stock con costo desconocido sigue sin definir, aun cuando llegue una compra posterior con costo conocido. Al agotar ese stock, una nueva recepción con costo confirmado permite un promedio conocido. El margen se muestra únicamente para líneas vendidas cuyo costo quedó registrado; las demás se informan como pendientes.

## Circuito diario

Compras → Nuevo pedido guarda proveedor, fecha, productos y costos confirmados (vacío significa pendiente, cero es un costo informado). Recibir mercadería permite recepción parcial y suma stock una sola vez. Un costo total no confirmado bloquea el pago; no se presume una deuda de la compra histórica. Pagos reales y parciales se confirman por separado con un turno abierto de Caja Bar.

Ventas entregan mercadería y descuentan stock una vez. Cobrar un pendiente no vuelve a descontarlo. Se bloquean existencias negativas. Mermas, consumos internos y cortesías requieren motivo; no generan cobros. Los mínimos, opcionales, disparan alertas al alcanzar el umbral. Las salidas y promedios conservan su costo al momento de la operación.

Caja Bar tiene turnos, responsables, movimientos y cuenta bancaria propios. No se abre automáticamente ni se infiere saldo inicial. Transferencias bloqueadas hasta confirmar su cuenta. ADMIN y BAR tienen acceso; otros usuarios necesitan un permiso explícito en `win_bar_access`, con otorgante y fecha. Los permisos heredados de Recepción no habilitan Bar. Los movimientos son inmutables y los cambios usan actor, auditoría y solicitud idempotente.

## Verificación

`supabase/tests/bar-stock.test.mjs` carga también los módulos operativos y calendario vigentes. Prueba semilla repetida, conservación del producto, totales, costos conjuntos sin repartir, promedio ponderado, venta y pago repetidos, recepción repetida, salida no comercial, exceso de stock, pagos bancarios sin cuenta, cierre de caja, aislamiento financiero y permisos de servicio/públicos. Las operaciones de prueba se ejecutan en PGlite, con datos ficticios; no generan ventas reales en producción.
