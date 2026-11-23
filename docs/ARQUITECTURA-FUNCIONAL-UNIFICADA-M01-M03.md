# WIN Gestión — diseño funcional unificado y auditoría de brechas (V5)
**Fecha:** 23/11/2026  
**Estado:** especificación de producto, en desarrollo; NO es manual vigente ni certifica funciones disponibles.

## 1. Fuentes y precedencia
Fuentes: (1) `WIN_Manual_Recepcion_Caja_y_Turnos_Borrador(2).docx` (M01); (2) `WIN_Modulo_02_Manual_Recepcion_y_Especificaciones_Borrador(2).docx` (M02); (3) `WIN_Gestion_Modulo_03_Manual_Recepcion_y_Especificaciones_Borrador(2).docx` (M03). Los tres describen procedimientos aprobados para una **próxima versión**, no el sistema vigente.

- M01 es autoridad sobre aperturas, cierres, comprobantes, conciliaciones, caja anterior, correcciones y jornada comercial.
- M02 es autoridad sobre categorías de actividad/movimientos, rendiciones, profesor y reglas específicas.
- M03 es autoridad sobre organización de pantalla, tarjetas, avisos e historial.
- La aplicación en GitHub y Supabase es la fuente para decir **qué está implementado hoy**. Cuando diseño y código no coinciden, marcar BRECHA, no fingir implementación.
- El sistema antiguo de Recepción (Apps Script/Sheets) debe permanecer intacto hasta aceptación formal.

## 2. Principio de datos: una sola verdad, múltiples vistas
**Separar actividad realizada, pago real y registro programado.** 
- `court_bookings` registra agenda/ocupación prevista: NO crea ingreso y NO equivale a "reserva jugada".
- `activities` registra lo efectivamente jugado o dictado y su hora real, duración, canchas, responsable, participantes; un evento multicancha es **una actividad** con varios recursos reservados.
- `charges` o `business_documents` registran conceptos económicos por origen (reserva, abono, clase, evento, producto). Una clase puede generar pendiente de profesor sin ingreso de WIN.
- `payments` representa una recepción real de dinero **una vez**: mismo pago puede distribuirse a varios conceptos; dos medios por un documento, y un comprobante puede respaldar varios conceptos. `payment_allocations` evita duplicar pagos y permite mixtos.
- `cash_movements` es el **libro de caja derivado/atómico** de pagos y salidas reales; no introducir el mismo pago dos veces en `cash_movements` y en `bar_sales`. El identificador de operación debe enlazar al asiento y una restricción de unicidad evita doble posteo.
- `cash_shifts` guarda responsable y estado; todos los cobros dentro del turno guardan actor, caja, fecha de carga y fecha de actividad si corresponde.
- `teacher_balances` y `teacher_settlements`: clases originan obligaciones; rendición posterior genera pago real EN EL TURNO EN QUE SE RECIBE y asignaciones a jornadas anteriores, no movimientos ficticios en el pasado.
- `audit_events` es append-only para correcciones, aprobaciones y anulaciones (autor, antes/después, fecha, motivo). Nunca eliminar una venta financiera físicamente.
- `notices` para pendientes manuales y automáticos; incidencias automáticas apuntan a `source_type/source_id` y se resuelven desde origen, no se duplican como tareas libres.
- **Una tabla de productos común** con unidades de negocio BAR/SHOP, y movimientos de stock normalizados. El Bar requerirá recetas/insumos, temperaturas y vencimientos en su propio módulo; no duplicar catálogos ni proveedores.
- Las identidades/roles ya viven en `win_auth.login_accounts` y `role_permissions`; no crear otra cuenta de staff paralela.

