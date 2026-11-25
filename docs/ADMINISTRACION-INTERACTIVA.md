# Administración interactiva

Se reutilizan `Table`, `Bars`, `Fold` y `Modal` de `AdminReportUI.jsx` en la pantalla operativa. Se elimina la duplicación de tablas y gráficos básicos. La nueva presentación es exclusivamente de lectura; los controles administrativos existentes mantienen sus llamadas, permisos y validación del servidor.

## Consultar

- Elegir fechas y pestaña. Las preferencias se conservan durante la sesión.
- Buscar, ordenar y paginar cada tabla. «Columnas» permite mostrar u ocultar campos individualmente; «Detalle» o seleccionar la fila muestra todos sus campos.
- Los encabezados y totales quedan visibles al desplazarse dentro de tablas largas. Los importes se alinean a la derecha; los datos monetarios completos mantienen el formato argentino.
- Los gráficos tienen ejes abreviados y valores exactos al pasar el mouse o enfocar una barra con el teclado. Admiten agrupación por día, semana o mes y tramos paginados.
- Seleccionar una barra acota las fechas a su día o agrupación, incluido el período anterior. En Finanzas se abre el detalle correspondiente de cobros o gastos.
- Tabla / Gráfico / Ambos se aplica a cada evolución y se conserva durante la sesión. Las secciones se pueden desplegar y contraer.

## Alcance de filtros y totales

Los filtros de detalle se combinan según los campos de la fuente: categoría, unidad y medio en movimientos financieros; tipo, cancha y profesor en actividad; profesor en Academia. Se preservan al cambiar de pestaña. Los totales y comparativos completos del período continúan siendo los del servidor; no se sustituyen por sumas de una página ni de resultados de búsqueda. La interfaz lo indica expresamente.

Las comparaciones muestran actual, anterior, diferencia absoluta y variación porcentual. Si no existe cobertura o base anterior se conserva esa advertencia. Cobros, gastos y retiros no se confunden con neto generado por actividad, rendiciones o saldos de profesores. No se unen las cajas de Bar y Recepción.

La caché existente se reutiliza por sesión y período, deduplica solicitudes concurrentes y vence a los 60 segundos al volver a consultar. «Actualizar reportes» y las acciones administrativas existentes la invalidan. Cambiar de pestaña, buscar o paginar no consulta nuevamente el servidor.

## Exportación y límites conservados

El CSV exporta el período completo, sin aplicar filtros de detalle, búsqueda ni paginación. Mantiene BOM UTF-8, separador de punto y coma, decimales con coma, CRLF y protección frente a fórmulas.

El servidor entrega hasta 5.000 movimientos y 5.000 actividades de detalle; los totales incluyen todo el período. El CSV financiero tiene un límite existente de 20.000 registros. Para superar estos límites hay que implementar paginación o exportación del lado servidor en otra etapa. No se cambian consultas contables ni permisos en esta entrega.

Quedan fuera de esta etapa los filtros globales que recalculen todos los indicadores, tablas dinámicas con agrupaciones arbitrarias como Excel y la unión de fuentes/cajas. Los filtros sobre campos no informados en el histórico no se inventan.

## Pruebas

`npm run test:admin-reports`, `npm run test:history` y `npm run test:money`. La suite de navegador `playwright.admin.config.js` prueba Chrome y WebKit a 1280 × 800, con datos aislados: interacción, filtros combinados, persistencia, deduplicación, históricos largos, selección de barras y CSV.

Para una verificación local adicional se admite `WIN_ADMIN_SNAPSHOT` con una instantánea agregada de sólo lectura. Ningún dato real ni credencial se incluye en las pruebas versionadas.
