# WIN Gestión — base inicial en Supabase

## Estado
Creada la estructura fundamental el 23/11/2026 en el proyecto Supabase existente (`cqvoherekzntmhyzdidj`). La migración de referencia es `win_foundation_users_cash_20261123`. **No es una aplicación operativa**: no hay usuarios cargados, datos migrados, endpoints ni integración con la web todavía.

## Tablas
- `public.win_staff` — usuarios de Supabase Auth vinculados a los roles ADMIN, MANAGER, RECEPTION y BAR.
- `public.win_cash_shifts` — apertura/cierre por jornada, responsable y efectivo contado.
- `public.win_cash_movements` — movimientos firmados por unidad de negocio (COURTS, ACADEMY, EVENTS, CAFE_BAR, SHOP, GENERAL), medio de cobro y turno, con `request_id` único para idempotencia.
- `public.win_cash_audit` — bitácora administrativa.

## Protección
- RLS activado en todas las tablas.
- **Sin políticas de acceso para roles de navegador** y privilegios de tabla revocados para `anon` y `authenticated`.
- El backend confiable podrá utilizar `service_role` **exclusivamente en Supabase Edge Functions** y deberá verificar JWT, rol interno y permisos en cada operación; nunca exponerla en React ni en el repositorio.
- La unicidad de turno abierto limita el diseño inicial a **una caja física activa**.
- La estructura impone checks básicos y referencias, pero **todavía no garantiza** conservación inmutable ni transacciones de negocio completas: toda operación financiera definitiva debe implementarse mediante endpoints transaccionales que validen estado del turno, permisos, importes y auditoría.
- No crear usuarios reales ni migrar datos de recepción hasta completar las pruebas.

## Pendiente de implementación
1. Funciones de servidor: autenticar y autorizar por rol; abrir/cerrar caja; guardar/reversar movimientos con auditoría transaccional e idempotencia.
2. Pruebas de concurrencia, control de cambios tras cierre, cobros mixtos y roles.
3. Integración de React con Auth y backend; configuración de publicación de GitHub Pages.
4. Migración controlada desde Sheets, conciliación y validación paralela.

## Código y producción
Repositorio fuente: `peterlema/WIN-PADEL-CRM`. La versión actual de Google Apps Script y Sheets de Recepción permanece intacta.
