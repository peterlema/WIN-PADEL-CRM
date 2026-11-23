# WIN Gestión — Módulo 04: Administración, indicadores y reportes

**Fuente:** `WIN_Gestion_Modulo_04_Especificaciones_Administracion_Reportes(2).docx` (23/11/2026, diseño aprobado; implementación por contrastar).

**Estado de esta integración:** referencia funcional incorporada a arquitectura GitHub + Supabase. **NO implica implementación ni despliegue.** El documento fuente habla de evolución de Apps Script/Sheets; se trasladan los requisitos funcionales, no su propuesta de plataforma, porque WIN V5 ya decidió React + Edge Functions + PostgreSQL. El sistema anterior de Recepción se conserva.

## 1. Navegación única
Un área **Administración** con pestañas internas, no aplicaciones independientes:
1. Resumen General.
2. Finanzas.
3. Actividad (incluye **Ocupación** y **Eventos** como subreportes).
4. Academia.
5. Control y herramientas (Control Diario, auditoría, incidencias, ajustes, exportación y configuración existente).

Filtros compartidos `Hoy / Semana / Mes / Personalizado` preservados entre pestañas. Comparación por período equivalente anterior, cuatro semanas y mes contra mes. Hacer clic en barra/indicador abre un detalle filtrado y permite volver sin perder filtros.

## 2. Dos ejes económicos sin duplicar
- **Finanzas:** cobros y egresos efectivamente registrados en la fecha/jornada financiera real. Total ingresos cobrados, gastos pagados, resultado financiero operativo registrado (ingresos menos gastos, **retiros por separado**), efectivo esperado por contexto de caja.
- **Actividad:** cantidad y **neto generado para WIN** en la fecha de prestación real, independiente de la fecha de cobro. El neto generado por clases descuenta remuneración del profesor, pero **NO es la utilidad neta empresarial** después de alquiler, sueldos e impuestos.
- Academia muestra, cuando corresponda, **bruto de clases**, remuneración devengada de profesores, neto de WIN y rendiciones cobradas. Son cuatro medidas diferentes, no ingresos duplicados.
- Un adelanto/abono cobrado o una rendición tardía no crea actividad ficticia el día del cobro.
- Reutilizar una sola capa de consultas/fórmulas con fechas, tipos, id y reglas explícitas, consumida por todas las pestañas y exportaciones. Evitar recrear cálculos en el frontend.

## 3. Resumen General
Primera lectura financiera con **cuatro indicadores clicables**:
1. Ingresos efectivamente cobrados.
2. Gastos efectivamente pagados.
3. Resultado financiero operativo de movimientos registrados = ingresos - gastos, **sin restar retiros como gastos**.
4. Neto generado para WIN por actividad.

Acceso al resumen de actividad con cantidad y neto por Reservas (regulares/abonos), Clases, Eventos y otros conceptos atribuibles. Conservar tienda y otras categorías sólo con atribución verificable; no sumar un mismo cobro de nuevo.

## 4. Finanzas
Tarjetas: ingresos cobrados, gastos pagados, resultado financiero operativo registrado, efectivo esperado (saldo, no ganancia).
- Categorías: reservas regulares, abonos, rendiciones de clases, eventos, tienda, otros ingresos; desglosar efectivo/transferencias.
- Egresos según categorías que ya existan; retiros aislados de gasto operativo.
- Gráficos por defecto: **barras/columnas verticales**, con tabla numérica. Ingresos diarios, gastos diarios, comparativo ingresos/gastos, por categorías, semana contra semana, últimas cuatro semanas y meses.
- Advertencia: resultado **parcial** hasta integrar gastos administrativos completos.

## 5. Actividad, Ocupación y Eventos
- Actividad neta generada se informa por día de prestación; comparar lunes vs lunes, martes vs martes y períodos equivalentes. Para período incompleto comparar iguales días transcurridos o aclarar diferencia de alcance.
- **Ocupación física:** horas-cancha ocupadas / horas-cancha disponibles. Evitar dobles por reserva + clase/evento en misma franja. Cuatro canchas C1–C4; composición por reserva, abono, clase, evento; mapa de calor por cancha/hora.
- **Aprovechamiento económico:** neto WIN / (horas-cancha disponibles × ARS 60.000). Esta cifra es referencia analítica aprobada del M04, **no precio vigente de reserva**.
- **Neto WIN por hora ocupada:** neto WIN / horas-cancha ocupadas. No recortar valores al 100% ni a $60.000: son cocientes económicos, no porcentajes físicos.
- Eventos: evento único incluso con varias canchas, participantes, horas-cancha, neto WIN, promedio, neto por participante/hora-cancha; comparativos de ediciones viernes/domingo. Cancelados separados de realizados.