### Reglas de consistencia
1. Un cobro con tres conceptos: un pago y hasta tres asignaciones; caja suma el pago una sola vez.
2. Una reserva jugada gratis cuenta actividad y ocupación, no ingreso; motivo de cortesía.
3. Un abono pagado por adelantado cuenta pago hoy y juego cuando ocurra: sin doble ingreso.
4. Clase sin rendir: actividad y pendiente; **caja WIN = 0**.
5. Rendición profesor de días anteriores: ingreso caja actual; vínculo contable a jornadas antiguas.
6. Evento tres canchas: un evento, tres ocupaciones, un cobro WIN.
7. Reintentos usan idempotency key estable desde el inicio del formulario (no generar UUID nuevo por reintento).
8. Corrección caja cerrada no modifica historia silenciosamente: propuesta provisional, aprobación/rechazo ADMIN y auditoría.

## 3. Módulos y navegación mínima por rol
- **ADMIN (Pedro):** Inicio, Recepción, Canchas, Academia, Bar, Shop, Reportes, Usuarios/Permisos; puede configurar y aprobar.
- **RECEPTION:** pantalla de turno, canchas, consulta de actividades y rendiciones pendientes, Shop simple, historial operativo no exportable. No reportes gerenciales.
- **ACADEMY_COORDINATOR:** alumnos, armado y asignación de clases, horarios/profesores, consultas y pendientes de academia (sin movimientos generales de caja).
- **COACH:** sólo agenda de **sus** clases; marcar realizado/asistencia/incidencia según futura aprobación, sin ver otros profesores ni importes gerenciales.
- **BAR (Gerson):** POS, catálogo/stock visible de bar y ventas autorizadas; sin Canchas, Academia, Caja general, Shop, informes globales ni gestión de usuarios.
- **MANAGER:** rol técnico existente; revisar antes de asignar al personal.
- Menú frontend se construye con permisos obtenidos del backend. Todas las rutas y RPC se autorizan **también en el servidor**; ocultar menú no alcanza.
- No habilitar todavía capacidades de profesores o coordinación hasta construir datos de alcance personal (teacher_id, alumnos, schedule) y pruebas de acceso ajeno.

## 4. Recepción: una pantalla, sin reportes repetidos
Jerarquía M03:
1. Barra caja: titular, fecha/hora, "colaborando" cuando sea otro empleado, estado y Actualizar.
2. Cuatro tarjetas de **la caja abierta**: efectivo esperado, transferencias recibidas, reservas efectivamente jugadas + horas cancha, clases efectivamente dictadas (cantidad por profesor y tamaño de grupo **sin importes**).
3. Avisos pendientes y resueltos; persisten entre turnos y días; no bloquean cierre.
4. Nueve acciones de M02 con igualdad visual: Reserva regular, Abono, Clase, Rendición, Evento/Cancha Abierta, Tienda, Gasto, Retiro, Otros ingresos. Un solo formulario desplegado a la vez. La nueva venta Bar es **POS propio**, no un décimo botón duplicado en Recepción.
5. Historial unificado: fecha real de carga DESC, buscar y filtrar (período, categoría, medio); preservar filtros/scroll al abrir ficha; ver autor, caja responsable, hora de actividad, edición/auditoría. Recepción sin exportar.
6. Cerrar turno al final y contraído, con conciliación M01 completa.

### Caja M01: circuito esencial
- Una caja global abierta a la vez. Dos empleados colaboran en la misma; el dueño cierra, salvo ADMIN.
- Apertura cuenta efectivo físico y compara con cierre previo; si difiere, se registra incidencia por traspaso sin falsear apertura.
- Cierre del turno exige efectivo contado + monto total y **cantidad** de comprobantes de transferencia. Si difiere, investigar; excepcional con motivo y comunicación, sin inventar asiento.
- Cierre de último turno: conciliación **de toda la jornada comercial**, separada de cierres individuales, suma/cantidad de comprobantes y saldos por turno. Pendiente al día siguiente no bloquea nueva caja.
- Transferencias: evidencia por WhatsApp Comprobantes sigue siendo procedimiento operativo acordado; el CRM guarda referencia/estado de verificación para evitar duplicar dinero o comprobantes.
- Caja cerrada: corrección provisional por recepción, aprobación o rechazo ADMIN con efectos reversibles y auditados.
- A partir de medianoche: respetar jornada comercial, no igualarla automáticamente al día civil.
- Gastos de Recepción: **efectivo solamente**, categoría restringida, sin exceder efectivo esperado. Retiro: efectivo y destinatario, **no gasto**, tampoco puede exceder saldo.
- No habilitar gasto/transferencia/OTHER de manera genérica desde el formulario de Recepción.
- **No construir caja fuerte y sobres**: expresamente etapa posterior.

