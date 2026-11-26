# Operación manual · v0.22.0

Referencias: Calendario de v0.20.0, commit 2829b0bb07abfe99285d3e254fe859233c193e89, anterior a la carga Playmix/Excel. Administración v0.12.0, commit 1ad5a982bf95735e36e0cccca18154f13b7fcff6, anterior al histórico detallado. No se restaura un frontend antiguo sobre la base actual: se retira selectivamente la integración importada y se conservan los reportes interactivos posteriores.

Se conservan Bar íntegro, permisos, usuarios, moneda argentina, caja, cobros idempotentes, precios privados, stock, compras, drag & drop, saltos y finalización de abonos. Las clases semanales se programan explícitamente hasta una fecha final usando la misma creación de clases, con validación atómica de conflictos y sin crear ingresos o devengamientos.

La limpieza es un procedimiento administrativo separado de la migración de funciones. Requiere respaldo verificado y deriva los IDs del origen guardado. Un vínculo operativo/financiero nuevo aborta toda la transacción sin cascadas; se compara antes de decidir cómo conservar sus referencias. Sólo se retiran filas respaldadas e iguales; las tablas se conservan.

Vista previa: 511 clientes exclusivos, 43 abonos, 44 filas de espera, 792 filas auxiliares; 1.416 registros de origen Apps Script y 118 filas de sus seis capturas anteriores. Dos clientes, una serie anterior finalizada y una reserva anterior permanecen. No se modifica ninguna operación real.

Respaldo completo previo: instantánea consistente de 111 tablas y sus definiciones, 3.590 filas, copia privada fuera de los esquemas expuestos y archivo OpenPGP AES-256. Conteos y huellas de tablas comparados; cifrado descifrado y comparado dentro de Supabase. Storage tenía cero objetos binarios. El archivo y su clave nunca se incluyen en git. La copia portátil está preparada en el respaldo privado; la descarga depende de disponer de un entorno de archivos conectado.

La API de importación queda retirada y su automatización desactivada. Los reportes filtran explícitamente APPS_SCRIPT preservando todas las ramas nativas, incluida Caja Bar. Exportaciones, períodos, tablas, gráficos y auditoría operativa continúan. Las migraciones anteriores permanecen en el historial; no se reinicia Supabase.

Se identificó que el reporte general anterior no incluía los 19 cobros nativos del Bar (128.500 ARS). La vista administrativa agrega esos movimientos sin modificar sus tablas, cuenta ni caja, y excluye duplicados por request_id. Fecha de cobro por occurred_at y fecha de venta por pedido permanecen separadas.