### Inconsistencia de horarios a verificar antes de calcular capacidad real
El M04 presenta **capacidad de referencia**: lunes-jueves 08:00–23:00, viernes 08:00–23:00 más extensiones, sábado 08:00–23:00, domingo 09:00–21:00. Declara **408 horas-cancha por semana base**. Esto **no debe confundirse con horarios operativos oficiales vigentes** ni con la grilla frontend, ni cargarse como una capacidad inflexible.
Diseño: tabla `court_availability_intervals` por fecha, cancha, apertura y cierre, con cierres por clima/mantenimiento y extensiones/eventos. Derivar capacidad **de la disponibilidad real**; mantener 408 sólo como referencia del documento hasta validación. No cambiar horarios reales por este anexo.

## 6. Academia analítica
- Tabla por profesor: número de clases de 1,2,3,4 alumnos y total de clases; promedio asistentes/clase.
- Al seleccionar profesor: bruto, remuneración generada, neto WIN, evolución diaria, comparación semana anterior, pendientes de rendición. Gráfico de columnas alterna `clases` / `neto WIN`.
- No contar rendición tardía como nueva actividad. Mantener remuneración devengada, pago rendido y pendiente separados.

## 7. Control Diario y herramientas
Conservar caja abiertas/cerradas, cierres, arqueos, conciliación por turno y jornada, correcciones provisionales, aprobación/rechazo, auditoría, historial y exportaciones previas. **No duplicar** Control Diario como otro libro de movimientos: es una vista operativa sobre los mismos registros.

## 8. Seguridad y rendimiento
- Administración restringida a permiso de reportes/control (`ADMIN` o permiso granular futuro). Recepción no ve datos gerenciales ni exporta Excel; el panel operativo tiene sus propias tarjetas de turno.
- Agregaciones SQL por período, paginación, detalles diferidos, índice para fechas de actividad y fecha financiera, y consultas compartidas en backend.
- Navegación con pocos clics, barras verticales, tablas exactas, filtro persistente, paleta `#232344` azul noche / `#D44664` coral / blanco.
- Reportes con trazabilidad a actividades, comprobantes y movimientos de origen; registro de versiones de fórmulas relevantes cuando cambie la definición.

## 9. Brechas frente a la implementación verificada
- **Implementado parcialmente:** autenticación y RBAC, caja/turnos/movimientos básicos, agenda de canchas.
- **Pendiente:** una capa analítica confiable de actividad realizada vs dinero, reporte de profesores y rendiciones, consolidación de totales, eventos, ocupación real, drill-down, gráficos, filtro persistente, Control Diario administrativo completo y exportación.
- **No diseñar como implementado:** libro general de gastos administrativos (alquiler, nómina, obra, impuestos, proveedores). Se deja como requerimiento **posterior**; conservar gastos actuales sin confundir el resultado operativo parcial con utilidad total.
- Los reportes y funciones del Apps Script anterior deben inventariarse antes de migrar para **conservar / modificar / agregar / proponer eliminar**, y no retirar funcionalidades existentes por omisión.

## 10. Pruebas de aceptación
1. Clase del lunes, rendición miércoles: actividad del lunes y cobro del miércoles, sin duplicación.
2. Reserva anticipada: Finanzas el día cobrado; Actividad sólo al jugarse.
3. Profesores: composición 1–4, bruto/remuneración/neto y pendientes conciliables.
4. Lunes contra lunes, cuatro semanas y mes contra mes con período equivalente.
5. Ocupación sumada por unión de intervalos de cancha: nunca doble por evento multicancha.
6. Evento en tres canchas: un evento, tres ocupaciones, neto único.
7. Cualquier barra/tarjeta conduce a movimientos o actividades rastreables; filtros siguen al volver.
8. Control Diario, funciones de auditoría y exportaciones históricas siguen accesibles según rol.
9. Render liviano con datos paginados; sin lecturas indiscriminadas de todos los registros.
10. No informar como dato real una proyección o referencia de capacidad sin comprobar horarios.

## 11. Orden de trabajo
1. Reconciliar fuentes de datos + fechas + catálogo de categorías, evitando doble conteo.
2. Completar modelo de actividad/clases/eventos y pagos para soportar reportes verificables.
3. Implementar funciones agregadas SQL/RPC de Resumen, Finanzas, Actividad y Academia.
4. Pantallas/tablas/gráficos de columnas con filtros compartidos y drill-down.
5. Ocupación/capacidad por cancha con disponibilidad real y Eventos.
6. Incorporar herramientas de Control Diario previamente inventariadas.
7. Pruebas financieras/regresión antes de publicar para Recepción.

**La especificación consolidada M01–M03** sigue siendo la referencia de Caja, Recepción y registro de movimientos. Este M04 define las **vistas analíticas y administrativas sobre las mismas fuentes**, no nuevos libros paralelos.