## 5. Reglas del M02 por operación
- Reserva: fecha/hora actividad, cancha, duración, pago real efectivo/transferencia; cortesía $0 con motivo. No copiar agenda Playmix como jugado.
- Abono: "¿Se jugó?" por defecto Sí; si No, admite anticipo sin ocupación; si Sí sin cobro, registra ocupación sin ingreso.
- Clase tradicional: profesor activo, asistentes **reales**, tarifa y % de profesor **vigente en fecha de actividad congelado en clase**, motivo si excepción. Profesor cobra habitualmente a alumnos, rinde después.
- Clase-partido: exigir solamente parte de WIN; no inventar total del profesor.
- Rendición: un solo profesor por rendición, imputación a varias fechas; registrar efectivo+transferencia real; pendientes, deuda y saldo a favor diferenciados, sin fabricar clases.
- Evento: una actividad multicancha con asistentes reales, parte recibida por WIN y rendición en misma jornada.
- Shop: mientras no exista POS inventariado, categoría simple con importe; luego reemplazar por POS que genere una única operación/cobro.
- Gasto, Retiro, Otros ingresos: formularios distintos, controles de saldo y motivos según M02.
- Evitar solapamiento de cancha entre actividad efectiva/reserva/evento y profesor duplicado en dos clases simultáneas.

## 6. Auditoría de implementación actual (GitHub main + Supabase)
| Componente | Estado comprobado | Brecha con manual |
|---|---|---|
| Usuario+PIN, token de sesión, bloqueo | Backend actual y tabla privada | Falta test multirol y política de rotación/recuperación PIN |
| Roles ADMIN/RECEPTION/ACADEMY_COORDINATOR/COACH/BAR | Matriz RBAC en Supabase | Faltan interfaces específicas y pruebas de extremo a extremo |
| Caja única, apertura/cierre básico | Tablas y RPC en PostgreSQL | Falta apertura comparada con cierre previo; comprobantes monto + cantidad; jornada cierre global; incidencias; corrección provisional |
| Movimientos caja | `win_cash_movements`, clase genérica, idempotencia por request_id | No representa actividades, pagos mixtos y comprobantes; falta historial detallado/edición auditada y restricciones de recepción |
| Canchas | Agenda, funciones día/mes/crear/cancelar y Edge Function | **Agenda no es actividad jugada**; integración con Reservas/Abonos/Eventos de M02 pendiente |
| Academia | Sólo rol y estructura conceptual | Alumnos, profesor activo, clase real, comisión histórica, pendientes/rendición e incidencias no implementados |
| Bar | Rol BAR y posibilidad de venta genérica CAFE_BAR | Faltan POS de productos, stock, compras, recetas, mermas, precios/costos y reportes propios |
| Shop | Valor de venta genérico | POS/stock no implementados (M02 lo deja como módulo futuro) |
| Recepción M03 | Panel básico de caja, calendario independiente | Faltan cuatro tarjetas exactas, avisos, nueve formularios, historial unificado y UX validada |
| Reportes | Sin implementación integral en nueva web | ADMIN: separar reportes gerenciales de pantalla de turno |

**Precaución:** los tres manuales NO confirman que los botones ya existan en la aplicación nueva. No asumir como funcionando lo que sólo está documentado.

## 7. Prioridades de desarrollo (cada entrega con pruebas)
### P0 — integridad y seguridad antes de dinero real
- Pruebas e2e de inicio de sesión, roles, caja ajena, turnos concurrentes y idempotencia.
- Restringir gastos/retiros al efectivo y saldo disponible; correcciones con auditoría.
- Evitar que rol BAR vea caja general y cualquier módulo fuera de su rol.
- Verificar conflicto UI/servidor al cerrar caja desde otro dispositivo.

