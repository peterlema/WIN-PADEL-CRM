# WIN Gestión — roles y permisos V1
Fecha de definición: 23/11/2026. Este documento combina **decisiones confirmadas** y **alcances iniciales propuestos**, a revisar con operación antes de abrir los módulos.

## Identidades creadas en Supabase
| Usuario | Nombre visible | Rol | Habilitado | Estado |
|---|---|---|---|---|
| Pedro | Pedro Lema | ADMIN | Sí | Acceso completo |
| Gerson | Gerson | BAR | No | Se creó ficha restringida; falta asignar PIN propio |

No se registraron usuarios de recepción, academia ni profesores todavía: solamente están definidos los tipos de cuenta.

## Matriz funcional

| Rol | Permisos por módulo | Limitaciones |
|---|---|---|
| ADMIN — administrador | Todos los módulos y acciones: Caja, Canchas, Academia, Clases, Bar, Shop, Reportes, Usuarios | Sin restricciones funcionales dentro de WIN, pero cada operación sigue validaciones contables |
| RECEPTION — recepción | Caja: consultar, abrir, registrar, cerrar; Canchas: consultar, crear y cancelar; Academia y Clases: consultar; Shop: consultar | Sin permisos de administración, reportes gerenciales ni gestión del Bar |
| ACADEMY_COORDINATOR — coordinador de academia | Academia: consultar y administrar; Clases: consultar, crear y editar; Canchas: consultar y crear | Sin caja general, reportes financieros ni Bar. Reservas sujetas a reglas por horario |
| COACH — profesor | Clases propias: consultar y actualizar | Sin acceso a datos de otros profesores ni a caja, Bar o calendario general |
| BAR — encargado de bar | Bar: consultar y vender | Sin acceso a caja general, calendario, clases, academia, administración, reportes ni Shop |
| MANAGER — gerencia (compatibilidad) | Permisos operativos amplios para caja, canchas, academia, Bar, Shop y reportes | Se conserva por compatibilidad técnica; no fue solicitado como cuenta de empleado |

**Definición pendiente:** alcance concreto de `COACH.OWN_UPDATE` (asistencia, realización de clase, notas) y del módulo `BAR.MANAGE` (stock/precios/compras). No se habilita ningún permiso adicional sin decidirlo.

## Implementación actual
- Matriz en `win_auth.role_permissions`. Todas las tablas de autenticación son privadas y tienen RLS.
- `public.win_can_access(account_id,module,action)` valida la cuenta vigente, rol y acción; ADMIN tiene acceso a todos los módulos.
- `public.win_role_permissions(token)` permite al backend obtener permisos sin revelar hashes ni credenciales.
- Funciones ya existentes de Caja y Canchas revisadas para verificar la matriz **del lado de PostgreSQL**, además de la Edge Function.
- El rol BAR sólo puede registrar ventas `CAFE_BAR` en un turno abierto. La consulta de estado de Caja, para BAR, devuelve sólo identificador/jornada del turno y no los saldos ni movimientos. No puede abrir ni cerrar la caja.
- COACH no puede consultar el calendario general de canchas por la API actual; su futura agenda propia estará en el módulo Clases.
- La aplicación de frontend todavía requiere un menú dinámico y pantallas separadas por roles. **Ocultar un módulo en el navegador no sustituye estos controles de backend.**

## Seguridad y operación
- Gerson está deshabilitado con PIN aleatorio no conocido. Para habilitarlo necesita PIN propio de seis dígitos; no reutilizar el de Pedro.
- El PIN debe permanecer sólo como hash seguro en Supabase. No commitear PIN ni hash específico de usuarios.
- El personal debe tener cuentas individuales (no compartir el usuario de Pedro), caducidad de sesiones y bloqueo de intentos fallidos.
- No se migraron usuarios ni movimientos de Recepción, ni se cambió su Apps Script de producción.
