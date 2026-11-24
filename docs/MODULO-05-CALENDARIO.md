# Módulo 05 · Calendario operativo · V0.13.0

## Estado y base revisada

Implementación incremental sobre `main` `1ad5a98` (V0.12.0), en el mismo repositorio `peterlema/WIN-PADEL-CRM`. Proyecto único de Supabase verificado: `cqvoherekzntmhyzdidj`, PostgreSQL 17.12. `win-api` estaba en versión 14 y `win-courts` en versión 5 al iniciar la revisión. Cloudflare sirve V0.12.0 en `https://win-padel-crm.peterlema35.workers.dev/`.

V0.13.0 queda preparada en `implementation/modulo-05`; aplicar la migración y publicar requiere la autorización del responsable, porque cambia el circuito operativo de cobros y las pestañas antiguas deben actualizarse. No se aplicaron los SQL M05 a producción durante el desarrollo. No se modificaron Apps Script, Sheets ni Playmix.

## Uso de la interfaz

- **Día:** cuatro columnas C4, C3, C2, C1; altura proporcional a los minutos, reloj rojo de Buenos Aires, botón Hoy y desplazamiento a la hora actual. En móvil se conserva el orden con desplazamiento horizontal dentro de la grilla.
- **Semana:** días agrupados y, dentro de cada día, C4, C3, C2, C1. La altura de cada bloque conserva su duración real. Desplazamiento interno para mantener textos legibles.
- **Sólo abonos:** misma grilla semanal, series actuales y opción de consultar las bajas. Las actividades puntuales que ocupan una fecha siguen impidiendo reservar ese espacio.
- Tocar un espacio libre precarga cancha, fecha y hora. Se ofrecen **Crear reserva** y **Crear clase**. Dentro de reserva se elige regular o abono semanal.
- Reserva: referente y teléfono obligatorios; búsqueda por nombre/teléfono; tarifa sugerida según fecha y duración, precio acordado editable y motivo al cambiarlo. 90 minutos por defecto, botones 60/90/120 y duración excepcional en múltiplos de 15 minutos, dentro del horario configurado y disponibilidad real cuando está definida.
- Clase: 60 minutos por defecto, profesor, 1–4 alumnos previstos, tipo, excepción y participantes opcionales. Programar sin nombres de alumnos es válido. Se conservan las reglas económicas M01–M04: tradicional, clase-partido, descuento, empleado y cortesía con remuneración real.
- La ficha muestra actividad y pago por separado, precio, aplicaciones, saldo e historial de cobros. Puede registrar efectivo, transferencia, mixto, parcial, anticipado o completo, siempre en la caja activa.
- **Confirmar partido jugado / clase dictada:** sólo después de finalizar el horario. Una programación no se convierte en actividad realizada por el paso del tiempo. **Por confirmar** reúne los últimos 31 días; las fechas anteriores se consultan navegando a la jornada. No bloquea cierres.
- Después de dictar una clase se puede corregir la cantidad real de alumnos y sus importes. No se cambia el horario, cancha o profesor de una actividad ya realizada. Se conserva el porcentaje congelado al confirmar.
- **Saltar semana:** libera únicamente esa fecha, conserva la serie y distribuye las aplicaciones existentes a las siguientes fechas pendientes del mismo abono. Si la siguiente ya está pagada, continúa buscando. Si está parcialmente pagada, completa su saldo y aplica el resto a la siguiente. No altera el cobro original ni crea movimientos financieros.
- Con un pago aplicado y menos de 24 horas de aviso, Administración realiza y autoriza la operación con su propia sesión. La autorización y motivo quedan auditados. Si no hay destino válido dentro de las 104 semanas examinadas o de la vigencia del abono, toda la transacción se revierte.
- **Baja definitiva:** libera la serie desde la fecha elegida y conserva fechas y cobros anteriores. No devuelve dinero automáticamente. Las coincidencias con la lista de espera generan oportunidades, sin contactar ni asignar clientes.
- **Clientes:** ficha propia, nombre completo, campos de nombre y apellido, teléfono, observaciones, reservas, participación en clases, asistencia y abonos actuales/anteriores. Los homónimos no se fusionan por nombre. Los formatos comunes argentinos se normalizan por teléfono, incluidos +54/549, 011 y 011 15. No se adivinan códigos de área faltantes.
- **Lista de espera:** varios días y franjas, duración, cancha opcional, notas y seguimiento. Al crear un abono desde una oportunidad se vincula la solicitud y pasa a acuerdo confirmado.
- Se conservan los consumos pendientes de Bar por cancha y turno, sus cobros independientes y los horarios de recepción.

