# Histórico de Administración

La importación anterior fue una captura manual de reportes: `win_resumen_admin`,
`win_clases_profesor_dia` y listados de movimientos/turnos del día. El repositorio
no tenía un importador de detalle. Esas tablas se conservan como referencia y
no se suman al nuevo histórico para evitar duplicaciones.

## Fuente y alcance

Lectura directa de Google Sheets, sin ejecutar funciones de escritura en Apps Script.
Fuente: `WIN GESTION BASE DE PRUEBAS`, ID
`1kYR8t-3dyXC0gFRiMMjBV7sV-byOgfIlGl2mCMwP-zE`.
La primera extracción detallada contiene actividad del 19/10 al 23/11/2026.
El título de la fuente se muestra en Administración; la importación no certifica
que todas sus anotaciones sean definitivas ni convierte datos de prueba en ventas.

Se leen cuatro tablas: WIN Anotaciones, WIN Detalle Clases,
WIN Cobros Distribuidos y Cierres. Asiento Diario, Rendiciones y Movimientos Caja
estaban vacías. WIN Conciliacion Clases no tenía vínculos.

## Importación reproducible

1. Obtener metadata y rangos acotados de esas cuatro hojas con valores sin formato.
   No leer Configuracion (puede contener credenciales). No modificar la fuente.
2. Guardar fuera de Git un JSON `{tituloHoja: {values: [encabezado, ...filas]}}`.
3. Ejecutar `python3 scripts/import-history.py snapshot.json facts.json`.
4. Cargar en una transacción `win_history_rows` con UPSERT de
   `(source_id, entity, origin_id)`. Actualizar sólo si cambian `content_hash`
   o `facts`. Comparar conteos, totales, fechas y estado de cajas antes de confirmar.
5. Volver a ejecutar la misma carga debe afectar cero filas. No eliminar registros
   desaparecidos de una extracción sin revisar la fuente y la trazabilidad.

Los IDs provienen de anotación, detalle de clase, cierre o clave compuesta de
cobro + fecha de actividad + profesor + medio. Una clave duplicada detiene el
importador; no se deduplica silenciosamente. Se preservan filas originales,
estado, posición de origen, hash y fecha de importación. No versionar snapshots
ni datos personales. Las fuentes no se sincronizan automáticamente.

## Semántica

- Las anulaciones y cobros reemplazados se conservan, pero no suman.
- Clase: cantidad y participantes provienen de la anotación; precio y porcentaje
  históricos sólo del detalle confirmado. No aplicar tarifas actuales a fechas pasadas.
- Sin precio confirmado: bruto, remuneración y neto desconocidos; no estimar.
- Clase-partido o excepción: conservar neto/economía original; no reconstruir bruto
  a partir del porcentaje cuando el origen no lo informa.
- Actividad se agrupa por fecha de actividad. Cobro distribuido usa su fecha explícita
  de cobro y conserva su atribución a actividad por separado. Las líneas atribuidas
  no generan una segunda venta ni un segundo cobro.
- Otras entradas financieras usan la jornada comercial del cierre de origen.
  Si falta ese cierre, se conserva la fecha financiera utilizada por el sistema
  anterior y se identifica `date_basis=legacy_financial_date`, sin deducirla
  del timestamp de registro. Las clases nunca son ingresos de caja por sí mismas.
- Retiros se muestran separados de gastos y del resultado operativo.
- Horarios/canchas faltantes no se infieren. La ocupación se informa incompleta;
  sólo se suman horas documentadas. No calcular neto por hora sobre una base parcial.
- Academia muestra docentes históricos aunque ya no estén en el catálogo, sin
  crearlos ni habilitarlos para operar. Pendiente/crédito operativo siguen separados:
  la captura no demuestra el saldo actual exigible del histórico.

`win_admin_ledger`, `win_admin_activity` y `win_admin_resources` son vistas exclusivas
de reportes. `win_ops_ledger`, cierres actuales, recursos operativos y agenda no reciben
histórico. RLS y permisos: sólo backend; la API verifica ADMIN antes de reportar/exportar.

## Consulta

Administración → Histórico importado → Resumen General, Finanzas, Actividad o Academia.
La conciliación muestra captura anterior, detalle recuperado y diferencia.
La exportación financiera incluye ambas fechas, fuente e ID. Los cierres anteriores
se consultan por separado en Control y herramientas. Semana = lunes–domingo;
Mes = mes calendario completo; comparación = período equivalente anterior.

## Gastos Administrativos (futuro)

Mantener separado el libro operativo de los futuros gastos devengados o pagados
por administración. Se prevén origen único/documento, proveedor, categoría,
fecha de devengamiento y fecha de pago, y vínculo opcional con pago real.
No crear pagos de caja al importar facturas; evitar sumar una factura y su pago
dos veces al resultado. No se implementan formularios, nuevos egresos ni un módulo
de cuentas por pagar en esta entrega.
