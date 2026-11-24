# Incidente de cobro Bar y recuperación v0.17.4

El registro del 24/11/2026 a las 17:11:14 UTC devolvió BAR_PRICE_IMMUTABLE (P0001). El protector de precios de empleados comparaba todo el registro salvo unit_cost y amount. Al agregar costos provisionales, el trigger de stock también actualizaba cost_is_provisional; false → true se interpretaba como alteración histórica. Se revirtió toda la venta. win-api v19 coincidía con el repositorio y los permisos service_role estaban presentes.

El snapshot de costo y origen se captura en INSERT de la línea. El snapshot completo se mantiene inmutable después de la inserción; no se relaja la protección para editar ventas anteriores. El movimiento de entrega encuentra el mismo costo y origen.

bar.request.status verifica sesión, permisos, propietario y payload originales. Usa el mismo bloqueo advisory que la mutación; devuelve IN_PROGRESS si otra transacción tiene la solicitud, NOT_FOUND si no existe o FOUND con resultado y coherencia de entrega/pago. No modifica dinero ni stock. Los pagos repetidos verifican usuario, pedido, importe y medio, y devuelven saldo actual.

El navegador conserva acción, payload y requestId en sessionStorage por usuario antes de enviar. Una respuesta perdida se consulta; jamás se crea un requestId nuevo para reintentar un resultado incierto. Actualizar no limpia la incertidumbre sin verificar el registro exacto. Un conflicto de requestId con otros datos mantiene el bloqueo para revisión.

Los errores SQL recibidos de PostgREST implican rollback y se presentan como validación o fallo del servidor, con outcome REJECTED. Los errores de transporte o respuesta ilegible quedan UNKNOWN hasta consultar la solicitud. El backend agrega X-WIN-Backend-Version y registra action, requestId y SQLSTATE sin credenciales ni payload de clientes.

Pruebas aisladas: reproducción del incidente con la combinación real de migraciones, efectivo/transferencia/tarjeta, cuenta corriente sin cobro, pagos parciales, reintentos, permisos service_role y snapshots históricos; PostgreSQL 17 con solicitudes simultáneas y consulta durante transacción abierta; Chrome/WebKit con respuesta perdida antes/después del commit y recuperación tras recargar la pestaña. No se generan ventas ni pagos ficticios en producción.
