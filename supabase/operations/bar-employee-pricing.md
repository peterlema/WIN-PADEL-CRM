# Bar: precios para empleados — preparación

La política se instala desactivada, sin precios especiales ni beneficiarios cargados. No existe una acción de API ni un botón para activarla en esta entrega. Los borradores no reciben aprobación al guardarse.

## Configuración

Administración → Bar → Precios empleados permite preparar por producto un precio final fijo o un descuento porcentual, comparar el resultado con el costo promedio y registrar un motivo. El catálogo público y el costo promedio ponderado continúan en sus campos actuales. Un costo desconocido sigue siendo desconocido.

Las autorizaciones individuales usan el ID del usuario activo y de su ficha de personal; nunca se infieren por nombre ni por rol. La estructura permite habilitarlas desde una operación administrativa auditada cuando se decida la política. No se asignan automáticamente.

## Circuito preparado

`bar.employee.quote` y `bar.employee.place` rechazan operaciones mientras la política esté desactivada. En una futura activación también se necesita aprobación por producto. La operación reutiliza la misma función de entrega, stock y cobro del Bar que las ventas públicas. Admite pago inmediato o cuenta corriente; la deuda se genera por el precio final. La cuenta del empleado se identifica por vínculo explícito, sin reutilizar clientes homónimos.

Cada línea conserva precio público, descuento, precio final, política y costo conocidos al entregar. Las versiones siguientes de una política no cambian lo ya vendido. El cobro posterior no vuelve a descontar stock. Las solicitudes tienen idempotencia; las autorizaciones excepcionales se consumen una sola vez, duran quince minutos y quedan ligadas a empleado, producto, cantidad, revisión de política, precio y costo.

Un precio inferior al costo, o un descuento con costo desconocido, requiere una excepción de Administración con motivo. Cambiar el costo o la política invalida una excepción pendiente. Las operaciones y borradores se registran en la auditoría inmutable del Bar. Las funciones y tablas privadas sólo están disponibles al servicio del backend.

Administración → Bar · empleados separa ventas al público, ventas a empleados y descuentos por fecha de entrega. La deuda mostrada es el saldo actual, con los pagos imputados al importe final. Los cobros y pagos usan exclusivamente Caja Bar.

## Activación pendiente

Después de la reunión se deben recibir los valores definitivos, confirmar beneficiarios y dejar una referencia de aprobación administrativa. La activación será un cambio posterior, con revisión y pruebas; no se debe usar la habilitación directa de las pruebas en producción.

## Validación

`npm run test:bar` ejecuta pruebas en una base descartable. Sólo allí se aprueban valores de prueba y se habilita temporalmente el circuito para verificar precios fijos y porcentuales, saldos finales, stock único, reintentos, permisos, inmutabilidad, excepciones y aislamiento de Caja Recepción. No opera sobre datos reales.
