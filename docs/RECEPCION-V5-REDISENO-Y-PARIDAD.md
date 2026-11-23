# Recepción V5 — rediseño visual y paridad con Apps Script
Fecha: 23/11/2026. Estado: **desarrollado en main; QA de publicación y operación pendiente**.

## Referencia visual
Capturas de Google Apps Script aportadas por el propietario (pantalla de caja y turnos). Criterios aplicados: franja WIN blanco/coral, panel de responsable y botón Actualizar, cuatro tarjetas 2x2, avisos, nueve acciones 2 columnas, historial con filtros; tarjetas claras, tipografía grande y mucho espacio. No modificar el Apps Script operativo.

## Archivos y fuentes de datos
- UI autenticada nueva: `src/pages/RecepcionV5.jsx`, estilos `src/recepcion-v5.css`; desde `src/App.jsx` para ADMIN/MANAGER/RECEPTION.
- `src/main.jsx` importa los estilos y denomina el acceso principal «Recepción».
- Estado y movimientos reales: Edge Function `win-api` → `reception.overview` → RPC privada `win_reception_overview` de Supabase. Migración: `supabase/migrations/20261123_win_reception_overview_readonly.sql`.
- La página `src/pages/Recepcion.jsx` original continúa como simulación, aislada bajo el acceso demo; NO se utiliza para operaciones reales.
- Se usa `win_cash_shifts` y `win_cash_movements`, sin crear tablas paralelas ni copiar datos del sistema de Recepción anterior.

## Funcionamiento actual permitido
- Consultar caja abierta, responsable y hora; colaborar con identificación individual.
- Efectivo esperado real, total de transferencias registradas de caja abierta.
- Abrir caja y registrar/cerrar movimientos **básicos** según el backend existente.
- Anotación básica real por: Gastos, Retiros, Tienda, Otros ingresos. Cada acción tiene su propio concepto y medio de pago válido; validar en servidor.
- Historial **limitado a últimos 100 movimientos del turno abierto** (no confundir con historial integral), filtros por tipo/medio y búsqueda de autor, concepto y categoría.
- Reintento de movimiento: identificador persistente en el formulario hasta éxito confirmado.

## Funciones pendientes, informadas como tales
- Reserva regular, Abono, Clase, Rendición, Evento: botones visibles que explican por qué todavía no cargan; NO generan anotaciones falsas.
- Tarjetas de Reservas jugadas / Clases dictadas: no hay modelo de actividad efectivamente realizada; mostrar «Sin integrar» en lugar de 0.
- Avisos pendientes: todavía no existe backend de avisos; mostrar estado pendiente, no cero engañoso.
- Conciliación completa M01 (importe y cantidad de comprobantes, último turno, diferencias e incidencias), ajustes, auditar cambios y exportar.
- Historial completo de turnos anteriores, filtros históricos y correcciones provisionales.
- POS de tienda con productos/stock y atención Bar.
- Control de saldo abierto vs cierre anterior.

## Verificaciones y riesgos
- RPC privada creada y comprobada en Supabase; permiso de `service_role` y prohibición de acceso `anon` verificados.
- Edge Function desplegada como `win-api` v3.
- Repositorio GitHub main actualizado; **no hay prueba automatizada ni confirmación de carga visual real completada en esta intervención**.
- Los formularios financieros básicos no sustituyen los nueve procedimientos M02 ni el cierre M01.
- No realizar datos reales de Recepción con esta V5 hasta probar dos usuarios, turnos concurrentes, rendiciones, cierre y conciliación. La instalación Apps Script actual permanece intacta.
