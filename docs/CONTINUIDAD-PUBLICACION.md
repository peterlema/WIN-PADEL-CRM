# Continuidad de WIN Gestión

## Trabajo recuperado

Se recuperaron `implementation/modulo-05` en `12de91c`, la integración existente
`integration/calendario-historico` en `ffadc24` (PR #1) y el histórico de `main`
en `a5a3d9f`. La entrega conserva los tres avances y sus pruebas; continúa en
el PR existente, sin crear otra base ni otro circuito operativo.
No se encontró una lista original numerada de aproximadamente 20 tareas;
el alcance recuperable está documentado en MODULO-05-CALENDARIO.md y sus commits.

El desarrollo M05 ya cubría calendario C4–C1, día/semana, reservas, precios
acordados, clientes, clases, alumnos, abonos, saltos, baja, anticipos, parciales,
pagos mixtos, idempotencia, Caja, rendiciones, disponibilidad, lista de espera,
roles y compatibilidad de lectura. Se recupera ese código; no se reconstruye.

## Cambios añadidos en la recuperación

- Reportes históricos de main preservados junto con la agenda nueva.
- Comparación por días equivalentes, categorías de actividad/Finanzas y docentes.
- Gráficos con período actual y anterior y evolución diaria por profesor.
- Falta de cobertura anterior indicada expresamente.
- Clasificación de cobros de Calendario en Reservas/Abonos, conservando la misma caja.
- Integración futura de gastos administrativos, inversiones, devengamientos y pendientes documentada.

## Estado de publicación

El histórico en Supabase está aplicado y contiene 1.416 registros; no se vuelve a importar.
M05 no estaba aplicado al recuperar el trabajo. Su migración modifica el contrato
de cobro; se aplica una sola vez al publicar juntos backend y frontend.
El abono y salto existentes, datos importados, cuenta abierta y catálogos se conservan.

Cloudflare requiere una sesión autenticada en la cuenta que contiene el Worker
`win-padel-crm`. La revisión automática bloqueó el inicio de sesión por falta
de aprobación del método/cuenta/configuración persistente. No se reemplaza por
otro hosting ni se crea otro Worker. El artefacto de compilación queda disponible
en el workflow de M05 para actualizar el proyecto existente.

## Corte pendiente

1. Sesión de Cloudflare aprobada y cuenta/Worker verificados.
2. Confirmar que no hayan aparecido cobros nuevos desde la verificación de corte.
3. Respaldo de las tablas y funciones afectadas; sin PIN/hashes ni secretos.
4. Aplicar únicamente `20261124010226_win_calendar_m05.sql` si aún falta.
5. Desplegar win-api con index.ts, operations.ts y calendar.ts; win-courts con
   su index.ts. Conservar `verify_jwt=false` y las variables existentes.
6. Subir el artefacto del mismo commit al Worker existente, con base `/`.
7. Verificar versión, acceso, agenda y abono existentes, Administración y caja
   anterior. No insertar ventas/reservas ficticias en la base real.
8. Primera reserva/cobro real con el responsable. Mantener Playmix y Apps Script
   disponibles hasta comprobar el circuito; no importar clientes a ciegas.

Pruebas aisladas y compilación no equivalen a la aceptación de operación real.
