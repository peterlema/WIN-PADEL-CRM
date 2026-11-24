# Preparación de Gastos Administrativos

Diseño de integración pendiente; no crea tablas, pagos ni pantallas en esta entrega.

## Separación de conceptos

| Concepto | Clasificación inicial | Tratamiento |
|---|---|---|
| Alquiler, sueldos, servicios y mantenimiento habitual | Gasto operativo | Período devengado y pagos reales separados |
| Obra y equipamiento que aumentan capacidad o vida útil | Inversión | No descontar la compra completa como gasto operativo del mes |
| Reparación de obra sin mejora permanente | Gasto operativo | Clasificar según el trabajo y comprobante real |
| Intereses, multas y conceptos ajenos a la operación habitual | No operativo / financiero | Mostrar fuera del resultado operativo |
| Aporte de socios, préstamo recibido o devolución de capital | Financiamiento / patrimonio | No son ventas ni gastos de operación |
| Retiros de socios | Retiro / distribución | Separados de gastos y de remuneraciones documentadas |
| Proveedor | Contraparte | Puede corresponder a gasto, inversión o anticipo; no es una categoría contable por sí solo |

La clasificación final debe admitir correcciones auditadas y no deducirse sólo
del destinatario. Un pago de alquiler en dólares conserva moneda original,
importe, fecha, tipo de cambio efectivamente usado y monto equivalente, cuando exista.
No inventar cotizaciones históricas ni mezclar dólares/pesos en una suma.

## Modelo previsto sobre la misma base

- Documento u obligación: ID propio, origen externo único opcional, proveedor,
  concepto/categoría, clasificación, moneda, importe original, período devengado,
  emisión, vencimiento, adjunto privado y estado de revisión.
- Pago: fecha real, moneda, importe, medio, cuenta de origen, referencia bancaria
  o vínculo al movimiento de caja existente. Un documento admite varios pagos;
  un pago admite imputación a varios documentos.
- Aplicación: vínculo documento–pago e importe aplicado; no puede exceder ni
  el documento ni el dinero efectivamente pagado. Anticipos se conservan separados.
- Saldos: pendiente, parcial, pagado y vencido derivados de documentos/aplicaciones;
  nunca crear otro ingreso/egreso sólo al cambiar un estado.
- Auditoría: autor, fecha, antes/después, motivo de corrección e idempotencia.

## Integración con WIN Gestión

1. Reutilizar identidad, roles, `win-api`, adjuntos privados y registros de caja.
2. `win_ops_ledger` sigue siendo el libro de dinero real de Recepción. Una factura
   importada no cambia una caja ni su cierre.
3. Si el gasto ya fue pagado y registrado por Recepción, vincular ese movimiento;
   no volver a insertarlo. Pagos externos a Recepción se incorporarán por su propio
   origen y fecha, sin simular una caja abierta.
4. Finanzas: pagos y cobros por fecha de dinero. Resultado de gestión futuro:
   ingresos y gastos por período devengado. Mostrar y conciliar ambas bases.
5. Actividad y Academia conservan sus reglas: una clase no se vuelve a cobrar
   al registrar una obligación administrativa; una rendición no genera otra actividad.
6. Reutilizar el patrón de histórico `(source_id, entity, origin_id)` para importar
   documentación original; no reutilizar un resumen agregado como detalle inventado.
7. Pendientes y vencimientos tendrán acceso administrativo. No ampliar permisos
   de Bar/Recepción para ver sueldos u obligaciones privadas.

## Validaciones para la futura implementación

- Una factura de 100 con pagos de 30 y 70: gasto devengado 100, dinero pagado
  en sus dos fechas y saldo final cero; nunca tres gastos de 100/30/70.
- Un pago ya existente de caja se vincula sin cambiar el total del cierre.
- Obra de inversión, capital de préstamo y aportes no contaminan el resultado operativo.
- Diferencias de moneda y tipo de cambio son explícitas, con fuente verificable.
- Duplicados por origen, pagos excesivos y autorizaciones se validan en backend.
