# Reglas del repositorio — WIN-PADEL-CRM

- Repositorio principal de **todo el código fuente** de WIN Gestión: frontend, backend, migraciones, pruebas y automatización de despliegue.
- La rama `main` publica la web mediante GitHub Actions / GitHub Pages. Las funciones de backend se despliegan como Supabase Edge Functions desde este mismo repositorio.
- Base de datos única para la futura aplicación web: **Supabase PostgreSQL**; autenticación con Supabase Auth.
- **Frontend React = presentación e interacción únicamente.** No colocar en el navegador secretos, claves privadas, service_role, acceso administrativo, reglas de caja, cálculo contable o decisiones de autorización. La URL y clave *publicable* de Supabase pueden estar en el navegador sólo para Auth, con controles de seguridad correctos; las escrituras sensibles pasan por Edge Functions con validación de identidad y permisos y transacciones de base de datos.
- Todas las tablas expuestas: RLS activado y políticas por roles/organización; nunca conceder acceso universal por defecto.
- Prohibido versionar datos de clientes, PIN, credenciales, variables privadas ni archivos `.env`.
- Commits claros y verificables. Interfaz en español rioplatense.
- Tablas UI con ancho apropiado para contenido.

## Decisiones confirmadas (23/11/2026)

1. La nueva web **React + Supabase** reemplazará gradualmente a Google Apps Script/Sheets cuando esté completa y validada. **El Apps Script y Sheets actuales siguen en producción, intactos** mientras se trabaja.
2. **GitHub guarda y versiona el código; no ejecuta el backend.** GitHub Pages publica el frontend; las Edge Functions de Supabase ejecutan el backend versionado en este repositorio, y PostgreSQL almacena datos.
3. El frontend no contiene lógica financiera crítica ni acceso privilegiado. Todos los registros de caja, cobros, devoluciones, stock, precios, descuentos y autorizaciones se verifican del lado servidor.
4. La copia original de Apps Script en `backup/win-gestion-desarrollo-2026-11-23` queda inalterada. La rama `desarrollo/v5-cafe-bar` es experimental; antes de fusionar verificar compatibilidad con las decisiones de `main`.
5. Acceso previsto: email + contraseña con Supabase Auth (sin PIN, salvo nueva decisión).
6. Orden de migración: caja y turnos → clases y rendiciones → reportes y administración → Café/Bar, Shop, stock y compras → historia de Sheets.
7. No conectar ni migrar movimientos reales antes de probar esquema, roles, transacciones, conciliación, idempotencia y backups.
8. La pantalla «Falta configurar Supabase» en Pages indica configuración pendiente de la nueva web; no reconectar el esquema experimental eliminado a ciegas.

## Arquitectura objetivo

`React/GitHub Pages` → `Supabase Auth` → `Edge Functions (backend, código en GitHub)` → `PostgreSQL (datos, permisos, auditoría)`.

El frontend puede recibir la URL y clave publicable de Supabase para autenticación; **la clave secreta sólo en entorno del backend**. Ningún secreto se publica en GitHub Pages.