## Integración y datos

Se amplían `win_court_bookings`, `win_court_abonos`, `win_court_payments` y `win_customers`. Las ocurrencias futuras se proyectan sin escribir durante una consulta; se materializan en `win_court_bookings` al intervenir sobre una fecha concreta, con unicidad `(source_abono_id, business_date)`.

Se agregan aplicaciones de cobros, participantes, idempotencia, lista de espera y oportunidades. No se crea una segunda caja, CRM o base de datos. `win_court_payments` conserva el origen del dinero y el trigger existente `win_ops_calendar_cash` genera el único asiento en `win_cash_movements`. Las aplicaciones se limitan al importe del cobro. Las correcciones aprobadas de un cobro con un único destino actualizan su aplicación; un cobro repartido entre varias fechas requiere revisión antes de modificar su importe, para no redistribuirlo arbitrariamente.

La actividad confirmada se registra en `win_ops_records` y `win_ops_resources`, con vínculo a la reserva, sin efectivo ni transferencia. Puede no tener caja asociada: se habilita `shift_id` nulo exclusivamente para actividades realizadas sin dinero. Los reportes M04 mantienen las fechas y fórmulas existentes, incluido $60.000 por hora-cancha disponible. Las rendiciones siguen devengando dinero en la fecha de recepción.

Recepción conserva historial completo y consulta tanto movimientos financieros como anotaciones operativas. Se identifican las anotaciones sin dinero y se incorpora un acceso a la actividad original. Sus formularios directos de Reserva, Abono y Clase se retiran; el backend también rechaza esas cargas desde pestañas anteriores. Las funciones de lectura del calendario anterior se adaptan a pagos múltiples; las escrituras del cliente antiguo solicitan actualizar la aplicación.

## API y seguridad

`win-api` conserva usuario + PIN, token temporal, CORS y verificación de sesión. Nuevo router `calendar.*` → `public.win_calendar_api(p_token, p_action, p)`. Acciones: `range`, `pending`, `quote`, `customers`, `customer.detail`, `customer.save`, `waitlist`, `waitlist.save`, `abonos`, `audit`, `request`, `create`, `update`, `abono.create`, `pay`, `confirm`, `cancel`, `skip`, `abono.end`.

La API valida permisos `COURTS` y `CASH` existentes; Bar no accede al módulo. El cliente no decide saldos, fechas contables, comisiones, autorizaciones ni disponibilidad. RLS activado y acceso revocado a `anon`/`authenticated`; funciones invoker con search_path vacío y ejecución sólo `service_role`. No hay credenciales nuevas ni cambios de PIN.

Todas las escrituras M05 reutilizan un UUID por solicitud y cotejan autor, acción y contenido exactos. Bloqueo transaccional compartido con Caja/Recepción, restricciones de superposición y revisión de versión al editar. El formulario conserva datos ante errores; si se pierde una confirmación consulta el resultado o reintenta exactamente la misma solicitud.

## Validación

