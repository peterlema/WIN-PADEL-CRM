# Bar: compras simples v0.17.3
Las diferencias históricas entre costos aproximados y facturas son informativas. No se exige conciliarlas para operar. No se vuelven a cargar los 11 costos ni el inventario de 393 unidades.

Bar → Compras → Nueva compra abre un único formulario. Proveedor, fecha, producto y cantidad; se puede informar costo unitario, total de línea, total de factura o usar referencias. El total de factura es el importe de control. La API reparte el remanente por cantidad × costo de referencia y distribuye los centavos por mayores restos; conserva exactamente el total de factura. El reparto estimado se puede copiar a los campos y editar antes de guardar. Si no existe referencia ni importe no se inventa un costo.

Pedido no recibido: no suma stock. Recibido: suma unidades y actualiza el promedio ponderado una sola vez. Pendiente de pago: no mueve dinero. Ya pagado: requiere confirmación explícita y registra un egreso real en Caja Bar según el medio, con cuenta bancaria del Bar para transferencias. También se pueden recibir y pagar pedidos posteriormente, incluyendo recepciones parciales.

purchase.save reutiliza purchase.create, purchase.receive y purchase.pay en una transacción con claves hijas deterministas y requestId idempotente. Si falla un pago, se revierte toda la operación nueva. Los reintentos no duplican compras, stock, costos ni pagos. Las ventas anteriores conservan su costo. Los costos estimados de nuevas recepciones se etiquetan y mantienen los márgenes como estimados.

El antiguo mensaje de rango mezclaba vacío/formato inválido con costo fuera de límite. Ahora cada caso se explica por separado y no hay formulario de conciliación obligatorio. Se reutilizan MoneyInput y parseMoneyInput es-AR.

Pruebas: test:bar, test:bar-costs, test:bar-purchases, test:money, scripts/bar-cost-input.test.mjs; interfaz en Chrome y WebKit con API aislada. Las pruebas transaccionales usan PGlite con los procedimientos reales y no generan operaciones de producción.
