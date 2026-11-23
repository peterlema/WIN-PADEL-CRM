# WIN Gestión — estado técnico de la base de datos

> Documento de estado técnico. **La especificación funcional única es** [ARQUITECTURA-FUNCIONAL-UNIFICADA-M01-M03.md](ARQUITECTURA-FUNCIONAL-UNIFICADA-M01-M03.md). No repetir reglas operativas aquí.

## Infraestructura
- Código versionado en `WIN-PADEL-CRM`. React en GitHub Pages; Supabase PostgreSQL para datos, y Edge Functions `win-api` y `win-courts` para servidor.
- La aplicación histórica de Recepción en Google Apps Script/Sheets **permanece separada y sin modificaciones**.
- Módulo de autenticación privado `win_auth.login_accounts`, `login_sessions`, `role_permissions` con usuario + PIN y controles de acceso backend. Identidad `win_staff` vinculada al account.
- Caja: `win_cash_shifts`, `win_cash_movements`, `win_cash_audit`.
- Canchas: `win_court_bookings`, `win_court_booking_events`.

## Qué funciona técnicamente / qué falta
- Persistencia básica de usuario, caja y agenda de canchas; roles implementados en PostgreSQL.
- Validación de caja: una abierta; cierre por titular/administrador; bloqueo de movimiento en caja cerrada; clave de idempotencia por movimiento. **Gastos de Recepción sólo efectivo; salidas de efectivo no pueden superar saldo teórico.**
- **Aún no es un sistema operativo completo:** no se implementó el modelo unificado de actividades efectivamente realizadas, asignaciones de pagos mixtos, conciliación detallada de transferencias/comprobantes, cierres de jornada, rendiciones de profesores, avisos, historiales auditados completos, Bar/Shop inventariados, reportes.
- Ver brechas, modelado y orden de trabajo en la [especificación unificada](ARQUITECTURA-FUNCIONAL-UNIFICADA-M01-M03.md), y [roles](ROLES-Y-PERMISOS-WIN.md).
- La caja y usuarios ya tienen datos de prueba; no borrar ni migrar automáticamente. Revisar estado de turnos antes de probar.

## Política de despliegue y migración
- No introducir movimiento real mientras falten aceptación, conciliación, QA con dos usuarios/dispositivos y plan de reversión.
- Migraciones SQL versionadas en `supabase/migrations/`; funciones Deno en `supabase/functions/`.
- No versionar PIN, credenciales, clientes ni comprobantes privados.
