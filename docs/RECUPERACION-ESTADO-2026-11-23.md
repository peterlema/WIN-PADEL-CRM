# Recuperación de estado — 23/11/2026 (Buenos Aires)

## Estado verificado
- main: a5a3d9fe2358f908cbb7351bf5d23e86581f4fa3, V0.12.1.
- GitHub Pages: workflow 45307195574 exitoso; web muestra V0.12.1 y a5a3d9f.
- Cloudflare: https://win-padel-crm.peterlema35.workers.dev/ muestra V0.12.1; commit mostrado "local". No se pudo verificar metadata de despliegue/cuenta porque el panel solicita inicio de sesión.
- Supabase cqvoherekzntmhyzdidj: win-api ACTIVE v14; index.ts y operations.ts coinciden exactamente con main. win-courts ACTIVE v5.
- Migraciones win_admin_history, win_admin_history_report_details y win_admin_history_completeness aplicadas. También config_bar_uses_products, settings y bar_immediate_court_client. No repetir por diferencias de nombre/fecha del archivo.
- Consulta real win_admin_report_(2026-10-19,2026-11-23): cobros 63.707.700; generado 62.080.314; 480 reservas/abonos; 299 clases.
- 1.416 filas históricas: 985 entry, 256 class_detail, 74 allocation, 101 shift. IDs únicos dentro de cada entidad. Histórico separado del libro operativo.
- 46 clases sin precio: 19–26/10/2026. 700 actividades con horario/cancha incompletos. No estimar.
- Al verificar: una caja OPEN del 23/11 con apertura 0; sin win_ops_records ni reservas nuevas en win_court_bookings. No se cambió su estado.
- No se recuperó la lista literal de aproximadamente 20 tareas. Se recuperaron módulos y decisiones, sin inventar ítems.

## Clasificación
| Estado | Alcance |
| --- | --- |
| Terminadas y verificadas | Importación detallada existente, IDs únicos, consultas reales de Resumen/Finanzas/Actividad/Academia, migraciones de histórico, win-api idéntica a main, publicación Pages y versión visible en Cloudflare. |
| Implementadas y pendientes de despliegue | Calendario M05 en implementation/modulo-05 (12de91c), siete commits propios. SQL M05 no aplicado; router calendar no desplegado. |
| Parcialmente terminadas | Integración M05 + recuperación histórica preparada en esta rama; validar CI antes de activar. Verificación de todos los formularios contra producción con sesión real sigue pendiente. |
| No iniciadas / diferidas | Módulo completo de gastos administrativos, expresamente fuera del alcance actual. |
| No verificables | Lista literal anterior, deudas históricas exigibles de profesores, detalle previo al 19/10 y metadatos del despliegue Cloudflare. |

## Decisión actual del usuario
Conservar el histórico disponible. No reconstruir precios, canchas u horarios faltantes ni detener el avance por ellos. Registrar correctamente en adelante. Los saldos operativos nuevos y el histórico se mantienen separados: la ausencia de precio no prueba deuda ni cancelación.

## Continuación preparada
Esta integración parte de main y agrega los cambios ya existentes de M05 sin reemplazar archivos de histórico. package.json conserva test:history y test:db con calendario. CI ejecuta importador, períodos, suites PostgreSQL, concurrencia, Deno y build. Una regresión conjunta verifica que el histórico siga en reportes después de aplicar M05 sin modificar caja ni deuda operativa.

No se aplicó la migración M05, no se redesplegaron Edge Functions ni se publicó V0.13.1. M05 cambia el contrato de cobros y retira Reserva/Abono/Clase de formularios viejos; requiere coordinar la activación con la caja abierta y autorizar el cambio concreto. Las pruebas usan bases efímeras, nunca movimientos ficticios en producción.

La copia local original, que no tiene .git y contiene cambios de M05, queda intacta. No se reimportaron filas ni se modificaron Apps Script, Sheets o Playmix.
