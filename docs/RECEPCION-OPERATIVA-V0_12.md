# Recepción operativa V0.12.0

Implementación de los circuitos aprobados en M01–M04 sobre React, Edge Functions y PostgreSQL. Apps Script y Sheets originales se conservan.

## Operación

- Refrescar la web y comprobar V0.12.0 al pie. Una caja ya abierta se conserva; no abrir una segunda.
- Abono y Reserva registran juego real y cobro real por separado. Un anticipo de abono no suma ocupación. La fecha a la que corresponde el cobro se indica expresamente.
- Vincular el turno del Calendario cuando exista. Si ya fue cobrado, no volver a cargar dinero. Los cobros futuros del Calendario se asientan una sola vez en la caja abierta.
- Clase tradicional conserva tarifa, remuneración y porcentaje histórico. Excepción exige importes reales y motivo. Clase-partido sólo requiere la parte de WIN.
- Rendición registra dinero recibido hoy y su imputación a jornadas de un solo profesor. Un excedente es saldo a favor; se aplica expresamente o se devuelve como salida real.
- Evento registra una actividad con varias canchas y la parte recibida por WIN en la misma jornada.
- Tienda sigue la modalidad simple por importe aprobada en M02. Los gastos de recepción y retiros se limitan al efectivo disponible.
- Las transferencias admiten varias referencias. Un comprobante compartido conserva la misma referencia y sólo su parte asignada a cada operación. El respaldo faltante crea un aviso.
- Avisos manuales y de origen persisten entre turnos. Los automáticos se resuelven desde su operación.
- Historial por fecha de carga, tipo y medio; conserva autor y responsable. Las anulaciones conservan auditoría y asientos inversos.
- Cierre exige efectivo contado, monto y cantidad de comprobantes. Las diferencias exigen motivo, verificaciones y constancia de aviso a Administración.
- La conciliación general se hace después del cierre de los turnos. Los controles pendientes no bloquean otra apertura.
- Correcciones financieras de cajas cerradas son provisionales hasta aprobación o rechazo de ADMIN. Los conteos físicos históricos se conservan.

## Administración

Filtros persistentes, comparación con días equivalentes de la semana anterior, mes anterior o período anterior. Finanzas se calcula por jornada de cobro; Actividad por prestación real. Academia distingue bruto, remuneración, neto WIN, rendido y saldo. Eventos cuentan una edición aunque ocupen varias canchas.

La capacidad y los porcentajes de ocupación exigen disponibilidad real configurada por fecha y cancha. No se presume una semana de 408 horas ni se confunde agenda con juego realizado. CSV completo limitado a 20.000 registros por exportación; si supera el límite se pide acotar fechas.

## Verificación

La suite aislada PostgreSQL/PGlite prueba usuarios de recepción distintos, permisos, caja única, actividad frente a cobro, anticipos, cortesías, solapamientos, reintentos, rendiciones y crédito, devolución real, comprobantes compartidos, conciliaciones, correcciones sucesivas y calendario/caja sin duplicación. Se ejecuta junto con las suites existentes de canchas, configuración y Bar, y la compilación de producción.

Los ensayos no introducen movimientos ficticios en la base real. Los datos de #/demo son una fixture visual explícita de lectura; no confirman guardados financieros. El alta de una clase anterior al catálogo requiere datos reales y motivo de excepción si no existe una tarifa o porcentaje histórico verificado.

Fuentes SQL: supabase/operations/schema.sql, controls.sql, reports.sql y calendar.sql, en ese orden.
