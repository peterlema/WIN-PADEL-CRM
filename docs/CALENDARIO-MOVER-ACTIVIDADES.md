# Mover actividades desde Calendario · v0.15.0

Recepción, Encargado y Administración pueden arrastrar una actividad futura a otra cancha u horario en Día y Semana. El arrastre usa eventos de puntero y un umbral de 8 píxeles; el clic normal abre el detalle. El destino se ajusta a 15 minutos, conserva duración y muestra disponibilidad de cancha y profesor en la agenda cargada. Al soltar se pide confirmación; cancelar o un rechazo conserva la posición original.

Para teclado y pantallas táctiles: abrir el detalle → Mover actividad → elegir fecha, cancha e inicio → Confirmar movimiento. Es la misma operación y la misma confirmación que usa el arrastre. La edición completa sigue disponible.

## Límites explícitos

- Reserva y clase: cambio de cancha, hora o jornada, mientras el origen y el destino sean futuros. Se respetan horarios configurados y disponibilidad real.
- Clase: se conserva profesor y acuerdo económico. Si otra jornada cambia la tarifa o remuneración, se rechaza el movimiento y se pide revisar el acuerdo desde la edición completa.
- Abono: mover **sólo esta ocurrencia**, con cancha/hora nuevas dentro de la misma jornada comercial. No se cambia el día ni la serie semanal. Una fecha proyectada se materializa con el resolutor existente únicamente al confirmar; no se duplica la ocurrencia. Las otras semanas conservan cancha y horario.
- Canceladas, iniciadas, realizadas, eventos, bloqueos y registros históricos de sólo lectura: no se mueven.

## Integridad

`win_calendar_move` recibe ID, revisión, origen y destino. Actualiza únicamente cancha, jornada, inicio, fin y revisión. No acepta duración, cliente, precio ni información de clase como cambios. Conserva participantes, teléfono, notas, profesor y pagos. La auditoría `CALENDAR_MOVE` registra autor, instante, antes/después y alcance. Las cuentas abiertas del Bar siguen la referencia del turno; pedidos cerrados y todos los importes conservan su contenido.

Se usa el mismo bloqueo transaccional de Calendario/Recepción, el resolutor de abonos, las validaciones de disponibilidad y profesor y la exclusión PostgreSQL de cancha. Se comprueba de nuevo revisión y ocupación al confirmar. La solicitud se deduplica en `win_calendar_requests`; una respuesta de red incierta se consulta o reintenta con el mismo identificador. No hay actualizaciones optimistas anteriores a la confirmación del servidor.

## Validación y despliegue

- `npm run test:calendar-move`: geometría, madrugada, permisos, solapamientos, profesor, pago previo, abono real/proyectado, auditoría, invariantes financieras, Bar e idempotencia.
- `python3 scripts/calendar-move-concurrency.py`: PostgreSQL 17 desechable, dos sesiones compitiendo por destinos, revisión de una reserva, profesor y una fecha de abono. Nunca se ejecuta contra producción.
- Validar primero en la rama `implementation/calendar-drag`. Volver a comprobar main y la versión desplegada de win-api antes de integrar.
- Aplicar `supabase/calendar/move.sql` como migración, desplegar la ruta nueva de win-api sin retirar rutas existentes, integrar frontend y comprobar versión visible.
- La demo `#/demo/calendario` admite movimientos en memoria y vuelve a su estado inicial al recargar. Nunca llama al backend real.
