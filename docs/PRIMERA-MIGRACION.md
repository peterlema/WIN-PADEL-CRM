# Primera carga real · 26/11/2026

La previsualización separa clientes, abonos y lista de espera antes de escribir.
Los archivos originales, teléfonos y payloads reales se conservan fuera de git.
Las filas incorporadas guardan archivo, SHA256, hoja, celda, contenido original,
clasificación, vínculos, revisiones, responsable y auditoría.

## Resultado verificado en entorno aislado

| Fuente | Clasificación |
|---|---|
| Clientes, 670 filas | 511 claros, 18 duplicados exactos, 141 para revisión |
| Abonos, 78 candidatos | 43 claros, 22 para revisión, 6 regresos pendientes, 3 bajas, 2 posibles, 2 actividades internas |
| Espera, 44 filas con contenido | 43 con nombre, 1 sin nombre; 11 necesitan completar o revisar contacto/disponibilidad |

La fila sin nombre de espera conserva sus días y horario; no se supone que
pertenezca al contacto de la fila anterior. Cuatro filas adicionales se separaron tras comparar con producción y verificar teléfonos que difieren en un dígito dentro del mismo apellido, además de los 137 casos observados inicialmente. Los horarios especiales sin duración
explícita quedan pendientes. Los teléfonos escritos bajo «Precio» se interpretan
como teléfonos, nunca como importes. La hoja demo y las secciones financieras del
reporte de clientes quedan fuera de la carga.

Sólo las 43 series claras se activan desde su primera fecha semanal a partir del
01/12/2026, sujetas a una segunda comparación transaccional con los datos vigentes.
No se presupone precio, pago ni asistencia. Las ocurrencias se proyectan al leer,
sin crear reservas materiales, deudas ni movimientos financieros. El precio debe
confirmarse antes de cobrar o confirmar actividad.

## Consulta y revisión

Calendario → **Abonos semanales**: siete días, filtros por cancha, hora, persona
y estado, tabla ordenable, fuente original, próxima fecha y exportación Excel.
La próxima fecha abre los controles existentes de pagos, salto de semana,
movimiento individual y baja de serie. Los horarios sin abono se distinguen de
la disponibilidad de una fecha concreta, que se comprueba en Calendario.

Calendario → **Clientes**: fichas incorporadas y edición habitual.
Calendario → **Revisar importación**: sólo Administración puede resolver las filas
excluidas. Un teléfono compartido no fusiona personas. Las cuentas corrientes
privadas del Bar, usuarios, claves y PIN no se crean por esta carga.
Calendario → **Lista de espera**: contactos y solicitudes originales, sin asignar
cancha ni presumir duración; los datos incompletos también se pueden consultar.

La revisión administrativa exige motivo y revisión vigente, conserva el original
y reutiliza requestId al consultar o reintentar resultados inciertos. Las series
ya activas se administran desde su actividad original para conservar pagos,
excepciones y trazabilidad.

## Reproducción

1. `read-migration-workbooks.py` extrae celdas y formatos sin modificar XLSX.
2. `prepare-first-migration.py` genera una previsualización fuera del repositorio.
3. Comparar la previsualización con clientes y agenda vigentes.
4. `win_first_migration_import` sólo admite un actor administrativo habilitado y
   se invoca desde el servicio seguro, con clientes antes que abonos y espera.
5. Una repetición idéntica inserta cero filas. Una fuente modificada con la misma
   referencia se rechaza; no sobrescribe registros existentes.

Los conflictos pasan a revisión; no desplazan reservas, clases ni otras series.
La restricción histórica de teléfono único se reemplaza por un índice de búsqueda.
La resolución de clientes exige identidad compatible o selección explícita.

## Comparación con Apps Script y Administración actual

Fuentes examinadas: `Código.gs` (`winDailyPack_`, `adminGenerarAsientosCore_`,
`adminMovimientoCerradoCore_`) y `ReportesActividad.gs`; en WIN Gestión,
`win_admin_ledger`, `win_ops_admin`, `win_ops_day`, `win_ops_control` y exportación.

| Capacidad | WIN Gestión actual | Acción |
|---|---|---|
| Ingresos/egresos por categoría, unidad y medio | Existe | Reutilizar Finanzas |
| Fecha de cobro separada de actividad | Existe | Conservar ambas en consultas y exportaciones |
| Aperturas, arqueos, cierres y transferencias | Existe | Reutilizar Control y Recepción; Bar separado |
| Movimientos diarios y correcciones provisionales | Existe | Reutilizar filtros de jornada y aprobación |
| Comparación entre jornadas/períodos | Existe | Reutilizar comparativos |
| Exportar movimientos a Excel | Existe, CSV de período con identificador de origen | Conservar como consulta/exportación de detalle |
| Jornada marcada REVISADA con huella de datos | No equivalente completo | Agregar revisión administrativa de jornada, invalidada por modificaciones |
| Asientos versionados y control de exportación repetida | No equivalente completo | Agregar registro de exportación vinculado a la huella revisada |
| Correcciones posteriores exportadas sólo como diferencias | No equivalente completo | Agregar exportación incremental con referencias a asientos anteriores |

Estas tres últimas diferencias son una propuesta acotada, no funciones que esta
carga declare implementadas. No se modifica ni reimporta el histórico anterior,
ni se presenta el CSV completo como asiento incremental listo para pegar dos veces.

## Validación

Pruebas de extracción: teléfonos, tiempos numéricos/textuales, bloques especiales,
columna Precio, exclusión de demo y fila incompleta de espera.
Pruebas SQL: doble aplicación, repetición de importación, cambio de fuente,
conflictos, revisión concurrente, permisos, teléfonos compartidos y cero escrituras
financieras. El payload real también se ejecuta localmente sin enviarlo a CI.
Regresión del calendario y pruebas visuales con API interceptada, a 1280×800.