### P1 — cierre/conciliación M01 + lectura M03
- Recibo de apertura y comparación con último cierre, incl. incidencia.
- Transferencias con comprobantes, cantidad + monto, comprobante único para conceptos múltiples.
- Cierre individual y control final de jornada, casos excepcionales auditados.
- Cuatro tarjetas con alcance **caja activa**, historial común y avisos.

### P2 — M02 con separación actividad/pago
- Reservas regulares, Abonos, Clase, Rendición, Evento, Shop simple y demás categorías.
- Modelo común de actividad y pagos con asignación; pagos mixtos y anticipos.
- Profesores, vigencias de comisión y rendiciones multi-jornada.

### P3 — aplicaciones específicas
- Academia coordinador/profesor (datos mínimos personales por rol).
- POS Bar + Shop con productos comunes, movimientos de stock y reportes por unidad.

### P4 — administración y calidad
- Reportes económicos globales, filtros/variaciones, exportación sólo ADMIN.
- Rendimiento, lectura responsive, teclado, errores con foco, pruebas en dos dispositivos y monitoreo.

## 8. Criterios de aceptación obligatorios
- Dos usuarios, una caja: colaboración visible, autor individual, rechazo a guardar tras cierre por otro empleado.
- Nunca dos cajas abiertas simultáneamente.
- Un comprobante de transferencia puede respaldar varias ventas sin doble contabilización.
- Una clase no rendida aumenta pendiente pero no efectivo de WIN; rendición jueves no altera caja del lunes.
- Una reserva de cortesía da ocupación, no ingreso; abono anticipado da ingreso, no ocupación.
- Gastos/retiros de recepción no permiten gasto por transferencia ni efectivo negativo.
- Evento de tres canchas = un evento y tres recursos ocupados.
- Historial de recepción consultable, no exportable, sin duplicación de pantallas.
- Cada función sensible valida permisos en servidor y conserva auditoría.
- Ensayo en base de prueba con dos sesiones/dispositivos, conciliación y datos simulados ANTES de habilitar a Recepción.

## 9. Decisiones pendientes: no inventar
- Tarifas vigentes y porcentajes de cada profesor, horarios exactos permitidos, política de reservas vigente y contactos operativos; verificar con datos actuales.
- Alcance de coordinación de Academia para cambiar horarios y registrar profesor.
- Qué registra un profesor en su propia clase y quién aprueba cambios.
- Qué puede Gerson sobre inventario, devoluciones, descuentos y ajustes de Bar.
- Si Shop y Bar usan **la misma caja física de Recepción** o terminales separadas (actual modelo supone una).
- Cómo registrar comprobantes (WhatsApp sigue procedimiento vigente; la referencia CRM debe ser auditable).
- Cómo migrar histórico Sheets y cómo reconciliar cobros, sin mezclar actividad programada/real.

**Regla de entrega:** implementar una vez, guardar una vez, contabilizar una vez; la UI sólo muestra vistas adaptadas al rol.


## 10. Administración y Reportes — Módulo 04 (agregado 23/11/2026)
El documento aprobado M04 se incorpora como **complemento funcional**, sin reescribir ni duplicar las reglas de caja, actividad y roles anteriores.

- **Documento único M04:** [Módulo 04: Administración, indicadores y reportes](MODULO-04-ADMINISTRACION-REPORTES.md).
- Una sola área Administración con pestañas `Resumen General / Finanzas / Actividad (Ocupación y Eventos) / Academia / Control y herramientas` y filtros comunes.
- Mismo origen de datos, dos fechas: actividad efectivamente realizada y movimiento financiero real; el **neto generado WIN** no es utilidad empresarial.
- Gráficos de barras verticales y tablas, comparaciones de períodos equivalentes, cuatro semanas, acceso a detalle rastreable.
- Horarios de capacidad y referencia ARS 60.000 por hora del M04 deben verificarse contra la operación real; no son tarifas ni horarios de atención confirmados.
- No implementar todavía libro administrativo integral de gastos, explícitamente fuera de alcance del M04.
- **Estado:** especificación integrada a GitHub; reportes y nuevas pantallas pendientes de implementación/pruebas.