- Suite existente de canchas, precios, Configuración, Bar, operaciones, conciliaciones y reportes.
- M05 aplicado dos veces, permisos reales del rol `service_role`, anon denegado y sesiones/roles no autorizados.
- Anticipos, parciales, mixtos, sobrecobros y doble solicitud; actividad futura no contabilizada como realizada; cancelación conservando dinero histórico.
- Dedupe telefónico, homónimos, modificación concurrente, duración excepcional y reversión integral ante superposición.
- Clases y profesor, cambio de dos a tres alumnos, comisión congelada, rendición sin duplicación, informes por fecha de actividad y de cobro, confirmación sin caja abierta.
- Saltos sobre fechas pagadas, aplicaciones repartidas sobre saldos parciales, origen del cobro inmutable y ausencia de destino con rollback.
- Lista de espera, coincidencias comerciales y ausencia de asignación automática.
- PostgreSQL 17 efímero con dos sesiones independientes: reserva superpuesta, exceso de cobro, reintento simultáneo, profesor simultáneo y cierre contra cobro.
- Utilidades de interfaz: C4–C3–C2–C1, medianoche de Buenos Aires, reloj, fin calculado y moneda argentina. Compilación React y chequeo Deno de ambos backends.
- Revisión visual local con datos marcados DEMO, sin confirmar escrituras ficticias ni movimientos en la base real.

## Inspección de Playmix

Se revisaron en Chrome las vistas diaria/semanal, los formularios de reservas y clases, la ficha de información, edición de una serie y la estructura de clientes. Son útiles la agenda proporcional, recurrencias, búsqueda de personas, pagos separados y edición desde la ficha. Se observaron registros de cliente repetidos; por eso se conserva la identidad por teléfono y no se importa masivamente.

No se guardaron reservas, cancelaciones o modificaciones ni se exportaron datos personales. Los formatos y permisos de exportación no quedaron verificados; esa inspección permanece pendiente antes de planificar una importación.

## Publicación controlada pendiente

La migración `supabase/migrations/20261124010226_win_calendar_m05.sql` fue creada con la CLI de Supabase y reúne, en orden, los cuatro archivos de `supabase/calendar`. CI comprueba que el contenido coincida. No ejecutar junto con una reaplicación general de migraciones antiguas.

Antes de aplicar: verificar de nuevo el proyecto, estado de main y versiones de las funciones; relevar cobros/abonos incorporados durante el desarrollo y revisar teléfonos duplicados normalizados. No fusionar clientes automáticamente. Tomar respaldo de esquema y datos afectados con los mecanismos del proyecto. Coordinar una ventana corta sin cargas para impedir que una pestaña anterior escriba durante el cambio de contratos.

Después de autorizar: aplicar una sola migración, desplegar `win-api` con sus módulos `operations.ts` y `calendar.ts` y `win-courts`, manteniendo la autenticación propia y verify_jwt previo. Publicar el frontend en el Worker existente, confirmar la cuenta antes de usar `wrangler.jsonc` y conservar variables existentes. La configuración no declara D1, otra base ni recursos nuevos. La rama main todavía tiene el workflow de Pages; evitar confundir su publicación con el despliegue de Cloudflare.

Verificación operativa: pie V0.13.0 y commit, ingresar con los usuarios existentes, comprobar lecturas/permisos, turno abierto y saldo anterior, y revisar la primera reserva/cobro real acordada con el responsable. No insertar ventas de prueba en la caja real. Frente a fallos, detener cargas, conservar solicitudes/idempotencia y revisar antes de cambiar versiones. No volver a un backend financiero anterior a ciegas después de recibir pagos parciales.

Fuera de alcance por decisión funcional: importación masiva, mensajería automática, señas obligatorias, créditos generales y devoluciones automáticas. Playmix sigue activo hasta una migración y validación posteriores.

## Continuidad recuperada

Se integra el histórico de main a5a3d9f y las comparaciones de Administración. Ver CONTINUIDAD-PUBLICACION.md para el corte de Cloudflare y GASTOS-ADMINISTRATIVOS-INTEGRACION.md para el diseño posterior. Las autorizaciones del usuario para continuar ya permiten los cambios técnicos incrementales; sigue pendiente el acceso autenticado a Cloudflare y la verificación del corte.
